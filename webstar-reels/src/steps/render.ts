import fs from "node:fs";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { env } from "../lib/env.js";
import { ROOT } from "../lib/queue.js";
import type { ReelProps } from "../types.js";

const PUBLIC_DIR = path.join(ROOT, "public");
const RUN_DIR = path.join(PUBLIC_DIR, "run");

export interface RenderInput extends Omit<ReelProps, "recordingSrc" | "voiceSrc" | "musicSrc" | "logoSrc"> {
  recordingFile: string;
  voiceFile: string;
}

/** Render the Remotion "Reel" composition to a 1080x1920 H.264 MP4. */
export async function renderReel(input: RenderInput, outFile: string): Promise<void> {
  // Remotion serves assets from public/, so stage this run's footage and voice there.
  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.copyFileSync(input.recordingFile, path.join(RUN_DIR, "recording.mp4"));
  fs.copyFileSync(input.voiceFile, path.join(RUN_DIR, "voice.mp3"));

  const { recordingFile: _r, voiceFile: _v, ...rest } = input;
  const logo = ["logo.png", "logo.svg"].find((f) => fs.existsSync(path.join(PUBLIC_DIR, f)));
  const inputProps: ReelProps = {
    ...rest,
    recordingSrc: "run/recording.mp4",
    voiceSrc: "run/voice.mp3",
    musicSrc: fs.existsSync(path.join(PUBLIC_DIR, "music.mp3")) ? "music.mp3" : null,
    logoSrc: logo ?? null,
  };

  const serveUrl = await bundle({
    entryPoint: path.join(ROOT, "remotion/index.ts"),
    publicDir: PUBLIC_DIR,
  });
  const browserExecutable = env("CHROMIUM_PATH") ?? null;
  const composition = await selectComposition({ serveUrl, id: "Reel", inputProps, browserExecutable });

  let lastLogged = -1;
  await renderMedia({
    serveUrl,
    composition,
    inputProps,
    browserExecutable,
    codec: "h264",
    crf: 18,
    pixelFormat: "yuv420p",
    audioCodec: "aac",
    outputLocation: outFile,
    onProgress: ({ progress }) => {
      const pct = Math.floor(progress * 10) * 10;
      if (pct > lastLogged) {
        lastLogged = pct;
        console.log(`   render ${pct}%`);
      }
    },
  });
}
