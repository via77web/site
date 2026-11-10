import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { brandDir, type Brand } from "./lib/brand.js";
import { loadBatches } from "./lib/batches.js";
import { generate } from "./lib/llm.js";
import { log, warn } from "./lib/log.js";
import { reelId } from "./lib/tracking.js";
import { fetchEvents, leadsEnabled, saveMetrics, type LeadEvent } from "./steps/leads.js";
import { postMetrics, type Metrics } from "./steps/post.js";
import { VARIANT_LABEL, type VariantId } from "./types.js";

/** A reel needs this long live before its numbers count. */
const MIN_AGE_HOURS = 48;
const WINDOW_DAYS = 60;
/** Nothing is retired or promoted until this many hooks have results. */
const MIN_MEASURED_HOOKS = 5;
/** Retiring never leaves a brand with fewer active hooks than this. */
const MIN_ACTIVE_HOOKS = 10;
const SHARE = 0.2;

export interface ReelResult {
  id: string;
  title: string;
  variant: VariantId;
  hook: string;
  day: string;
  direction?: string;
  views?: number;
  watchSeconds?: number;
  shares?: number;
  reactions?: number;
  comments?: number;
  clicks: number;
  enquiries: number;
  deposits: number;
  /** Clicks, enquiries and deposits that came through the bio or DM link and were credited to this reel as the latest one out. */
  assumed: number;
  score: number;
}

export interface Learning {
  updatedAt: string;
  measured: number;
  hooks: Record<string, { uses: number; score: number; status: "winner" | "active" | "retired" }>;
  variants: Record<string, { uses: number; score: number; weight: number }>;
}

const learningFile = (brand: Pick<Brand, "id">) => path.join(brandDir(brand as Brand), "learning.json");

export function loadLearning(brand: Pick<Brand, "id">): Learning | undefined {
  try {
    return JSON.parse(fs.readFileSync(learningFile(brand), "utf8")) as Learning;
  } catch {
    return undefined;
  }
}

/**
 * Credit events to reels. Events from a reel's own link already carry its id. Bio and DM clicks
 * can't say which reel prompted them, so they go to the brand's most recent reel at that moment.
 */
export function attribute(reels: { id: string; brand: string; at: number }[], events: LeadEvent[]) {
  const tally = new Map<string, { clicks: number; enquiries: number; deposits: number; assumed: number }>();
  const get = (id: string) => tally.get(id) ?? tally.set(id, { clicks: 0, enquiries: 0, deposits: 0, assumed: 0 }).get(id)!;
  const byBrand = new Map<string, { id: string; at: number }[]>();
  for (const r of reels) byBrand.set(r.brand, [...(byBrand.get(r.brand) ?? []), r].sort((a, b) => a.at - b.at));
  const known = new Set(reels.map((r) => r.id));
  for (const e of events) {
    let id = e.reel_id && known.has(e.reel_id) ? e.reel_id : undefined;
    let assumed = false;
    if (!id) {
      const t = Date.parse(e.created_at);
      id = (byBrand.get(e.brand) ?? []).filter((r) => r.at <= t).pop()?.id;
      assumed = true;
    }
    if (!id) continue;
    const row = get(id);
    row[e.type === "click" ? "clicks" : e.type === "enquiry" ? "enquiries" : "deposits"]++;
    if (assumed) row.assumed++;
  }
  return tally;
}

/** What each signal is worth. A metric nobody has (no Buffer numbers yet, say) drops out and the rest share its weight. */
const WEIGHTS = { views: 0.25, watchSeconds: 0.15, shares: 0.15, clicks: 0.15, enquiries: 0.15, deposits: 0.15 } as const;

/** Score each reel 0-100 against the brand's best on each signal. */
export function scoreReels(reels: Omit<ReelResult, "score">[]): ReelResult[] {
  const keys = Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[];
  const max = Object.fromEntries(keys.map((k) => [k, Math.max(0, ...reels.map((r) => Number(r[k] ?? 0)))])) as Record<keyof typeof WEIGHTS, number>;
  const live = keys.filter((k) => max[k] > 0);
  const total = live.reduce((sum, k) => sum + WEIGHTS[k], 0);
  return reels.map((r) => ({
    ...r,
    score: total ? Math.round((live.reduce((sum, k) => sum + (WEIGHTS[k] * Number(r[k] ?? 0)) / max[k], 0) / total) * 100) : 0,
  }));
}

function rank(results: ReelResult[], key: (r: ReelResult) => string | undefined) {
  const groups = new Map<string, number[]>();
  for (const r of results) {
    const k = key(r);
    if (k) groups.set(k, [...(groups.get(k) ?? []), r.score]);
  }
  return [...groups.entries()]
    .map(([name, scores]) => ({ name, uses: scores.length, score: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) }))
    .sort((a, b) => b.score - a.score || b.uses - a.uses);
}

/** Winners (top 20%), retired (bottom 20%) and format weights, from ranked results. */
export function decide(results: ReelResult[], allHooks: string[], previous?: Learning): Learning {
  const hooks: Learning["hooks"] = {};
  const ranked = rank(results, (r) => r.hook).filter((h) => allHooks.includes(h.name));
  // Hooks retired in earlier weeks stay retired.
  const alreadyRetired = new Set(Object.entries(previous?.hooks ?? {}).filter(([, h]) => h.status === "retired").map(([k]) => k));
  for (const h of ranked) hooks[h.name] = { uses: h.uses, score: h.score, status: alreadyRetired.has(h.name) ? "retired" : "active" };
  for (const name of alreadyRetired) hooks[name] ??= { ...previous!.hooks[name] };

  const candidates = ranked.filter((h) => !alreadyRetired.has(h.name));
  // No decisions on a tie: with no data yet every hook scores the same, and none has earned anything.
  const spread = candidates.length ? candidates[0].score - candidates[candidates.length - 1].score : 0;
  if (candidates.length >= MIN_MEASURED_HOOKS && spread > 0) {
    const n = Math.floor(candidates.length * SHARE);
    for (const h of candidates.slice(0, n)) hooks[h.name].status = "winner";
    const active = allHooks.filter((h) => !alreadyRetired.has(h)).length;
    const canRetire = Math.max(0, Math.min(n, active - MIN_ACTIVE_HOOKS));
    // Only hooks that scored below the middle of the pack can be retired.
    const median = candidates[Math.floor(candidates.length / 2)].score;
    for (const h of candidates.slice(candidates.length - canRetire)) {
      if (hooks[h.name].status !== "winner" && h.score < median) hooks[h.name].status = "retired";
    }
  }

  const variants: Learning["variants"] = {};
  const formats = rank(results, (r) => r.variant);
  const enough = formats.filter((f) => f.uses >= 2).length >= 3 && formats[0].score > formats[formats.length - 1].score;
  formats.forEach((f, i) => {
    const weight = !enough || f.uses < 2 ? 1 : i === 0 ? 1.5 : i === formats.length - 1 ? 0.5 : 1;
    variants[f.name] = { uses: f.uses, score: f.score, weight };
  });
  return { updatedAt: new Date().toISOString(), measured: results.length, hooks, variants };
}

/**
 * Spread items over `n` picks in proportion to their weights (smooth weighted round-robin),
 * so a favoured format comes up more often without two in a row where avoidable.
 */
export function weightedSequence<T extends string>(items: readonly T[], weights: Partial<Record<string, number>>, n: number): T[] {
  const w = items.map((i) => weights[i] ?? 1);
  const total = w.reduce((a, b) => a + b, 0);
  const current = items.map(() => 0);
  return Array.from({ length: n }, () => {
    for (let i = 0; i < items.length; i++) current[i] += w[i];
    const best = current.indexOf(Math.max(...current));
    current[best] -= total;
    return items[best];
  });
}

const fmt = (n: number | undefined) => (n === undefined ? "–" : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));

function insightsMarkdown(brand: Brand, results: ReelResult[], learning: Learning, notes: string[], added: string[]): string {
  const table = (rows: { name: string; uses: number; score: number }[], label: (n: string) => string) =>
    rows.length ? `| | Reels | Score |\n| --- | --- | --- |\n${rows.map((r) => `| ${label(r.name)} | ${r.uses} | ${r.score} |`).join("\n")}` : "_No results yet._";
  const by = (status: string) => Object.entries(learning.hooks).filter(([, h]) => h.status === status).map(([k]) => k);
  const top = [...results].sort((a, b) => b.score - a.score);
  const weights = Object.entries(learning.variants).filter(([, v]) => v.weight !== 1);
  return `# ${brand.name}: what's working

Updated ${new Date().toISOString().slice(0, 10)} from ${results.length} reel${results.length === 1 ? "" : "s"} posted in the last ${WINDOW_DAYS} days and live for at least ${MIN_AGE_HOURS} hours.
${notes.map((n) => `\n> ${n}`).join("")}

Score is 0–100: each reel against the brand's best on views, watch time, shares, clicks, enquiries and deposits.

## Reels

| Day | Reel | Format | Views | Watch (s) | Shares | Clicks | Enquiries | Deposits | Score |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${top.map((r) => `| ${r.day} | ${r.title} | ${VARIANT_LABEL[r.variant] ?? r.variant} | ${fmt(r.views)} | ${fmt(r.watchSeconds)} | ${fmt(r.shares)} | ${r.clicks} | ${r.enquiries} | ${r.deposits} | **${r.score}** |`).join("\n") || "| – | – | – | – | – | – | – | – | – | – |"}

## Hooks

${table(rank(results, (r) => r.hook), (n) => `"${n}"`)}

## Formats and angles

${table(rank(results, (r) => r.variant), (n) => VARIANT_LABEL[n as VariantId] ?? n)}
${rank(results, (r) => r.direction).length ? `\n## Design directions\n\n${table(rank(results, (r) => r.direction), (n) => n)}\n` : ""}
## Next week

${by("winner").length ? `**Used more often:**\n${by("winner").map((h) => `- "${h}"`).join("\n")}` : `No hooks promoted yet (needs results for at least ${MIN_MEASURED_HOOKS} hooks).`}

${by("retired").length ? `**Retired:**\n${by("retired").map((h) => `- "${h}"`).join("\n")}` : "No hooks retired."}
${added.length ? `\n**New hooks written to replace them, in the style of the winners:**\n${added.map((h) => `- "${h}"`).join("\n")}\n` : ""}
${weights.length ? `**Formats:** ${weights.map(([k, v]) => `${VARIANT_LABEL[k as VariantId] ?? k} ${v.weight > 1 ? "more often" : "less often"}`).join(", ")}.` : "Formats keep an even rotation (needs at least two reels each in three formats)."}
`;
}

/** New hooks to replace retired ones, written in the style of the winners. */
async function replaceHooks(brand: Brand, winners: string[], retired: string[], existing: string[], n: number): Promise<string[]> {
  const { hooks } = await generate({
    label: `${brand.id} new hooks`,
    schema: z.object({ hooks: z.array(z.string()).describe(`Exactly ${n} hooks`) }),
    system: `You write opening hooks for ${brand.name}'s short videos. ${brand.about} Voice: ${brand.tone}. ${brand.rules.join(" ")}`,
    prompt: `Write ${n} new hooks, each under 12 words.

These performed best, so learn from what they do:
${winners.map((h) => `- ${h}`).join("\n") || "- (no clear winners yet)"}

These performed worst and were retired, so avoid their approach:
${retired.map((h) => `- ${h}`).join("\n")}

Don't repeat or closely echo any existing hook:
${existing.map((h) => `- ${h}`).join("\n")}${brand.allowPrices ? "" : "\n\nNo prices or dollar figures."}`,
    effort: "low",
    check: (r) => (r.hooks.length < n ? [`Need ${n} hooks`] : r.hooks.some((h) => existing.includes(h)) ? ["One of these already exists"] : []),
  });
  return hooks.slice(0, n);
}

/**
 * The Sunday learning step for one brand: gather results, rank, write insights.md and
 * learning.json, retire the weakest hooks and write replacements. Returns the notes it logged.
 */
export async function learn(brand: Brand, { mock = false, now = new Date() } = {}): Promise<Learning | undefined> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);
  const posted = loadBatches(brand).flatMap((b) =>
    b.variants
      .filter((v) => v.status === "scheduled" && v.scheduledFor && new Date(v.scheduledFor) >= since && now.getTime() - Date.parse(v.scheduledFor) >= MIN_AGE_HOURS * 3_600_000)
      .map((v) => ({ batch: b, v })),
  );
  if (!posted.length) {
    log(`[${brand.id}] learning: no reels old enough to measure yet`);
    return undefined;
  }

  const notes: string[] = [];
  const metrics = new Map<string, Metrics>();
  let metricsFailed = 0;
  if (!mock) {
    for (const { batch, v } of posted) {
      const sum: Metrics = {};
      for (const postId of Object.values(v.posts ?? {})) {
        try {
          const m = await postMetrics(brand, postId);
          for (const k of Object.keys(m) as (keyof Metrics)[]) sum[k] = (sum[k] ?? 0) + (m[k] ?? 0);
        } catch {
          metricsFailed++;
        }
      }
      metrics.set(reelId(batch, v), sum);
    }
  }
  if (metricsFailed) notes.push(`Buffer metrics could not be read for ${metricsFailed} post(s); those reels are scored without them.`);
  if (![...metrics.values()].some((m) => m.views)) notes.push("No view counts from Buffer yet, so scores rest on clicks and leads.");

  let events: LeadEvent[] = [];
  if (!leadsEnabled()) notes.push("Lead tracking is not set up (SUPABASE_URL and SUPABASE_SERVICE_KEY), so clicks, enquiries and deposits are missing.");
  else {
    try {
      events = (await fetchEvents(since)).filter((e) => e.brand === brand.id);
    } catch (error) {
      notes.push(`The leads table could not be read: ${error instanceof Error ? error.message : error}`);
    }
  }
  const tally = attribute(posted.map(({ batch, v }) => ({ id: reelId(batch, v), brand: brand.id, at: Date.parse(v.scheduledFor!) })), events);
  if ([...tally.values()].some((t) => t.assumed)) notes.push("Bio and DM links can't tell which reel prompted them, so those clicks and leads are credited to the most recent reel at the time.");

  const results = scoreReels(
    posted.map(({ batch, v }) => {
      const id = reelId(batch, v);
      const m = metrics.get(id) ?? {};
      const t = tally.get(id) ?? { clicks: 0, enquiries: 0, deposits: 0, assumed: 0 };
      return { id, title: batch.site.name, variant: v.id, hook: v.hookSource ?? v.script.hook, day: v.scheduledFor!.slice(0, 10), direction: batch.site.direction, ...m, ...t };
    }),
  );
  await saveMetrics(results.map((r) => ({ id: r.id, views: r.views, watch_seconds: r.watchSeconds, shares: r.shares, reactions: r.reactions, comments: r.comments }))).catch(
    (e) => warn(`[${brand.id}] could not save metrics to Supabase: ${e instanceof Error ? e.message : e}`),
  );

  const hooksFile = path.join(brandDir(brand), "hooks.json");
  const allHooks = JSON.parse(fs.readFileSync(hooksFile, "utf8")) as string[];
  const previous = loadLearning(brand);
  const learning = decide(results, allHooks, previous);

  // Replace hooks retired this week, so the pool keeps its size.
  const newlyRetired = Object.entries(learning.hooks).filter(([k, h]) => h.status === "retired" && previous?.hooks[k]?.status !== "retired").map(([k]) => k);
  let added: string[] = [];
  if (newlyRetired.length && !mock) {
    try {
      const winners = Object.entries(learning.hooks).filter(([, h]) => h.status === "winner").map(([k]) => k);
      added = await replaceHooks(brand, winners, newlyRetired, allHooks, newlyRetired.length);
      fs.writeFileSync(hooksFile, JSON.stringify([...allHooks, ...added], null, 2) + "\n");
    } catch (error) {
      warn(`[${brand.id}] could not write replacement hooks: ${error instanceof Error ? error.message : error}`);
    }
  }

  fs.writeFileSync(learningFile(brand), JSON.stringify(learning, null, 2) + "\n");
  fs.writeFileSync(path.join(brandDir(brand), "insights.md"), insightsMarkdown(brand, results, learning, notes, added));
  const count = (s: string) => Object.values(learning.hooks).filter((h) => h.status === s).length;
  log(`[${brand.id}] learning: ${results.length} reels measured, ${count("winner")} winning hooks, ${newlyRetired.length} retired, ${added.length} new → brands/${brand.id}/insights.md`);
  return learning;
}
