/** npm run schedule [-- --brand via77 --dry-run]: put approved reels into their calendar slots now. */
import { parseArgs } from "node:util";
import { listBrandIds, loadBrand } from "../lib/brand.js";
import { scheduleApproved } from "../schedule.js";

const { values: flags } = parseArgs({ options: { brand: { type: "string" }, "dry-run": { type: "boolean", default: false } } });
for (const id of flags.brand ? flags.brand.split(",") : listBrandIds()) {
  await scheduleApproved(loadBrand(id.trim()), { dryRun: flags["dry-run"] });
}
