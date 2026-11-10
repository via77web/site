import type { Brand } from "./lib/brand.js";
import { loadBatches, saveBatch } from "./lib/batches.js";
import { loadCalendar, localDate, slotsFor, zonedTime } from "./lib/calendar.js";
import { weightedSequence } from "./learn.js";
import { VARIANTS, type Batch, type BatchVariant } from "./types.js";

export interface Pick {
  batch: Batch;
  variant: BatchVariant;
}

const dayBefore = (date: string) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/** The next `days` local dates, starting tomorrow (or `start`). */
export function upcomingDates(days: number, start?: string): string[] {
  const tz = loadCalendar().timezone;
  const first = start ? new Date(`${start}T12:00:00Z`) : new Date(Date.now() + 86_400_000);
  return Array.from({ length: days }, (_, i) => localDate(new Date(first.getTime() + i * 86_400_000), tz));
}

/** Noon on a local date, for campaign lookups. */
export function noonOf(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return zonedTime(y, m, d, "12:00", loadCalendar().timezone);
}

/** How many posts a brand makes on a local date (its calendar slots that day). */
export function slotsOn(brandId: string, date: string): Date[] {
  const cal = loadCalendar();
  const [y, m, d] = date.split("-").map(Number);
  const midnight = zonedTime(y, m, d, "00:00", cal.timezone);
  // Start just before midnight (slotsFor adds a 15 minute margin) and look across two days, keeping this date.
  return slotsFor(cal, brandId, new Date(midnight.getTime() - 16 * 60_000), 1).filter((s) => localDate(s, cal.timezone) === date);
}

/** True when a reel is already planned (or further along) for this date. */
export function hasPlanned(brand: { id: string }, date: string): boolean {
  return loadBatches(brand).some((b) => b.variants.some((v) => v.plannedFor === date && v.status !== "rejected"));
}

/**
 * Give one of a site batch's reels a day. The angle follows a rotation weighted by what the
 * learning loop found (even until there are results), so the feed varies and winners recur.
 */
export function planSiteBatch(batch: Batch, date: string, dayIndex: number, weights: Partial<Record<string, number>> = {}): BatchVariant | undefined {
  const sequence = weightedSequence(VARIANTS, weights, 28);
  const first = sequence[dayIndex % sequence.length];
  const order = [first, ...VARIANTS.filter((v) => v !== first)];
  const v = order.map((id) => batch.variants.find((x) => x.id === id && x.status === "ready")).find(Boolean);
  if (v) {
    v.plannedFor = date;
    saveBatch(batch);
  }
  return v;
}

/** Sites (batches) that post or are up for approval on a date. */
function busyBatches(brand: Brand, date: string): Set<string> {
  const tz = loadCalendar().timezone;
  return new Set(
    loadBatches(brand)
      .filter((b) =>
        b.variants.some(
          (v) =>
            (v.scheduledFor && localDate(new Date(v.scheduledFor), tz) === date) ||
            (v.proposedOn === date && v.status !== "rejected" && v.status !== "ready"),
        ),
      )
      .map((b) => b.id),
  );
}

/**
 * Reels to put up for approval on a date: the ones planned for it, topped up from the pool of
 * ready reels (oldest first) when the plan is short. A site never appears twice in a day, and
 * avoids the site that posted the day before.
 */
export function picksFor(brand: Brand, date: string, count: number, exclude = new Set<string>()): Pick[] {
  const batches = loadBatches(brand);
  const today = busyBatches(brand, date);
  const yesterday = busyBatches(brand, dayBefore(date));
  const picks: Pick[] = [];
  const taken = (b: Batch) => today.has(b.id) || picks.some((p) => p.batch.id === b.id) || exclude.has(b.id);

  for (const b of batches) {
    for (const v of b.variants) {
      if (picks.length >= count) break;
      if (v.status === "ready" && v.plannedFor === date && !taken(b)) picks.push({ batch: b, variant: v });
    }
  }
  const spares = batches
    .flatMap((b) => b.variants.filter((v) => v.status === "ready" && (!v.plannedFor || v.plannedFor < date)).map((v) => ({ batch: b, variant: v })))
    .sort((a, b) => Number(yesterday.has(a.batch.id)) - Number(yesterday.has(b.batch.id)));
  for (const s of spares) {
    if (picks.length >= count) break;
    if (!taken(s.batch)) picks.push(s);
  }
  return picks;
}

/** Mark picks as up for approval today. */
export function propose(picks: Pick[], date: string): void {
  for (const p of picks) {
    p.variant.status = "awaiting";
    p.variant.proposedOn = date;
    saveBatch(p.batch);
  }
}
