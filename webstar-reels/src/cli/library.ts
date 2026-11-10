/**
 * npm run library:crawl -- --brand verrano [--url https://verrano.com.au/] [--max-pages 80] [--min-short 900]
 * npm run library:tag -- --brand verrano [--all]
 */
import { parseArgs } from "node:util";
import { loadBrand } from "../lib/brand.js";
import { log, logError, startLog } from "../lib/log.js";
import { DEFAULT_CRAWL, crawlLibrary } from "../stills/crawl.js";
import { tagLibrary } from "../stills/tag.js";

const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    brand: { type: "string", default: "verrano" },
    url: { type: "string" },
    "max-pages": { type: "string" },
    "min-short": { type: "string" },
    "min-long": { type: "string" },
    all: { type: "boolean", default: false },
  },
});
const brand = loadBrand(flags.brand!);
const command = positionals[0];
startLog(`library-${command}`);
try {
  if (command === "crawl") {
    const url = flags.url ?? brand.website;
    if (!url) throw new Error(`brands/${brand.id}.json has no "website"; pass --url`);
    await crawlLibrary(brand, url, {
      maxPages: Number(flags["max-pages"] ?? DEFAULT_CRAWL.maxPages),
      minShortSide: Number(flags["min-short"] ?? DEFAULT_CRAWL.minShortSide),
      minLongSide: Number(flags["min-long"] ?? DEFAULT_CRAWL.minLongSide),
    });
  } else if (command === "tag") {
    await tagLibrary(brand, { all: flags.all });
  } else {
    throw new Error('Usage: library crawl|tag --brand <id>');
  }
  log("done");
} catch (error) {
  logError(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
