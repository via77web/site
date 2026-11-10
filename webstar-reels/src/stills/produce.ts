import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { dropTrailingPhrase } from "../../remotion/captions.js";
import { reelSeconds } from "../../remotion/timing.js";
import { ROOT, type Brand } from "../lib/brand.js";
import { loadBatches, saveBatch } from "../lib/batches.js";
import type { Campaign } from "../lib/calendar.js";
import { env } from "../lib/env.js";
import { run } from "../lib/exec.js";
import { generate } from "../lib/llm.js";
import { log, step, warn } from "../lib/log.js";
import { nextHooks } from "../lib/queue.js";
import { postText } from "../reels.js";
import { openSite } from "../steps/record.js";
import { renderStills, renderVariants } from "../steps/render.js";
import { mockScripts, scriptProblems } from "../steps/script.js";
import { mockVoice, synthesizeVoice } from "../steps/voice.js";
import { VARIANT_LABEL, type Batch, type Shot, type StillFormat, type VariantScript } from "../types.js";
import { libraryDir, libraryText, loadLibrary, usableImages, type Library, type LibraryImage } from "./library.js";

/** Formats in the order the week cycles through them. */
export const FORMAT_CYCLE: StillFormat[] = ["transformation", "showcase", "finish", "explainer", "site-scroll"];

export const ScriptSchema = z.object({
  hook: z.string(),
  voiceover: z.string().describe("Spoken script, starting with the hook"),
  captions: z.array(z.string()).describe("The voiceover split into consecutive 2-4 word phrases"),
  postCaption: z.string().describe("1-3 short sentences, no hashtags"),
  hashtags: z.array(z.string()).describe("8-12 hashtags without #"),
  youtubeTitle: z.string().describe("Under 90 characters, no hashtags"),
  rows: z
    .array(z.object({ label: z.string(), wrap: z.string(), replace: z.string() }))
    .describe("Explainer only: exactly 4 rows labelled Cost, Time, Downtime, Waste, each value 1-4 words. Empty for other formats."),
});

interface Plan {
  format: StillFormat;
  images: LibraryImage[];
  pageUrl?: string;
  material?: string;
  space?: string;
  footage: string;
}

/** Library images and pages, least recently used first, so reels don't repeat photos. */
export function recency(brand: Brand): Map<string, number> {
  const last = new Map<string, number>();
  for (const b of loadBatches(brand)) {
    for (const v of b.variants) for (const a of v.assets ?? []) last.set(a, Math.max(last.get(a) ?? 0, Date.parse(b.createdAt)));
  }
  return last;
}

export const byRecency = <T>(items: T[], key: (t: T) => string, last: Map<string, number>) =>
  [...items].sort((a, b) => (last.get(key(a)) ?? 0) - (last.get(key(b)) ?? 0));

const labelOf = (img: LibraryImage) => [img.spaces[0], img.materials[0]].filter(Boolean).join(" · ");

/** Choose footage for a format. Falls back to a showcase when the library can't support it. */
export function planReel(brand: Brand, lib: Library, format: StillFormat): Plan {
  const last = recency(brand);
  const images = byRecency(usableImages(brand, lib), (i) => i.id, last);
  if (!images.length && format !== "site-scroll") throw new Error("The library has no usable photos");

  if (format === "transformation") {
    const pairs = byRecency(lib.pairs, (p) => p.before, last)
      .map((p) => ({ p, before: images.find((i) => i.id === p.before), after: images.find((i) => i.id === p.after) }))
      .filter((x) => x.before && x.after);
    if (pairs.length) {
      const { before, after, p } = pairs[0];
      return {
        format,
        images: [before!, after!],
        space: p.space,
        footage: `A before photo, then a wipe reveals the after photo of the same ${p.space ?? "space"}. Before: ${before!.description ?? before!.alt}. After: ${after!.description ?? after!.alt}.`,
      };
    }
    warn("no before/after pairs in the library; making a showcase instead");
    return planReel(brand, lib, "showcase");
  }

  if (format === "finish") {
    const materials = lib.materials.filter((m) => images.some((i) => i.materials.includes(m.name)));
    const material = byRecency(materials, (m) => `material:${m.name}`, last)[0];
    if (material) {
      const shots = images.filter((i) => i.materials.includes(material.name)).slice(0, 3);
      return {
        format,
        images: shots,
        material: material.name,
        footage: `Slow, close zooms into ${shots.length} photos of work in ${material.name}: ${shots.map((s) => s.description ?? s.alt).join("; ")}.`,
      };
    }
    warn("no photos are tagged with a named material; making a showcase instead");
    return planReel(brand, lib, "showcase");
  }

  if (format === "explainer") {
    return { format, images: images.slice(0, 1), footage: "A dimmed project photo behind an animated table: wrap vs replace on cost, time, downtime and waste." };
  }

  if (format === "site-scroll") {
    const pages = lib.pages.filter((p) => !/privacy|terms|contact|thank/i.test(p.url));
    const page = byRecency(pages.length ? pages : [{ url: lib.site, title: "Home", headings: [], text: "" }], (p) => `page:${p.url}`, last)[0];
    return { format, images: [], pageUrl: page.url, footage: `A phone screen recording scrolling ${page.title || page.url} on Verrano's website, top to bottom.` };
  }

  // showcase: the least-used space with enough photos, else the least-used photos overall.
  const spaces = new Map<string, LibraryImage[]>();
  for (const img of images) for (const s of img.spaces) spaces.set(s, [...(spaces.get(s) ?? []), img]);
  const group = [...spaces.entries()].filter(([, imgs]) => imgs.length >= 3).sort((a, b) => {
    const age = (imgs: LibraryImage[]) => Math.max(...imgs.slice(0, 4).map((i) => last.get(i.id) ?? 0));
    return age(a[1]) - age(b[1]);
  })[0];
  const shots = (group ? group[1] : images).slice(0, 4);
  return {
    format: "showcase",
    images: shots,
    space: group?.[0],
    footage: `Slow pans and zooms across ${shots.length} project photos${group ? ` of ${group[0]}s` : ""}: ${shots.map((s) => s.description ?? s.alt).join("; ")}.`,
  };
}

const MOTIONS: Shot["motion"][] = ["zoom-in", "pan-left", "zoom-out", "pan-right"];

export function shotFor(brand: Brand, img: LibraryImage, i: number, label = true): Shot {
  const landscape = img.width / img.height > 0.75;
  return {
    src: path.join(libraryDir(brand), img.file),
    width: img.width,
    height: img.height,
    motion: landscape ? MOTIONS[i % MOTIONS.length] : i % 2 ? "zoom-out" : "zoom-in",
    label: label ? labelOf(img) || undefined : undefined,
  };
}

/**
 * ANIMATE_STILL_CMD turns a photo into a short clip, e.g. your fal/Wan script:
 *   ANIMATE_STILL_CMD='python3 ~/scripts/wan.py --image {input} --out {output} --prompt {prompt}'
 * {input}, {output} and {prompt} are filled in (shell-quoted). On failure the photo is used as is.
 */
async function maybeAnimate(file: string, prompt: string, outDir: string): Promise<string | null> {
  const template = env("ANIMATE_STILL_CMD");
  if (!template) return null;
  const out = path.join(outDir, `${path.basename(file).replace(/\.\w+$/, "")}-anim.mp4`);
  if (fs.existsSync(out)) return out;
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const cmd = template.replaceAll("{input}", q(file)).replaceAll("{output}", q(out)).replaceAll("{prompt}", q(prompt));
  try {
    await step(`animate ${path.basename(file)}`, () => run("/bin/sh", ["-c", cmd]));
    return fs.existsSync(out) ? out : null;
  } catch {
    warn(`could not animate ${path.basename(file)}; using the still`);
    return null;
  }
}

export function systemPrompt(brand: Brand, lib: Library, campaign?: Campaign): string {
  const services = lib.services.map((s) => `## ${s.title}\n${s.text}`).join("\n\n").slice(0, 9000);
  return `You write short-form video scripts for ${brand.name}. ${brand.about}

Audience: ${brand.audience}
Voice: ${brand.tone}.
${brand.rules.map((r) => `- ${r}`).join("\n")}
${campaign ? `\nCurrent campaign: ${campaign.name}. ${campaign.angle}\n` : ""}
How the reel is assembled:
- The hook is on screen for the first ${brand.style.hookSeconds} seconds and is the first thing the voice says.
- The voiceover is read by a text-to-speech voice over about ${brand.scroll.seconds} seconds. At most ${brand.voice.maxWords} words, counting the hook. Spell out numbers and web addresses as spoken. End with: "${brand.spokenCta}"
- Split the voiceover into 2-4 word caption phrases that reproduce it exactly.
- The reel is cross-posted to Instagram Reels, TikTok and YouTube Shorts. Include these hashtags: ${brand.hashtags.join(", ")}.

Verrano's own website copy. This is the only source of facts; anything with a figure must come from here:
<site>
${services}

Facts and comparisons stated on the site:
${lib.facts.map((f) => `- ${f}`).join("\n") || "- (none found)"}

Materials and finishes named on the site: ${lib.materials.map((m) => m.name).join(", ") || "(none found)"}
</site>`;
}

/** Every figure in the script must appear somewhere in the crawled site text. */
export function factProblems(texts: string[], lib: Library): string[] {
  const source = libraryText(lib).toLowerCase();
  const figures = texts.join(" ").match(/\$?\d[\d,.]*\s?(%|percent|days?|weeks?|hours?|years?|x\b)?/gi) ?? [];
  return figures
    .map((f) => f.trim())
    .filter((f) => f && !source.includes(f.toLowerCase()) && !source.includes(f.replace(/\s+/g, "").toLowerCase()))
    .map((f) => `"${f}" is not stated on Verrano's site. Remove it or use a qualitative comparison.`);
}

export interface StillReelOptions {
  dryRun: boolean;
  mock: boolean;
  campaign?: Campaign;
  plannedFor?: string;
}

/** Make one photo-library reel in the given format and save it as a "ready" batch. */
export async function produceStillReel(brand: Brand, wanted: StillFormat, opts: StillReelOptions): Promise<Batch> {
  const lib = loadLibrary(brand);
  const plan = planReel(brand, lib, wanted);
  const format = plan.format;
  const id = `${brand.id}-${opts.plannedFor ?? new Date().toISOString().slice(0, 10)}-${format}${loadBatches(brand).some((b) => b.id === `${brand.id}-${opts.plannedFor}-${format}`) ? `-${Date.now() % 10000}` : ""}`;
  const workDir = path.join(ROOT, "out", brand.id, id);
  fs.mkdirSync(workDir, { recursive: true });
  const file = (n: string) => path.join(workDir, n);
  log(`[${brand.id}] ${VARIANT_LABEL[format]}${plan.space ? ` (${plan.space})` : ""}${plan.material ? ` (${plan.material})` : ""}${plan.pageUrl ? ` (${plan.pageUrl})` : ""}`);

  const [hook] = nextHooks(brand, 1, opts.campaign, (h) => h);
  let script: VariantScript & { rows?: { label: string; wrap: string; replace: string }[] };
  if (opts.mock) {
    script = {
      ...mockScripts(brand, { name: brand.name, niche: "surface wrapping", url: lib.site, concept: false }, [format], [hook])[0],
      rows:
        format === "explainer"
          ? [
              { label: "Cost", wrap: "Lower", replace: "Higher" },
              { label: "Time", wrap: "Faster", replace: "Longer" },
              { label: "Downtime", wrap: "Minimal", replace: "Disruptive" },
              { label: "Waste", wrap: "Less to landfill", replace: "Old units dumped" },
            ]
          : [],
    };
  } else {
    const result = await step(`script ${format}`, () =>
      generate({
        label: `${brand.id} ${format} script`,
        schema: ScriptSchema,
        system: systemPrompt(brand, lib, opts.campaign),
        prompt: `Write one reel script.

Format: ${VARIANT_LABEL[format]}. Footage: ${plan.footage}
Hook: ${hook}${plan.material ? `\nThe finish on screen is ${plan.material}; name it exactly like that.` : ""}${format === "explainer" ? "\nAlso fill rows: Cost, Time, Downtime, Waste. Wrap and replace values of 1-4 words each, qualitative unless the site states a figure." : ""}`,
        effort: "medium",
        check: (s) => [
          ...scriptProblems({ ...s, variant: format }, brand),
          ...factProblems([s.voiceover, s.postCaption, s.youtubeTitle, ...s.rows.flatMap((r) => [r.wrap, r.replace])], lib),
          ...(format === "explainer" && s.rows.length !== 4 ? ["The explainer needs exactly 4 rows."] : []),
        ],
      }),
    );
    script = { ...result, variant: format, hashtags: result.hashtags.map((h) => h.replace(/^#+/, "").replace(/\s+/g, "")) };
  }

  const voiceFile = file("voice.mp3");
  const voice = opts.mock
    ? await mockVoice(script.voiceover, voiceFile, brand)
    : await step(`voice ${format}`, () => synthesizeVoice(script.voiceover, voiceFile, brand));
  const total = reelSeconds(voice.duration, brand.scroll.seconds, brand.style.endCardSeconds);
  const shown = brand.captionSpokenCta ? { words: voice.words, captions: script.captions } : dropTrailingPhrase(voice.words, script.captions, brand.spokenCta);
  const outFile = file(`${id}.mp4`);
  let aiDisclosure: string | null = null;

  if (format === "site-scroll") {
    const session = await step("open site", () => openSite(plan.pageUrl!));
    try {
      await step("record site", () =>
        session.record({
          full: { file: file("full-recording.mp4"), duration: total, heroHold: Math.max(brand.scroll.heroHold, brand.style.hookSeconds), sectionHold: brand.scroll.sectionHold, footerHold: brand.style.endCardSeconds },
        }),
      );
    } finally {
      await session.close();
    }
    await step("render", () =>
      renderVariants(brand, [{ variant: "full", recordingFile: file("full-recording.mp4"), voiceFile, totalSeconds: total, hook: script.hook, captions: shown.captions, words: shown.words, outFile }], false),
    );
  } else {
    const shots: Shot[] = [];
    const files: string[] = [];
    const add = async (img: LibraryImage, i: number, label = true) => {
      const shot = shotFor(brand, img, i, label);
      const anim = format === "showcase" ? await maybeAnimate(shot.src, `Slow, steady camera move across this ${img.spaces[0] ?? "room"}. ${img.description ?? img.alt}`, workDir) : null;
      if (anim) {
        shot.video = true;
        shot.src = anim;
      }
      files.push(shot.src);
      return shot;
    };
    let pair: { before: Shot; after: Shot } | null = null;
    if (format === "transformation") {
      const before = shotFor(brand, plan.images[0], 0, false);
      const after = { ...shotFor(brand, plan.images[1], 0), motion: before.motion };
      files.push(before.src, after.src);
      pair = { before, after };
    } else {
      for (const [i, img] of plan.images.entries()) shots.push(await add(img, i, format === "showcase"));
      if (format === "finish") shots.forEach((s) => (s.motion = "zoom-in"));
    }
    // Stills animated by a generative model are AI footage: the whole reel carries the label.
    const animated = shots.some((s) => s.video);
    if (animated) aiDisclosure = brand.ai?.disclosure ?? "Includes AI-animated footage.";
    await step("render", () =>
      renderStills(brand, {
        props: {
          format,
          shots,
          pair,
          aiLabel: animated ? (brand.ai?.label ?? "Visualisation") : null,
          material: plan.material ? { name: plan.material, note: "Finish spotlight" } : null,
          rows: format === "explainer" ? (script.rows ?? null) : null,
          totalSeconds: total,
          hook: script.hook,
          captions: shown.captions,
          words: shown.words,
        },
        files,
        voiceFile,
        outFile,
      }),
    );
  }

  const { rows: _rows, ...cleanScript } = script;
  const batch: Batch = {
    id,
    brand: brand.id,
    createdAt: new Date().toISOString(),
    source: "library",
    site: { name: `${brand.name} · ${VARIANT_LABEL[format]}`, url: plan.pageUrl ?? lib.site, niche: "surface wrapping", concept: false },
    campaign: opts.campaign?.id,
    variants: [
      {
        id: format,
        status: "ready",
        script: cleanScript,
        postText: (aiDisclosure ? `${aiDisclosure} ` : "") + postText(cleanScript, false, opts.campaign),
        seconds: total,
        file: path.relative(ROOT, outFile),
        plannedFor: opts.plannedFor,
        assets: [
          ...plan.images.map((i) => i.id),
          ...(plan.material ? [`material:${plan.material}`] : []),
          ...(plan.pageUrl ? [`page:${plan.pageUrl}`] : []),
        ],
      },
    ],
  };
  if (!opts.dryRun) saveBatch(batch);
  fs.writeFileSync(file("batch.json"), JSON.stringify(batch, null, 2));
  log(`[${brand.id}] ready: ${path.relative(process.cwd(), outFile)} "${script.hook}"`);
  return batch;
}
