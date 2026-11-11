/** Music sits this far down while the voice is speaking (-12 dB). */
const DUCK = Math.pow(10, -12 / 20);
/** Seconds to ease down before a line and back up after it. */
const RAMP = 0.28;

/** Stretches of speech, from the word timings (in reel time), with short gaps joined up. */
export function speechSegments(words: { start: number; end: number }[]): [number, number][] {
  const out: [number, number][] = [];
  for (const w of words) {
    const last = out[out.length - 1];
    if (last && w.start - last[1] < 0.45) last[1] = Math.max(last[1], w.end);
    else out.push([w.start, w.end]);
  }
  return out;
}

/** Music gain at a moment: full level between lines, 12 dB down under the voice, with smooth ramps. */
export function duckGain(t: number, segments: [number, number][]): number {
  let distance = Infinity;
  for (const [a, b] of segments) {
    if (t >= a && t <= b) return DUCK;
    distance = Math.min(distance, t < a ? a - t : t - b);
  }
  return DUCK + (1 - DUCK) * Math.min(distance / RAMP, 1);
}
