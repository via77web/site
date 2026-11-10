import fs from "node:fs";
import path from "node:path";
import type { Brand } from "../lib/brand.js";
import { listReferences, projectDir, projectSlug, referencesRoot } from "./sync.js";

export interface FoundReferences {
  project: string;
  dir: string;
  count: number;
  /** "project": the site's own folder. "brand": the brand's standing moodboard. "named": passed with --refs. */
  from: "project" | "brand" | "named";
}

/**
 * Which reference folder a site should be built from:
 *   1. the folder named with --refs (a name under references/, or a path)
 *   2. references/<project>/, where the project name is the brief turned into a folder name
 *   3. references/<brand>/, a standing moodboard for everything that brand makes
 * If none has images, the project folder is created (so there is somewhere to drop them)
 * and returned with a count of 0.
 */
export async function findReferences(brand: Brand, brief: string, named?: string): Promise<FoundReferences> {
  if (named) {
    const dir = fs.existsSync(named) && fs.statSync(named).isDirectory() ? path.resolve(named) : projectDir(named);
    fs.mkdirSync(dir, { recursive: true });
    return { project: projectSlug(path.basename(dir)), dir, count: (await listReferences(dir)).length, from: "named" };
  }
  const own = projectDir(brief);
  const ownCount = (await listReferences(own)).length;
  if (ownCount) return { project: projectSlug(brief), dir: own, count: ownCount, from: "project" };
  const shared = projectDir(brand.id);
  const sharedCount = (await listReferences(shared)).length;
  if (sharedCount) return { project: projectSlug(brand.id), dir: shared, count: sharedCount, from: "brand" };
  fs.mkdirSync(own, { recursive: true });
  return { project: projectSlug(brief), dir: own, count: 0, from: "project" };
}

/** The folder as you'd find it on a phone, when references/ is linked to iCloud Drive. */
export function friendlyPath(dir: string): string {
  let real = dir;
  try {
    real = fs.realpathSync(dir);
  } catch {
    /* not created yet */
  }
  const m = real.match(/Mobile Documents\/com~apple~CloudDocs\/(.*)$/);
  return m ? `iCloud Drive › ${m[1].split("/").join(" › ")}` : path.relative(process.cwd(), dir) || dir;
}

export { referencesRoot };
