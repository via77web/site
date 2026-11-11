import fs from "node:fs";
import path from "node:path";
import { dropTrailingPhrase } from "../remotion/captions.js";
import { INTRO_FADE } from "../remotion/timing.js";
import { ROOT, type Brand } from "./lib/brand.js";
import { loadBatches, saveBatch } from "./lib/batches.js";
import { loadCalendar, localDate, type Campaign } from "./lib/calendar.js";
import { nextHooks, slugify } from "./lib/queue.js";
import { step } from "./lib/log.js";
import { pickIntro, type PreparedIntro } from "./lib/intros.js";
import { planTimeline, type Timeline } from "./lib/timeline.js";
import { beforeFile, openSite, recordDesktop, type ClipOptions } from "./steps/record.js";
import { renderVariants, type RenderJob } from "./steps/render.js";
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
  if (!session.variants.includes("interaction")) log("   nothing tappable found, so no interaction reel");
  // The laptop-zoom reel needs an intro clip this brand hasn't opened with in the last five days.
  let intro: PreparedIntro | null = null;
  try {
    intro = await pickIntro(brand);
  } catch (error) {
    log(`   intro clips unavailable: ${error instanceof Error ? error.message : error}`);
  }
  const variants: SiteVariant[] = intro ? [...session.variants, "laptop-zoom"] : session.variants;
  if (!intro) log("   no intro clip available, so no laptop-zoom reel");

  const voices: Record<string, { words: WordTiming[]; duration: number }> = {};
  const timelines: Record<string, Timeline> = {};
  const usedTracks = new Set<string>();
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
      // Each reel gets its own track, with the drop on its reveal and the end card on a beat.
      timelines[s.variant] = await planTimeline(brand, {
        voiceSeconds: voices[s.variant].duration,
        reveal: s.variant === "laptop-zoom" ? intro!.seconds : s.variant === "before-after" ? "wipe" : "hook",
        avoid: usedTracks,
      });
    }

    // Record last, each at its reel's exact length, so footage fits the voice with no speed change.
    log("reels 4/5 Recording");
    const clip = (v: SiteVariant): ClipOptions => ({
      file: file(`${v}-recording.mp4`),
      // After a laptop-zoom intro the recording starts as the screen fills the frame, already moving.
      duration: v === "laptop-zoom" ? timelines[v].totalSeconds - intro!.seconds + INTRO_FADE : timelines[v].totalSeconds,
      heroHold: v === "laptop-zoom" ? 1 : Math.max(scroll.heroHold, style.hookSeconds),
      sectionHold: scroll.sectionHold,
      footerHold: style.endCardSeconds,
      beat: timelines[v].beat,
    });
    await step(`record ${input.name}`, () => session.record(Object.fromEntries(variants.map((v) => [v, clip(v)]))));
    // The laptop's screen shows the real site too: a desktop recording, never a generated one.
    if (intro) await step(`record ${input.name} for the laptop screen`, () => recordDesktop(input.url, file("laptop-zoom-desktop.mp4"), intro!.seconds));
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
      totalSeconds: timelines[s.variant].totalSeconds,
      voiceStart: timelines[s.variant].voiceStart,
      revealSeconds: timelines[s.variant].revealSeconds,
      music: timelines[s.variant].music,
      intro: s.variant === "laptop-zoom" && intro ? { clip: intro, desktopFile: file("laptop-zoom-desktop.mp4") } : undefined,
      hook: s.hook,
      captions: shown.captions,
      words: shown.words,
      outFile: file(`${id}-${s.variant}.mp4`),
    };
  });
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
      music: timelines[s.variant].music ?? undefined,
      intro: s.variant === "laptop-zoom" ? intro?.clip.file : undefined,
      seconds: timelines[s.variant].totalSeconds,
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
