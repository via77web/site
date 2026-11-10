import { loadBrand } from "./src/lib/brand.ts";
import { startLog } from "./src/lib/log.ts";
import { produceStillReel } from "./src/stills/produce.ts";
startLog("verrano-test");
const brand = loadBrand("verrano");
for (const [i, f] of (["transformation", "showcase", "finish", "explainer", "site-scroll"] as const).entries()) {
  await produceStillReel(brand, f, { dryRun: true, mock: true, plannedFor: `2026-11-1${i}` });
}
