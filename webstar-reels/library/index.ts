import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const LIBRARY_DIR = path.dirname(fileURLToPath(import.meta.url));

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const Font = z.object({ family: z.string(), weights: z.string(), stack: z.string() });

/**
 * Which version of each building block a one-page site uses. A direction may carry a recipe;
 * without one the defaults apply. (Demo stores keep the store-kit structure and take tokens only.)
 */
export const ComponentsSchema = z.object({
  /** bar: full-width sticky bar. pill: floating rounded bar. centered: logo in the middle. */
  nav: z.enum(["bar", "pill", "centered"]),
  /** split: text beside an image. fullbleed: text over a full-screen image. type: oversized headline, image below. */
  hero: z.enum(["split", "fullbleed", "type"]),
  /** tabs: one service at a time. cards: a grid of cards. list: large numbered rows. */
  services: z.enum(["tabs", "cards", "list"]),
  /** bento: one large and several small. strip: a sideways-scrolling row. stack: full-width images, one per row. */
  gallery: z.enum(["bento", "strip", "stack"]),
  /** card: a rounded dark panel. band: a full-width accent band. */
  cta: z.enum(["card", "band"]),
  /** Up to two extras: a scrolling text band, a round badge on the hero, oversized outline numbers on the steps. */
  standouts: z.array(z.enum(["marquee", "badge", "big-numbers"])).max(2),
});

export type Components = z.infer<typeof ComponentsSchema>;

export const DEFAULT_COMPONENTS: Components = {
  nav: "bar",
  hero: "split",
  services: "tabs",
  gallery: "bento",
  cta: "card",
  standouts: [],
};

const DirectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Brand ids allowed to use this direction. */
  brands: z.array(z.string()),
  /** "onepage": a one-page business site. "store": a demo store on the store-kit engine. */
  layout: z.enum(["onepage", "store"]),
  mood: z.string(),
  bestFor: z.string(),
  colors: z.object({ bg: hex, bg2: hex, ink: hex, muted: hex, accent: hex, accentInk: hex }),
  fonts: z.object({ display: Font, body: Font }),
  display: z.object({ case: z.enum(["none", "uppercase"]), weight: z.number(), tracking: z.string() }),
  radius: z.number(),
  /** Motion system v1 scale, 0.8 to 1.5. Every duration is multiplied by it. */
  motionScale: z.number().min(0.8).max(1.5),
  primaryEase: z.enum(["draft", "build", "snap", "press"]),
  signatureMoves: z.array(z.string()).max(3),
  /** Photography direction, written for the image workflow. */
  imageStyle: z.string(),
  /** Component recipe for one-page sites. */
  components: ComponentsSchema.optional(),
  /** Where the direction came from, e.g. "references/sourdough-bakery". */
  source: z.string().optional(),
});

export { DirectionSchema };

export type Direction = z.infer<typeof DirectionSchema>;

export function loadDirections(): Direction[] {
  const dir = path.join(LIBRARY_DIR, "directions");
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const parsed = DirectionSchema.safeParse(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
      if (!parsed.success) throw new Error(`library/directions/${f} is invalid:\n${z.prettifyError(parsed.error)}`);
      return parsed.data;
    });
}

export function directionsFor(brandId: string): Direction[] {
  const list = loadDirections().filter((d) => d.brands.includes(brandId));
  if (!list.length) throw new Error(`No design direction in library/directions lists brand "${brandId}"`);
  return list;
}

export interface AntiPatterns {
  bannedPhrases: string[];
  rules: string[];
  maxFontFamilies: number;
}

export function loadAntiPatterns(): AntiPatterns {
  return JSON.parse(fs.readFileSync(path.join(LIBRARY_DIR, "anti-patterns.json"), "utf8"));
}

/** Google Fonts families a derived direction may use, with the weights each offers. */
export function loadFonts(): Record<string, { weights: number[]; kind: string }> {
  return JSON.parse(fs.readFileSync(path.join(LIBRARY_DIR, "fonts.json"), "utf8"));
}

export function saveDirection(d: Direction): string {
  const file = path.join(LIBRARY_DIR, "directions", `${d.id}.json`);
  fs.writeFileSync(file, JSON.stringify(d, null, 2) + "\n");
  return file;
}

export function googleFontsUrl(d: Direction): string {
  const fam = (f: { family: string; weights: string }) =>
    `family=${f.family.replace(/ /g, "+")}:wght@${f.weights}`;
  return `https://fonts.googleapis.com/css2?${fam(d.fonts.display)}&${fam(d.fonts.body)}&display=swap`;
}

// ---- WCAG contrast ----
function luminance(color: string): number {
  const n = parseInt(color.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Colour pairs every direction must pass at WCAG AA for body text. */
export function directionContrastProblems(d: Direction): string[] {
  const c = d.colors;
  const pairs: [string, string, string][] = [
    ["ink on bg", c.ink, c.bg],
    ["ink on bg2", c.ink, c.bg2],
    ["muted on bg", c.muted, c.bg],
    ["muted on bg2", c.muted, c.bg2],
    ["accentInk on accent", c.accentInk, c.accent],
    ["bg on ink (notice bar)", c.bg, c.ink],
  ];
  return pairs
    .filter(([, fg, bg]) => contrast(fg, bg) < 4.5)
    .map(([name, fg, bg]) => `${d.id}: ${name} is ${contrast(fg, bg).toFixed(2)}:1, needs 4.5:1`);
}
