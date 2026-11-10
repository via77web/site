/**
 * npm run approve -- <batch-id> all
 * npm run approve -- <batch-id> full detail
 * npm run approve -- <batch-id> reject [variants]
 * npm run approve -- --issue 12          (reads the command from $COMMENT_BODY; used by GitHub Actions)
 */
import { parseArgs } from "node:util";
import { listBrandIds, loadBrand } from "../lib/brand.js";
import { findBatch, saveBatch } from "../lib/batches.js";
import { applyDecision, parseDecision } from "../approve.js";
import { closeReview } from "../steps/notify.js";
import { scheduleApproved } from "../schedule.js";

const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  options: { issue: { type: "string" }, "no-schedule": { type: "boolean", default: false } },
});

const brands = listBrandIds().map(loadBrand);
const issue = flags.issue ? Number(flags.issue) : undefined;
const batch = findBatch(brands, issue ? { issue } : { id: positionals[0] });
if (!batch) {
  console.error(issue ? `No batch is waiting on issue #${issue}.` : `No batch called "${positionals[0]}".`);
  process.exit(issue ? 0 : 1);
}

const words = issue ? (process.env.COMMENT_BODY ?? "") : positionals.slice(1).join(" ");
const command = issue ? words : `/${/^(reject)\b/i.test(words) ? "" : "approve "}${words}`;
const decision = parseDecision(command);
if (!decision) {
  console.error(`Could not read a decision from "${words.trim().slice(0, 80)}". Use: all, a list of variants (full, detail, before-after, interaction), or reject.`);
  process.exit(issue ? 0 : 1);
}

const summary = applyDecision(batch, decision);
saveBatch(batch);
console.log(`${batch.id}: ${summary}`);

const brand = loadBrand(batch.brand);
const scheduled = flags["no-schedule"] ? 0 : await scheduleApproved(brand);
const reply = `${summary}${scheduled ? `\n\nScheduled ${scheduled} reel(s) into the next calendar slots.` : ""}`;
if (batch.variants.every((v) => v.status !== "awaiting")) await closeReview(batch, reply);
