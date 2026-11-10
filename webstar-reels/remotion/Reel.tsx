import React from "react";
import {
  AbsoluteFill,
  Audio,
  OffthreadVideo,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { ReelProps } from "../src/types";
import { bold } from "./bold";
import { minimal } from "./minimal";
import { clamp, type Theme } from "./shared";

const THEMES: Record<ReelProps["style"]["theme"], Theme> = { bold, minimal };

/** The screen recording with a slow push-in and pull-out so the frame never sits still. */
const Footage: React.FC<{ src: string; zoom: number; overlay: string; background: string }> = ({
  src,
  zoom,
  overlay,
  background,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const t = frame / fps;
  // One slow breath every ~7s for a lively zoom, stretching to a single drift for a subtle one.
  const period = zoom >= 0.04 ? 7 : durationInFrames / fps;
  const breathe = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / period);
  const settle = interpolate(t, [0, 1.5], [1, 0], clamp);
  const scale = 1 + zoom * 1.3 * settle * settle + zoom * breathe;
  return (
    <AbsoluteFill style={{ backgroundColor: background }}>
      <OffthreadVideo
        src={staticFile(src)}
        muted
        style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${scale})`, transformOrigin: "50% 42%" }}
      />
      <AbsoluteFill style={{ background: overlay }} />
    </AbsoluteFill>
  );
};

export const Reel: React.FC<ReelProps> = ({
  recordingSrc,
  voiceSrc,
  musicSrc,
  logoSrc,
  brandName,
  style,
  hook,
  captions,
  words,
  ctaLine,
  ctaAction,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const theme = THEMES[style.theme];
  const hookFrames = Math.round(style.hookSeconds * fps);
  const endCardFrames = Math.round(style.endCardSeconds * fps);
  const endCardStart = durationInFrames - endCardFrames;

  return (
    <AbsoluteFill style={{ backgroundColor: style.colors.scrim }}>
      <Footage
        src={recordingSrc}
        zoom={style.zoom}
        overlay={theme.footageOverlay(style)}
        background={style.colors.scrim}
      />

      <Sequence from={0} durationInFrames={hookFrames}>
        <theme.Hook text={hook} brandName={brandName} style={style} />
      </Sequence>

      {/* Captions take over once the hook clears, and stop for the end card. */}
      {frame >= hookFrames && frame < endCardStart ? (
        <theme.Captions words={words} captions={captions} style={style} />
      ) : null}

      <Sequence from={endCardStart} durationInFrames={endCardFrames}>
        <theme.EndCard ctaLine={ctaLine} ctaAction={ctaAction} brandName={brandName} logoSrc={logoSrc} style={style} />
      </Sequence>

      <Audio src={staticFile(voiceSrc)} />
      {musicSrc ? (
        <Audio
          src={staticFile(musicSrc)}
          loop
          volume={(f) =>
            style.musicVolume *
            interpolate(f, [0, fps * 0.5, durationInFrames - fps, durationInFrames], [0, 1, 1, 0], clamp)
          }
        />
      ) : null}
    </AbsoluteFill>
  );
};
