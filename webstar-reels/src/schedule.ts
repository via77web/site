import fs from "node:fs";
import path from "node:path";
import { ROOT, type Brand } from "./lib/brand.js";
import { loadBatches, saveBatch } from "./lib/batches.js";
import { loadCalendar, localDate, slotsFor } from "./lib/calendar.js";
import { resolveChannels, schedulePost, type Channel } from "./steps/post.js";
import { publishVideos } from "./steps/publish.js";
import { VARIANT_LABEL, type Batch, type VariantId } from "./types.js";

interface Occupied {
  at: Date;
  batch: string;
}

export interface Placement {
  batch: string;
  variant: VariantId;
  at: Date;
}

const HORIZON_DAYS = 28;
/** Awaiting reels older than this no longer count as "coming soon" when deciding whether to make more. */
const STALE_REVIEW_DAYS = 3;

/**
 * Fill free slots in time order. A site (batch) never gets two posts on the same local day; a
 * slot stays empty rather than break that. Where another site is available, it also avoids
 * the same site twice in a row.
 */
export function assignSlots(
  slots: Date[],
  occupied: Occupied[],
  candidates: { batch: string; variant: VariantId }[],
  timeZone: string,
): Placement[] {
  const all = [...occupied];
  const left = [...candidates];
  const placements: Placement[] = [];
  for (const slot of [...slots].sort((a, b) => a.getTime() - b.getTime())) {
    if (all.some((o) => o.at.getTime() === slot.getTime())) continue;
    const day = localDate(slot, timeZone);
    const before = all.filter((o) => o.at < slot).sort((a, b) => b.at.getTime() - a.at.getTime())[0];
    const after = all.filter((o) => o.at > slot).sort((a, b) => a.at.getTime() - b.at.getTime())[0];
    const otherDay = (c: { batch: string }) => !all.some((o) => o.batch === c.batch && localDate(o.at, timeZone) === day);
    // Hard rule: one post per site per day. Preference: not the same site as the post either side.
    let i = left.findIndex((c) => otherDay(c) && c.batch !== before?.batch && c.batch !== after?.batch);
    if (i === -1) i = left.findIndex(otherDay);
    if (i === -1) continue;
    const [pick] = left.splice(i, 1);
    placements.push({ ...pick, at: slot });
    all.push({ at: slot, batch: pick.batch });
  }
  return placements;
}

function occupiedSlots(batches: Batch[], since: Date): Occupied[] {
  return batches.flatMap((b) =>
    b.variants
      .filter((v) => v.status === "scheduled" && v.scheduledFor && new Date(v.scheduledFor) >= since)
      .map((v) => ({ at: new Date(v.scheduledFor!), batch: b.id })),
  );
}

const candidatesOf = (batches: Batch[], ok: (b: Batch, status: string) => boolean) =>
  batches.flatMap((b) => b.variants.filter((v) => ok(b, v.status)).map((v) => ({ batch: b.id, variant: v.id })));

/**
 * How many slots in the brand's lookahead window would stay empty even if everything approved
 * or recently sent for review were approved. More than zero means it is time to make more.
 */
export function emptySlotsAhead(brand: Brand, now = new Date()): number {
  const cal = loadCalendar();
  const cfg = cal.brands[brand.id];
  const batches = loadBatches(brand);
  const fresh = (b: Batch) => now.getTime() - new Date(b.createdAt).getTime() < STALE_REVIEW_DAYS * 86_400_000;
  const slots = slotsFor(cal, brand.id, now, cfg.lookaheadDays);
  const occupied = occupiedSlots(batches, new Date(now.getTime() - 86_400_000));
  const free = slots.filter((s) => !occupied.some((o) => o.at.getTime() === s.getTime()));
  const placed = assignSlots(
    slots,
    occupied,
    candidatesOf(batches, (b, st) => st === "approved" || (st === "awaiting" && fresh(b))),
    cal.timezone,
  );
  return free.length - placed.length;
}

/** Put every approved reel into its calendar slot and schedule it on all of the brand's channels. */
export async function scheduleApproved(brand: Brand, { dryRun = false, now = new Date() } = {}): Promise<number> {
  const log = (m: string) => console.log(`[${brand.id}] ${m}`);
  const cal = loadCalendar();
  const batches = loadBatches(brand);
  const placements = assignSlots(
    slotsFor(cal, brand.id, now, HORIZON_DAYS),
    occupiedSlots(batches, new Date(now.getTime() - 86_400_000)),
    candidatesOf(batches, (_, st) => st === "approved"),
    cal.timezone,
  );
  const waiting = candidatesOf(batches, (_, st) => st === "approved").length;
  if (!placements.length) {
    if (waiting) log(`${waiting} approved reel(s) but no free slot in the next ${HORIZON_DAYS} days that keeps sites apart`);
    return 0;
  }

  const when = (d: Date) =>
    d.toLocaleString("en-AU", { timeZone: cal.timezone, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  if (dryRun) {
    for (const p of placements) log(`would schedule ${p.batch} ${VARIANT_LABEL[p.variant]} for ${when(p.at)}`);
    return 0;
  }

  let channels: Channel[] | undefined;
  let done = 0;
  for (const p of placements) {
    const batch = batches.find((b) => b.id === p.batch)!;
    const v = batch.variants.find((x) => x.id === p.variant)!;
    try {
      if (!v.videoUrl) {
        const file = path.join(ROOT, v.file);
        if (!fs.existsSync(file)) throw new Error(`no uploaded video and no local file at ${v.file}; re-render this batch`);
        [v.videoUrl] = await publishVideos([file], batch.id, `Reels for ${batch.site.name}.`);
      }
      channels ??= await resolveChannels(brand);
      v.posts ??= {};
      // Save after each channel so a retry never double-posts one that already went through.
      for (const channel of channels) {
        if (v.posts[channel.id]) continue;
        v.posts[channel.id] = await schedulePost(brand, channel, {
          text: v.postText,
          videoUrl: v.videoUrl,
          dueAt: p.at,
          youtubeTitle: v.script.youtubeTitle,
        });
        saveBatch(batch);
      }
      v.status = "scheduled";
      v.scheduledFor = p.at.toISOString();
      delete v.error;
      saveBatch(batch);
      done++;
      log(`scheduled ${batch.site.name} ${VARIANT_LABEL[v.id]} for ${when(p.at)} on ${channels.map((c) => c.service).join(", ")}`);
    } catch (error) {
      v.error = error instanceof Error ? error.message : String(error);
      saveBatch(batch);
      log(`could not schedule ${batch.id} ${v.id}: ${v.error}`);
    }
  }
  return done;
}
