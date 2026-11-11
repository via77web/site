import { reelSeconds } from "../../remotion/timing.js";
import type { Brand } from "./brand.js";
import { fitMusic, pickTrack, snapUpToBeat, type Beat, type ReelMusic } from "./music.js";

export interface Timeline {
  totalSeconds: number;
  /** When the voiceover starts. */
  voiceStart: number;
  /** The moment the music drop lands on. */
  revealSeconds: number;
  music: ReelMusic | null;
  /** The track's beat grid in reel time, for cuts and zooms. Null without music. */
  beat: Beat | null;
}

export interface TimelineInput {
  voiceSeconds: number;
  /**
   * What the drop lands on. "hook": the hook text clearing. "wipe": the before/after wipe,
   * a little over a third of the way through. A number: a laptop-zoom intro of that length,
   * with the voice starting as it ends.
   */
  reveal: "hook" | "wipe" | number;
  /** Tracks already used by other reels in the same batch. The chosen track is added. */
  avoid?: Set<string>;
  /** The end card can't start before this (e.g. fixed-length clips still playing). */
  minEndCardStart?: number;
}

/**
 * Lay a reel out against its music: choose the track, put the drop on the reveal, and start the
 * end card on a beat. The reel may run up to one beat longer than the voice strictly needs.
 */
export async function planTimeline(brand: Brand, input: TimelineInput): Promise<Timeline> {
  const { hookSeconds, endCardSeconds } = brand.style;
  const voiceStart = typeof input.reveal === "number" ? input.reveal : 0;
  let endCardStart = Math.max(reelSeconds(input.voiceSeconds, brand.scroll.seconds, endCardSeconds) - endCardSeconds + voiceStart, input.minEndCardStart ?? 0);
  const revealSeconds =
    typeof input.reveal === "number" ? input.reveal : input.reveal === "wipe" ? hookSeconds + (endCardStart - hookSeconds) * 0.38 : hookSeconds;

  const track = pickTrack(brand, input.avoid);
  let music: ReelMusic | null = null;
  let beat: Beat | null = null;
  if (track) {
    ({ music, beat } = await fitMusic(track, revealSeconds));
    input.avoid?.add(track.file);
    endCardStart = snapUpToBeat(endCardStart, beat);
  }
  return { totalSeconds: endCardStart + endCardSeconds, voiceStart, revealSeconds, music, beat };
}
