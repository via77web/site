import { contrast, googleFontsUrl, type Direction } from "../index.js";

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (n: number, s: number) => (n >> s) & 255;
  const v = [16, 8, 0].map((s) => Math.round(ch(pa, s) + (ch(pb, s) - ch(pa, s)) * t));
  return "#" + v.map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** CSS custom properties for a direction. Shared by both layouts. */
export function directionVars(d: Direction): Record<string, string | number> {
  const c = d.colors;
  return {
    "--bg": c.bg,
    "--bg2": c.bg2,
    "--ink": c.ink,
    "--muted": c.muted,
    "--line": mix(c.bg, c.ink, 0.12),
    "--line-strong": mix(c.bg, c.ink, 0.28),
    "--accent": c.accent,
    "--accent-ink": c.accentInk,
    // Accent only becomes a text colour when it is readable on the background.
    "--accent-text": contrast(c.accent, c.bg) >= 4.5 ? c.accent : c.ink,
    "--f-display": d.fonts.display.stack,
    "--f-body": d.fonts.body.stack,
    "--dw": d.display.weight,
    "--dt": d.display.tracking,
    "--dc": d.display.case,
    "--radius": `${d.radius}px`,
    "--s": d.motionScale,
  };
}

export const styleAttr = (vars: Record<string, string | number>) =>
  Object.entries(vars)
    .map(([k, v]) => `${k}:${String(v).replace(/"/g, "&quot;")}`)
    .join(";");

export function fontLinks(d: Direction): string {
  return `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${googleFontsUrl(d)}" rel="stylesheet">`;
}

/** Rendered site: files keyed by path relative to the site root. Images are added by the builder. */
export interface RenderedSite {
  files: Record<string, string>;
  /** Library files to copy as-is: site path -> library path. */
  copy: Record<string, string>;
}
