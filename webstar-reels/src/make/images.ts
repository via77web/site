import fs from "node:fs";
import path from "node:path";
import type { Direction } from "../../library/index.js";
import type { SiteImage } from "../../library/spec.js";
import { env } from "../lib/env.js";
import { run } from "../lib/exec.js";

import { loadAiConfig } from "../ai/config.js";
import { logCost } from "../ai/costs.js";

const LONG_EDGE = 1800;

/** Where an image sits on the page. Decides its shape: portrait for a hero (and reels), square for a product card. */
export type Placement = "hero" | "product";
export type ImageProvider = "openai" | "nano-banana";

/** IMAGE_PROVIDER in .env: "openai" (default) or "nano-banana" (Google Gemini image models). */
export function imageProvider(): ImageProvider {
  const v = (env("IMAGE_PROVIDER") ?? "openai").toLowerCase();
  if (v === "openai" || v === "nano-banana") return v;
  throw new Error(`IMAGE_PROVIDER must be "openai" or "nano-banana", not "${v}"`);
}

export const imageKeyName = (provider: ImageProvider) => (provider === "openai" ? "OPENAI_API_KEY" : "GEMINI_API_KEY");

/** The shot list entry as plain sentences: subject, scene, lighting, then the direction's photography style. */
function shotLines(image: SiteImage, direction: Direction): string[] {
  return [
    image.subject.trim(),
    image.scene.trim(),
    image.lighting.trim(),
    `Style: ${direction.imageStyle} Photorealistic commercial photography, natural colour, believable materials and textures.`,
    `Palette to sit alongside: background ${direction.colors.bg}, accent ${direction.colors.accent}.`,
  ];
}

const NO_TEXT = "No text, lettering, signage, logos, watermarks or brand names anywhere in the frame. No recognisable real people.";

/** Prompt for Gemini image models: the shot as paragraphs. */
export function imagePrompt(image: SiteImage, direction: Direction): string {
  return [...shotLines(image, direction), NO_TEXT].join("\n\n");
}

/**
 * Prompt for OpenAI image models. They follow a labelled brief best, and need telling that the
 * result is a photograph: left alone they drift towards illustration and over-polished skin.
 */
export function openaiPrompt(image: SiteImage, direction: Direction, placement?: Placement): string {
  const framing =
    placement === "hero"
      ? "Vertical portrait framing with the subject in the middle third and calm space above it for a headline."
      : placement === "product"
        ? "Square framing, the product centred with even space around it, on a simple surface."
        : `Framed for a ${image.aspect} crop; keep the subject away from the edges.`;
  return [
    "A photorealistic photograph, as shot by a commercial photographer on a full-frame camera. Not an illustration, not a 3D render.",
    `Subject: ${image.subject.trim()}`,
    `Scene: ${image.scene.trim()}`,
    `Lighting: ${image.lighting.trim()}`,
    `Style: ${direction.imageStyle} Natural colour, real materials and textures, natural skin, shallow depth of field where it suits.`,
    `Colour: sits alongside a ${direction.colors.bg} page with ${direction.colors.accent} accents.`,
    `Composition: ${framing}`,
    NO_TEXT,
  ].join("\n");
}

/** OpenAI image sizes: portrait for heroes and tall crops, square for product cards, landscape otherwise. */
export function openaiSize(aspect: SiteImage["aspect"], placement?: Placement): "1024x1024" | "1024x1536" | "1536x1024" {
  if (placement === "hero") return "1024x1536";
  if (placement === "product") return "1024x1024";
  const [w, h] = aspect.split(":").map(Number);
  return w === h ? "1024x1024" : w < h ? "1024x1536" : "1536x1024";
}

// Newest first. The first one this API key can use is remembered for the rest of the run.
const OPENAI_MODELS = ["gpt-image-2", "gpt-image-1.5", "gpt-image-1"];
let openaiModel: string | undefined;

async function toWebp(data: Buffer, outFile: string): Promise<void> {
  // Re-encode to WebP, capped at a sensible size for the web.
  await run("ffmpeg", ["-y", "-loglevel", "error", "-i", "-", "-vf", `scale='min(${LONG_EDGE},iw)':-2`, "-c:v", "libwebp", "-quality", "82", outFile], data);
}

interface Made {
  model: string;
  usd: number;
  requestId: string;
}

async function generateOpenai(image: SiteImage, direction: Direction, outFile: string, placement?: Placement): Promise<Made> {
  const size = openaiSize(image.aspect, placement);
  const quality = env("OPENAI_IMAGE_QUALITY") ?? "high";
  const candidates = openaiModel ? [openaiModel] : env("OPENAI_IMAGE_MODEL") ? [env("OPENAI_IMAGE_MODEL")!] : OPENAI_MODELS;
  let lastError = "";
  for (const model of candidates) {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { authorization: `Bearer ${env("OPENAI_API_KEY")}`, "content-type": "application/json" },
      body: JSON.stringify({ model, prompt: openaiPrompt(image, direction, placement), size, quality, n: 1, output_format: "png" }),
    });
    const text = await res.text();
    if (!res.ok) {
      lastError = `OpenAI Images API returned ${res.status} for ${model}: ${text.slice(0, 300)}`;
      // An unknown or unavailable model: try the next one down. Anything else is a real failure.
      if ((res.status === 404 || /model_not_found|does not exist|do not have access|must be verified/i.test(text)) && candidates.length > 1) continue;
      throw new Error(lastError);
    }
    const data = JSON.parse(text) as {
      data?: { b64_json?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { text_tokens?: number; image_tokens?: number } };
    };
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) throw new Error(`OpenAI returned no image for "${image.id}"`);
    await toWebp(Buffer.from(b64, "base64"), outFile);
    openaiModel = model;
    const prices = loadAiConfig().openaiImages;
    const u = data.usage;
    const rate = prices.usdPerMillionTokens;
    const usd = u?.output_tokens
      ? ((u.input_tokens_details?.text_tokens ?? u.input_tokens ?? 0) * rate.textIn + (u.input_tokens_details?.image_tokens ?? 0) * rate.imageIn + u.output_tokens * rate.imageOut) / 1e6
      : (prices.usdPerImage[quality]?.[size] ?? 0);
    return { model: `openai/${model} ${quality} ${size}`, usd, requestId: res.headers.get("x-request-id") ?? "" };
  }
  throw new Error(lastError);
}

const GEMINI_MODEL = () => env("IMAGE_MODEL") ?? "gemini-3.1-flash-image";

async function generateGemini(image: SiteImage, direction: Direction, outFile: string): Promise<Made> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL()}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": env("GEMINI_API_KEY")!, "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: imagePrompt(image, direction) }] }],
      generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: image.aspect, imageSize: "2K" } },
    }),
  });
  if (!res.ok) throw new Error(`Image API returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { inlineData?: { mimeType: string; data: string } }[] } }[];
  };
  const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part?.inlineData) throw new Error(`Image API returned no image for "${image.id}"`);
  await toWebp(Buffer.from(part.inlineData.data, "base64"), outFile);
  return { model: `google/${GEMINI_MODEL()}`, usd: Number(env("GEMINI_USD_PER_IMAGE") ?? 0.1), requestId: "" };
}

/** A tasteful gradient stand-in in the direction's colours, for --mock runs or when there is no image key. */
function placeholder(image: SiteImage, direction: Direction, outFile: string): void {
  const [w, h] = image.aspect.split(":").map(Number);
  const W = 1200;
  const H = Math.round((W * h) / w);
  const c = direction.colors;
  const seed = [...image.id].reduce((n, ch) => n + ch.charCodeAt(0), 0);
  const cx = 30 + (seed % 40);
  const cy = 30 + ((seed * 7) % 40);
  fs.writeFileSync(
    outFile,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<defs><radialGradient id="g" cx="${cx}%" cy="${cy}%" r="85%"><stop offset="0" stop-color="${c.accent}" stop-opacity=".85"/><stop offset=".55" stop-color="${c.bg2}"/><stop offset="1" stop-color="${c.ink}" stop-opacity=".9"/></radialGradient>
<filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="${seed}"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .07 0"/></filter></defs>
<rect width="100%" height="100%" fill="url(#g)"/><circle cx="${W * 0.62}" cy="${H * 0.58}" r="${Math.min(W, H) * 0.24}" fill="${c.bg}" opacity=".35"/><rect width="100%" height="100%" filter="url(#n)"/></svg>`,
  );
}

/**
 * Make every image the spec lists. Returns image id -> path relative to the site root.
 * Files already in `imgDir` are reused, so a revised spec only generates new ids.
 */
export async function makeImages(
  images: SiteImage[],
  direction: Direction,
  imgDir: string,
  { placeholders, placements = {}, costKey = "site" }: { placeholders: boolean; placements?: Record<string, Placement>; costKey?: string },
): Promise<{ paths: Record<string, string>; placeholders: string[]; usd: number }> {
  fs.mkdirSync(imgDir, { recursive: true });
  const provider = imageProvider();
  const usePlaceholders = placeholders || !env(imageKeyName(provider));
  let usd = 0;
  const paths: Record<string, string> = {};
  const fallback: string[] = [];
  const queue = [...images];

  const worker = async () => {
    for (let image = queue.shift(); image; image = queue.shift()) {
      const webp = path.join(imgDir, `${image.id}.webp`);
      const svg = path.join(imgDir, `${image.id}.svg`);
      if (fs.existsSync(webp)) {
        paths[image.id] = `img/${image.id}.webp`;
        continue;
      }
      if (!usePlaceholders) {
        try {
          const made = provider === "openai" ? await generateOpenai(image, direction, webp, placements[image.id]) : await generateGemini(image, direction, webp);
          paths[image.id] = `img/${image.id}.webp`;
          usd += made.usd;
          // Every generated image goes in logs/ai-costs.csv with its model and cost.
          logCost(costKey.split("/")[0], `${costKey}/${image.id}`, { kind: "image", model: made.model, requestId: made.requestId, usd: made.usd, result: "used" });
          continue;
        } catch (error) {
          console.warn(`   image ${image.id} failed, using a placeholder: ${error instanceof Error ? error.message : error}`);
        }
      }
      placeholder(image, direction, svg);
      paths[image.id] = `img/${image.id}.svg`;
      fallback.push(image.id);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return { paths, placeholders: fallback, usd };
}
