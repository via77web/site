import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { ROOT, type Brand } from "./brand.js";
import { loadBatches } from "./batches.js";
import { run } from "./exec.js";
import { warn } from "./log.js";

export const MUSIC_DIR = path.join(ROOT, "music");
const ANALYSIS_FILE = path.join(MUSIC_DIR, "analysis.json");
const USAGE_LOG = path.join(MUSIC_DIR, "usage-log.csv");

/** A brand never hears the same track twice within this many days. */
export const REUSE_DAYS = 7;
/** Music sits this far down while the voice is speaking. */
export const DUCK_DB = -12;

const LibrarySchema = z.object({
  tracks: z.array(
    z.object({
      file: z.string(),
      title: z.string(),
      artist: z.string().optional(),
      /** Brand ids allowed to use the track. */
      brands: z.array(z.string()).min(1),
      /** Tempo as stated by the library. Beat detection refines it. */
      bpm: z.number().min(60).max(200),
      genre: z.string(),
      moods: z.array(z.string()).min(1),
      /** Must be true. A track that isn't royalty-free does not belong in this folder. */
      royaltyFree: z.literal(true),
      /** Where the licence comes from, e.g. "Epidemic Sound". */
      source: z.string().min(2),
      /** The licence itself: plan or licence name, and an order or track id where there is one. */
      license: z.string().min(8),
      /** Seconds into the track where the drop lands, to override detection. */
      drop: z.number().optional(),
    }),
  ),
});

export type Track = z.infer<typeof LibrarySchema>["tracks"][number];

/**
 * The music library. Only tracks listed in music/library.json, marked royalty-free with a
 * licence and its source, and present on disk can ever be used. Anything else in the folder is ignored.
 */
export function loadMusic(): { tracks: Track[]; unlisted: string[] } {
  const parsed = LibrarySchema.safeParse(JSON.parse(fs.readFileSync(path.join(MUSIC_DIR, "library.json"), "utf8")));
  if (!parsed.success) throw new Error(`music/library.json is invalid:\n${z.prettifyError(parsed.error)}`);
  const tracks = parsed.data.tracks.filter((t) => fs.existsSync(path.join(MUSIC_DIR, t.file)));
  const listed = new Set(parsed.data.tracks.map((t) => t.file));
  const unlisted = fs.readdirSync(MUSIC_DIR).filter((f) => /\.(mp3|m4a|wav|aac|ogg|flac)$/i.test(f) && !listed.has(f));
  return { tracks, unlisted };
}

// ---------- beat and drop detection ----------

export interface TrackAnalysis {
  /** File size when analysed; a changed file is analysed again. */
  size: number;
  seconds: number;
  bpm: number;
  /** Time of the first beat on the grid. */
  firstBeat: number;
  /** Where the drop lands, or null when the track has none. */
  drop: number | null;
}

const RATE = 11025;
const HOP = 256;
const FPS = RATE / HOP;

async function envelope(file: string, filter: string): Promise<Float32Array> {
  const raw = path.join(os.tmpdir(), `reels-${process.pid}-${Date.now()}.raw`);
  try {
    await run("ffmpeg", ["-y", "-loglevel", "error", "-i", file, "-af", filter, "-ac", "1", "-ar", String(RATE), "-f", "s16le", raw]);
    const buf = fs.readFileSync(raw);
    const samples = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 2));
    const frames = Math.floor(samples.length / HOP);
    const env = new Float32Array(frames);
    for (let f = 0; f < frames; f++) {
      let sum = 0;
      for (let i = f * HOP; i < (f + 1) * HOP; i++) sum += (samples[i] / 32768) ** 2;
      env[f] = Math.sqrt(sum / HOP);
    }
    return env;
  } finally {
    fs.rmSync(raw, { force: true });
  }
}

/** Tempo and beat phase from the kick band, then the drop: the beat where low-end energy steps up and stays up. */
export function analyseEnvelopes(low: Float32Array, full: Float32Array, hint: number): Omit<TrackAnalysis, "size"> {
  const onset = new Float32Array(low.length);
  for (let i = 1; i < low.length; i++) onset[i] = Math.max(0, low[i] - low[i - 1]);
  const at = (arr: Float32Array, t: number) => arr[Math.min(Math.max(Math.round(t * FPS), 0), arr.length - 1)] ?? 0;
  const seconds = low.length / FPS;

  // Comb search: the tempo and phase whose beat grid lands on the most kick onsets.
  let best = { score: -1, bpm: hint, phase: 0 };
  for (let bpm = hint - 3; bpm <= hint + 3; bpm += 0.05) {
    const beat = 60 / bpm;
    for (let p = 0; p < 32; p++) {
      const phase = (p / 32) * beat;
      let score = 0;
      for (let t = phase; t < seconds; t += beat) score += at(onset, t);
      if (score > best.score) best = { score, bpm, phase };
    }
  }
  const beat = 60 / best.bpm;
  const firstBeat = best.phase;

  // Drop: the beat where low-end energy steps up most, comparing the 8 beats after with the 8 before.
  const perBeat: number[] = [];
  for (let t = firstBeat; t + beat <= seconds; t += beat) {
    let sum = 0;
    let n = 0;
    for (let f = Math.round(t * FPS); f < Math.min(Math.round((t + beat) * FPS), low.length); f++, n++) sum += low[f] + 0.25 * full[f];
    perBeat.push(n ? sum / n : 0);
  }
  const mean = (from: number, to: number) => perBeat.slice(from, to).reduce((x, y) => x + y, 0) / Math.max(to - from, 1);
  let peak = 0;
  for (let k = 0; k + 8 <= perBeat.length; k++) peak = Math.max(peak, mean(k, k + 8));
  const steps: { k: number; ratio: number }[] = [];
  for (let k = 8; k + 8 <= perBeat.length; k++) {
    const after = mean(k, k + 8);
    if (after >= peak * 0.7) steps.push({ k, ratio: after / (mean(k - 8, k) + 1e-6) });
  }
  const strongest = Math.max(0, ...steps.map((x) => x.ratio));
  // With several drops, take the first that is nearly as strong as the strongest, at its own local peak.
  const first = steps.find((x, i) => x.ratio >= Math.max(1.6, strongest * 0.8) && x.ratio >= (steps[i + 1]?.k === x.k + 1 ? steps[i + 1].ratio : 0));
  const drop = first ? { t: firstBeat + first.k * beat } : null;
  return { seconds, bpm: Math.round(best.bpm * 100) / 100, firstBeat: Math.round(firstBeat * 1000) / 1000, drop: drop ? Math.round(drop.t * 1000) / 1000 : null };
}

/** Beat grid and drop for a track, cached in music/analysis.json until the file changes. */
export async function analyseTrack(track: Track): Promise<TrackAnalysis> {
  const file = path.join(MUSIC_DIR, track.file);
  const size = fs.statSync(file).size;
  let cache: Record<string, TrackAnalysis> = {};
  try {
    cache = JSON.parse(fs.readFileSync(ANALYSIS_FILE, "utf8"));
  } catch {
    /* first run */
  }
  let a = cache[track.file];
  if (!a || a.size !== size) {
    const [low, full] = await Promise.all([envelope(file, "lowpass=f=150"), envelope(file, "anull")]);
    a = { size, ...analyseEnvelopes(low, full, track.bpm) };
    cache[track.file] = a;
    fs.writeFileSync(ANALYSIS_FILE, JSON.stringify(cache, null, 2) + "\n");
  }
  return track.drop !== undefined ? { ...a, drop: track.drop } : a;
}

// ---------- choosing a track ----------

const warned = new Set<string>();

/** Tracks a brand has used, with the most recent day each was used for. */
function recentUse(brand: Brand): Map<string, number> {
  const last = new Map<string, number>();
  for (const b of loadBatches(brand)) {
    for (const v of b.variants) {
      if (!v.music) continue;
      const when = Date.parse(v.scheduledFor ?? (v.plannedFor ? `${v.plannedFor}T12:00:00Z` : b.createdAt));
      last.set(v.music.file, Math.max(last.get(v.music.file) ?? 0, when));
    }
  }
  return last;
}

/** How well a track fits the brand's brief: tempo in range first, then mood and genre. */
export function fit(track: Track, brand: Brand): number {
  const [lo, hi] = brand.music.bpm;
  const off = track.bpm < lo ? lo - track.bpm : track.bpm > hi ? track.bpm - hi : 0;
  const moods = track.moods.filter((m) => brand.music.moods.includes(m.toLowerCase())).length;
  const genre = brand.music.genres.some((g) => track.genre.toLowerCase().includes(g.toLowerCase())) ? 2 : 0;
  return (off === 0 ? 10 : -off) + moods + genre;
}

/**
 * The track for a brand's next reel: the best fit for its music brief that the brand hasn't
 * used in the last seven days and that isn't already on another reel in the same batch.
 * If every track has been used that recently, the one used longest ago plays again, with a warning.
 * Returns null (voice only) when the brand has no licensed track at all. Never a fallback from outside the library.
 */
export function pickTrack(brand: Brand, avoid: Set<string> = new Set(), now = Date.now()): Track | null {
  const mine = loadMusic().tracks.filter((t) => t.brands.includes(brand.id));
  if (!mine.length) return null;
  const last = recentUse(brand);
  const fresh = mine.filter((t) => !avoid.has(t.file) && now - (last.get(t.file) ?? 0) >= REUSE_DAYS * 86_400_000);
  if (fresh.length) return fresh.sort((a, b) => fit(b, brand) - fit(a, brand) || a.file.localeCompare(b.file))[0];
  const oldest = [...mine].sort((a, b) => Number(avoid.has(a.file)) - Number(avoid.has(b.file)) || (last.get(a.file) ?? 0) - (last.get(b.file) ?? 0))[0];
  if (!warned.has(brand.id)) warn(`[${brand.id}] not enough tracks to avoid a repeat within ${REUSE_DAYS} days; reusing "${oldest.title}". Add more ${brand.music.genres[0]} tracks to music/.`);
  warned.add(brand.id);
  return oldest;
}

// ---------- fitting a track to a reel ----------

export interface ReelMusic {
  file: string;
  title: string;
  source: string;
  license: string;
  bpm: number;
  /** Seconds into the track where playback starts. */
  startAt: number;
  /** Seconds into the reel before the music comes in (only when the drop is very early in the track). */
  delay: number;
}

export interface Beat {
  /** A beat in reel time (the reveal). */
  origin: number;
  interval: number;
}

export const snapToBeat = (t: number, beat: Beat | null) => (beat ? beat.origin + Math.round((t - beat.origin) / beat.interval) * beat.interval : t);
export const snapUpToBeat = (t: number, beat: Beat | null) => (beat ? beat.origin + Math.ceil((t - beat.origin) / beat.interval - 1e-6) * beat.interval : t);

/**
 * Line a track up with a reel so its drop (or, without one, a beat) lands exactly on the reveal.
 * The returned beat grid is in reel time, for snapping cuts and zooms.
 */
export async function fitMusic(track: Track, revealSeconds: number): Promise<{ music: ReelMusic; beat: Beat }> {
  const a = await analyseTrack(track);
  const interval = 60 / a.bpm;
  let startAt: number;
  let delay = 0;
  if (a.drop !== null) {
    startAt = a.drop - revealSeconds;
    if (startAt < 0) {
      delay = -startAt;
      startAt = 0;
    }
  } else {
    // No drop: start on whichever beat puts a beat on the reveal.
    const n = Math.ceil((revealSeconds - a.firstBeat) / interval);
    startAt = Math.max(a.firstBeat + n * interval - revealSeconds, 0);
  }
  return {
    music: { file: track.file, title: track.title, source: track.source, license: track.license, bpm: a.bpm, startAt: Math.round(startAt * 1000) / 1000, delay: Math.round(delay * 1000) / 1000 },
    beat: { origin: revealSeconds, interval },
  };
}

/** One line per published reel: which track, and under which licence. */
export function logMusicUse(row: { date: string; brand: string; reel: string; platforms: string; music: ReelMusic }): void {
  if (!fs.existsSync(USAGE_LOG)) fs.writeFileSync(USAGE_LOG, "published,brand,reel,platforms,track,file,licence_source,licence\n");
  const cell = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const m = row.music;
  fs.appendFileSync(USAGE_LOG, [row.date, row.brand, row.reel, row.platforms, m.title, m.file, m.source, m.license].map(cell).join(",") + "\n");
}
