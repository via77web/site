export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;

/** Length of the cross-fade from the laptop screen to the full-quality recording. */
export const INTRO_FADE = 0.3;

const VOICE_TAIL = 0.4;

/**
 * Reel length: the brand's scroll, then its end card. If the voiceover runs longer
 * than the scroll, the scroll stretches so the end card never cuts the voice off.
 */
export function reelSeconds(voiceDuration: number, scrollSeconds: number, endCardSeconds: number): number {
  return Math.max(scrollSeconds, voiceDuration + VOICE_TAIL) + endCardSeconds;
}
