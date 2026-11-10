import fs from "node:fs";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { ROOT, type Brand } from "../lib/brand.js";
import { env } from "../lib/env.js";
import type { ReelProps, WordTiming } from "../types.js";

const PUBLIC_DIR = path.join(ROOT, "public");
const RUN_DIR = path.join(PUBLIC_DIR, "run");

export interface RenderInput {
  brand: Brand;
  recordingFile: string;
  voiceFile: string;
  totalSeconds: number;
  hook: string;
  captions: string[];
  words: WordTiming[];
}

/** First of `names` that exists in public/brands/<id>/, as a path relative to public/. */
function brandAsset(brand: Brand, names: string[]): string | null {
  const found = names.find((n) => fs.existsSync(path.join(PUBLIC_DIR, "brands", brand.id, n)));
  return found ? `brands/${brand.id}/${found}` : null;
}

/** Render the Remotion "Reel" composition to a 1080x1920 H.264 MP4. */
export async function renderReel(input: RenderInput, outFile: string): Promise<void> {
  const { brand } = input;
  // Remotion serves assets from public/, so stage this run's footage and voice there.
  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.copyFileSync(input.recordingFile, path.join(RUN_DIR, "recording.mp4"));
  fs.copyFileSync(input.voiceFile, path.join(RUN_DIR, "voice.mp3"));

  const [ctaLine, ctaAction = ""] = brand.cta.split(/\s+[—–]\s+/);
  const inputProps: ReelProps = {
    recordingSrc: "run/recording.mp4",
    voiceSrc: "run/voice.mp3",
    musicSrc: brandAsset(brand, ["music.mp3"]),
    logoSrc: brandAsset(brand, ["logo.svg", "logo.png"]),
    brandName: brand.name,
    style: brand.style,
    totalSeconds: input.totalSeconds,
    hook: input.hook,
    captions: input.captions,
    words: input.words,
    ctaLine,
    ctaAction,
  };

  const serveUrl = await bundle({
    entryPoint: path.join(ROOT, "remotion/index.ts"),
    publicDir: PUBLIC_DIR,
  });
  const browserExecutable = env("CHROMIUM_PATH") ?? null;
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
    outputLocation: outFile,
    onProgress: ({ progress }) => {
      const pct = Math.floor(progress * 4) * 25;
      if (pct > lastLogged) {
        lastLogged = pct;
        console.log(`   render ${pct}%`);
      }
    },
  });
}
