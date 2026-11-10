export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;

export const HOOK_SECONDS = 1.5;
export const END_CARD_SECONDS = 2.5;
const MIN_SECONDS = 15;
const MAX_SECONDS = 20;
const VOICE_TAIL = 0.4;

/** Reel length: voiceover + end card, kept inside the 15-20s window. */
export function reelSeconds(voiceDuration: number): number {
  const wanted = voiceDuration + VOICE_TAIL + END_CARD_SECONDS;
  return Math.min(Math.max(wanted, MIN_SECONDS), MAX_SECONDS);
}
