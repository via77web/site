import React from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { EASE } from "../library/tokens/motion";
import type { StillsProps, Shot } from "../src/types";
import { BeforeAfterLayer } from "./Reel";
import { FONT_DISPLAY, FONT_HEAVY, FONT_SANS, clamp, rgba } from "./shared";
import { THEMES } from "./themes";

const build = Easing.bezier(...EASE.build);
const FADE = 10;

/**
 * A still photo with motion: cover-fit to the vertical frame, then a slow pan across the
 * overflow or a push-in toward a focus point. Animated clips (from ANIMATE_STILL_CMD) play as video.
 */
const Moving: React.FC<{ shot: Shot; frames: number; strength?: number }> = ({ shot, frames, strength = 1 }) => {
  const frame = useCurrentFrame();
  const { width: W, height: H } = useVideoConfig();
  const p = interpolate(frame, [0, frames], [0, 1], clamp);
  // Cover-fit size, with a little headroom so a push-in never shows an edge.
  const coverScale = Math.max(W / shot.width, H / shot.height);
  const w = shot.width * coverScale;
  const h = shot.height * coverScale;
  const overflowX = w - W;
  const overflowY = h - H;
  const fx = shot.focusX ?? 0.5;
  const fy = shot.focusY ?? 0.5;

  let scale = 1;
  let x = -overflowX * fx;
  let y = -overflowY * fy;
  switch (shot.motion) {
    case "pan-left":
    case "pan-right": {
      const from = shot.motion === "pan-left" ? 0.8 : 0.2;
      const to = shot.motion === "pan-left" ? 0.2 : 0.8;
      x = -overflowX * interpolate(p, [0, 1], [from, to]);
      scale = 1.04;
      break;
    }
    case "zoom-in":
      scale = interpolate(p, [0, 1], [1.02, 1.02 + 0.16 * strength]);
      break;
    case "zoom-out":
      scale = interpolate(p, [0, 1], [1.02 + 0.16 * strength, 1.02]);
      break;
  }
  const style: React.CSSProperties = {
    position: "absolute",
    left: 0,
    top: 0,
    width: w,
    height: h,
    transform: `translate(${x}px, ${y}px) scale(${scale})`,
    transformOrigin: `${fx * 100}% ${fy * 100}%`,
  };
  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "#000" }}>
      {shot.video ? (
        <OffthreadVideo src={staticFile(shot.src)} muted style={{ ...style, objectFit: "cover" }} />
      ) : (
        <Img src={staticFile(shot.src)} style={style} />
      )}
    </AbsoluteFill>
  );
};

/** Consecutive shots with short cross-fades. */
const ShotSequence: React.FC<{ shots: Shot[]; total: number; strength?: number; labelStyle?: StillsProps["style"]; labelDelay: number }> = ({
  shots,
  total,
  strength,
  labelStyle,
  labelDelay,
}) => {
  const per = Math.ceil(total / shots.length);
  return (
    <>
      {shots.map((shot, i) => (
        <Sequence key={i} from={Math.max(i * per - FADE, 0)} durationInFrames={per + FADE * 2}>
          <FadeIn first={i === 0}>
            <Moving shot={shot} frames={per + FADE * 2} strength={strength} />
          </FadeIn>
          {labelStyle && shot.label ? (
            // The first shot sits under the hook, so its label waits for the hook to clear.
            <Sequence from={i === 0 ? labelDelay : FADE}>
              <Label text={shot.label} style={labelStyle} />
            </Sequence>
          ) : null}
        </Sequence>
      ))}
    </>
  );
};

const FadeIn: React.FC<{ first: boolean; children: React.ReactNode }> = ({ first, children }) => {
  const frame = useCurrentFrame();
  return <AbsoluteFill style={{ opacity: first ? 1 : interpolate(frame, [0, FADE], [0, 1], clamp) }}>{children}</AbsoluteFill>;
};

const Label: React.FC<{ text: string; style: StillsProps["style"] }> = ({ text, style }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [0, 14], [0, 1], { ...clamp, easing: build });
  const minimal = style.theme === "minimal";
  return (
    <div
      style={{
        position: "absolute",
        top: 120,
        left: 60,
        opacity: p,
        transform: `translateY(${(1 - p) * 14}px)`,
        fontFamily: minimal ? FONT_SANS : FONT_HEAVY,
        fontWeight: minimal ? 500 : 800,
        fontSize: 32,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: style.colors.text,
        backgroundColor: rgba(style.colors.scrim, 0.72),
        padding: "12px 20px",
        borderLeft: `6px solid ${style.colors.accent}`,
      }}
    >
      {text}
    </div>
  );
};

/** finish: the material's name, set like a swatch label. */
const MaterialCard: React.FC<{ name: string; note: string; style: StillsProps["style"] }> = ({ name, note, style }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [0, 18], [0, 1], { ...clamp, easing: build });
  return (
    <div
      style={{
        position: "absolute",
        left: 60,
        right: 60,
        top: 230,
        opacity: p,
        transform: `translateX(${(1 - p) * -40}px)`,
        backgroundColor: rgba(style.colors.scrim, 0.82),
        borderLeft: `12px solid ${style.colors.accent}`,
        padding: "34px 40px",
      }}
    >
      <div style={{ fontFamily: FONT_HEAVY, fontWeight: 800, fontSize: 30, letterSpacing: "0.16em", textTransform: "uppercase", color: style.colors.accent }}>
        {note}
      </div>
      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 104, lineHeight: 1, textTransform: "uppercase", color: style.colors.text, marginTop: 14 }}>
        {name}
      </div>
    </div>
  );
};

/** explainer: wrap vs replace, row by row. */
const Comparison: React.FC<{ rows: NonNullable<StillsProps["rows"]>; style: StillsProps["style"]; frames: number }> = ({ rows, style, frames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const each = Math.max((frames - fps) / rows.length, fps * 0.8);
  const cell: React.CSSProperties = { fontFamily: FONT_HEAVY, fontWeight: 800, fontSize: 44, lineHeight: 1.15, color: style.colors.text };
  return (
    <div style={{ position: "absolute", top: 250, left: 56, right: 56 }}>
      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 116, lineHeight: 1, textTransform: "uppercase", color: style.colors.text }}>
        Wrap <span style={{ color: style.colors.accent }}>vs</span> replace
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginTop: 40, fontFamily: FONT_HEAVY, fontWeight: 800, fontSize: 30, letterSpacing: "0.14em" }}>
        <div style={{ color: style.colors.accent }}>WRAP</div>
        <div style={{ color: rgba(style.colors.text, 0.6) }}>REPLACE</div>
      </div>
      {rows.map((row, i) => {
        const p = interpolate(frame, [i * each, i * each + 14], [0, 1], { ...clamp, easing: build });
        return (
          <div key={i} style={{ opacity: p, transform: `translateY(${(1 - p) * 24}px)`, borderTop: `2px solid ${rgba(style.colors.text, 0.25)}`, padding: "20px 0 22px", marginTop: 6 }}>
            <div style={{ fontFamily: FONT_HEAVY, fontWeight: 800, fontSize: 26, letterSpacing: "0.16em", textTransform: "uppercase", color: rgba(style.colors.text, 0.7), marginBottom: 10 }}>
              {row.label}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
              <div style={{ ...cell, color: style.colors.accent }}>{row.wrap}</div>
              <div style={{ ...cell, color: rgba(style.colors.text, 0.75) }}>{row.replace}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const Stills: React.FC<StillsProps> = (props) => {
  const { format, shots, pair, material, rows, style, voiceSrc, musicSrc, logoSrc, brandName, hook, captions, words, ctaLine, ctaAction } = props;
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const theme = THEMES[style.theme];
  const hookFrames = Math.round(style.hookSeconds * fps);
  const endCardFrames = Math.round(style.endCardSeconds * fps);
  const endCardStart = durationInFrames - endCardFrames;
  const body = endCardStart - hookFrames;

  let visual: React.ReactNode = null;
  if (format === "transformation" && pair) {
    const wipeStart = Math.round(hookFrames + body * 0.38);
    visual = (
      <AbsoluteFill>
        <Moving shot={pair.after} frames={durationInFrames} strength={0.5} />
        <BeforeAfterLayer beforeSrc="" wipeStart={wipeStart} style={style} before={<Moving shot={pair.before} frames={durationInFrames} strength={0.5} />} />
        {pair.after.label ? (
          <Sequence from={wipeStart + fps} durationInFrames={endCardStart - wipeStart - fps}>
            <Label text={pair.after.label} style={style} />
          </Sequence>
        ) : null}
      </AbsoluteFill>
    );
  } else if (format === "explainer") {
    visual = (
      <>
        <Moving shot={shots[0]} frames={durationInFrames} strength={0.4} />
        <AbsoluteFill style={{ backgroundColor: rgba(style.colors.scrim, 0.8) }} />
      </>
    );
  } else {
    visual = (
      <ShotSequence
        shots={shots}
        total={endCardStart + FADE}
        strength={format === "finish" ? 2.4 : 1}
        labelStyle={format === "showcase" ? style : undefined}
        labelDelay={hookFrames}
      />
    );
  }

  return (
    <AbsoluteFill style={{ backgroundColor: style.colors.scrim }}>
      {visual}
      <AbsoluteFill style={{ background: theme.footageOverlay(style) }} />

      {format === "explainer" && rows?.length ? (
        <Sequence from={hookFrames} durationInFrames={body}>
          <Comparison rows={rows} style={style} frames={body} />
        </Sequence>
      ) : null}
      {format === "finish" && material ? (
        <Sequence from={hookFrames} durationInFrames={body}>
          <MaterialCard name={material.name} note={material.note} style={style} />
        </Sequence>
      ) : null}

      <Sequence from={0} durationInFrames={hookFrames}>
        <theme.Hook text={hook} brandName={brandName} style={style} />
      </Sequence>
      {frame >= hookFrames && frame < endCardStart ? <theme.Captions words={words} captions={captions} style={style} /> : null}
      <Sequence from={endCardStart} durationInFrames={endCardFrames}>
        <theme.EndCard ctaLine={ctaLine} ctaAction={ctaAction} brandName={brandName} logoSrc={logoSrc} style={style} />
      </Sequence>

      <Audio src={staticFile(voiceSrc)} />
      {musicSrc ? (
        <Audio
          src={staticFile(musicSrc)}
          loop
          volume={(f) => style.musicVolume * interpolate(f, [0, fps * 0.5, durationInFrames - fps, durationInFrames], [0, 1, 1, 0], clamp)}
        />
      ) : null}
    </AbsoluteFill>
  );
};
