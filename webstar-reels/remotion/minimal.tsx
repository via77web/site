import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { groupWords } from "./captions";
import { FONT_SANS, clamp, rgba, type Theme } from "./shared";

/** Quiet and slow: one sans typeface, sentence case, fades instead of bounces, square corners. */

const ease = { ...clamp, easing: Easing.out(Easing.cubic) };
const type = { fontFamily: FONT_SANS, fontWeight: 500, letterSpacing: "-0.045em" } as const;

const Hook: Theme["Hook"] = ({ text, brandName, style }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const { background: paper, accent, scrim } = style.colors;
  const fadeOut = interpolate(frame, [durationInFrames - 14, durationInFrames], [1, 0], clamp);
  const rule = interpolate(frame, [4, 4 + fps * 0.9], [0, 1], ease);
  // Hooks are often two short sentences; give each its own line group and let the second arrive later.
  const sentences = text.match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
  const fontSize = text.length <= 30 ? 112 : text.length <= 48 ? 96 : 82;
  return (
    <AbsoluteFill
      style={{
        opacity: fadeOut,
        backgroundColor: rgba(scrim, 0.74),
        justifyContent: "center",
        padding: "0 96px",
      }}
    >
      <div
        style={{
          ...type,
          letterSpacing: "0.14em",
          fontSize: 30,
          textTransform: "uppercase",
          color: rgba(paper, 0.7),
          opacity: interpolate(frame, [0, 12], [0, 1], clamp),
        }}
      >
        {brandName}
      </div>
      <div style={{ height: 3, width: 150 * rule, backgroundColor: accent, margin: "34px 0 46px" }} />
      <div style={{ ...type, fontSize, lineHeight: 1.08, color: paper }}>
        {sentences.map((sentence, i) => {
          const start = 6 + i * Math.round(fps * 0.55);
          const p = interpolate(frame, [start, start + fps * 0.7], [0, 1], ease);
          return (
            <div
              key={i}
              style={{
                opacity: p,
                transform: `translateY(${(1 - p) * 22}px)`,
                color: i === 0 ? paper : rgba(paper, 0.72),
              }}
            >
              {sentence}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const Captions: Theme["Captions"] = ({ words, captions, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const { background: paper, scrim } = style.colors;
  const groups = React.useMemo(() => groupWords(words, captions), [words, captions]);
  const group = groups.find((g) => t >= g.start && t < g.end);
  if (!group) return null;
  const appear = interpolate(t, [group.start, group.start + 0.18], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "flex-start", padding: "0 72px 500px" }}>
      <div
        style={{
          ...type,
          letterSpacing: "-0.03em",
          fontSize: 60,
          lineHeight: 1.2,
          backgroundColor: rgba(scrim, 0.9),
          padding: "22px 34px 26px",
          display: "flex",
          flexWrap: "wrap",
          columnGap: "0.26em",
          maxWidth: 900,
          opacity: appear,
          transform: `translateY(${(1 - appear) * 10}px)`,
        }}
      >
        {group.words.map((w, i) => (
          <span
            key={i}
            style={{
              // Words brighten as they are spoken; nothing moves.
              color: rgba(paper, interpolate(t, [w.start - 0.04, w.start + 0.14], [0.36, 1], clamp)),
            }}
          >
            {w.word}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  );
};

const EndCard: Theme["EndCard"] = ({ ctaLine, ctaAction, brandName, logoSrc, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { background: paper, text: ink, accent } = style.colors;
  const bg = interpolate(frame, [0, fps * 0.6], [0, 1], clamp);
  const step = (delay: number) => interpolate(frame, [fps * delay, fps * (delay + 0.7)], [0, 1], ease);
  const rise = (p: number): React.CSSProperties => ({ opacity: p, transform: `translateY(${(1 - p) * 18}px)` });
  return (
    <AbsoluteFill style={{ backgroundColor: paper, opacity: bg, justifyContent: "center", padding: "0 96px" }}>
      <div style={rise(step(0.3))}>
        {logoSrc ? (
          <Img src={staticFile(logoSrc)} style={{ width: 460, display: "block" }} />
        ) : (
          <div style={{ ...type, fontSize: 120, color: ink }}>{brandName}</div>
        )}
      </div>
      <div style={{ height: 3, width: 150 * step(0.55), backgroundColor: accent, margin: "70px 0 56px" }} />
      <div style={{ ...type, fontSize: 104, lineHeight: 1.04, color: ink, ...rise(step(0.7)) }}>{ctaLine}</div>
      {ctaAction ? (
        <div style={{ ...type, letterSpacing: "-0.02em", fontSize: 54, color: accent, marginTop: 36, ...rise(step(0.95)) }}>
          {ctaAction}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

export const minimal: Theme = {
  footageOverlay: (style) =>
    `linear-gradient(180deg, ${rgba(style.colors.scrim, 0)} 55%, ${rgba(style.colors.scrim, 0.3)} 78%, ${rgba(style.colors.scrim, 0.08)} 100%)`,
  Hook,
  Captions,
  EndCard,
};
