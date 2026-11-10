/**
 * npm run make "<one-line brief>" --brand=webstar|via77 [--refs=<folder>]
 *
 * Brief -> references (mood brief, tokens, direction) -> concept site (copy, images, build, audit,
 * comparison with the references, Vercel preview) -> four reels, left "ready". Approve them on the
 * review page (npm run review) or let the daily job offer them.
 *
 * References come from --refs, else references/<brief as a folder name>/, else references/<brand>/.
 * With none, it asks for some before building; --no-refs builds from the library's directions instead.
 */
import readline from "node:readline/promises";
import { parseArgs } from "node:util";
import { listBrandIds, loadBrand } from "../lib/brand.js";
import { activeCampaign, loadCalendar } from "../lib/calendar.js";
import { requireEnv } from "../lib/env.js";
import { llmBackend } from "../lib/llm.js";
import { log, startLog } from "../lib/log.js";
import { serveDir } from "../lib/serve.js";
import { makeSite, type MakeOptions } from "../make/index.js";
import { findReferences, friendlyPath } from "../refs/resolve.js";
import { produceBatch } from "../reels.js";
import { notify } from "../steps/notify.js";

const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    brand: { type: "string" },
    refs: { type: "string" },
    "no-refs": { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    mock: { type: "boolean", default: false },
    placeholders: { type: "boolean", default: false },
    "no-reels": { type: "boolean", default: false },
    "no-campaign": { type: "boolean", default: false },
  },
});

// `npm run make "brief" --brand=via77 --refs=x` hands those flags to npm, not the script; npm exposes them as npm_config_*.
const brandId = flags.brand ?? process.env.npm_config_brand;
const refsFlag = flags.refs ?? process.env.npm_config_refs;
const brief = positionals.join(" ").trim();
if (!brief || !brandId) {
  console.error(
    `Usage: npm run make "<one-line brief>" --brand=${listBrandIds().join("|")} [--refs=<folder>] [-- --no-refs --dry-run --mock --placeholders --no-reels]`,
  );
  process.exit(2);
}
const brand = loadBrand(brandId);
startLog("make");
const dryRun = flags["dry-run"] || flags.mock;
if (!flags.mock && llmBackend() === "api") requireEnv(["ANTHROPIC_API_KEY"]);
if (!flags.mock && !flags["no-reels"]) requireEnv(["ELEVENLABS_API_KEY", `ELEVENLABS_VOICE_ID_${brand.id.toUpperCase()}`]);

// References are checked before anything is generated.
let refs: MakeOptions["refs"];
if (!flags.mock && !flags["no-refs"]) {
  let found = await findReferences(brand, brief, refsFlag);
  while (!found.count) {
    const where = friendlyPath(found.dir);
    if (!process.stdin.isTTY) {
      log(`No references yet. Add screenshots to ${where}, then run this again (or pass --no-refs).`);
      await notify({ title: "References needed", message: `Add screenshots for "${brief}" to ${where}, then run make again.` });
      process.exit(2);
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(
      `\nNo reference images for this project yet.\nSave screenshots to: ${where}\nPress Enter when they're there, or type "skip" to build from the library's directions instead: `,
    );
    rl.close();
    if (answer.trim().toLowerCase() === "skip") break;
    found = await findReferences(brand, brief, refsFlag);
  }
  if (found.count) {
    refs = { project: found.project, dir: found.dir };
    log(`[${brand.id}] ${found.count} reference(s) from ${friendlyPath(found.dir)}${found.from === "brand" ? " (the brand's moodboard)" : ""}`);
  }
}

const campaign = flags["no-campaign"] ? undefined : activeCampaign(loadCalendar(), brand.id);
if (campaign) console.log(`[${brand.id}] Campaign: ${campaign.name}`);

const made = await makeSite(brand, brief, {
  mock: flags.mock,
  placeholders: flags.placeholders,
  noDeploy: dryRun,
  campaign,
  refs,
}).catch(async (error) => {
  // The step that failed has already logged why.
  await notify({ title: "Make failed", message: error instanceof Error ? error.message.slice(0, 200) : String(error), urgent: true });
  process.exit(1);
});
if (made.references) {
  console.log(
    `References: ${made.references.overall}/10 match${made.references.refined ? " after one refinement" : ""}. Brief: ${friendlyPath(made.references.dir)} › brief.md${
      made.references.savedDirection ? `. Direction kept for reuse: ${made.references.savedDirection}` : ""
    }`,
  );
}
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
console.log("Reels are ready. Approve them now with `npm run review`, or the daily job will offer them when a day needs one.");
