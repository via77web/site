import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { ROOT, type Brand } from "./brand.js";
import { loadBatches } from "./batches.js";
import { run } from "./exec.js";
import { warn } from "./log.js";

/**
 * Intro clips for laptop-zoom reels: 3-4 seconds of someone at a laptop, camera locked off,
 * the laptop screen blank or green. The real recording of the site is pinned onto that screen
 * when the reel is edited. The clip never shows a website of its own.
 */
export const INTRO_DIR = path.join(ROOT, "intros");
const CACHE_DIR = path.join(INTRO_DIR, ".cache");
const INDEX = path.join(INTRO_DIR, "intros.json");

/** A brand never opens with the same clip twice within this many days. */
export const INTRO_REUSE_DAYS = 5;
const MAX_SECONDS = 4;
const MIN_SECONDS = 2.5;
/** The push-in at the end of the intro. */
const ZOOM_SECONDS = 1.8;

const Point = z.tuple([z.number(), z.number()]);
const ClipSchema = z.object({
  /** File name inside intros/<brand>/. */
  file: z.string(),
  brand: z.string(),
  /** "green": the screen is chroma-key green and its corners are found automatically. "blank": give the corners by hand. */
  screen: z.enum(["green", "blank"]),
  /** "filmed" by you, or "generated" with an AI video model. */
  source: z.enum(["filmed", "generated"]),
  /**
   * The screen's four corners in the clip's own pixels: top-left, top-right, bottom-right, bottom-left.
   * Needed for a blank screen, and used instead of detection whenever present.
   */
  corners: z.array(Point).length(4).optional(),
  note: z.string().optional(),
});
const IndexSchema = z.object({ clips: z.array(ClipSchema) });
export type IntroClip = z.infer<typeof ClipSchema>;

export function loadIntroIndex(): IntroClip[] {
  if (!fs.existsSync(INDEX)) return [];
  const parsed = IndexSchema.safeParse(JSON.parse(fs.readFileSync(INDEX, "utf8")));
  if (!parsed.success) throw new Error(`intros/intros.json is invalid:\n${z.prettifyError(parsed.error)}`);
  return parsed.data.clips;
}

export function saveIntroIndex(clips: IntroClip[]): void {
  const note = "Intro clips for laptop-zoom reels. See intros/README.md. `npm run intros` checks every clip.";
  fs.writeFileSync(INDEX, JSON.stringify({ note, clips }, null, 2) + "\n");
}

export const introPath = (clip: Pick<IntroClip, "brand" | "file">) => path.join(INTRO_DIR, clip.brand, clip.file);

// ---------- finding the screen ----------

type Pt = [number, number];
export interface ScreenFind {
  /** Corners in the frame's own pixels: top-left, top-right, bottom-right, bottom-left. */
  corners: [Pt, Pt, Pt, Pt];
  /** Average colour of the green, for keying. */
  key: [number, number, number];
  /** Average colour and brightness (0-1) of everything that isn't the screen. */
  room: [number, number, number];
  luma: number;
}

const quadArea = (q: Pt[]) => Math.abs(q.reduce((sum, [x, y], i) => sum + x * q[(i + 1) % 4][1] - q[(i + 1) % 4][0] * y, 0)) / 2;

/**
 * Find a green screen in one RGB frame: the largest connected patch of chroma green, and its four
 * corners. Returns a reason instead when there is no patch, it is too small, or it isn't a clean
 * four-sided shape (something is covering part of the screen).
 */
export function findScreen(rgb: Uint8Array, w: number, h: number): ScreenFind | string {
  const green = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2];
    green[i] = g > 90 && g > r * 1.45 && g > b * 1.45 ? 1 : 0;
  }
  // Largest connected patch (flood fill).
  const seen = new Int32Array(w * h);
  let best = { id: 0, size: 0 };
  const stack: number[] = [];
  for (let start = 0, id = 0; start < w * h; start++) {
    if (!green[start] || seen[start]) continue;
    id++;
    let size = 0;
    stack.push(start);
    seen[start] = id;
    while (stack.length) {
      const p = stack.pop()!;
      size++;
      const x = p % w;
      for (const q of [p - w, p + w, x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1]) {
        if (q >= 0 && q < w * h && green[q] && !seen[q]) {
          seen[q] = id;
          stack.push(q);
        }
      }
    }
    if (size > best.size) best = { id, size };
  }
  if (best.size < w * h * 0.02) return "no green screen found (the screen must be solid chroma green and fill at least 2% of the frame)";

  // Corners are the patch's extreme points along the two diagonals.
  let tl: Pt = [0, 0], tr: Pt = [0, 0], br: Pt = [0, 0], bl: Pt = [0, 0];
  let [minSum, maxSum, minDiff, maxDiff] = [Infinity, -Infinity, Infinity, -Infinity];
  const key = [0, 0, 0];
  const room = [0, 0, 0];
  for (let i = 0; i < w * h; i++) {
    const mine = seen[i] === best.id;
    const sums = mine ? key : room;
    for (let c = 0; c < 3; c++) sums[c] += rgb[i * 3 + c];
    if (!mine) continue;
    const x = i % w, y = (i - x) / w;
    if (x + y < minSum) (minSum = x + y), (tl = [x, y]);
    if (x + y > maxSum) (maxSum = x + y), (br = [x + 1, y + 1]);
    if (x - y > maxDiff) (maxDiff = x - y), (tr = [x + 1, y]);
    if (x - y < minDiff) (minDiff = x - y), (bl = [x, y + 1]);
  }
  const corners: [Pt, Pt, Pt, Pt] = [tl, tr, br, bl];
  // A real screen fills its four corners and nothing else: count the patch's pixels inside the quad.
  let inside = 0;
  for (let i = 0; i < w * h; i++) {
    if (seen[i] !== best.id) continue;
    const x = (i % w) + 0.5, y = Math.floor(i / w) + 0.5;
    if (corners.every(([ax, ay], k) => (corners[(k + 1) % 4][0] - ax) * (y - ay) - (corners[(k + 1) % 4][1] - ay) * (x - ax) >= -1)) inside++;
  }
  const area = quadArea(corners);
  if (inside / best.size < 0.985 || inside / area < 0.93 || best.size / area > 1.06) return "the green area isn't a clean four-sided screen (something covers part of it, or there is other green in shot)";
  const rest = w * h - best.size;
  const avg = (s: number[], n: number) => s.map((v) => Math.round(v / n)) as [number, number, number];
  const roomRgb = avg(room, rest);
  return { corners, key: avg(key, best.size), room: roomRgb, luma: (0.2126 * roomRgb[0] + 0.7152 * roomRgb[1] + 0.0722 * roomRgb[2]) / 255 };
}

async function probe(file: string): Promise<{ width: number; height: number; seconds: number }> {
  const out = JSON.parse(
    await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", file]),
  );
  return { width: out.streams[0].width, height: out.streams[0].height, seconds: Number(out.format.duration) };
}

const DETECT_WIDTH = 540;

async function frameAt(file: string, t: number, w: number, h: number): Promise<Uint8Array> {
  const raw = path.join(os.tmpdir(), `intro-${process.pid}-${Date.now()}-${Math.round(t * 1000)}.rgb`);
  try {
    await run("ffmpeg", ["-y", "-loglevel", "error", "-ss", t.toFixed(3), "-i", file, "-frames:v", "1", "-vf", `scale=${w}:${h}`, "-f", "rawvideo", "-pix_fmt", "rgb24", raw]);
    return new Uint8Array(fs.readFileSync(raw));
  } finally {
    fs.rmSync(raw, { force: true });
  }
}

export interface PreparedIntro {
  clip: IntroClip;
  /** Absolute path of the clip. */
  file: string;
  /** Absolute path of the keyed (transparent screen) copy, for green-screen clips. */
  keyedFile: string | null;
  width: number;
  height: number;
  corners: [Pt, Pt, Pt, Pt];
  seconds: number;
  zoomSeconds: number;
  screenBrightness: number;
  tint: string;
}

const hex = (c: number[]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

/**
 * Measure a clip and find its screen. For a green screen the corners are detected at the start,
 * middle and end; if they move, the camera isn't locked off and the clip is refused. Manual
 * corners in intros.json always win. Throws with a plain reason when the clip can't be used.
 */
export async function inspectIntro(clip: IntroClip): Promise<Omit<PreparedIntro, "keyedFile"> & { key: [number, number, number] | null }> {
  const file = introPath(clip);
  if (!fs.existsSync(file)) throw new Error(`file not found at intros/${clip.brand}/${clip.file}`);
  const { width, height, seconds: length } = await probe(file);
  if (length < MIN_SECONDS) throw new Error(`only ${length.toFixed(1)}s long; intros need 3-4 seconds`);
  const seconds = Math.min(length, MAX_SECONDS);
  const w = Math.min(DETECT_WIDTH, width);
  const h = Math.round((height * w) / width / 2) * 2;
  const scale = width / w;

  let found: ScreenFind | null = null;
  if (clip.screen === "green") {
    const finds: ScreenFind[] = [];
    let reason = "";
    for (const t of [0.1, seconds / 2, seconds - 0.2]) {
      const f = findScreen(await frameAt(file, t, w, h), w, h);
      if (typeof f === "string") reason = f;
      else finds.push(f);
    }
    if (finds.length === 3) {
      const drift = Math.max(...finds.flatMap((f) => f.corners.map((c, i) => Math.hypot(c[0] - finds[0].corners[i][0], c[1] - finds[0].corners[i][1]))));
      if (drift > w * 0.012) reason = "the screen moves during the clip; the camera and laptop must stay still";
      else found = finds[1];
    }
    if (!found && !clip.corners) throw new Error(`${reason}. Fix the clip, or add its four screen corners to intros/intros.json`);
  }
  // Corners given by hand on a green screen: still key the green out, so a hand or head stays in front.
  let key = found?.key ?? null;
  if (!found && clip.corners && clip.screen === "green") {
    const rgb = await frameAt(file, seconds / 2, w, h);
    const sum = [0, 0, 0];
    let n = 0;
    for (let i = 0; i < w * h; i++) {
      const [r, g, b] = [rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]];
      if (g > 90 && g > r * 1.45 && g > b * 1.45) (sum[0] += r), (sum[1] += g), (sum[2] += b), n++;
    }
    if (n > w * h * 0.01) key = sum.map((v) => Math.round(v / n)) as [number, number, number];
  }
  if (!found && !clip.corners) throw new Error('a "blank" screen needs its four corners in intros/intros.json (top-left, top-right, bottom-right, bottom-left, in pixels)');

  let corners: [Pt, Pt, Pt, Pt];
  if (clip.corners) corners = clip.corners as [Pt, Pt, Pt, Pt];
  else {
    // Scale back to clip pixels and push each corner out a touch, so no green fringe is left uncovered.
    const q = found!.corners.map(([x, y]) => [x * scale, y * scale] as Pt);
    const cx = q.reduce((s, p) => s + p[0], 0) / 4;
    const cy = q.reduce((s, p) => s + p[1], 0) / 4;
    corners = q.map(([x, y]) => [x + Math.sign(x - cx) * scale * 1.5, y + Math.sign(y - cy) * scale * 1.5] as Pt) as [Pt, Pt, Pt, Pt];
  }
  if (quadArea(corners) < width * height * 0.02) throw new Error("the screen is too small in frame to zoom into cleanly");
  const luma = found?.luma ?? 0.5;
  return {
    clip,
    file,
    width,
    height,
    corners,
    seconds,
    zoomSeconds: Math.min(ZOOM_SECONDS, seconds - 0.8),
    // A screen in a dim room reads dimmer; never brighter than the recording itself.
    screenBrightness: Math.min(1, Math.max(0.8, 0.78 + 0.3 * luma)),
    tint: hex(found?.room ?? [128, 128, 128]),
    key,
  };
}

/**
 * Get a clip ready for the edit. Green-screen clips are keyed to a transparent copy (cached), so
 * the site recording sits behind the footage and anything in front of the laptop stays in front.
 */
export async function prepareIntro(clip: IntroClip): Promise<PreparedIntro> {
  const { key, ...info } = await inspectIntro(clip);
  let keyedFile: string | null = null;
  if (key) {
    const stat = fs.statSync(info.file);
    keyedFile = path.join(CACHE_DIR, clip.brand, `${clip.file.replace(/\.\w+$/, "")}-${stat.size}.webm`);
    if (!fs.existsSync(keyedFile)) {
      fs.mkdirSync(path.dirname(keyedFile), { recursive: true });
      await run("ffmpeg", [
        "-y", "-loglevel", "error", "-t", String(info.seconds), "-i", info.file,
        "-vf", `chromakey=0x${hex(key).slice(1)}:0.16:0.07,despill=type=green,format=yuva420p`,
        "-an", "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "22", "-row-mt", "1", "-cpu-used", "4",
        keyedFile,
      ]);
    }
  }
  return { ...info, keyedFile };
}

// ---------- rotation ----------

function lastUse(brand: Brand): Map<string, number> {
  const last = new Map<string, number>();
  for (const b of loadBatches(brand)) {
    for (const v of b.variants) {
      if (!v.intro) continue;
      const when = Date.parse(v.scheduledFor ?? (v.plannedFor ? `${v.plannedFor}T12:00:00Z` : b.createdAt));
      last.set(v.intro, Math.max(last.get(v.intro) ?? 0, when));
    }
  }
  return last;
}

/** A brand's clips in the order to try them: unused in the last five days first, least recently used first. */
export function introOrder(clips: IntroClip[], last: Map<string, number>, now = Date.now()): { clip: IntroClip; recent: boolean }[] {
  return clips
    .map((clip) => ({ clip, at: last.get(clip.file) ?? 0 }))
    .sort((a, b) => a.at - b.at || a.clip.file.localeCompare(b.clip.file))
    .map(({ clip, at }) => ({ clip, recent: now - at < INTRO_REUSE_DAYS * 86_400_000 }));
}

/**
 * The intro for a brand's next laptop-zoom reel, ready to edit: the least recently used clip that
 * hasn't opened a reel in the last five days. Null when the brand has no usable clip, or every
 * clip was used too recently (the laptop-zoom reel is then skipped rather than repeating one).
 */
export async function pickIntro(brand: Brand, now = Date.now()): Promise<PreparedIntro | null> {
  const mine = loadIntroIndex().filter((c) => c.brand === brand.id);
  if (!mine.length) return null;
  const order = introOrder(mine, lastUse(brand), now);
  for (const { clip, recent } of order) {
    if (recent) continue;
    try {
      return await prepareIntro(clip);
    } catch (error) {
      warn(`[${brand.id}] intro ${clip.file} skipped: ${error instanceof Error ? error.message : error}`);
    }
  }
  if (order.every((o) => o.recent)) warn(`[${brand.id}] every intro clip was used in the last ${INTRO_REUSE_DAYS} days; no laptop-zoom reel this time. Add more clips to intros/${brand.id}/.`);
  return null;
}
