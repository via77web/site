/**
 * npm run approve -- <batch-id> all | <variant...> | reject [variant...]
 * Approving schedules the reel to Buffer at its next calendar slot straight away.
 */
import { listBrandIds, loadBrand } from "../lib/brand.js";
import { findBatch, saveBatch } from "../lib/batches.js";
import { startLog } from "../lib/log.js";
import { parseDecision } from "../approve.js";
import { scheduleApproved } from "../schedule.js";

startLog("approve");
const [id, ...words] = process.argv.slice(2);
const batch = id ? findBatch(listBrandIds().map(loadBrand), { id }) : undefined;
if (!batch) {
  console.error(id ? `No batch called "${id}".` : "Usage: npm run approve -- <batch-id> all | <variants...> | reject");
  process.exit(1);
}
const text = words.join(" ");
const decision = parseDecision(`/${/^reject\b/i.test(text) ? "" : "approve "}${text}`);
if (!decision) {
  console.error(`Could not read "${text}". Use all, variant names, or reject.`);
  process.exit(1);
}
// Works on reels that are ready (not yet offered) or awaiting a decision. Unlike the review
// issue flow, naming some variants here doesn't reject the others.
const open = batch.variants.filter((v) => v.status === "ready" || v.status === "awaiting");
const named = new Set(decision.variants.length ? decision.variants : open.map((v) => v.id));
for (const v of open) if (named.has(v.id)) v.status = decision.action === "approve" ? "approved" : "rejected";
saveBatch(batch);
console.log(`${batch.id}: ${decision.action === "approve" ? "approved" : "rejected"} ${[...named].join(", ")}`);
await scheduleApproved(loadBrand(batch.brand));
