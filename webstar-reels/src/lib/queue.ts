import fs from "node:fs";
import path from "node:path";
import { brandDir, type Brand } from "./brand.js";
import type { Site } from "../types.js";

export const MAX_ATTEMPTS = 3;

const sitesFile = (brand: Brand) => path.join(brandDir(brand), "sites.json");
const hooksFile = (brand: Brand) => path.join(brandDir(brand), "hooks.json");

export function loadSites(brand: Brand): Site[] {
  if (!fs.existsSync(sitesFile(brand))) throw new Error(`brands/${brand.id}/sites.json is missing`);
  return JSON.parse(fs.readFileSync(sitesFile(brand), "utf8")) as Site[];
}

export function saveSites(brand: Brand, sites: Site[]): void {
  fs.writeFileSync(sitesFile(brand), JSON.stringify(sites, null, 2) + "\n");
}

export function nextPending(sites: Site[]): Site | undefined {
  return sites.find((s) => s.status === "pending");
}

/** Day N is the Nth reel posted, so a failed or dry run never burns a hook. */
export function dayNumber(sites: Site[]): number {
  return sites.filter((s) => s.status === "posted").length + 1;
}

/** One hook per day, in order, wrapping after the last. */
export function hookForDay(brand: Brand, day: number, site: Pick<Site, "name" | "niche">): string {
  if (!fs.existsSync(hooksFile(brand))) throw new Error(`brands/${brand.id}/hooks.json is missing`);
  const hooks = JSON.parse(fs.readFileSync(hooksFile(brand), "utf8")) as string[];
  if (!hooks.length) throw new Error(`brands/${brand.id}/hooks.json is empty`);
  const shortNiche = site.niche.split(",")[0].trim();
  return hooks[(day - 1) % hooks.length]
    .replaceAll("{niche}", shortNiche)
    .replaceAll("{name}", site.name);
}

export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "site";
}
