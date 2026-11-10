import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ROOT } from "../lib/brand.js";
import { env } from "../lib/env.js";

const Input = z.record(z.string(), z.unknown());

const VideoModel = z.object({
  /** fal model id, e.g. fal-ai/kling-video/v2.6/pro/image-to-video */
  id: z.string(),
  /** Length of the clip this input asks for. */
  seconds: z.number().positive(),
  /** Used for the cost log and budget. Check the model's page on fal.ai. */
  usdPerSecond: z.number().min(0),
  input: Input,
  /**
   * How to give the model a last frame too (for finish-to-finish and before-to-after morphs).
   * Its input is merged into `input`, or replaces it when `replace` is true; `id` switches endpoint.
   * Leave out for models without end-frame support: the reel then cross-fades between clips instead.
   */
  endFrame: z.object({ id: z.string().optional(), replace: z.boolean().default(false), input: Input }).optional(),
});

const AiConfigSchema = z.object({
  /** Which entry of videoModels to use. FAL_VIDEO_MODEL in .env overrides it. */
  video: z.string(),
  videoModels: z.record(z.string(), VideoModel),
  imageEdit: z.object({ id: z.string(), usdPerImage: z.number().min(0), input: Input }),
  /** Optional fal video upscaler for models that can't output 1080x1920: { id, usdPerSecond, input } with {video}. */
  upscale: z.object({ id: z.string(), usdPerSecond: z.number().min(0), input: Input }).nullable().default(null),
  qc: z.object({
    minWidth: z.number().default(1080),
    minHeight: z.number().default(1920),
    /** Brightness wobble between frames (0-255 scale). Smooth camera moves sit well under 1. */
    maxFlicker: z.number().default(1.4),
    /** Largest brightness jump between two frames: catches glitches and hard cuts. */
    maxJump: z.number().default(22),
    /** Have Claude look at frames from each clip for warped geometry, distorted people and stray text. */
    vision: z.boolean().default(true),
    /** Tries per clip before giving up on it. */
    attempts: z.number().int().min(1).max(4).default(2),
  }),
  budget: z.object({ maxUsdPerReel: z.number().positive(), maxUsdPerWeek: z.number().positive() }),
});

export type AiConfig = z.infer<typeof AiConfigSchema>;
export type VideoModelConfig = z.infer<typeof VideoModel> & { name: string };

export function loadAiConfig(): AiConfig {
  const parsed = AiConfigSchema.safeParse(JSON.parse(fs.readFileSync(path.join(ROOT, "ai.json"), "utf8")));
  if (!parsed.success) throw new Error(`ai.json is invalid:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

export function videoModel(cfg: AiConfig): VideoModelConfig {
  const name = env("FAL_VIDEO_MODEL") ?? cfg.video;
  const model = cfg.videoModels[name];
  if (!model) throw new Error(`No video model "${name}" in ai.json. Available: ${Object.keys(cfg.videoModels).join(", ")}`);
  return { ...model, name };
}

/** Fill {placeholders} throughout an input template. */
export function fillInput(template: unknown, values: Record<string, string>): unknown {
  if (typeof template === "string") {
    const whole = template.match(/^\{(\w+)\}$/);
    if (whole && whole[1] in values) return values[whole[1]];
    return template.replace(/\{(\w+)\}/g, (m, k) => values[k] ?? m);
  }
  if (Array.isArray(template)) return template.map((t) => fillInput(t, values));
  if (template && typeof template === "object") {
    return Object.fromEntries(Object.entries(template).map(([k, v]) => [k, fillInput(v, values)]));
  }
  return template;
}
