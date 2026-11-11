import React from "react";
import { Audio, Sequence, interpolate, staticFile, useVideoConfig } from "remotion";
import type { ReelAudioProps } from "../src/types";
import { duckGain, speechSegments } from "./duck";
import { clamp } from "./shared";

/**
 * Voice and music for a reel. The voice starts at `voiceStart`. The music starts part-way into
 * its track so the drop lands on the reveal, ducks under every line, and fades at both ends.
 */
export const ReelAudio: React.FC<ReelAudioProps> = ({ voiceSrc, voiceStart, music, words }) => {
  const { fps, durationInFrames } = useVideoConfig();
  const segments = React.useMemo(() => speechSegments(words), [words]);
  const delay = Math.round((music?.delay ?? 0) * fps);
  return (
    <>
      <Sequence from={Math.round(voiceStart * fps)} layout="none">
        <Audio src={staticFile(voiceSrc)} />
      </Sequence>
      {music ? (
        <Sequence from={delay} layout="none">
          <Audio
            src={staticFile(music.src)}
            startFrom={Math.round(music.startAt * fps)}
            loop
            volume={(f) => {
              const frame = f + delay; // the callback counts from where this audio starts
              const edges = interpolate(frame, [delay, delay + fps * 0.4, durationInFrames - fps * 0.9, durationInFrames], [0, 1, 1, 0], clamp);
              return music.level * edges * duckGain(frame / fps, segments);
            }}
          />
        </Sequence>
      ) : null}
    </>
  );
};
