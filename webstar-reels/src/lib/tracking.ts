import type { Brand } from "./brand.js";
import { loadCalendar, localDate } from "./calendar.js";
import { env } from "./env.js";
import type { Batch, BatchVariant } from "../types.js";

/** One id per reel, safe for URLs and for Stripe's client_reference_id. */
export function reelId(batch: Pick<Batch, "id">, variant: Pick<BatchVariant, "id">): string {
  return `${batch.id}--${variant.id}`.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 190);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

const PLATFORM_CODE: Record<string, string> = { instagram: "ig", tiktok: "tt", youtube: "yt" };

/** UTM tags for a reel: brand and day in the campaign, the variant as content, the hook as term. */
export function reelUtm(brand: Brand, batch: Batch, variant: BatchVariant, at: Date): Record<string, string> {
  const day = localDate(at, loadCalendar().timezone);
  return {
    utm_medium: "reel",
    utm_campaign: `${brand.id}-${day}`,
    utm_content: variant.id,
    utm_term: slug(variant.hookSource ?? variant.script.hook),
  };
}

/**
 * The link to put under a reel on one platform.
 * With TRACK_BASE_URL (the "go" function), it is a short redirect that counts the click itself.
 * Without it, it is the brand's page with the UTM tags and reel id on the end, and the site snippet counts the click.
 */
export function trackedLink(brand: Brand, batch: Batch, variant: BatchVariant, service: string, at: Date): string {
  const id = reelId(batch, variant);
  const base = env("TRACK_BASE_URL");
  if (base) return `${base.replace(/\/$/, "")}/${id}?p=${PLATFORM_CODE[service] ?? service}`;
  const url = new URL(brand.link);
  for (const [k, v] of Object.entries({ utm_source: service, ...reelUtm(brand, batch, variant, at) })) url.searchParams.set(k, v);
  url.searchParams.set("r", id);
  return url.toString();
}

/** The brand's standing links, for the bio and for ManyChat's DM. */
export function brandLinks(brand: Brand): { id: string; kind: "bio" | "dm"; url: string; utm: Record<string, string> }[] {
  const base = env("TRACK_BASE_URL")?.replace(/\/$/, "");
  return (["bio", "dm"] as const).map((kind) => {
    const id = `${brand.id}-${kind}`;
    const utm = { utm_medium: kind === "dm" ? "dm" : "bio", utm_campaign: kind === "dm" ? `comment-${brand.commentKeyword.toLowerCase()}` : `${brand.id}-bio` };
    const direct = new URL(brand.link);
    for (const [k, v] of Object.entries({ utm_source: "instagram", ...utm })) direct.searchParams.set(k, v);
    direct.searchParams.set("r", id);
    return { id, kind, utm, url: base ? `${base}/${id}?p=${kind}` : direct.toString() };
  });
}

/**
 * The caption for one platform. Instagram keeps the comment prompt (ManyChat answers it);
 * TikTok and YouTube, where the prompt would go unanswered, get the tracked link in its place.
 */
export function captionFor(service: string, brand: Brand, batch: Batch, variant: BatchVariant, at: Date): string {
  if (service === "instagram") return variant.postText;
  const link = `${brand.cta.split(/\s+[—–]\s+/)[0]}: ${trackedLink(brand, batch, variant, service, at)}`;
  return variant.postText.includes(brand.commentPrompt) ? variant.postText.replace(brand.commentPrompt, link) : `${variant.postText}\n\n${link}`;
}
