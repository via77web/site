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
export type VariantId = (typeof VARIANTS)[number];

export const VARIANT_LABEL: Record<VariantId, string> = {
  full: "Full scroll",
  detail: "Detail zooms",
  "before-after": "Before / after",
  interaction: "Interaction demo",
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
 * awaiting: rendered, waiting for your decision.
 * approved: will be scheduled into the next free calendar slot.
 * scheduled: sent to Buffer for `scheduledFor`.
 * rejected: will never post.
 */
export type VariantStatus = "awaiting" | "approved" | "rejected" | "scheduled";

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
  /** Buffer post id per channel id. Lets a retry skip channels that already succeeded. */
  posts?: Record<string, string>;
  error?: string;
}

/** One site's set of reels, from rendering through approval to scheduling. */
export interface Batch {
  id: string;
  brand: string;
  createdAt: string;
  source: "queue" | "make";
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
