/**
 * npm run daily [-- --no-wait]
 *
 * 6am job. Schedules anything already approved, then puts today's reels (one per brand per
 * calendar slot) up for approval on a local page, notifies you, and waits. Each reel you approve
 * is uploaded and scheduled to Buffer for its slot at once. Anything undecided by the deadline
 * (default 30 minutes before the day's first slot) doesn't post and goes back into the pool.
 */
import { parseArgs } from "node:util";
import { listBrandIds, loadBrand } from "../lib/brand.js";
import { loadBatches, saveBatch } from "../lib/batches.js";
import { loadCalendar, localDate } from "../lib/calendar.js";
import { env } from "../lib/env.js";
import { currentLogFile, log, logError, loggedErrors, startLog } from "../lib/log.js";
import { picksFor, propose, slotsOn, type Pick } from "../plan.js";
import { awaitingCount, startReviewServer } from "../review/server.js";
import { scheduleApproved } from "../schedule.js";
import { notify } from "../steps/notify.js";
import { VARIANT_LABEL } from "../types.js";

const { values: flags } = parseArgs({ options: { "no-wait": { type: "boolean", default: false } } });
startLog("daily");
const cal = loadCalendar();
const today = localDate(new Date(), cal.timezone);
const brands = listBrandIds().map(loadBrand).filter((b) => cal.brands[b.id]);

// 1. Anything approved earlier that still needs a slot.
for (const brand of brands) {
  try {
    await scheduleApproved(brand);
  } catch (error) {
    logError(`[${brand.id}] scheduling: ${error instanceof Error ? error.message : error}`);
  }
}

// 2. Today's picks.
const picks: Pick[] = [];
let firstSlot: Date | undefined;
for (const brand of brands) {
  const slots = slotsOn(brand.id, today).filter((s) => s.getTime() > Date.now());
  const already = loadBatches(brand).flatMap((b) => b.variants).filter((v) => v.proposedOn === today && v.status !== "ready" && v.status !== "rejected").length;
  const count = slots.length - already;
  if (count <= 0) continue;
  const p = picksFor(brand, today, count);
  if (p.length < count) logError(`[${brand.id}] only ${p.length} of ${count} reel(s) ready for today; is the weekly job running?`);
  propose(p, today);
  picks.push(...p);
  if (slots[0] && (!firstSlot || slots[0] < firstSlot)) firstSlot = slots[0];
}

if (!awaitingCount()) {
  log("nothing to approve today");
  if (loggedErrors().length) {
    await notify({ title: "Daily reels: nothing to approve", message: loggedErrors()[0].slice(0, 200), urgent: true, url: `file://${currentLogFile()}` });
    process.exit(3);
  }
  process.exit(0);
}

// 3. Ask, then wait for decisions.
const leadMinutes = Number(env("REVIEW_LEAD_MINUTES") ?? 30);
const deadline = new Date(Math.max((firstSlot?.getTime() ?? Date.now() + 8 * 3_600_000) - leadMinutes * 60_000, Date.now() + 60 * 60_000));
const server = await startReviewServer({ deadline });
const list = picks.map((p) => `${p.batch.brand.toUpperCase()}: ${VARIANT_LABEL[p.variant.id]}`).join(", ");
await notify({
  title: `${awaitingCount()} reel(s) to approve`,
  message: `${list}. Decide by ${deadline.toLocaleTimeString("en-AU", { timeZone: cal.timezone, hour: "numeric", minute: "2-digit" })}.`,
  url: server.url,
  html: `<p>${list}</p><p>Open <a href="${server.url}">${server.url}</a> on your Mac to watch and approve. Nothing posts until you do.</p>`,
});
log(`review page: ${server.url} (open until ${deadline.toISOString()})`);

if (flags["no-wait"]) {
  // Leave today's reels waiting; approve them later with `npm run review`.
  await server.close();
} else {
  let reminded = false;
  while (Date.now() < deadline.getTime() && awaitingCount() > 0) {
    if (!reminded && deadline.getTime() - Date.now() < 90 * 60_000) {
      reminded = true;
      await notify({ title: "Reels still waiting", message: `${awaitingCount()} reel(s) need a decision before ${deadline.toLocaleTimeString("en-AU", { timeZone: cal.timezone, hour: "numeric", minute: "2-digit" })}.`, url: server.url });
    }
    await new Promise((r) => setTimeout(r, 15_000));
  }
  // 4. Undecided reels go back into the pool; nothing posts without a yes.
  let lapsed = 0;
  for (const brand of brands) {
    for (const batch of loadBatches(brand)) {
      let changed = false;
      for (const v of batch.variants) {
        if (v.status === "awaiting" && v.proposedOn === today) {
          v.status = "ready";
          delete v.proposedOn;
          changed = true;
          lapsed++;
        }
      }
      if (changed) saveBatch(batch);
    }
  }
  await server.close();
  if (lapsed) {
    log(`${lapsed} reel(s) undecided; not posted`);
    await notify({ title: "Reels not posted", message: `${lapsed} reel(s) weren't approved in time, so nothing was posted for them.` });
  }
}

const scheduled = brands.flatMap((b) => loadBatches(b).flatMap((x) => x.variants)).filter((v) => v.proposedOn === today && v.status === "scheduled").length;
log(`daily done: ${scheduled} scheduled today`);
const errors = loggedErrors();
if (errors.length) {
  await notify({ title: `Daily reels: ${errors.length} problem(s)`, message: errors[0].slice(0, 200), urgent: true, url: `file://${currentLogFile()}` });
  process.exit(3);
}
