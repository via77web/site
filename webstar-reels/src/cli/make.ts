/**
 * npm run make "<one-line brief>" --brand=webstar|via77
 *
 * Brief -> concept site (direction, copy, images, build, audit, Vercel preview) -> four reels
 * -> approval request. Nothing posts until you approve.
 */
import { parseArgs } from "node:util";
import { listBrandIds, loadBrand } from "../lib/brand.js";
import { activeCampaign, loadCalendar } from "../lib/calendar.js";
import { requireEnv } from "../lib/env.js";
import { serveDir } from "../lib/serve.js";
import { makeSite } from "../make/index.js";
import { produceBatch } from "../reels.js";

const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    brand: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    mock: { type: "boolean", default: false },
    placeholders: { type: "boolean", default: false },
    "no-reels": { type: "boolean", default: false },
    "no-campaign": { type: "boolean", default: false },
  },
});

// `npm run make "brief" --brand=via77` hands --brand to npm, not the script; npm exposes it as npm_config_brand.
const brandId = flags.brand ?? process.env.npm_config_brand;
const brief = positionals.join(" ").trim();
if (!brief || !brandId) {
  console.error(`Usage: npm run make "<one-line brief>" --brand=${listBrandIds().join("|")} [-- --dry-run --mock --placeholders --no-reels]`);
  process.exit(2);
}
const brand = loadBrand(brandId);
const dryRun = flags["dry-run"] || flags.mock;
if (!flags.mock) requireEnv(["ANTHROPIC_API_KEY"]);
if (!flags.mock && !flags["no-reels"]) requireEnv(["ELEVENLABS_API_KEY", `ELEVENLABS_VOICE_ID_${brand.id.toUpperCase()}`]);

const campaign = flags["no-campaign"] ? undefined : activeCampaign(loadCalendar(), brand.id);
if (campaign) console.log(`[${brand.id}] Campaign: ${campaign.name}`);

const made = await makeSite(brand, brief, {
  mock: flags.mock,
  placeholders: flags.placeholders,
  noDeploy: dryRun,
  campaign,
});
if (flags["no-reels"]) process.exit(0);

const server = await serveDir(made.dir);
try {
  await produceBatch(
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
    { dryRun, mock: flags.mock, campaign },
  );
} finally {
  await server.close();
}
