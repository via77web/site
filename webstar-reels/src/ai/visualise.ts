import fs from "node:fs";
import path from "node:path";
import { reelSeconds } from "../../remotion/timing.js";
import { ROOT, type Brand } from "../lib/brand.js";
import { loadBatches, saveBatch } from "../lib/batches.js";
import { run } from "../lib/exec.js";
import { generate } from "../lib/llm.js";
import { log, step, warn } from "../lib/log.js";
import { nextHooks } from "../lib/queue.js";
import { postText } from "../reels.js";
import { renderStills } from "../steps/render.js";
import { mockScripts, scriptProblems } from "../steps/script.js";
import { mockVoice, synthesizeVoice } from "../steps/voice.js";
import { libraryDir, loadLibrary, usableImages, type LibraryImage } from "../stills/library.js";
import { ScriptSchema, byRecency, factProblems, recency, systemPrompt, type StillReelOptions } from "../stills/produce.js";
import { AI_FORMATS, VARIANT_LABEL, type AiCost, type AiFormat, type Batch, type Shot, type VariantScript } from "../types.js";
import { fillInput, loadAiConfig, videoModel, type AiConfig, type VideoModelConfig } from "./config.js";
import { logCost, spentUsd } from "./costs.js";
import { dataUri, download, falRun, mockClip, mockEdit } from "./fal.js";
import { technicalCheck, visionCheck } from "./qc.js";

export const AI_CYCLE: readonly AiFormat[] = AI_FORMATS;

const NEGATIVE =
  "people, hands, faces, text, letters, numbers, logos, watermark, signage, warped lines, bending edges, melting, morphing furniture, flicker, strobing, fast motion, camera shake, fisheye";

const RULES =
  "Only the camera moves; nothing else in the scene moves. Photoreal lighting that matches the photo, with natural soft shadows. Every edge of the cabinetry, walls and benchtops stays perfectly straight and rigid. No people. No text, lettering, logos or signage anywhere in frame.";

const MOVES = ["a slow, steady dolly forward", "a slow cinematic push-in", "a slow, level pan to the right", "a slow, level pan to the left"];

/** Works out one reel's generations, and enforces the per-reel budget as it goes. */
class Studio {
  items: AiCost[] = [];
  spent = 0;
  private n = 0;

  constructor(
    private brand: Brand,
    private reel: string,
    private dir: string,
    private cfg: AiConfig,
    readonly model: VideoModelConfig,
    private mock: boolean,
  ) {}

  private charge(c: AiCost): void {
    this.items.push(c);
    this.spent += c.usd;
    if (!this.mock) logCost(this.brand.id, this.reel, c);
  }

  private affordable(usd: number, what: string): boolean {
    if (this.spent + usd <= this.cfg.budget.maxUsdPerReel) return true;
    warn(`   skipping ${what}: it would take this reel past $${this.cfg.budget.maxUsdPerReel}`);
    return false;
  }

  /** A real photo, cropped to the vertical frame, ready to send to a model. */
  async prepare(img: LibraryImage): Promise<string> {
    const out = path.join(this.dir, `src-${img.id}.jpg`);
    await run("ffmpeg", [
      "-y", "-loglevel", "error", "-i", path.join(libraryDir(this.brand), img.file),
      "-vf", "scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920", "-q:v", "2", out,
    ]);
    return out;
  }

  /** Re-finish the surfaces in a photo. Null if no attempt passes the checks. */
  async edit(source: string, finish: { name: string; prompt: string }, index: number): Promise<string | null> {
    const { imageEdit, qc } = this.cfg;
    const out = path.join(this.dir, `edit-${++this.n}-${finish.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.jpg`);
    const prompt = `Re-finish the cabinetry, joinery and panel surfaces in this photo with ${finish.prompt}. Change only the surface finish. Keep the room layout, geometry, camera angle, lighting, reflections, handles, benchtops, floor and every other object exactly as they are. Photorealistic. No text or logos.`;
    for (let attempt = 1; attempt <= qc.attempts; attempt++) {
      if (!this.affordable(imageEdit.usdPerImage, `the ${finish.name} image`)) return null;
      let requestId = "mock";
      if (this.mock) await mockEdit(source, out, index);
      else {
        const r = await step(`fal image ${finish.name}`, () => falRun(imageEdit.id, fillInput(imageEdit.input, { prompt, image: dataUri(source) })));
        requestId = r.requestId;
        const raw = out.replace(/\.jpg$/, "-raw");
        await download(r.url, raw);
        await run("ffmpeg", ["-y", "-loglevel", "error", "-i", raw, "-vf", "scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920", "-q:v", "2", out]);
        fs.rmSync(raw, { force: true });
      }
      const seen = !this.mock && qc.vision
        ? await visionCheck(out, source, "image", `The same room as the reference, with its cabinetry re-finished in ${finish.name}.`)
        : { ok: true, reason: "" };
      this.charge({ kind: "image", model: imageEdit.id, requestId, usd: this.mock ? 0 : imageEdit.usdPerImage, result: seen.ok ? "used" : "rejected", reason: seen.ok ? undefined : seen.reason });
      if (seen.ok) return out;
    }
    return null;
  }

  /** Animate a still (optionally morphing to an end frame). Null if no attempt passes the checks. */
  async clip(start: string, end: string | undefined, prompt: string, context: string): Promise<{ file: string; seconds: number } | null> {
    const { qc, upscale } = this.cfg;
    const m = this.model;
    const useEnd = end && m.endFrame ? end : undefined;
    const id = useEnd && m.endFrame?.id ? m.endFrame.id : m.id;
    const usd = m.usdPerSecond * m.seconds;
    for (let attempt = 1; attempt <= qc.attempts; attempt++) {
      if (!this.affordable(usd, "a clip")) return null;
      let out = path.join(this.dir, `clip-${++this.n}.mp4`);
      let requestId = "mock";
      if (this.mock) await mockClip(start, useEnd, out, m.seconds);
      else {
        const values = { prompt, negative: NEGATIVE, image: dataUri(start), ...(useEnd ? { end_image: dataUri(useEnd) } : {}) };
        const template = useEnd ? (m.endFrame!.replace ? m.endFrame!.input : { ...m.input, ...m.endFrame!.input }) : m.input;
        const r = await step(`fal clip (${m.name})`, () => falRun(id, fillInput(template, values)));
        requestId = r.requestId;
        await download(r.url, out);
      }
      let tech = await technicalCheck(out, qc);
      // Too small but otherwise fine: upscale it if an upscaler is configured.
      if (!tech.ok && upscale && !this.mock && tech.reasons.every((r) => r.startsWith("resolution"))) {
        const up = await step("fal upscale", () => falRun(upscale.id, fillInput(upscale.input, { video: dataUri(out) })));
        const bigger = out.replace(/\.mp4$/, "-up.mp4");
        await download(up.url, bigger);
        this.charge({ kind: "upscale", model: upscale.id, requestId: up.requestId, seconds: tech.seconds, usd: upscale.usdPerSecond * tech.seconds, result: "used" });
        out = bigger;
        tech = await technicalCheck(out, qc);
      }
      let reason = tech.reasons.join("; ");
      if (tech.ok && qc.vision && !this.mock) {
        const seen = await visionCheck(out, start, "clip", context);
        if (!seen.ok) reason = seen.reason;
      }
      this.charge({ kind: "video", model: id, requestId, seconds: tech.seconds, usd: this.mock ? 0 : usd, result: reason ? "rejected" : "used", reason: reason || undefined });
      if (!reason) return { file: out, seconds: tech.seconds };
      warn(`   clip rejected (attempt ${attempt}/${qc.attempts}): ${reason}`);
    }
    return null;
  }
}

const noPeople = (img: LibraryImage) => !/\b(person|people|man|woman|worker|installer|hands?|face)\b/i.test(`${img.description ?? ""} ${img.alt}`);

interface Built {
  shots: Shot[];
  files: string[];
  sources: LibraryImage[];
  footage: string;
  finishNames: string[];
}

const still = (file: string, seconds: number | undefined, label?: string): Shot => ({ src: file, width: 1080, height: 1920, motion: "none", seconds, label });
const clipShot = (c: { file: string; seconds: number }, label?: string): Shot => ({ src: c.file, width: 1080, height: 1920, motion: "none", video: true, seconds: c.seconds, label });

async function build(format: AiFormat, brand: Brand, studio: Studio, images: LibraryImage[], rotation: number): Promise<Built> {
  const ai = brand.ai!;
  const open = brand.style.hookSeconds + 0.4;
  const finishes = ai.finishes.map((_, i) => ai.finishes[(i + rotation) % ai.finishes.length]).slice(0, 3);
  const move = MOVES[rotation % MOVES.length];
  const canMorph = !!studio.model.endFrame;

  if (format === "finish-mood") {
    const tagged = images.filter((i) => i.materials.length);
    const sources = (tagged.length ? tagged : images).slice(0, 2);
    const shots: Shot[] = [];
    const used: LibraryImage[] = [];
    for (const img of sources) {
      const src = await studio.prepare(img);
      const c = await studio.clip(
        src,
        undefined,
        `A very slow, close glide across the finished surface, low raking light revealing its texture and grain. ${RULES}`,
        "A close, slow move across a wrapped surface in the reference photo.",
      );
      if (c) {
        shots.push(clipShot(c, img.materials[0]));
        used.push(img);
      }
    }
    if (!shots.length) throw new Error("no finish clip passed the quality check");
    const last = await studio.prepare(used[used.length - 1]);
    shots.push(still(last, undefined));
    return { shots, files: shots.map((s) => s.src), sources: used, footage: `Close, slow AI camera moves across ${used.length} wrapped surface(s), showing texture.`, finishNames: used.flatMap((i) => i.materials.slice(0, 1)) };
  }

  if (format === "visualised") {
    const before = images.find((i) => i.role === "before") ?? images[0];
    const src = await studio.prepare(before);
    const finish = finishes[0];
    const after = await studio.edit(src, finish, rotation);
    if (!after) throw new Error("the visualised image did not pass the quality check");
    const label = `Visualised · ${finish.name}`;
    const c = await studio.clip(
      canMorph ? src : after,
      canMorph ? after : undefined,
      canMorph
        ? `${move[0].toUpperCase()}${move.slice(1)} as the cabinetry surfaces smoothly change to ${finish.prompt}. Only the surface finish changes. ${RULES}`
        : `${move[0].toUpperCase()}${move.slice(1)} through this interior. ${RULES}`,
      `The room in the reference photo, ${canMorph ? `its cabinetry changing to ${finish.name}` : `re-finished in ${finish.name}`}.`,
    );
    // Hold on the real photo long enough for its label to register after the hook clears.
    const shots = [still(src, open + 1.4, "Before · real photo"), ...(c ? [clipShot(c, label)] : []), still(after, undefined, label)];
    return { shots, files: shots.map((s) => s.src), sources: [before], footage: `A real before photo of a ${before.spaces[0] ?? "space"}, which morphs into an AI visualisation of the same space wrapped in ${finish.name}.`, finishNames: [finish.name] };
  }

  // imagine: the same room in two or three finishes.
  const room = images.find((i) => i.role !== "before") ?? images[0];
  const src = await studio.prepare(room);
  const edits: { file: string; name: string }[] = [];
  for (const [i, f] of finishes.entries()) {
    const e = await studio.edit(src, f, i + rotation);
    if (e) edits.push({ file: e, name: f.name });
  }
  if (edits.length < 2) throw new Error("fewer than two finishes passed the quality check");
  const shots: Shot[] = [];
  if (canMorph) {
    shots.push(still(edits[0].file, open, edits[0].name));
    for (let i = 1; i < edits.length; i++) {
      const c = await studio.clip(
        edits[i - 1].file,
        edits[i].file,
        `${move[0].toUpperCase()}${move.slice(1)} as the cabinetry finish smoothly changes from ${edits[i - 1].name} to ${edits[i].name}. Only the surface finish changes. ${RULES}`,
        `The same room, its cabinetry changing from ${edits[i - 1].name} to ${edits[i].name}.`,
      );
      // If the morph fails its checks, hold on the next finish instead; the edit cross-fades.
      shots.push(c ? clipShot(c, edits[i].name) : still(edits[i].file, 3, edits[i].name));
    }
    shots.push(still(edits[edits.length - 1].file, undefined, edits[edits.length - 1].name));
  } else {
    for (const e of edits) {
      const c = await studio.clip(e.file, undefined, `${move[0].toUpperCase()}${move.slice(1)} through this interior. ${RULES}`, `The room re-finished in ${e.name}.`);
      shots.push(c ? clipShot(c, e.name) : still(e.file, 3, e.name));
    }
    shots.push(still(edits[edits.length - 1].file, undefined, edits[edits.length - 1].name));
  }
  if (!shots.some((s) => s.video)) warn("   no clip passed; this reel cross-fades between the visualised stills");
  return { shots, files: shots.map((s) => s.src), sources: [room], footage: `One ${room.spaces[0] ?? "room"} shown as AI visualisations in ${edits.map((e) => e.name).join(", ")}, changing smoothly from one finish to the next.`, finishNames: edits.map((e) => e.name) };
}

/**
 * One AI visualisation reel from real library photos. Every such reel carries the on-screen
 * label for its full length and a caption that starts with the disclosure line.
 */
export async function produceAiReel(brand: Brand, format: AiFormat, opts: StillReelOptions): Promise<Batch> {
  const ai = brand.ai;
  if (!ai) throw new Error(`brands/${brand.id}.json has no "ai" section`);
  const cfg = loadAiConfig();
  const model = videoModel(cfg);
  if (!opts.mock) {
    const week = spentUsd(7);
    if (week >= cfg.budget.maxUsdPerWeek) throw new Error(`AI budget reached: $${week.toFixed(2)} spent in the last 7 days (limit $${cfg.budget.maxUsdPerWeek} in ai.json)`);
  }
  const lib = loadLibrary(brand);
  const last = recency(brand);
  const images = byRecency(usableImages(brand, lib).filter(noPeople), (i) => i.id, last);
  if (!images.length) throw new Error("the library has no usable photos without people");

  const made = loadBatches(brand).filter((b) => b.variants.some((v) => (AI_FORMATS as readonly string[]).includes(v.id))).length;
  const base = `${brand.id}-${opts.plannedFor ?? new Date().toISOString().slice(0, 10)}-${format}`;
  const id = loadBatches(brand).some((b) => b.id === base) ? `${base}-${Date.now() % 10000}` : base;
  const workDir = path.join(ROOT, "out", brand.id, id);
  fs.mkdirSync(workDir, { recursive: true });
  const file = (n: string) => path.join(workDir, n);
  log(`[${brand.id}] ${VARIANT_LABEL[format]} with ${model.name} (${opts.mock ? "mock" : model.id})`);

  const studio = new Studio(brand, id, workDir, cfg, model, opts.mock);
  const built = await build(format, brand, studio, images, made);

  // The script speaks the visualisation call to action instead of the brand's usual one.
  const aiBrand: Brand = { ...brand, cta: ai.cta, spokenCta: ai.spokenCta, captionSpokenCta: true };
  const [hook] = nextHooks(brand, 1, opts.campaign, (h) => h);
  let script: VariantScript;
  if (opts.mock) {
    script = mockScripts(aiBrand, { name: brand.name, niche: "surface wrapping", url: lib.site, concept: false }, [format], ["Imagine your space in a new finish"])[0];
  } else {
    const result = await step(`script ${format}`, () =>
      generate({
        label: `${brand.id} ${format} script`,
        schema: ScriptSchema,
        system: systemPrompt(aiBrand, lib, opts.campaign),
        prompt: `Write one reel script for an AI visualisation reel.

Format: ${VARIANT_LABEL[format]}. Footage: ${built.footage}
Finishes shown: ${built.finishNames.join(", ") || "as photographed"}.

This reel is a visualisation, not a completed job. The viewer sees a "${ai.label}" label on screen throughout. Write it as an invitation to picture their own space: "imagine", "here's how it could look". Never say or imply Verrano carried out the work shown, and never describe the visualised result as a real project, a client's space or a finished job.
The hook should fit that; use this one only if it does, otherwise write a new one in the same voice: ${hook}
Leave rows empty.`,
        effort: "medium",
        check: (s) => [
          ...scriptProblems({ ...s, variant: format }, aiBrand),
          ...factProblems([s.voiceover, s.postCaption, s.youtubeTitle], lib),
          ...(/\b(we (did|wrapped|finished|completed|transformed)|our latest (job|project)|this (job|project) (was|took))\b/i.test(`${s.voiceover} ${s.postCaption}`)
            ? ["The script describes the visualisation as a real completed job. Rewrite it as an invitation to imagine the result."]
            : []),
        ],
      }),
    );
    const { rows: _rows, ...rest } = result;
    script = { ...rest, variant: format, hashtags: rest.hashtags.map((h) => h.replace(/^#+/, "").replace(/\s+/g, "")) };
  }
  if (!script.hashtags.includes("aivisualisation")) script.hashtags.push("aivisualisation");

  const voiceFile = file("voice.mp3");
  const voice = opts.mock ? await mockVoice(script.voiceover, voiceFile, aiBrand) : await step(`voice ${format}`, () => synthesizeVoice(script.voiceover, voiceFile, aiBrand));

  // Clips play at their real length; the last still fills whatever time is left.
  const fixed = built.shots.reduce((sum, s) => sum + (s.seconds ?? 0), 0);
  const total = Math.max(reelSeconds(voice.duration, brand.scroll.seconds, brand.style.endCardSeconds), fixed + 0.8 + brand.style.endCardSeconds);
  built.shots[built.shots.length - 1].seconds = total - fixed;
  const outFile = file(`${id}.mp4`);
  await step("render", () =>
    renderStills(brand, {
      props: { format, shots: built.shots, pair: null, material: null, rows: null, aiLabel: ai.label, totalSeconds: total, hook: script.hook, captions: script.captions, words: voice.words },
      files: built.files,
      voiceFile,
      outFile,
      cta: ai.cta,
    }),
  );

  const caption = postText(script, false, opts.campaign);
  const batch: Batch = {
    id,
    brand: brand.id,
    createdAt: new Date().toISOString(),
    source: "library",
    site: { name: `${brand.name} · ${VARIANT_LABEL[format]}`, url: lib.site, niche: "surface wrapping", concept: false },
    campaign: opts.campaign?.id,
    variants: [
      {
        id: format,
        status: "ready",
        script,
        // The disclosure always opens the caption, whatever the script wrote.
        postText: caption.includes(ai.disclosure) ? caption : `${ai.disclosure} ${caption}`,
        seconds: total,
        file: path.relative(ROOT, outFile),
        plannedFor: opts.plannedFor,
        assets: built.sources.map((i) => i.id),
        ai: { usd: Number(studio.spent.toFixed(2)), items: studio.items },
      },
    ],
  };
  if (!opts.dryRun) saveBatch(batch);
  fs.writeFileSync(file("batch.json"), JSON.stringify(batch, null, 2));
  const rejected = studio.items.filter((i) => i.result === "rejected").length;
  log(`[${brand.id}] ready: ${path.relative(process.cwd(), outFile)} · AI cost $${studio.spent.toFixed(2)}${rejected ? ` (${rejected} rejected generation(s) included)` : ""}`);
  return batch;
}
