import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont } from "@remotion/fonts";
import type { ReelProps } from "../src/types";
import { groupWords } from "./captions";
import { END_CARD_SECONDS, HOOK_SECONDS } from "./timing";

const DISPLAY = "Anton";
const CAPTION = "Montserrat";
const ACCENT = "#FFE14D";
const INK = "#0B0B10";

loadFont({ family: DISPLAY, url: staticFile("fonts/anton.woff2"), weight: "400" });
loadFont({ family: CAPTION, url: staticFile("fonts/montserrat-800.woff2"), weight: "800" });

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** The screen recording with a slow push-in / pull-out so the frame never sits still. */
const Footage: React.FC<{ src: string }> = ({ src }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const intro = spring({ frame, fps, config: { damping: 200 }, durationInFrames: Math.round(HOOK_SECONDS * fps) });
  const breathe = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / 7);
  const scale = 1 + 0.06 * (1 - intro) + 0.045 * breathe;
  return (
    <AbsoluteFill style={{ backgroundColor: INK }}>
      <OffthreadVideo
        src={staticFile(src)}
        muted
        style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${scale})`, transformOrigin: "50% 42%" }}
      />
      <AbsoluteFill
        style={{ background: "linear-gradient(180deg, rgba(0,0,0,0) 48%, rgba(0,0,0,0.5) 74%, rgba(0,0,0,0.12) 100%)" }}
      />
    </AbsoluteFill>
  );
};

const Hook: React.FC<{ text: string }> = ({ text }) => {
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
        backgroundColor: "rgba(8,8,12,0.58)",
        justifyContent: "center",
        alignItems: "center",
        padding: "0 80px",
      }}
    >
      <div
        style={{
          fontFamily: DISPLAY,
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
                color: i === words.length - 1 ? ACCENT : "white",
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

const Captions: React.FC<Pick<ReelProps, "words" | "captions">> = ({ words, captions }) => {
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
          fontFamily: CAPTION,
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
          WebkitTextStroke: `14px ${INK}`,
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
                color: active ? ACCENT : "white",
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

const Star: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 100 100">
    <path d="M50 2 L61 39 L98 50 L61 61 L50 98 L39 61 L2 50 L39 39 Z" fill={ACCENT} />
  </svg>
);

const EndCard: React.FC<{ cta: string; logoSrc: string | null }> = ({ cta, logoSrc }) => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const slide = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 14 });
  const logo = spring({ frame: frame - 8, fps, config: { damping: 13, stiffness: 160 } });
  const pill = spring({ frame: frame - 20, fps, config: { damping: 11, stiffness: 180 } });
  const nudge = Math.sin(((frame - 30) / fps) * Math.PI * 3) * 10;
  return (
    <AbsoluteFill
      style={{
        transform: `translateY(${(1 - slide) * height}px)`,
        background: `radial-gradient(120% 70% at 50% 38%, #24243a 0%, ${INK} 62%)`,
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
            <Star size={170} />
            <div style={{ fontFamily: DISPLAY, fontSize: 190, letterSpacing: "0.06em", color: "white", lineHeight: 1 }}>
              WEBSTAR
            </div>
          </div>
        )}
      </div>
      <div
        style={{
          fontFamily: CAPTION,
          fontWeight: 800,
          fontSize: 54,
          color: "rgba(255,255,255,0.82)",
          textAlign: "center",
          padding: "0 90px",
          opacity: Math.min(logo, 1),
        }}
      >
        {cta}
      </div>
      <div
        style={{
          transform: `scale(${pill}) translateY(${frame > 30 ? nudge : 0}px)`,
          backgroundColor: ACCENT,
          color: INK,
          fontFamily: CAPTION,
          fontWeight: 800,
          fontSize: 76,
          textTransform: "uppercase",
          padding: "34px 76px",
          borderRadius: 999,
          boxShadow: "0 20px 60px rgba(255,225,77,0.28)",
        }}
      >
        Link in bio ↑
      </div>
    </AbsoluteFill>
  );
};

export const Reel: React.FC<ReelProps> = ({
  recordingSrc,
  voiceSrc,
  musicSrc,
  logoSrc,
  hook,
  captions,
  words,
  cta,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const hookFrames = Math.round(HOOK_SECONDS * fps);
  const endCardFrames = Math.round(END_CARD_SECONDS * fps);
  const endCardStart = durationInFrames - endCardFrames;

  return (
    <AbsoluteFill style={{ backgroundColor: INK }}>
      <Footage src={recordingSrc} />

      <Sequence from={0} durationInFrames={hookFrames}>
        <Hook text={hook} />
      </Sequence>

      {/* Captions take over once the hook clears, and stop for the end card. */}
      {frame >= hookFrames && frame < endCardStart ? <Captions words={words} captions={captions} /> : null}

      <Sequence from={endCardStart} durationInFrames={endCardFrames}>
        <EndCard cta={cta} logoSrc={logoSrc} />
      </Sequence>

      <Audio src={staticFile(voiceSrc)} />
      {musicSrc ? (
        <Audio
          src={staticFile(musicSrc)}
          loop
          volume={(f) =>
            0.12 *
            interpolate(f, [0, fps * 0.5, durationInFrames - fps, durationInFrames], [0, 1, 1, 0], clamp)
          }
        />
      ) : null}
    </AbsoluteFill>
  );
};
