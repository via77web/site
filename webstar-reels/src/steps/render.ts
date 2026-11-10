import fs from "node:fs";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { ROOT, type Brand } from "../lib/brand.js";
import { env } from "../lib/env.js";
import type { ReelProps, VariantId, WordTiming } from "../types.js";

const PUBLIC_DIR = path.join(ROOT, "public");
const RUN_DIR = path.join(PUBLIC_DIR, "run");

export interface RenderJob {
  variant: VariantId;
  recordingFile: string;
  beforeFile?: string;
  voiceFile: string;
  totalSeconds: number;
  hook: string;
  captions: string[];
  words: WordTiming[];
  outFile: string;
}

/** First of `names` that exists in public/brands/<id>/, as a path relative to public/. */
function brandAsset(brand: Brand, names: string[]): string | null {
  const found = names.find((n) => fs.existsSync(path.join(PUBLIC_DIR, "brands", brand.id, n)));
  return found ? `brands/${brand.id}/${found}` : null;
}

/**
 * Render every variant of one site. Remotion copies public/ when it bundles, so all
 * footage is staged first and the project is bundled once for the whole set.
 */
export async function renderVariants(brand: Brand, jobs: RenderJob[], concept: boolean): Promise<void> {
  fs.rmSync(RUN_DIR, { recursive: true, force: true });
  for (const job of jobs) {
    const dir = path.join(RUN_DIR, job.variant);
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(job.recordingFile, path.join(dir, "recording.mp4"));
    fs.copyFileSync(job.voiceFile, path.join(dir, "voice.mp3"));
    if (job.beforeFile) fs.copyFileSync(job.beforeFile, path.join(dir, "before.mp4"));
  }

  const serveUrl = await bundle({ entryPoint: path.join(ROOT, "remotion/index.ts"), publicDir: PUBLIC_DIR });
  const browserExecutable = env("CHROMIUM_PATH") ?? null;
  const [ctaLine, ctaAction = ""] = brand.cta.split(/\s+[—–]\s+/);

  for (const job of jobs) {
    const inputProps: ReelProps = {
      variant: job.variant,
      recordingSrc: `run/${job.variant}/recording.mp4`,
      beforeSrc: job.beforeFile ? `run/${job.variant}/before.mp4` : null,
      voiceSrc: `run/${job.variant}/voice.mp3`,
      musicSrc: brandAsset(brand, ["music.mp3"]),
      logoSrc: brandAsset(brand, ["logo.svg", "logo.png", "logo.webp", "logo.jpg"]),
      brandName: brand.name,
      style: brand.style,
      totalSeconds: job.totalSeconds,
      hook: job.hook,
      captions: job.captions,
      words: job.words,
      ctaLine,
      ctaAction,
      concept,
    };
    const composition = await selectComposition({ serveUrl, id: "Reel", inputProps, browserExecutable, logLevel: "error" });
    let lastLogged = -1;
    await renderMedia({
      serveUrl,
      composition,
      inputProps,
      browserExecutable,
      logLevel: "error",
      codec: "h264",
      crf: 18,
      pixelFormat: "yuv420p",
      audioCodec: "aac",
      outputLocation: job.outFile,
      onProgress: ({ progress }) => {
        const pct = Math.floor(progress * 2) * 50;
        if (pct > lastLogged) {
          lastLogged = pct;
          console.log(`   ${job.variant} ${pct}%`);
        }
      },
    });
  }
}

export interface StillsJob {
  props: Omit<import("../types.js").StillsProps, "voiceSrc" | "musicSrc" | "logoSrc" | "brandName" | "style" | "ctaLine" | "ctaAction">;
  /** Absolute paths of the photos or clips, in the same order as props.shots (then pair before, after). */
  files: string[];
  voiceFile: string;
  outFile: string;
  /** End card text for this reel, when it differs from the brand's usual call to action. */
  cta?: string;
}

/** Render one photo-library reel with the "Stills" composition. */
export async function renderStills(brand: Brand, job: StillsJob): Promise<void> {
  const dir = path.join(RUN_DIR, "stills");
  fs.rmSync(RUN_DIR, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  // Stage every photo under public/ and point the props at the staged copies.
  const staged = job.files.map((f, i) => {
    const name = `${i}${path.extname(f)}`;
    fs.copyFileSync(f, path.join(dir, name));
    return `run/stills/${name}`;
  });
  fs.copyFileSync(job.voiceFile, path.join(dir, "voice.mp3"));
  let n = 0;
  const restage = <T extends { src: string }>(s: T): T => ({ ...s, src: staged[n++] });
  const shots = job.props.shots.map(restage);
  const pair = job.props.pair ? { before: restage(job.props.pair.before), after: restage(job.props.pair.after) } : null;

  const [ctaLine, ctaAction = ""] = (job.cta ?? brand.cta).split(/\s+[—–]\s+/);
  const inputProps: import("../types.js").StillsProps = {
    ...job.props,
    shots,
    pair,
    voiceSrc: "run/stills/voice.mp3",
    musicSrc: brandAsset(brand, ["music.mp3"]),
    logoSrc: brandAsset(brand, ["logo.svg", "logo.png", "logo.webp", "logo.jpg"]),
    brandName: brand.name,
    style: brand.style,
    ctaLine,
    ctaAction,
  };
  const serveUrl = await bundle({ entryPoint: path.join(ROOT, "remotion/index.ts"), publicDir: PUBLIC_DIR });
  const browserExecutable = env("CHROMIUM_PATH") ?? null;
  const composition = await selectComposition({ serveUrl, id: "Stills", inputProps, browserExecutable, logLevel: "error" });
  await renderMedia({
    serveUrl,
    composition,
    inputProps,
    browserExecutable,
    logLevel: "error",
    codec: "h264",
    crf: 18,
    pixelFormat: "yuv420p",
    audioCodec: "aac",
    outputLocation: job.outFile,
  });
}
