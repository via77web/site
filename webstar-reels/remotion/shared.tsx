import type React from "react";
import { staticFile } from "remotion";
import { loadFont } from "@remotion/fonts";
import type { BrandStyle } from "../src/lib/brand";
import type { WordTiming } from "../src/types";

export const FONT_DISPLAY = "Anton";
export const FONT_HEAVY = "Montserrat";
export const FONT_SANS = "Inter";

loadFont({ family: FONT_DISPLAY, url: staticFile("fonts/anton.woff2"), weight: "400" });
loadFont({ family: FONT_HEAVY, url: staticFile("fonts/montserrat-800.woff2"), weight: "800" });
loadFont({ family: FONT_SANS, url: staticFile("fonts/inter-500.woff2"), weight: "500" });

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

export function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** The three text layers every theme provides. Each is rendered inside its own time window. */
export interface Theme {
  /** Gradient laid over the footage for the whole reel, so captions stay readable. */
  footageOverlay: (style: BrandStyle) => string;
  Hook: React.FC<{ text: string; brandName: string; style: BrandStyle }>;
  Captions: React.FC<{ words: WordTiming[]; captions: string[]; style: BrandStyle }>;
  EndCard: React.FC<{
    ctaLine: string;
    ctaAction: string;
    brandName: string;
    logoSrc: string | null;
    style: BrandStyle;
  }>;
}
