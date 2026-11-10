import React from "react";
import { Composition } from "remotion";
import type { ReelProps } from "../src/types";
import { Reel } from "./Reel";
import { FPS, HEIGHT, WIDTH, reelSeconds } from "./timing";

// Placeholder props for `npm run studio`. Run `npm run reel:mock` once so public/run/ has assets.
const previewProps: ReelProps = {
  recordingSrc: "run/recording.mp4",
  recordingDuration: 15,
  voiceSrc: "run/voice.mp3",
  voiceDuration: 12,
  musicSrc: "music.mp3",
  logoSrc: null,
  hook: "This skincare website sells before you scroll",
  captions: [],
  words: "This skincare website sells before you scroll. Clean layout, soft colour, and product shots that do the talking."
    .split(" ")
    .map((word, i) => ({ word, start: i * 0.37, end: i * 0.37 + 0.33 })),
  cta: "Get a site like this",
};

export const Root: React.FC = () => (
  <Composition
    id="Reel"
    component={Reel}
    width={WIDTH}
    height={HEIGHT}
    fps={FPS}
    durationInFrames={FPS * 15}
    defaultProps={previewProps}
    calculateMetadata={({ props }) => ({
      durationInFrames: Math.round(reelSeconds(props.voiceDuration) * FPS),
    })}
  />
);
