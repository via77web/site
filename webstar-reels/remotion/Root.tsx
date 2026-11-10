import React from "react";
import { Composition } from "remotion";
import webstar from "../brands/webstar.json";
import type { ReelProps } from "../src/types";
import { Reel } from "./Reel";
import { FPS, HEIGHT, WIDTH } from "./timing";

// Placeholder props for `npm run studio`. Run `npm run reel:mock` once so public/run/ has assets,
// and swap the import above to preview another brand.
const hook = "This skincare website sells before you scroll";
const previewProps: ReelProps = {
  recordingSrc: "run/recording.mp4",
  voiceSrc: "run/voice.mp3",
  musicSrc: `brands/${webstar.id}/music.mp3`,
  logoSrc: null,
  brandName: webstar.name,
  style: webstar.style as ReelProps["style"],
  totalSeconds: webstar.scroll.seconds + webstar.style.endCardSeconds,
  hook,
  captions: [],
  words: `${hook}. Clean layout, bold product shots, zero clutter.`
    .split(" ")
    .map((word, i) => ({ word, start: i * 0.37, end: i * 0.37 + 0.33 })),
  ctaLine: "Pick a tier",
  ctaAction: "link in bio",
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
      durationInFrames: Math.round(props.totalSeconds * FPS),
    })}
  />
);
