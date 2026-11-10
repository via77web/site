import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Site } from "../types.js";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SITES_FILE = path.join(ROOT, "sites.json");
const HOOKS_FILE = path.join(ROOT, "hooks.json");

export const MAX_ATTEMPTS = 3;

export function loadSites(): Site[] {
  return JSON.parse(fs.readFileSync(SITES_FILE, "utf8")) as Site[];
}

export function saveSites(sites: Site[]): void {
  fs.writeFileSync(SITES_FILE, JSON.stringify(sites, null, 2) + "\n");
}

export function nextPending(sites: Site[]): Site | undefined {
  return sites.find((s) => s.status === "pending");
}

/** Day N is the Nth reel posted, so a failed or dry run never burns a hook. */
export function dayNumber(sites: Site[]): number {
  return sites.filter((s) => s.status === "posted").length + 1;
}

/** One hook per day, in order, wrapping after the last. */
export function hookForDay(day: number, site: Pick<Site, "name" | "niche">): string {
  const hooks = JSON.parse(fs.readFileSync(HOOKS_FILE, "utf8")) as string[];
  if (!hooks.length) throw new Error("hooks.json is empty");
  const shortNiche = site.niche.split(",")[0].trim();
  return hooks[(day - 1) % hooks.length]
    .replaceAll("{niche}", shortNiche)
    .replaceAll("{name}", site.name);
}

export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "site";
}
