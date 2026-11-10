import fs from "node:fs";
import path from "node:path";
import { dropTrailingPhrase } from "../remotion/captions.js";
import { reelSeconds } from "../remotion/timing.js";
import { ROOT, type Brand } from "./lib/brand.js";
import { loadBatches, saveBatch } from "./lib/batches.js";
import { loadCalendar, localDate, type Campaign } from "./lib/calendar.js";
import { nextHooks, slugify } from "./lib/queue.js";
import { step } from "./lib/log.js";
import { beforeFile, openSite, type ClipOptions } from "./steps/record.js";
import { musicFor, renderVariants, type RenderJob } from "./steps/render.js";
import { mockScripts, writeScripts } from "./steps/script.js";
import { mockVoice, synthesizeVoice } from "./steps/voice.js";
import { VARIANT_LABEL, type Batch, type SiteVariant, type VariantScript, type WordTiming } from "./types.js";

export interface BatchInput {
  /** Where the recorder loads the site from (may be a local server for generated sites). */
  url: string;
  /** Public address shown in the approval message. Defaults to `url`. */
  publicUrl?: string;
  name: string;
  niche: string;
  concept: boolean;
  beforeUrl?: string;
  source: Batch["source"];
  brief?: string;
  direction?: string;
  audit?: Batch["audit"];
}

export interface BatchOptions {
  /** Render everything, but save nothing. */
  dryRun: boolean;
  /** Canned scripts and a silent voice: no API calls. */
  mock: boolean;
  campaign?: Campaign;
}

/**
 * Caption exactly as posted: the copy, then the comment-to-DM prompt, then hashtags.
 * Concepts are always labelled, and the prompt is always there: both are added here, not left to the script.
 */
export function postText(script: VariantScript, concept: boolean, campaign: Campaign | undefined, brand: Pick<Brand, "commentPrompt">): string {
  let caption = script.postCaption.trim();
  if (concept && !/^concept\b/i.test(caption)) caption = `Concept · ${caption}`;
  const tags = [...new Set([...script.hashtags, ...(campaign?.hashtags ?? [])].map((h) => h.toLowerCase()))];
  return `${caption}\n\n${brand.commentPrompt}\n\n${tags.map((h) => `#${h}`).join(" ")}`;
}

function batchId(brand: Brand, name: string): string {
  const base = `${brand.id}-${localDate(new Date(), loadCalendar().timezone)}-${slugify(name)}`;
  const taken = new Set(loadBatches(brand).map((b) => b.id));
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

/**
 * One site in, four reels out (full, detail, before-after, interaction), from a single
 * recording session. Saved as a batch of "ready" reels; the daily job puts each up for
 * approval on its day. Nothing is uploaded or scheduled here.
 */
export async function produceBatch(brand: Brand, input: BatchInput, opts: BatchOptions): Promise<Batch> {
  const log = (m: string) => console.log(`[${brand.id}] ${m}`);
  const id = batchId(brand, input.name);
  const workDir = path.join(ROOT, "out", brand.id, id);
  fs.mkdirSync(workDir, { recursive: true });
  const file = (name: string) => path.join(workDir, name);
  const { style, scroll } = brand;
  const fill = (h: string) => h.replaceAll("{niche}", input.niche.split(",")[0].trim()).replaceAll("{name}", input.name);

  log(`Reels for ${input.name} (${input.publicUrl ?? input.url})${opts.dryRun ? " [dry run]" : ""}${opts.mock ? " [mock]" : ""}`);
  log("reels 1/5 Opening site and planning shots");
  const session = await step(`open ${input.name}`, () => openSite(input.url, input.beforeUrl));
  const variants = session.variants;
  if (!variants.includes("interaction")) log("   nothing tappable found, so no interaction reel");

  const voices: Record<string, { words: WordTiming[]; duration: number }> = {};
  const totals: Record<string, number> = {};
  let scripts: VariantScript[];
  let sources: string[] = [];
  try {
    log(`reels 2/5 Writing ${variants.length} scripts`);
    sources = nextHooks(brand, variants.length, opts.campaign, (h) => h);
    const hooks = sources.map(fill);
    const site = { name: input.name, niche: input.niche, url: input.publicUrl ?? input.url, concept: input.concept, brief: input.brief };
    scripts = opts.mock
      ? mockScripts(brand, site, variants, hooks)
      : await step(`scripts for ${input.name}`, () =>
          writeScripts(brand, site, variants, hooks, session.pageInfo, session.plan, opts.campaign),
        );
    fs.writeFileSync(file("scripts.json"), JSON.stringify(scripts, null, 2));

    log("reels 3/5 Voiceovers");
    for (const s of scripts) {
      const out = file(`${s.variant}-voice.mp3`);
      voices[s.variant] = opts.mock
        ? await mockVoice(s.voiceover, out, brand)
        : await step(`voice ${s.variant}`, () => synthesizeVoice(s.voiceover, out, brand));
      totals[s.variant] = reelSeconds(voices[s.variant].duration, scroll.seconds, style.endCardSeconds);
    }

    // Record last, each at its reel's exact length, so footage fits the voice with no speed change.
    log("reels 4/5 Recording");
    const clip = (v: SiteVariant): ClipOptions => ({
      file: file(`${v}-recording.mp4`),
      duration: totals[v],
      heroHold: Math.max(scroll.heroHold, style.hookSeconds),
      sectionHold: scroll.sectionHold,
      footerHold: style.endCardSeconds,
    });
    await step(`record ${input.name}`, () => session.record(Object.fromEntries(variants.map((v) => [v, clip(v)]))));
  } finally {
    await session.close();
  }

  log("reels 5/5 Editing");
  const jobs: RenderJob[] = scripts.map((s) => {
    const words = voices[s.variant].words;
    const shown = brand.captionSpokenCta ? { words, captions: s.captions } : dropTrailingPhrase(words, s.captions, brand.spokenCta);
    return {
      variant: s.variant,
      recordingFile: file(`${s.variant}-recording.mp4`),
      beforeFile: s.variant === "before-after" ? beforeFile(file(`${s.variant}-recording.mp4`)) : undefined,
      voiceFile: file(`${s.variant}-voice.mp3`),
      totalSeconds: totals[s.variant],
      hook: s.hook,
      captions: shown.captions,
      words: shown.words,
      outFile: file(`${id}-${s.variant}.mp4`),
    };
  });
  const track = musicFor(brand);
  await step(`render ${input.name}`, () => renderVariants(brand, jobs, input.concept));

  const batch: Batch = {
    id,
    brand: brand.id,
    createdAt: new Date().toISOString(),
    source: input.source,
    site: {
      name: input.name,
      url: input.publicUrl ?? input.url,
      niche: input.niche,
      concept: input.concept,
      previewUrl: input.publicUrl,
      brief: input.brief,
      direction: input.direction,
    },
    campaign: opts.campaign?.id,
    audit: input.audit,
    variants: scripts.map((s, i) => ({
      id: s.variant,
      status: "ready",
      script: s,
      postText: postText(s, input.concept, opts.campaign, brand),
      hookSource: sources[i],
      music: track ?? undefined,
      seconds: totals[s.variant],
      file: path.relative(ROOT, jobs[i].outFile),
    })),
  };
  fs.writeFileSync(file("batch.json"), JSON.stringify(batch, null, 2));

  if (opts.dryRun) {
    log(`Dry run: ${batch.variants.length} reels in ${path.relative(process.cwd(), workDir)}, nothing saved or sent.`);
    for (const v of batch.variants) log(`   ${VARIANT_LABEL[v.id]}: "${v.script.hook}" (${v.seconds.toFixed(1)}s)`);
    return batch;
  }

  saveBatch(batch);
  log(`${batch.variants.length} reels ready: batch ${id}`);
  return batch;
}
