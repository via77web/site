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

const normalise = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * Remove the spoken call to action from the end of the captions, for brands whose
 * spoken version (a spelled-out URL, say) should be heard but not shown.
 */
export function dropTrailingPhrase(
  words: WordTiming[],
  captions: string[],
  phrase: string,
): { words: WordTiming[]; captions: string[] } {
  const target = normalise(phrase);
  let tail = "";
  let count = 0;
  while (count < words.length && tail.length < target.length) {
    count++;
    tail = normalise(words[words.length - count].word) + tail;
  }
  if (!target || tail !== target) return { words, captions };

  // Trim the same number of words off the caption phrases so they still line up.
  const trimmed = [...captions];
  let remaining = count;
  while (remaining > 0 && trimmed.length) {
    const parts = trimmed[trimmed.length - 1].trim().split(/\s+/);
    if (parts.length <= remaining) {
      remaining -= parts.length;
      trimmed.pop();
    } else {
      trimmed[trimmed.length - 1] = parts.slice(0, parts.length - remaining).join(" ");
      remaining = 0;
    }
  }
  return { words: words.slice(0, words.length - count), captions: trimmed };
}
