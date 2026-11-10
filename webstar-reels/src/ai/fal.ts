import fs from "node:fs";
import { env } from "../lib/env.js";
import { run } from "../lib/exec.js";

/**
 * Minimal client for fal's queue API: submit, poll the status URL fal returns, fetch the result.
 * With `mock`, nothing is sent: stand-in files are made locally with ffmpeg so the rest of the
 * pipeline (quality checks, edit, review) can be tried for free.
 */
export interface FalResult {
  requestId: string;
  /** URL of the generated video or image. */
  url: string;
}

const POLL_MS = 5000;
const TIMEOUT_MS = 20 * 60_000;

async function fal(url: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(url, {
    ...init,
    headers: { authorization: `Key ${env("FAL_KEY")}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`fal ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

/** First URL found under the usual result keys (video.url, images[0].url, ...). */
function resultUrl(result: any): string | undefined {
  return (
    result?.video?.url ??
    result?.videos?.[0]?.url ??
    result?.images?.[0]?.url ??
    result?.image?.url ??
    result?.output?.url ??
    (typeof result?.url === "string" ? result.url : undefined)
  );
}

export async function falRun(modelId: string, input: unknown): Promise<FalResult> {
  if (!env("FAL_KEY")) throw new Error("FAL_KEY is empty. Add your fal.ai key to .env.");
  const submitted = await fal(`https://queue.fal.run/${modelId}`, { method: "POST", body: JSON.stringify(input) });
  const { request_id: requestId, status_url: statusUrl, response_url: responseUrl } = submitted;
  if (!requestId || !statusUrl || !responseUrl) throw new Error(`fal did not queue the request: ${JSON.stringify(submitted).slice(0, 300)}`);

  const started = Date.now();
  for (;;) {
    const status = await fal(statusUrl);
    if (status.status === "COMPLETED") break;
    if (status.status && !["IN_QUEUE", "IN_PROGRESS"].includes(status.status)) {
      throw new Error(`fal request ${requestId} ended as ${status.status}`);
    }
    if (Date.now() - started > TIMEOUT_MS) throw new Error(`fal request ${requestId} timed out after ${TIMEOUT_MS / 60_000} minutes`);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  // A failed request also reports COMPLETED; the response then carries the error instead of a file.
  const result = await fal(responseUrl);
  const url = resultUrl(result);
  if (!url) throw new Error(`fal request ${requestId} returned no file: ${JSON.stringify(result).slice(0, 400)}`);
  return { requestId, url };
}

export async function download(url: string, file: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download ${url} (HTTP ${res.status})`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

/** Local image as a data URI, which fal accepts wherever it takes an image URL. */
export function dataUri(file: string): string {
  const type = /\.png$/i.test(file) ? "image/png" : /\.webp$/i.test(file) ? "image/webp" : "image/jpeg";
  return `data:${type};base64,${fs.readFileSync(file).toString("base64")}`;
}

// ---- mock stand-ins (ffmpeg) ----

/** A tinted copy of the image, standing in for a re-finished one. */
export async function mockEdit(source: string, out: string, index: number): Promise<void> {
  const tints = ["colorbalance=rs=.25:gs=.08:bs=-.2", "eq=brightness=-0.22:saturation=0.25", "hue=s=0.15,eq=brightness=0.08"];
  await run("ffmpeg", ["-y", "-loglevel", "error", "-i", source, "-vf", tints[index % tints.length], "-q:v", "3", out]);
}

/** A slow push-in on the start image, dissolving to the end image if there is one. */
export async function mockClip(start: string, end: string | undefined, out: string, seconds: number): Promise<void> {
  const frames = Math.round(seconds * 30);
  const zoom = (label: string, from: number) =>
    `[${label}]scale=1080:1920,zoompan=z='${from}+0.06*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1080x1920:fps=30`;
  const args = ["-y", "-loglevel", "error", "-i", start];
  let filter = `${zoom("0:v", 1)}[a]`;
  let map = "[a]";
  if (end) {
    args.push("-i", end);
    filter += `;${zoom("1:v", 1)}[b];[a][b]blend=all_expr='A*(1-T/${seconds})+B*(T/${seconds})'[v]`;
    map = "[v]";
  }
  await run("ffmpeg", [...args, "-filter_complex", filter, "-map", map, "-t", String(seconds), "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", out]);
}
