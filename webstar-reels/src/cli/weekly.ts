/**
 * npm run weekly [-- --brand via77 --days 7 --start 2026-11-16 --mock --dry-run]
 *
 * Sunday 6am job. For every brand, makes a reel for each of the next 7 days that doesn't have
 * one yet: WEBSTAR and VIA77 get a concept site per day (queue first, then campaign briefs, then
 * the brief backlog) with all four angles pre-rendered; Verrano gets one library reel per day,
 * cycling through its formats. Everything is left "ready" for the daily job to put up for approval.
 */
import { parseArgs } from "node:util";
import { listBrandIds, loadBrand, type Brand } from "../lib/brand.js";
import { loadBatches } from "../lib/batches.js";
import { activeCampaign, loadCalendar } from "../lib/calendar.js";
import { env } from "../lib/env.js";
import { currentLogFile, log, logError, loggedErrors, startLog, warn } from "../lib/log.js";
import { AI_CYCLE, produceAiReel } from "../ai/visualise.js";
import { serveDir } from "../lib/serve.js";
import { loadBriefs, loadSites, nextPending, saveBriefs, saveSites, MAX_ATTEMPTS } from "../lib/queue.js";
import { ensureBriefs } from "../briefs.js";
import { makeSite } from "../make/index.js";
import { hasPlanned, noonOf, planSiteBatch, slotsOn, upcomingDates } from "../plan.js";
import { produceBatch } from "../reels.js";
import { FORMAT_CYCLE, produceStillReel } from "../stills/produce.js";
import { hasLibrary } from "../stills/library.js";
import { notify } from "../steps/notify.js";

const { values: flags } = parseArgs({
  options: {
    brand: { type: "string" },
    days: { type: "string", default: "7" },
    start: { type: "string" },
    mock: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
});
const mock = flags.mock;
const dryRun = flags["dry-run"];
startLog("weekly");
const cal = loadCalendar();
const dates = upcomingDates(Number(flags.days), flags.start);
log(`planning ${dates[0]} to ${dates[dates.length - 1]}`);

async function siteDay(brand: Brand, date: string, dayIndex: number): Promise<void> {
  const campaign = activeCampaign(cal, brand.id, noonOf(date));
  const sites = loadSites(brand);
  const site = nextPending(sites);
  let batch;
  if (site) {
    try {
      batch = await produceBatch(
        brand,
        { url: site.url, name: site.name, niche: site.niche, concept: !!site.concept, beforeUrl: site.beforeUrl, source: "queue" },
        { dryRun, mock, campaign },
      );
      site.status = "rendered";
      site.batch = batch.id;
      delete site.lastError;
    } catch (error) {
      site.attempts = (site.attempts ?? 0) + 1;
      site.lastError = error instanceof Error ? error.message : String(error);
      if (site.attempts >= MAX_ATTEMPTS) site.status = "failed";
      throw error;
    } finally {
      if (!dryRun) saveSites(brand, sites);
    }
  } else {
    if (!cal.brands[brand.id].autoMake) throw new Error("the site queue is empty and autoMake is off in calendar.json");
    const used = new Set(loadBatches(brand).map((b) => b.site.brief));
    let brief = campaign?.briefs[brand.id]?.find((b) => !used.has(b));
    let briefs = loadBriefs(brand);
    if (!brief) {
      if (!briefs.some((b) => b.status === "pending") && !mock) {
        await ensureBriefs(brand, 7, campaign);
        briefs = loadBriefs(brand);
      }
      brief = briefs.find((b) => b.status === "pending")?.brief ?? (mock ? "A neighbourhood business" : undefined);
    }
    if (!brief) throw new Error("no site in the queue and no brief to make one from");
    log(`[${brand.id}] ${date}: "${brief}"${campaign ? ` (${campaign.name})` : ""}`);
    const made = await makeSite(brand, brief, { mock, placeholders: false, noDeploy: dryRun || mock, campaign });
    const server = await serveDir(made.dir);
    try {
      batch = await produceBatch(
        brand,
        {
          url: server.url,
          publicUrl: made.previewUrl ?? `${made.name} (concept, not deployed)`,
          name: made.name,
          niche: made.niche,
          concept: true,
          source: "make",
          brief,
          direction: made.direction,
          audit: made.audit,
        },
        { dryRun, mock, campaign },
      );
    } finally {
      await server.close();
    }
    const entry = briefs.find((b) => b.brief === brief);
    if (entry && !dryRun) {
      entry.status = "made";
      entry.batch = batch.id;
      saveBriefs(brand, briefs);
    }
  }
  if (!dryRun) {
    const v = planSiteBatch(batch, date, dayIndex);
    log(`[${brand.id}] ${date}: ${batch.site.name}, ${v?.id ?? "no"} reel planned; ${batch.variants.length - 1} spare`);
  }
}

const results: string[] = [];
for (const id of flags.brand ? flags.brand.split(",") : listBrandIds()) {
  const brand = loadBrand(id.trim());
  if (!cal.brands[brand.id]) continue;
  let made = 0;
  let wanted = 0;
  for (const [i, date] of dates.entries()) {
    if (!slotsOn(brand.id, date).length || hasPlanned(brand, date)) continue;
    wanted++;
    try {
      if (brand.content === "library") {
        if (!hasLibrary(brand)) throw new Error(`no library yet; run npm run library:crawl -- --brand ${brand.id}`);
        const dayOfWeek = new Date(`${date}T12:00:00Z`).getUTCDay();
        const options = { dryRun, mock, plannedFor: date, campaign: activeCampaign(cal, brand.id, noonOf(date)) };
        const standard = FORMAT_CYCLE[dayOfWeek % FORMAT_CYCLE.length];
        // AI visualisations take `perWeek` of the week's days, spread out, and need a fal key.
        const perWeek = brand.ai?.perWeek ?? 0;
        const aiDay =
          perWeek > 0 &&
          (mock || !!env("FAL_KEY")) &&
          Math.floor(((i + 1) * perWeek) / dates.length) > Math.floor((i * perWeek) / dates.length);
        if (aiDay) {
          const done = loadBatches(brand).filter((b) => b.variants.some((v) => (AI_CYCLE as readonly string[]).includes(v.id))).length;
          try {
            await produceAiReel(brand, AI_CYCLE[done % AI_CYCLE.length], options);
          } catch (error) {
            // A day never goes empty because a visualisation failed: fall back to real footage.
            warn(`[${brand.id}] ${date}: AI visualisation not made (${error instanceof Error ? error.message : error}); making a ${standard} reel instead`);
            await produceStillReel(brand, standard, options);
          }
        } else {
          await produceStillReel(brand, standard, options);
        }
      } else {
        await siteDay(brand, date, i);
      }
      made++;
    } catch (error) {
      logError(`[${brand.id}] ${date}: ${error instanceof Error ? error.message : error}`);
    }
  }
  results.push(`${brand.name} ${made}/${wanted}`);
}

const errors = loggedErrors();
log(`weekly done: ${results.join(", ")}`);
await notify({
  title: errors.length ? `Weekly reels: ${errors.length} problem(s)` : "Weekly reels ready",
  message: `${results.join(" · ")}${errors.length ? `. First: ${errors[0].slice(0, 140)}` : ""}`,
  url: errors.length && currentLogFile() ? `file://${currentLogFile()}` : undefined,
  urgent: errors.length > 0,
});
process.exit(errors.length ? 3 : 0);
