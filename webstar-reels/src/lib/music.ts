import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ROOT, type Brand } from "./brand.js";

export const MUSIC_DIR = path.join(ROOT, "music");

const LibrarySchema = z.object({
  tracks: z.array(
    z.object({
      file: z.string(),
      title: z.string(),
      moods: z.array(z.string()).min(1),
      /** Brand ids allowed to use the track. */
      brands: z.array(z.string()).min(1),
      /** Must be true. A track that isn't royalty-free does not belong in this folder. */
      royaltyFree: z.literal(true),
      /** Where the right to use it comes from: the licence name, or the library and licence id. */
      license: z.string().min(8),
      source: z.string().optional(),
    }),
  ),
});

export type Track = z.infer<typeof LibrarySchema>["tracks"][number];

/**
 * The music library. Only tracks listed in music/library.json, marked royalty-free with a
 * licence, and present on disk can ever be used. Anything else in the folder is ignored.
 */
export function loadMusic(): { tracks: Track[]; unlisted: string[] } {
  const parsed = LibrarySchema.safeParse(JSON.parse(fs.readFileSync(path.join(MUSIC_DIR, "library.json"), "utf8")));
  if (!parsed.success) throw new Error(`music/library.json is invalid:\n${z.prettifyError(parsed.error)}`);
  const tracks = parsed.data.tracks.filter((t) => fs.existsSync(path.join(MUSIC_DIR, t.file)));
  const listed = new Set(parsed.data.tracks.map((t) => t.file));
  const unlisted = fs.readdirSync(MUSIC_DIR).filter((f) => /\.(mp3|m4a|wav|aac|ogg)$/i.test(f) && !listed.has(f));
  return { tracks, unlisted };
}

/**
 * A track for a reel: one of the brand's tracks in its moods, rotating so consecutive reels
 * differ. Returns null (no music) when the brand has no licensed track, never a fallback.
 */
export function pickTrack(brand: Brand, rotation: number): Track | null {
  const mine = loadMusic().tracks.filter((t) => t.brands.includes(brand.id));
  const inMood = mine.filter((t) => t.moods.some((m) => brand.musicMoods.includes(m)));
  const pool = (inMood.length ? inMood : mine).sort((a, b) => a.file.localeCompare(b.file));
  return pool.length ? pool[rotation % pool.length] : null;
}
