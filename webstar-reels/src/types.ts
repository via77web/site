import type { BrandStyle } from "./lib/brand.js";

export type SiteStatus = "pending" | "rendered" | "failed";

/** A site in a brand's queue (brands/<id>/sites.json). */
export interface Site {
  url: string;
  name: string;
  niche: string;
  status: SiteStatus;
  /** Label posts as a concept. Always true for sites made by `npm run make`. */
  concept?: boolean;
  /** An earlier version of the site, for the before-after reel. Without it, "before" is the page with its design switched off. */
  beforeUrl?: string;
  attempts?: number;
  lastError?: string;
  batch?: string;
}

/** The four reels made from every site. */
export const VARIANTS = ["full", "detail", "before-after", "interaction"] as const;
export type SiteVariant = (typeof VARIANTS)[number];

/** Reel formats for brands whose content is a photo library (Verrano), not websites. */
export const STILL_FORMATS = ["transformation", "showcase", "finish", "explainer", "site-scroll"] as const;
export type StillFormat = (typeof STILL_FORMATS)[number];

/** AI visualisation formats: real library photos re-finished and animated with generative models. Always labelled. */
export const AI_FORMATS = ["imagine", "visualised", "finish-mood"] as const;
export type AiFormat = (typeof AI_FORMATS)[number];

export type VariantId = SiteVariant | StillFormat | AiFormat;
export const ALL_VARIANTS: readonly VariantId[] = [...VARIANTS, ...STILL_FORMATS, ...AI_FORMATS];

export const VARIANT_LABEL: Record<VariantId, string> = {
  full: "Full scroll",
  detail: "Detail zooms",
  "before-after": "Before / after",
  interaction: "Interaction demo",
  transformation: "Transformation",
  showcase: "Project showcase",
  finish: "Finish spotlight",
  explainer: "Wrap vs replace",
  "site-scroll": "Site scroll",
  imagine: "Imagine your space (AI)",
  visualised: "Before → visualised after (AI)",
  "finish-mood": "Finish mood (AI)",
};

export interface VariantScript {
  variant: VariantId;
  hook: string;
  voiceover: string;
  captions: string[];
  postCaption: string;
  hashtags: string[];
  youtubeTitle: string;
}

export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

export interface PageInfo {
  title: string;
  description: string;
  headings: string[];
}

/**
 * ready: rendered and waiting for its day (the weekly job plans one per brand per day).
 * awaiting: proposed for today, waiting for your decision.
 * approved: will be scheduled into the next free calendar slot.
 * scheduled: sent to Buffer for `scheduledFor`.
 * rejected: will never post.
 */
export type VariantStatus = "ready" | "awaiting" | "approved" | "rejected" | "scheduled";

export interface BatchVariant {
  id: VariantId;
  status: VariantStatus;
  script: VariantScript;
  /** Caption and hashtags exactly as they will be posted. */
  postText: string;
  seconds: number;
  /** Local path of the rendered MP4, relative to the project root (not committed). */
  file: string;
  /** Public URL of the MP4. Buffer downloads from here. */
  videoUrl?: string;
  scheduledFor?: string;
  /** Local date (YYYY-MM-DD) the weekly plan gives this reel. */
  plannedFor?: string;
  /** Local date it was put up for approval. */
  proposedOn?: string;
  /** Library images used (photo-library brands), so later reels can avoid repeating them. */
  assets?: string[];
  /** AI reels: every generated clip and image with its model, cost and quality-check result. */
  ai?: { usd: number; items: AiCost[] };
  /** Buffer post id per channel id. Lets a retry skip channels that already succeeded. */
  posts?: Record<string, string>;
  error?: string;
}

/** One site's set of reels, from rendering through approval to scheduling. */
export interface Batch {
  id: string;
  brand: string;
  createdAt: string;
  source: "queue" | "make" | "library";
  site: {
    name: string;
    url: string;
    niche: string;
    concept: boolean;
    previewUrl?: string;
    brief?: string;
    direction?: string;
  };
  campaign?: string;
  audit?: { blocking: string[]; warnings: string[] };
  /** GitHub issue used for approval, when running with GitHub. */
  issue?: number;
  decidedAt?: string;
  variants: BatchVariant[];
}

/** Input props of the Remotion composition. Asset paths are relative to public/. */
export type ReelProps = {
  variant: VariantId;
  recordingSrc: string;
  /** before-after only: the "before" footage, scrolled in step with the main recording. */
  beforeSrc: string | null;
  voiceSrc: string;
  musicSrc: string | null;
  logoSrc: string | null;
  brandName: string;
  style: BrandStyle;
  totalSeconds: number;
  hook: string;
  captions: string[];
  words: WordTiming[];
  /** End card headline and the action line under it. */
  ctaLine: string;
  ctaAction: string;
  /** Show a small "Concept" tag on screen. */
  concept: boolean;
};

/** A still photo (or an animated clip of one) in a library reel. Paths are relative to public/. */
export interface Shot {
  src: string;
  width: number;
  height: number;
  motion: "pan-left" | "pan-right" | "zoom-in" | "zoom-out" | "none";
  /** How long the shot runs. Clips use their real length; without it, shots share the time equally. */
  seconds?: number;
  /** Where to aim, as fractions of the image (0-1). */
  focusX?: number;
  focusY?: number;
  /** Small on-screen label, e.g. the space or finish. */
  label?: string;
  /** True when src is an animated clip rather than a photo. */
  video?: boolean;
}

/** Input props of the Remotion "Stills" composition (photo-library reels). */
export type StillsProps = {
  format: Exclude<StillFormat, "site-scroll"> | AiFormat;
  /** Shown small on screen for the whole reel when any footage is AI-generated. Null for real footage only. */
  aiLabel: string | null;
  shots: Shot[];
  pair: { before: Shot; after: Shot } | null;
  material: { name: string; note: string } | null;
  rows: { label: string; wrap: string; replace: string }[] | null;
  voiceSrc: string;
  musicSrc: string | null;
  logoSrc: string | null;
  brandName: string;
  style: BrandStyle;
  totalSeconds: number;
  hook: string;
  captions: string[];
  words: WordTiming[];
  ctaLine: string;
  ctaAction: string;
};

/** One paid generation: a clip or an edited image. */
export interface AiCost {
  kind: "video" | "image" | "upscale";
  model: string;
  requestId: string;
  seconds?: number;
  usd: number;
  result: "used" | "rejected";
  reason?: string;
}
