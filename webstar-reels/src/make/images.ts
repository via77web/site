import fs from "node:fs";
import path from "node:path";
import type { Direction } from "../../library/index.js";
import type { SiteImage } from "../../library/spec.js";
import { env } from "../lib/env.js";
import { run } from "../lib/exec.js";

const IMAGE_MODEL = () => env("IMAGE_MODEL") ?? "gemini-3.1-flash-image";
const LONG_EDGE = 1800;

/**
 * The image workflow's prompt structure (subject, scene, lighting, style, then technical
 * constraints), with the direction's photography style as the style line.
 */
export function imagePrompt(image: SiteImage, direction: Direction): string {
  return [
    image.subject.trim(),
    image.scene.trim(),
    image.lighting.trim(),
    `Style: ${direction.imageStyle} Photorealistic commercial photography, natural colour, believable materials and textures.`,
    `Palette to sit alongside: background ${direction.colors.bg}, accent ${direction.colors.accent}.`,
    "No text, lettering, signage, logos, watermarks or brand names anywhere in the frame. No recognisable real people.",
  ].join("\n\n");
}

async function generateOne(image: SiteImage, direction: Direction, outFile: string): Promise<void> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL()}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": env("GEMINI_API_KEY")!, "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: imagePrompt(image, direction) }] }],
        generationConfig: {
          responseModalities: ["IMAGE"],
          imageConfig: { aspectRatio: image.aspect, imageSize: "2K" },
        },
      }),
    },
  );
  if (!res.ok) throw new Error(`Image API returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { inlineData?: { mimeType: string; data: string } }[] } }[];
  };
  const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part?.inlineData) throw new Error(`Image API returned no image for "${image.id}"`);
  // Re-encode to WebP, capped at a sensible size for the web.
  await run(
    "ffmpeg",
    ["-y", "-loglevel", "error", "-i", "-", "-vf", `scale='min(${LONG_EDGE},iw)':-2`, "-c:v", "libwebp", "-quality", "82", outFile],
    Buffer.from(part.inlineData.data, "base64"),
  );
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
  { placeholders }: { placeholders: boolean },
): Promise<{ paths: Record<string, string>; placeholders: string[] }> {
  fs.mkdirSync(imgDir, { recursive: true });
  const usePlaceholders = placeholders || !env("GEMINI_API_KEY");
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
          await generateOne(image, direction, webp);
          paths[image.id] = `img/${image.id}.webp`;
          console.log(`   image ${image.id}`);
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
  return { paths, placeholders: fallback };
}
