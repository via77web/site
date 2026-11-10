/**
 * npm run daily [-- --brand via77 --dry-run --mock --produce]
 *
 * For each brand: schedule approved reels into calendar slots, then, if the coming days can't
 * be filled from what's approved or awaiting review, make the next batch from the site queue,
 * an active campaign's briefs or the brief backlog. New batches wait for approval.
 */
import { parseArgs } from "node:util";
import { brandEnvName, listBrandIds, loadBrand, type Brand } from "../lib/brand.js";
import { loadBatches } from "../lib/batches.js";
import { activeCampaign, loadCalendar, localDate } from "../lib/calendar.js";
import { requireEnv } from "../lib/env.js";
import { serveDir } from "../lib/serve.js";
import { MAX_ATTEMPTS, loadBriefs, loadSites, nextPending, saveBriefs, saveSites } from "../lib/queue.js";
import { makeSite } from "../make/index.js";
import { produceBatch } from "../reels.js";
import { emptySlotsAhead, scheduleApproved } from "../schedule.js";

const { values: flags } = parseArgs({
  options: {
    brand: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    mock: { type: "boolean", default: false },
    /** Make a batch even if the calendar is already covered. */
    produce: { type: "boolean", default: false },
  },
});
const dryRun = flags["dry-run"] || flags.mock;
const mock = flags.mock;

async function runBrand(brand: Brand): Promise<"ok" | "failed"> {
  const log = (m: string) => console.log(`[${brand.id}] ${m}`);
  const cal = loadCalendar();
  const cfg = cal.brands[brand.id];
  if (!cfg) {
    log("not in calendar.json, skipped");
    return "ok";
  }

  // 1. Approved reels into slots.
  if (!mock) {
    try {
      if (!dryRun) requireEnv([brandEnvName("BUFFER_PROFILE_IDS", brand)]);
      await scheduleApproved(brand, { dryRun });
    } catch (error) {
      log(`scheduling failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  // 2. Make more only when the calendar needs it, and at most one batch per brand per day.
  const empty = emptySlotsAhead(brand);
  const today = localDate(new Date(), cal.timezone);
  const madeToday = loadBatches(brand).some((b) => localDate(new Date(b.createdAt), cal.timezone) === today);
  if (!flags.produce && (empty <= 0 || madeToday)) {
    log(empty <= 0 ? `next ${cfg.lookaheadDays} days are covered` : "already made a batch today");
    return "ok";
  }
  log(`${empty} slot(s) in the next ${cfg.lookaheadDays} days need content`);

  try {
    if (!mock) requireEnv(["ANTHROPIC_API_KEY", "ELEVENLABS_API_KEY", brandEnvName("ELEVENLABS_VOICE_ID", brand)]);
  } catch (error) {
    log(`Failed: ${error instanceof Error ? error.message : error}`);
    return "failed";
  }
  const campaign = activeCampaign(cal, brand.id);

  // a. The site queue comes first.
  const sites = loadSites(brand);
  const site = nextPending(sites);
  if (site) {
    try {
      const batch = await produceBatch(
        brand,
        { url: site.url, name: site.name, niche: site.niche, concept: !!site.concept, beforeUrl: site.beforeUrl, source: "queue" },
        { dryRun, mock, campaign },
      );
      if (!dryRun) {
        site.status = "rendered";
        site.batch = batch.id;
        delete site.lastError;
        saveSites(brand, sites);
      }
      return "ok";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!dryRun) {
        site.attempts = (site.attempts ?? 0) + 1;
        site.lastError = message;
        if (site.attempts >= MAX_ATTEMPTS) site.status = "failed";
        saveSites(brand, sites);
      }
      log(`Failed: ${message}`);
      return "failed";
    }
  }

  // b. Then a new concept site: an unused campaign brief, else the backlog.
  if (!cfg.autoMake) {
    log("queue is empty and autoMake is off in calendar.json");
    return "ok";
  }
  const usedBriefs = new Set(loadBatches(brand).map((b) => b.site.brief));
  const briefs = loadBriefs(brand);
  const campaignBrief = campaign?.briefs[brand.id]?.find((b) => !usedBriefs.has(b));
  const backlog = briefs.find((b) => b.status === "pending");
  const brief = campaignBrief ?? backlog?.brief;
  if (!brief) {
    log("nothing to make: the site queue and brief backlog are empty");
    return "ok";
  }
  log(`making a concept site: "${brief}"${campaignBrief ? ` (${campaign!.name})` : ""}`);
  try {
    const made = await makeSite(brand, brief, { mock, placeholders: false, noDeploy: dryRun, campaign });
    const server = await serveDir(made.dir);
    try {
      const batch = await produceBatch(
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
      if (!dryRun && !campaignBrief && backlog) {
        backlog.status = "made";
        backlog.batch = batch.id;
        saveBriefs(brand, briefs);
      }
    } finally {
      await server.close();
    }
    return "ok";
  } catch (error) {
    log(`Failed: ${error instanceof Error ? error.message : error}`);
    return "failed";
  }
}

const ids = flags.brand ? flags.brand.split(",").map((b) => b.trim()).filter(Boolean) : listBrandIds();
const outcomes: Record<string, string> = {};
for (const id of ids) {
  try {
    outcomes[id] = await runBrand(loadBrand(id));
  } catch (error) {
    console.error(`[${id}] Failed: ${error instanceof Error ? error.message : error}`);
    outcomes[id] = "failed";
  }
}
console.log("\nSummary: " + Object.entries(outcomes).map(([id, o]) => `${id} ${o}`).join(", "));
process.exit(Object.values(outcomes).includes("failed") ? 1 : 0);
