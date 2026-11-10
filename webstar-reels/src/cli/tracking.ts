/**
 * npm run tracking:setup
 * Registers each brand's link-in-bio and comment-to-DM links in the leads table and prints them,
 * ready to paste into the Instagram bio and the ManyChat flow.
 */
import { listBrandIds, loadBrand } from "../lib/brand.js";
import { env } from "../lib/env.js";
import { brandLinks } from "../lib/tracking.js";
import { leadsEnabled, registerBrandLinks } from "../steps/leads.js";

const brands = listBrandIds().map(loadBrand);
if (leadsEnabled()) {
  await registerBrandLinks(brands);
  console.log("Brand links saved to the leads table.\n");
} else {
  console.log("SUPABASE_URL and SUPABASE_SERVICE_KEY are not set, so nothing was saved. The links below still carry UTM tags.\n");
}
if (!env("TRACK_BASE_URL")) console.log("TRACK_BASE_URL is not set: these are direct links. Set it to your `go` function URL for short links that count clicks.\n");
for (const brand of brands) {
  console.log(`${brand.name}  (comment keyword: ${brand.commentKeyword})`);
  for (const l of brandLinks(brand)) console.log(`  ${l.kind === "bio" ? "Link in bio" : "ManyChat DM "}: ${l.url}`);
  console.log("");
}
