/**
 * npm run intros                      check every intro clip (and register new files dropped into intros/<brand>/)
 * npm run intros:generate -- --brand webstar [--count 6] [--mock]
 *                                     generate clips with fal (text to video). Without --mock this spends fal credit.
 *
 * An intro is 3-4 seconds of someone at a laptop, camera locked off, the laptop screen solid
 * green (or blank, with its corners given by hand). The website is never generated: the real
 * recording is pinned onto the screen when the reel is edited.
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { fillInput, loadAiConfig } from "../ai/config.js";
import { logCost } from "../ai/costs.js";
import { download, falRun } from "../ai/fal.js";
import { listBrandIds, loadBrand, type Brand } from "../lib/brand.js";
import { env } from "../lib/env.js";
import { run } from "../lib/exec.js";
import { INTRO_DIR, inspectIntro, introPath, loadIntroIndex, saveIntroIndex, type IntroClip } from "../lib/intros.js";

const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  options: { brand: { type: "string" }, count: { type: "string", default: "6" }, mock: { type: "boolean", default: false } },
});

/** Different framings, so a bank of clips doesn't look like one clip repeated. */
const FRAMINGS = [
  "Over-the-shoulder view from behind and slightly to the right of the person.",
  "Three-quarter view from the left side of the desk, the person in profile at the edge of frame.",
  "A slightly wider shot from behind, showing more of the room around the desk.",
  "A close over-the-shoulder view, the laptop filling the lower half of the frame.",
  "Three-quarter view from the right, a cup beside the laptop.",
  "A straight-on view from behind the person, shoulders framing the laptop.",
  "A high over-the-shoulder view looking down at the desk and laptop.",
  "A view from behind and to the left, soft window light across the desk.",
];

export function introPrompt(scene: string, i: number): string {
  return [
    "Vertical 9:16 video, photorealistic. The camera is locked off on a tripod and does not move at all.",
    `${scene} A person sits at a desk using an open silver laptop. ${FRAMINGS[i % FRAMINGS.length]}`,
    "The laptop's screen faces the camera and is fully visible, with nothing in front of it. The whole screen is one flat, solid, uniform chroma-key green (#00FF00): no interface, no text, no image, no glare and no reflections on it.",
    "The person's hands stay on the keyboard or beside the laptop and never cross the screen. Only small, natural movement: breathing, a slight shift, fingers typing. The laptop does not move.",
    "No text, captions, logos or brand names anywhere. No other green objects in the room.",
  ].join(" ");
}

/** Stand-in clip for --mock: a plain room colour with a green screen, so the rest of the pipeline can be tried for free. */
async function mockIntro(out: string, i: number): Promise<void> {
  const rooms = ["0x8a7f72", "0x6f7780", "0x9a8f7c"];
  await run("ffmpeg", [
    "-y", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=${rooms[i % rooms.length]}:s=1080x1920:d=3.6:r=30`,
    "-vf", `drawbox=x=${230 + i * 12}:y=${800 + i * 20}:w=620:h=388:color=0x00FF00:t=fill,noise=alls=4:allf=t`,
    "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", out,
  ]);
}

async function check(): Promise<void> {
  let clips = loadIntroIndex();
  // New files dropped into intros/<brand>/ are registered as filmed green-screen clips.
  for (const brand of listBrandIds()) {
    const dir = path.join(INTRO_DIR, brand);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((f) => /\.(mp4|mov|m4v|webm)$/i.test(f)).sort()) {
      if (clips.some((c) => c.brand === brand && c.file === file)) continue;
      clips.push({ file, brand, screen: "green", source: "filmed" });
      console.log(`+ registered intros/${brand}/${file} (filmed, green screen). Edit intros/intros.json if that is wrong.`);
    }
  }
  clips = clips.filter((c) => fs.existsSync(introPath(c)) || (console.log(`- removed ${c.brand}/${c.file}: file is gone`), false));
  saveIntroIndex(clips);

  for (const brand of listBrandIds()) {
    const mine = clips.filter((c) => c.brand === brand);
    let usable = 0;
    console.log(`\n${brand}`);
    for (const clip of mine) {
      try {
        const i = await inspectIntro(clip);
        usable++;
        console.log(`  ✓ ${clip.file}  ${i.width}x${i.height}, ${i.seconds.toFixed(1)}s, ${clip.source}, screen ${clip.corners ? "corners given" : "found"} at ${i.corners.map((c) => `(${Math.round(c[0])},${Math.round(c[1])})`).join(" ")}`);
      } catch (error) {
        console.log(`  ✗ ${clip.file}  ${error instanceof Error ? error.message : error}`);
      }
    }
    if (usable === 0) console.log("  no usable clips: this brand makes no laptop-zoom reels");
    else if (usable < 5) console.log(`  ${usable} usable clip(s). Aim for 5-8 so none repeats within five days.`);
  }
}

async function generate(brand: Brand, count: number, mock: boolean): Promise<void> {
  if (!brand.introScene) throw new Error(`brands/${brand.id}.json has no "introScene" (the room to generate)`);
  if (!mock && !env("FAL_KEY")) throw new Error("FAL_KEY is empty. Add your fal.ai key to .env, or use --mock.");
  const cfg = loadAiConfig();
  const name = env("FAL_INTRO_MODEL") ?? cfg.intro;
  const model = cfg.introModels[name];
  if (!model) throw new Error(`No intro model "${name}" in ai.json. Available: ${Object.keys(cfg.introModels).join(", ")}`);
  const usd = model.usdPerSecond * model.seconds;
  if (!mock) console.log(`Generating ${count} clip(s) with ${name} (${model.id}), about $${usd.toFixed(2)} each.`);

  const dir = path.join(INTRO_DIR, brand.id);
  fs.mkdirSync(dir, { recursive: true });
  const clips = loadIntroIndex();
  let kept = 0;
  for (let i = 0; i < count; i++) {
    let n = 1;
    while (fs.existsSync(path.join(dir, `generated-${String(n).padStart(2, "0")}.mp4`))) n++;
    const file = `generated-${String(n).padStart(2, "0")}.mp4`;
    const out = path.join(dir, file);
    let requestId = "mock";
    if (mock) await mockIntro(out, i);
    else {
      const r = await falRun(model.id, fillInput(model.input, { prompt: introPrompt(brand.introScene, n - 1), negative: "camera movement, zoom, text, logos, website, user interface on screen, reflections on screen, hands in front of screen" }));
      requestId = r.requestId;
      await download(r.url, out);
    }
    const clip: IntroClip = { file, brand: brand.id, screen: "green", source: "generated" };
    let reason = "";
    try {
      const info = await inspectIntro(clip);
      if (Math.min(info.width, info.height) < 720) reason = `resolution ${info.width}x${info.height} is too low`;
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error);
    }
    logCost(brand.id, `intro/${file}`, { kind: "video", model: model.id, requestId, seconds: model.seconds, usd: mock ? 0 : usd, result: reason ? "rejected" : "used", reason: reason || undefined });
    if (reason) {
      // A clip without a clean, still, green screen can't take the real recording, so it is never used.
      fs.rmSync(out, { force: true });
      console.log(`  ✗ ${file} rejected: ${reason}`);
      continue;
    }
    clips.push(clip);
    saveIntroIndex(clips);
    kept++;
    console.log(`  ✓ intros/${brand.id}/${file}`);
  }
  console.log(`${kept} of ${count} clip(s) kept. Watch them before they go out: delete any you don't like and run \`npm run intros\`.`);
}

try {
  if (positionals[0] === "generate") {
    if (!flags.brand) throw new Error("--brand is required");
    await generate(loadBrand(flags.brand), Math.max(1, Number(flags.count) || 6), flags.mock!);
  } else await check();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
