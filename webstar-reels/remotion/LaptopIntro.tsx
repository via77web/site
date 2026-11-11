import React from "react";
import { AbsoluteFill, Easing, OffthreadVideo, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { EASE } from "../library/tokens/motion";
import type { IntroProps } from "../src/types";
import { cornerPin } from "./pin";
import { clamp } from "./shared";

const draft = Easing.bezier(...EASE.draft);
type Pt = [number, number];

/**
 * Laptop-zoom opening: a person at a laptop, with the real recording of the site pinned to the
 * laptop's screen. The camera pushes in until the screen fills the frame, where the reel
 * cross-fades to the full-quality recording. The site on the screen is always the real
 * recording; the clip only supplies the room and the laptop.
 */
export const LaptopIntro: React.FC<{ intro: IntroProps }> = ({ intro }) => {
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  const total = Math.round(intro.seconds * fps);
  const zoomFrames = Math.round(intro.zoomSeconds * fps);
  const p = interpolate(frame, [total - zoomFrames, total], [0, 1], { ...clamp, easing: draft });

  // The clip is cover-fitted to the frame; its corner points move with it.
  const fit = Math.max(W / intro.width, H / intro.height);
  const ox = (W - intro.width * fit) / 2;
  const oy = (H - intro.height * fit) / 2;
  const quad = intro.corners.map(([x, y]) => [x * fit + ox, y * fit + oy] as Pt) as [Pt, Pt, Pt, Pt];
  const xs = quad.map((q) => q[0]);
  const ys = quad.map((q) => q[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  // Push in until the screen covers the whole frame (a little past, so no edge of the laptop shows).
  const end = Math.max(W / (maxX - minX), H / (maxY - minY)) * 1.06;
  const scale = 1 + (end - 1) * p;
  const tx = (W / 2 - cx) * p;
  const ty = (H / 2 - cy) * p;

  // The pinned recording is sized like the desktop capture so text stays sharp deep into the zoom.
  const SW = 1440;
  const SH = 900;
  const pin = cornerPin(SW, SH, quad);
  const pinned: React.CSSProperties = { position: "absolute", left: 0, top: 0, width: SW, height: SH, transformOrigin: "0 0", transform: pin };

  const clip = (
    <OffthreadVideo
      src={staticFile(intro.keyedSrc ?? intro.src)}
      muted
      transparent={!!intro.keyedSrc}
      style={{ position: "absolute", left: ox, top: oy, width: intro.width * fit, height: intro.height * fit }}
    />
  );
  const screen = (
    <div style={{ ...pinned, overflow: "hidden", backgroundColor: "#fff" }}>
      {/* Slightly dimmed and softened so the screen sits in the room instead of floating on it. */}
      <OffthreadVideo
        src={staticFile(intro.desktopSrc)}
        muted
        style={{ width: "100%", height: "100%", objectFit: "cover", filter: `brightness(${intro.screenBrightness}) contrast(0.97) blur(${interpolate(p, [0, 1], [0.7, 0])}px)` }}
      />
      {/* The room's own colour, faintly, so the screen takes on its light. */}
      <AbsoluteFill style={{ backgroundColor: intro.tint, opacity: 0.1 * (1 - p), mixBlendMode: "soft-light" }} />
      {/* A faint diagonal reflection, fading as the camera closes in. */}
      <AbsoluteFill
        style={{ opacity: 1 - p, background: "linear-gradient(115deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.02) 32%, rgba(255,255,255,0) 55%)" }}
      />
    </div>
  );

  return (
    <AbsoluteFill style={{ backgroundColor: "#000", overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: `translate(${tx}px, ${ty}px) scale(${scale})`, transformOrigin: `${cx}px ${cy}px` }}>
        {/* A green-screen clip is keyed, so it goes on top and anything in front of the laptop stays in front. */}
        {intro.keyedSrc ? null : clip}
        {screen}
        {/* Screen glow spilling onto the room. */}
        <div style={{ ...pinned, backgroundColor: "rgba(235,240,255,0.5)", filter: "blur(60px)", opacity: 0.22 * (1 - p), mixBlendMode: "screen" }} />
        {intro.keyedSrc ? clip : null}
      </AbsoluteFill>
      {intro.aiLabel ? (
        <div
          style={{
            position: "absolute", top: 120, right: 60, opacity: 1 - p, fontFamily: "Montserrat", fontWeight: 800, fontSize: 28,
            letterSpacing: "0.12em", textTransform: "uppercase", color: "#fff", backgroundColor: "rgba(0,0,0,0.62)",
            border: "2px solid rgba(255,255,255,0.55)", padding: "10px 18px", borderRadius: 999,
          }}
        >
          {intro.aiLabel}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
