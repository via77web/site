import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { run } from "../lib/exec.js";
import { generate, llmBackend } from "../lib/llm.js";
import type { AiConfig } from "./config.js";

export interface QcResult {
  ok: boolean;
  reasons: string[];
  width: number;
  height: number;
  seconds: number;
  flicker: number;
  jump: number;
}

/** Brightness per frame, from a small copy of the clip. */
async function brightness(file: string): Promise<number[]> {
  const out = await run("ffmpeg", [
    "-v", "error", "-i", file,
    "-vf", "scale=160:-2,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-",
    "-f", "null", "-",
  ]);
  return [...out.matchAll(/YAVG=([\d.]+)/g)].map((m) => Number(m[1]));
}

/**
 * Flicker and jump scores. A steady camera move changes brightness smoothly, so its frame-to-frame
 * change barely varies. Flicker shows up as that change swinging back and forth (a large second
 * difference); a glitch or hard cut shows up as one large step.
 */
export function flickerScores(y: number[]): { flicker: number; jump: number } {
  if (y.length < 3) return { flicker: 0, jump: 0 };
  const d1 = y.slice(1).map((v, i) => v - y[i]);
  const d2 = d1.slice(1).map((v, i) => Math.abs(v - d1[i]));
  return {
    flicker: d2.reduce((a, b) => a + b, 0) / d2.length,
    jump: Math.max(...d1.map(Math.abs)),
  };
}

/** Resolution, length, flicker and glitch checks. No model involved. */
export async function technicalCheck(file: string, cfg: AiConfig["qc"]): Promise<QcResult> {
  const probe = await run("ffprobe", [
    "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "csv=p=0:s=,", file,
  ]);
  const [width, height, seconds] = probe.trim().split(/[,\n]+/).map(Number);
  const { flicker, jump } = flickerScores(await brightness(file));
  const reasons: string[] = [];
  if (width < cfg.minWidth || height < cfg.minHeight) {
    reasons.push(`resolution ${width}x${height} is under ${cfg.minWidth}x${cfg.minHeight}`);
  }
  if (!seconds || seconds < 2) reasons.push(`clip is only ${seconds || 0}s long`);
  if (flicker > cfg.maxFlicker) reasons.push(`flicker ${flicker.toFixed(2)} (limit ${cfg.maxFlicker})`);
  if (jump > cfg.maxJump) reasons.push(`brightness jump of ${jump.toFixed(1)} between frames (limit ${cfg.maxJump}): glitch or cut`);
  return { ok: !reasons.length, reasons, width, height, seconds, flicker, jump };
}

const VisionSchema = z.object({
  warpedGeometry: z.boolean().describe("Straight edges bend, cabinets or walls melt, objects change shape between frames"),
  distortedPeople: z.boolean().describe("Any person, hand or face that looks deformed or appears from nowhere"),
  textOrLogos: z.boolean().describe("Text, signage, logos or watermarks that the model added or garbled. Text that is in the reference photo and unchanged does not count"),
  inconsistentFrames: z.boolean().describe("Frames flicker, pop or change lighting abruptly"),
  layoutChanged: z.boolean().describe("The room layout differs from the reference photo beyond the surface finish"),
  reason: z.string().describe("One sentence naming the worst problem, or 'clean'"),
});

/** A strip of evenly spaced frames, with the reference photo first, for Claude to compare. */
async function contactSheet(file: string, reference: string | undefined, out: string, isImage: boolean): Promise<void> {
  const cell = "scale=360:640:force_original_aspect_ratio=decrease,pad=360:640:(ow-iw)/2:(oh-ih)/2";
  if (isImage) {
    const inputs = reference ? ["-i", reference, "-i", file] : ["-i", file];
    const filter = reference ? `[0:v]${cell}[a];[1:v]${cell}[b];[a][b]hstack=inputs=2` : cell;
    await run("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", filter, "-frames:v", "1", out]);
    return;
  }
  const strip = out.replace(/\.jpg$/, "-frames.jpg");
  await run("ffmpeg", ["-y", "-loglevel", "error", "-i", file, "-vf", `thumbnail=n=20,fps=1,${cell},tile=6x1`, "-frames:v", "1", strip]).catch(() =>
    run("ffmpeg", ["-y", "-loglevel", "error", "-i", file, "-vf", `fps=1,${cell},tile=6x1`, "-frames:v", "1", strip]),
  );
  if (!reference) return fs.renameSync(strip, out);
  await run("ffmpeg", ["-y", "-loglevel", "error", "-i", reference, "-i", strip, "-filter_complex", `[0:v]${cell}[a];[a][1:v]hstack=inputs=2`, "-frames:v", "1", out]);
  fs.rmSync(strip, { force: true });
}

/**
 * Claude looks at frames from a clip (or at an edited image) next to the real photo it came from
 * and fails it for warped geometry, distorted people, stray text or a changed room.
 */
export async function visionCheck(
  file: string,
  reference: string | undefined,
  what: "clip" | "image",
  context: string,
): Promise<{ ok: boolean; reason: string }> {
  if (llmBackend() !== "claude-code") return { ok: true, reason: "vision check skipped (needs the Claude Code backend)" };
  const sheet = file.replace(/\.\w+$/, "-qc.jpg");
  await contactSheet(file, reference, sheet, what === "image");
  const v = await generate({
    label: "AI quality check",
    schema: VisionSchema,
    system:
      "You are a strict quality checker for AI-generated interior visualisations used in a trade business's marketing. Fail anything a tradesperson would call fake-looking. When unsure, fail it.",
    prompt: `Open ${path.basename(sheet)} with the Read tool. ${
      reference ? "The first panel is the real reference photo. " : ""
    }${what === "clip" ? "The other panels are frames from one generated video clip, in order." : "The last panel is the generated image."}

What it should show: ${context}

Check for: straight lines that bend or melt, objects changing shape, deformed people or hands, text or logos that were added or have turned to gibberish (text already in the reference photo and still intact is fine), lighting that pops between frames${
      reference ? ", and whether the room is still the same room as the reference (only the surface finish and the camera position may differ)" : ""
    }.`,
    effort: "low",
    readDir: path.dirname(sheet),
    rounds: 1,
  });
  const failed = [
    v.warpedGeometry && "warped geometry",
    v.distortedPeople && "distorted people",
    v.textOrLogos && "text or logos in frame",
    v.inconsistentFrames && "inconsistent frames",
    reference && v.layoutChanged && "room layout changed",
  ].filter(Boolean);
  return { ok: !failed.length, reason: failed.length ? `${failed.join(", ")}: ${v.reason}` : "clean" };
}
