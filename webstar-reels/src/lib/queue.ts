import fs from "node:fs";
import path from "node:path";
import { brandDir, type Brand } from "./brand.js";
import { loadBatches } from "./batches.js";
import type { Campaign } from "./calendar.js";
import type { Site } from "../types.js";

/** What the weekly learning step decided (brands/<id>/learning.json). Read here without importing the learner. */
interface LearnedHooks {
  hooks: Record<string, { status: "winner" | "active" | "retired" }>;
}

function loadLearning(brand: Brand): LearnedHooks | undefined {
  try {
    return JSON.parse(fs.readFileSync(path.join(brandDir(brand), "learning.json"), "utf8")) as LearnedHooks;
  } catch {
    return undefined;
  }
}

/**
 * The order hooks are used in: retired hooks are dropped, and each winner gets a second
 * turn halfway round, so it comes up twice as often.
 */
export function hookRotation(hooks: string[], learning: LearnedHooks | undefined): string[] {
  if (!learning) return hooks;
  const active = hooks.filter((h) => learning.hooks[h]?.status !== "retired");
  const base = active.length ? active : hooks;
  const winners = base.filter((h) => learning.hooks[h]?.status === "winner");
  if (!winners.length) return base;
  const half = Math.ceil(base.length / 2);
  // Second turns are spread through the back half, each as far from its first turn as possible.
  const out = [...base];
  winners.forEach((w, i) => {
    const first = out.indexOf(w);
    const at = (first + half + i) % (out.length + 1);
    out.splice(at, 0, w);
  });
  return out;
}

export const MAX_ATTEMPTS = 3;

const sitesFile = (brand: Brand) => path.join(brandDir(brand), "sites.json");
const hooksFile = (brand: Brand) => path.join(brandDir(brand), "hooks.json");
const briefsFile = (brand: Brand) => path.join(brandDir(brand), "briefs.json");

export function loadSites(brand: Brand): Site[] {
  if (!fs.existsSync(sitesFile(brand))) return [];
  return JSON.parse(fs.readFileSync(sitesFile(brand), "utf8")) as Site[];
}

export function saveSites(brand: Brand, sites: Site[]): void {
  fs.writeFileSync(sitesFile(brand), JSON.stringify(sites, null, 2) + "\n");
}

export function nextPending(sites: Site[]): Site | undefined {
  return sites.find((s) => s.status === "pending");
}

/**
 * The next `count` hooks, one per reel, in order (winners twice as often, retired hooks never). During a campaign its hooks are used first;
 * otherwise the brand's hooks.json. Each list keeps its own place and wraps after its last hook,
 * counted from the reels already made, so a dry run never uses one up.
 */
export function nextHooks(brand: Brand, count: number, campaign: Campaign | undefined, fill: (h: string) => string): string[] {
  const batches = loadBatches(brand);
  const written = fs.existsSync(hooksFile(brand)) ? (JSON.parse(fs.readFileSync(hooksFile(brand), "utf8")) as string[]) : [];
  if (!written.length) throw new Error(`brands/${brand.id}/hooks.json is missing or empty`);
  const brandHooks = hookRotation(written, loadLearning(brand));
  const campaignHooks = campaign?.hooks[brand.id] ?? [];

  const used = (pred: (campaignId: string | undefined) => boolean) =>
    batches.filter((b) => pred(b.campaign)).reduce((n, b) => n + b.variants.length, 0);
  const take = (list: string[], start: number, n: number) => Array.from({ length: n }, (_, i) => list[(start + i) % list.length]);

  const fromCampaign = campaignHooks.length ? take(campaignHooks, used((c) => c === campaign!.id), Math.min(count, campaignHooks.length)) : [];
  const rest = take(brandHooks, used((c) => !c), count - fromCampaign.length);
  return [...fromCampaign, ...rest].map(fill);
}

export interface Brief {
  brief: string;
  status: "pending" | "made";
  batch?: string;
}

/** One-line briefs waiting to be made into concept sites (brands/<id>/briefs.json). */
export function loadBriefs(brand: Brand): Brief[] {
  if (!fs.existsSync(briefsFile(brand))) return [];
  return JSON.parse(fs.readFileSync(briefsFile(brand), "utf8")) as Brief[];
}

export function saveBriefs(brand: Brand, briefs: Brief[]): void {
  fs.writeFileSync(briefsFile(brand), JSON.stringify(briefs, null, 2) + "\n");
}

export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "site";
}
