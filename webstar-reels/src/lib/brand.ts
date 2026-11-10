import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { env } from "./env.js";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BRANDS_DIR = path.join(ROOT, "brands");

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "expected a #RRGGBB colour");

const StyleSchema = z.object({
  /** "bold": big uppercase type, pops and bounces. "minimal": small sans type, slow fades. */
  theme: z.enum(["bold", "minimal"]),
  hookSeconds: z.number().positive(),
  endCardSeconds: z.number().positive(),
  /** How far the footage slowly pushes in, as a fraction (0.04 = 4%). */
  zoom: z.number().min(0).max(0.2),
  musicVolume: z.number().min(0).max(1),
  colors: z.object({
    /** End card background. */
    background: hex,
    /** End card text. */
    text: hex,
    /** Highlights: active caption word, rules, buttons. */
    accent: hex,
    /** Tint laid over the footage behind the hook and captions. */
    scrim: hex,
  }),
});

const BrandSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  /** Who the brand is and what the reels show. Given to Claude. */
  about: z.string(),
  audience: z.string(),
  tone: z.string(),
  rules: z.array(z.string()).default([]),
  /** When false, the script may not mention prices, costs or discounts. */
  allowPrices: z.boolean().default(true),
  /** End card text. " — " splits it into a headline and an action line. */
  cta: z.string(),
  /** How the voice should say the call to action (spell out URLs). */
  spokenCta: z.string(),
  /** Set false when the spoken call to action reads badly on screen (a spelled-out URL); the end card shows it instead. */
  captionSpokenCta: z.boolean().default(true),
  hashtags: z.array(z.string()).default([]),
  voice: z.object({
    maxWords: z.number().int().positive(),
    stability: z.number().min(0).max(1),
    similarityBoost: z.number().min(0).max(1),
    style: z.number().min(0).max(1),
    speed: z.number().min(0.7).max(1.2),
  }),
  scroll: z.object({
    /** Length of the hero-to-footer scroll, including pauses. */
    seconds: z.number().positive(),
    heroHold: z.number().min(0),
    sectionHold: z.number().min(0),
  }),
  post: z.object({ time: z.string().regex(/^\d{1,2}:\d{2}$/), timezone: z.string() }),
  style: StyleSchema,
});

export type Brand = z.infer<typeof BrandSchema>;
export type BrandStyle = z.infer<typeof StyleSchema>;

export function listBrandIds(): string[] {
  return fs
    .readdirSync(BRANDS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -5))
    .sort();
}

export function loadBrand(id: string): Brand {
  const file = path.join(BRANDS_DIR, `${id}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`Unknown brand "${id}". Available: ${listBrandIds().join(", ")}`);
  }
  const parsed = BrandSchema.safeParse(JSON.parse(fs.readFileSync(file, "utf8")));
  if (!parsed.success) {
    throw new Error(`brands/${id}.json is invalid:\n${z.prettifyError(parsed.error)}`);
  }
  if (parsed.data.id !== id) throw new Error(`brands/${id}.json has id "${parsed.data.id}"; it must match the file name`);
  return parsed.data;
}

/** Folder holding the brand's sites.json and hooks.json. */
export function brandDir(brand: Brand): string {
  return path.join(BRANDS_DIR, brand.id);
}

/** Per-brand environment variable name, e.g. brandEnvName("ELEVENLABS_VOICE_ID", via77) -> ELEVENLABS_VOICE_ID_VIA77. */
export function brandEnvName(base: string, brand: Pick<Brand, "id">): string {
  return `${base}_${brand.id.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
}

export function brandEnv(base: string, brand: Pick<Brand, "id">): string | undefined {
  return env(brandEnvName(base, brand));
}
