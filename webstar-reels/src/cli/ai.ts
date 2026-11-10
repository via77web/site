/**
 * npm run ai:test -- [--format imagine|visualised|finish-mood] [--brand verrano] [--mock]
 * Makes one AI visualisation reel now (not saved to the queue), to check a fal model preset,
 * the quality checks and the cost. Without --mock this spends real fal credit.
 */
import { parseArgs } from "node:util";
import { loadBrand } from "../lib/brand.js";
import { logError, startLog } from "../lib/log.js";
import { produceAiReel } from "../ai/visualise.js";
import { AI_FORMATS, type AiFormat } from "../types.js";

const { values: flags } = parseArgs({
  options: {
    format: { type: "string", default: "visualised" },
    brand: { type: "string", default: "verrano" },
    mock: { type: "boolean", default: false },
  },
});
if (!(AI_FORMATS as readonly string[]).includes(flags.format!)) {
  console.error(`--format must be one of: ${AI_FORMATS.join(", ")}`);
  process.exit(2);
}
startLog("ai-test");
try {
  const batch = await produceAiReel(loadBrand(flags.brand!), flags.format as AiFormat, { dryRun: true, mock: flags.mock });
  const v = batch.variants[0];
  console.log(`\n${v.file}\nCaption: ${v.postText.split("\n")[0]}\nGenerations:`);
  for (const i of v.ai?.items ?? []) {
    console.log(`  ${i.kind} ${i.model} $${i.usd.toFixed(2)} ${i.result}${i.reason ? ` (${i.reason})` : ""}`);
  }
} catch (error) {
  logError(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
