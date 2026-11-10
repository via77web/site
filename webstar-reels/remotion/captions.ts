import type { WordTiming } from "../src/types";

export interface CaptionGroup {
  words: WordTiming[];
  start: number;
  end: number;
}

const FALLBACK_GROUP_SIZE = 3;

/**
 * Group timed words into on-screen phrases. Uses the script's caption phrases when
 * they line up with the spoken words, otherwise falls back to groups of three.
 */
export function groupWords(words: WordTiming[], captions: string[]): CaptionGroup[] {
  const sizes = captions.map((c) => c.trim().split(/\s+/).filter(Boolean).length).filter((n) => n > 0);
  const usable = sizes.reduce((a, b) => a + b, 0) === words.length && sizes.every((n) => n <= 5);

  const chunks: WordTiming[][] = [];
  if (usable) {
    let i = 0;
    for (const size of sizes) chunks.push(words.slice(i, (i += size)));
  } else {
    for (let i = 0; i < words.length; i += FALLBACK_GROUP_SIZE) {
      chunks.push(words.slice(i, i + FALLBACK_GROUP_SIZE));
    }
  }
  return chunks.map((chunk, i) => ({
    words: chunk,
    start: chunk[0].start,
    // Stay up until the next phrase starts, but never linger more than a beat after the last word.
    end: Math.min(chunks[i + 1]?.[0].start ?? Infinity, chunk[chunk.length - 1].end + 0.6),
  }));
}
