import React from "react";
import {
  AbsoluteFill,
  Easing,
  OffthreadVideo,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { ReelProps } from "../src/types";
import { EASE } from "../library/tokens/motion";
import { FONT_HEAVY, FONT_SANS, clamp, rgba } from "./shared";
import { THEMES } from "./themes";
import { ReelAudio } from "./audio";
import { LaptopIntro } from "./LaptopIntro";
import { INTRO_FADE } from "./timing";

/** The screen recording with a slow push-in and pull-out so the frame never sits still. */
const Footage: React.FC<{
  src: string;
  zoom: number;
  overlay: string;
  background: string;
  /** Seconds for one push-in and pull-out. Sixteen beats of the track, when there is music. */
  period?: number;
  children?: React.ReactNode;
}> = ({ src, zoom, overlay, background, period: beatPeriod, children }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const t = frame / fps;
  // One slow breath every ~7s for a lively zoom, stretching to a single drift for a subtle one.
  const period = zoom >= 0.04 ? (beatPeriod ?? 7) : durationInFrames / fps;
  const breathe = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / period);
  const settle = interpolate(t, [0, 1.5], [1, 0], clamp);
  const scale = 1 + zoom * 1.3 * settle * settle + zoom * breathe;
  return (
    <AbsoluteFill style={{ backgroundColor: background }}>
      <AbsoluteFill style={{ transform: `scale(${scale})`, transformOrigin: "50% 42%" }}>
        <OffthreadVideo src={staticFile(src)} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        {children}
      </AbsoluteFill>
      <AbsoluteFill style={{ background: overlay }} />
    </AbsoluteFill>
  );
};

const snap = Easing.bezier(...EASE.snap);

/**
 * before-after: the "before" footage plays first; then a wipe line sweeps across and reveals
 * the designed site underneath, both recordings scrolling in step.
 */
export const BeforeAfterLayer: React.FC<{
  beforeSrc: string;
  wipeStart: number;
  style: ReelProps["style"];
  /** Render the "before" layer yourself (e.g. a still photo); defaults to a video. */
  before?: React.ReactNode;
}> = ({ beforeSrc, wipeStart, style, before }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = interpolate(frame, [wipeStart, wipeStart + fps * 0.9], [0, 1], { ...clamp, easing: snap });
  const minimal = style.theme === "minimal";
  const label = (text: string, visible: number, side: "left" | "right"): React.ReactNode => (
    <div
      style={{
        position: "absolute",
        top: 250,
        [side]: 60,
        opacity: visible,
        fontFamily: minimal ? FONT_SANS : FONT_HEAVY,
        fontWeight: minimal ? 500 : 800,
        fontSize: minimal ? 34 : 40,
        letterSpacing: minimal ? "0.14em" : "0.04em",
        textTransform: "uppercase",
        color: style.colors.background,
        backgroundColor: minimal ? rgba(style.colors.scrim, 0.86) : style.colors.accent,
        padding: minimal ? "14px 22px" : "14px 26px",
        borderRadius: minimal ? 0 : 999,
      }}
    >
      {text}
    </div>
  );
  return (
    <>
      {/* The before footage covers the after footage, and is cut away from the left by the wipe. */}
      <AbsoluteFill style={{ clipPath: `inset(0 0 0 ${p * 100}%)` }}>
        {before ?? <OffthreadVideo src={staticFile(beforeSrc)} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
      </AbsoluteFill>
      {p > 0 && p < 1 ? (
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `calc(${p * 100}% - 4px)`,
            width: 8,
            backgroundColor: style.colors.accent,
            boxShadow: `0 0 40px ${rgba(style.colors.accent, 0.7)}`,
          }}
        />
      ) : null}
      {label("Before", 1 - p, "right")}
      {label("After", p >= 1 ? 1 : 0, "left")}
    </>
  );
};

/** Small "Concept" tag for sites that are not real businesses. */
const ConceptTag: React.FC<{ style: ReelProps["style"] }> = ({ style }) => {
  const minimal = style.theme === "minimal";
  return (
    <div
      style={{
        position: "absolute",
        top: 120,
        left: 60,
        fontFamily: minimal ? FONT_SANS : FONT_HEAVY,
        fontWeight: minimal ? 500 : 800,
        fontSize: 30,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: minimal ? style.colors.background : style.colors.text,
        backgroundColor: rgba(style.colors.scrim, 0.72),
        border: `2px solid ${rgba(minimal ? style.colors.background : style.colors.text, 0.5)}`,
        padding: "10px 18px",
        borderRadius: minimal ? 0 : 999,
      }}
    >
      Concept
    </div>
  );
};

export const Reel: React.FC<ReelProps> = ({
  variant,
  beforeSrc,
  concept,
  recordingSrc,
  voiceSrc,
  music,
  voiceStart,
  revealSeconds,
  intro,
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
  // On a laptop-zoom reel the hook sits over the whole intro; otherwise for the brand's hook time.
  const introFrames = intro ? Math.round(intro.seconds * fps) : 0;
  const hookFrames = intro ? introFrames : Math.round(style.hookSeconds * fps);
  const endCardFrames = Math.round(style.endCardSeconds * fps);
  const endCardStart = durationInFrames - endCardFrames;
  // Detail and interaction footage already moves in the recording, so the frame stays still.
  const zoom = variant === "detail" || variant === "interaction" ? 0 : style.zoom;
  const wipeStart = Math.round(revealSeconds * fps);
  // The site recording starts as the laptop screen fills the frame, and fades in over it.
  const footageFrom = intro ? introFrames - Math.round(INTRO_FADE * fps) : 0;
  const footageIn = intro ? interpolate(frame, [footageFrom, introFrames], [0, 1], clamp) : 1;

  return (
    <AbsoluteFill style={{ backgroundColor: style.colors.scrim }}>
      {intro && frame < introFrames ? <LaptopIntro intro={intro} /> : null}
      <Sequence from={footageFrom}>
        <AbsoluteFill style={{ opacity: footageIn }}>
          <Footage
            src={recordingSrc}
            zoom={zoom}
            overlay={theme.footageOverlay(style)}
            background={style.colors.scrim}
            period={music ? music.beatSeconds * 16 : undefined}
          >
            {variant === "before-after" && beforeSrc ? (
              <BeforeAfterLayer beforeSrc={beforeSrc} wipeStart={wipeStart} style={style} />
            ) : null}
          </Footage>
        </AbsoluteFill>
      </Sequence>

      {concept && frame >= hookFrames && frame < endCardStart ? <ConceptTag style={style} /> : null}

      <Sequence from={0} durationInFrames={hookFrames}>
        <theme.Hook text={hook} brandName={brandName} style={style} light={!!intro} />
      </Sequence>

      {/* Captions take over once the hook clears, and stop for the end card. */}
      {frame >= hookFrames && frame < endCardStart ? (
        <theme.Captions words={words} captions={captions} style={style} />
      ) : null}

      <Sequence from={endCardStart} durationInFrames={endCardFrames}>
        <theme.EndCard ctaLine={ctaLine} ctaAction={ctaAction} brandName={brandName} logoSrc={logoSrc} style={style} />
      </Sequence>

      <ReelAudio voiceSrc={voiceSrc} voiceStart={voiceStart} music={music} words={words} />
    </AbsoluteFill>
  );
};
