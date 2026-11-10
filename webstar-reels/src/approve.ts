import { VARIANTS, VARIANT_LABEL, type Batch, type VariantId } from "./types.js";

export interface Decision {
  action: "approve" | "reject";
  /** Empty means every variant still awaiting a decision. */
  variants: VariantId[];
}

/**
 * Read `/approve all`, `/approve full detail`, `/reject` or `/reject before-after` from a
 * comment. Variant names may be separated by spaces or commas. Returns null when the text
 * holds no command or names a variant that doesn't exist.
 */
export function parseDecision(text: string): Decision | null {
  const m = text.match(/^\s*\/(approve|reject)\b([^\n]*)/im);
  if (!m) return null;
  const words = m[2].toLowerCase().split(/[\s,]+/).filter(Boolean).filter((w) => w !== "all");
  if (words.some((w) => !(VARIANTS as readonly string[]).includes(w))) return null;
  return { action: m[1].toLowerCase() as Decision["action"], variants: [...new Set(words)] as VariantId[] };
}

/**
 * Apply a decision to the variants still awaiting one. Approving a list rejects the rest,
 * so "pick variants" is a single comment. Returns a summary for the review issue.
 */
export function applyDecision(batch: Batch, decision: Decision): string {
  const awaiting = batch.variants.filter((v) => v.status === "awaiting");
  if (!awaiting.length) return "Nothing to decide: every reel in this batch already has a decision.";
  const named = new Set(decision.variants.length ? decision.variants : awaiting.map((v) => v.id));
  for (const v of awaiting) {
    if (decision.action === "approve") v.status = named.has(v.id) ? "approved" : "rejected";
    else if (named.has(v.id)) v.status = "rejected";
  }
  if (batch.variants.every((v) => v.status !== "awaiting")) batch.decidedAt = new Date().toISOString();
  const list = (s: string) => batch.variants.filter((v) => v.status === s).map((v) => VARIANT_LABEL[v.id]);
  return [
    list("approved").length ? `Approved: ${list("approved").join(", ")}.` : "",
    list("rejected").length ? `Rejected: ${list("rejected").join(", ")}.` : "",
    list("awaiting").length ? `Still waiting: ${list("awaiting").join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
