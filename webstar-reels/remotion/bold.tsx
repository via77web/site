import React from "react";
import { AbsoluteFill, Img, spring, staticFile, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { groupWords } from "./captions";
import { FONT_DISPLAY, FONT_HEAVY, clamp, rgba, type Theme } from "./shared";

/** Loud and fast: uppercase display type, words that pop, a bouncing button. */

const Hook: Theme["Hook"] = ({ text, style }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const words = text.replace(/[.]+$/, "").split(/\s+/);
  const fadeOut = interpolate(frame, [durationInFrames - 6, durationInFrames], [1, 0], clamp);
  // Shrink the type for longer hooks so it always fits in four or five lines.
  const fontSize = words.length <= 6 ? 168 : words.length <= 9 ? 142 : 118;
  return (
    <AbsoluteFill
      style={{
        opacity: fadeOut,
        backgroundColor: rgba(style.colors.scrim, 0.58),
        justifyContent: "center",
        alignItems: "center",
        padding: "0 80px",
      }}
    >
      <div
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize,
          lineHeight: 1.04,
          textTransform: "uppercase",
          textAlign: "center",
          color: "white",
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          columnGap: "0.24em",
          textShadow: "0 8px 40px rgba(0,0,0,0.55)",
        }}
      >
        {words.map((word, i) => {
          const pop = spring({ frame: frame - i * 2, fps, config: { damping: 14, stiffness: 220, mass: 0.6 } });
          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                opacity: Math.min(pop * 1.5, 1),
                transform: `translateY(${(1 - pop) * 60}px) scale(${0.8 + 0.2 * pop})`,
                color: i === words.length - 1 ? style.colors.accent : "white",
              }}
            >
              {word}
            </span>
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
  const groups = React.useMemo(() => groupWords(words, captions), [words, captions]);
  const group = groups.find((g) => t >= g.start && t < g.end);
  if (!group) return null;
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 520 }}>
      <div
        style={{
          fontFamily: FONT_HEAVY,
          fontWeight: 800,
          fontSize: 84,
          lineHeight: 1.12,
          textTransform: "uppercase",
          textAlign: "center",
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          columnGap: "0.28em",
          maxWidth: 920,
          WebkitTextStroke: `14px ${style.colors.background}`,
          paintOrder: "stroke fill",
          textShadow: "0 6px 24px rgba(0,0,0,0.6)",
        }}
      >
        {group.words.map((w, i) => {
          const sinceStart = frame - Math.round(w.start * fps);
          const pop = spring({ frame: sinceStart, fps, config: { damping: 12, stiffness: 260, mass: 0.5 } });
          const active = t >= w.start && t < w.end + 0.08;
          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                opacity: sinceStart >= 0 ? 1 : 0,
                transform: `scale(${0.7 + 0.3 * pop + (active ? 0.08 : 0)})`,
                color: active ? style.colors.accent : "white",
              }}
            >
              {w.word}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const Star: React.FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 100 100">
    <path d="M50 2 L61 39 L98 50 L61 61 L50 98 L39 61 L2 50 L39 39 Z" fill={color} />
  </svg>
);

const EndCard: Theme["EndCard"] = ({ ctaLine, ctaAction, brandName, logoSrc, style }) => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const { background, text, accent } = style.colors;
  const slide = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 14 });
  const logo = spring({ frame: frame - 8, fps, config: { damping: 13, stiffness: 160 } });
  const pill = spring({ frame: frame - 20, fps, config: { damping: 11, stiffness: 180 } });
  const nudge = Math.sin(((frame - 30) / fps) * Math.PI * 3) * 10;
  return (
    <AbsoluteFill
      style={{
        transform: `translateY(${(1 - slide) * height}px)`,
        background: `radial-gradient(120% 70% at 50% 38%, ${rgba(text, 0.14)} 0%, ${background} 62%)`,
        backgroundColor: background,
        justifyContent: "center",
        alignItems: "center",
        gap: 70,
      }}
    >
      <div style={{ transform: `scale(${0.6 + 0.4 * logo})`, opacity: Math.min(logo * 1.4, 1) }}>
        {logoSrc ? (
          <Img src={staticFile(logoSrc)} style={{ width: 720, height: 360, objectFit: "contain" }} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 26 }}>
            <Star size={170} color={accent} />
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 190, letterSpacing: "0.06em", color: text, lineHeight: 1 }}>
              {brandName}
            </div>
          </div>
        )}
      </div>
      <div
        style={{
          fontFamily: FONT_DISPLAY,
          // Longer lines step down so they stay within three lines.
          fontSize: ctaLine.length > 22 ? 84 : 104,
          lineHeight: 1.08,
          textTransform: "uppercase",
          letterSpacing: "0.02em",
          color: text,
          textAlign: "center",
          padding: "0 90px",
          opacity: Math.min(logo, 1),
        }}
      >
        {ctaLine}
      </div>
      {ctaAction ? (
        <div
          style={{
            transform: `scale(${pill}) translateY(${frame > 30 ? nudge : 0}px)`,
            backgroundColor: accent,
            color: background,
            fontFamily: FONT_HEAVY,
            fontWeight: 800,
            // Long actions shrink to fit the frame on one line.
            fontSize: Math.min(76, Math.floor(1500 / Math.max(ctaAction.length + 2, 1))),
            whiteSpace: "nowrap",
            textTransform: "uppercase",
            padding: ctaAction.length > 18 ? "28px 48px" : "34px 76px",
            borderRadius: 999,
            boxShadow: `0 20px 60px ${rgba(accent, 0.28)}`,
          }}
        >
          {ctaAction} ↑
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

export const bold: Theme = {
  footageOverlay: () =>
    "linear-gradient(180deg, rgba(0,0,0,0) 48%, rgba(0,0,0,0.5) 74%, rgba(0,0,0,0.12) 100%)",
  Hook,
  Captions,
  EndCard,
};
