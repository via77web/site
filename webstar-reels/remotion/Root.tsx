import React from "react";
import { Composition } from "remotion";
import webstar from "../brands/webstar.json";
import type { ReelProps, StillsProps } from "../src/types";
import { Reel } from "./Reel";
import { Stills } from "./Stills";
import { FPS, HEIGHT, WIDTH } from "./timing";

// Placeholder props for `npm run studio`. Run `npm run reel:mock` once so public/run/ has assets,
// set `variant` (and beforeSrc: "run/before-after/before.mp4" for before-after),
// and swap the import above to preview another brand.
const hook = "This skincare website sells before you scroll";
const previewProps: ReelProps = {
  variant: "full",
  beforeSrc: null,
  concept: true,
  recordingSrc: "run/full/recording.mp4",
  voiceSrc: "run/full/voice.mp3",
  music: null,
  voiceStart: 0,
  revealSeconds: webstar.style.hookSeconds,
  intro: null,
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

const stillsPreview: StillsProps = {
  format: "showcase",
  shots: [],
  pair: null,
  material: null,
  rows: null,
  aiLabel: null,
  voiceSrc: previewProps.voiceSrc,
  music: null,
  revealSeconds: webstar.style.hookSeconds,
  logoSrc: null,
  brandName: "VERRANO",
  style: webstar.style as ReelProps["style"],
  totalSeconds: 15,
  hook: "Same cabinets. Completely different room.",
  captions: [],
  words: [],
  ctaLine: "Get a quote",
  ctaAction: "verrano.com.au",
};

export const Root: React.FC = () => (
  <>
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
  <Composition
    id="Stills"
    component={Stills}
    width={WIDTH}
    height={HEIGHT}
    fps={FPS}
    durationInFrames={FPS * 15}
    defaultProps={stillsPreview}
    calculateMetadata={({ props }) => ({ durationInFrames: Math.round(props.totalSeconds * FPS) })}
  />
  </>
);
