import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "../lib/brand.js";
import { env } from "../lib/env.js";
import { run } from "../lib/exec.js";
import { log, warn } from "../lib/log.js";

const IMAGE = /\.(png|jpe?g|webp|heic|heif|gif|avif|tiff?)$/i;
const MAX_IMAGES = 24;
const LONG_EDGE = 1568;

/**
 * Where reference folders live. On the Mac, scripts/setup-mac.sh makes `references/` a link to
 * an iCloud Drive folder, so screenshots saved from a phone appear here. REFERENCES_DIR overrides it.
 */
export function referencesRoot(): string {
  return env("REFERENCES_DIR") ?? path.join(ROOT, "references");
}

export const projectSlug = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "project";

export function projectDir(project: string): string {
  return path.join(referencesRoot(), projectSlug(project));
}

/**
 * iCloud Drive may hold a file as a placeholder until it is opened. Ask for the folder's files
 * and wait (up to two minutes) for them to arrive.
 */
async function downloadFromICloud(dir: string): Promise<void> {
  if (process.platform !== "darwin") return;
  const pending = () => fs.readdirSync(dir).filter((f) => f.startsWith(".") && f.endsWith(".icloud"));
  if (!pending().length) return;
  log(`   fetching ${pending().length} reference(s) from iCloud`);
  spawnSync("brctl", ["download", dir]);
  for (let i = 0; i < 60 && pending().length; i++) await new Promise((r) => setTimeout(r, 2000));
  if (pending().length) warn(`   ${pending().length} reference(s) still not downloaded from iCloud; carrying on without them`);
}

/** Reference images in a folder (not the brief or other files saved alongside them). */
export async function listReferences(dir: string): Promise<string[]> {
  if (!fs.existsSync(dir)) return [];
  await downloadFromICloud(dir);
  return fs
    .readdirSync(dir)
    .filter((f) => !f.startsWith(".") && IMAGE.test(f))
    .sort()
    .map((f) => path.join(dir, f));
}

export interface PreparedRefs {
  /** Folder of normalised copies (ref-01.jpg ...), safe for Claude to read. */
  cacheDir: string;
  files: string[];
  /** Changes whenever an image is added, removed or replaced. */
  hash: string;
  count: number;
}

/** Copy the references into a working folder as plain JPEGs of a sensible size. */
export async function prepareReferences(dir: string, project: string): Promise<PreparedRefs> {
  let sources = await listReferences(dir);
  if (sources.length > MAX_IMAGES) {
    warn(`   ${sources.length} references in ${dir}; using the first ${MAX_IMAGES}`);
    sources = sources.slice(0, MAX_IMAGES);
  }
  const cacheDir = path.join(ROOT, "out", "refs", projectSlug(project));
  fs.rmSync(cacheDir, { recursive: true, force: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  const sha = crypto.createHash("sha1");
  const files: string[] = [];
  for (const [i, src] of sources.entries()) {
    sha.update(path.basename(src)).update(fs.readFileSync(src));
    const out = path.join(cacheDir, `ref-${String(i + 1).padStart(2, "0")}.jpg`);
    const scale = `scale='if(gt(iw,ih),min(${LONG_EDGE},iw),-2)':'if(gt(iw,ih),-2,min(${LONG_EDGE},ih))'`;
    try {
      await run("ffmpeg", ["-y", "-loglevel", "error", "-i", src, "-frames:v", "1", "-vf", scale, "-q:v", "3", out]);
    } catch {
      // ffmpeg builds without HEIC support: macOS can convert it.
      const sips = process.platform === "darwin" ? spawnSync("sips", ["-s", "format", "jpeg", "-Z", String(LONG_EDGE), src, "--out", out]) : null;
      if (!sips || sips.status !== 0) {
        warn(`   could not read reference ${path.basename(src)}; skipped`);
        continue;
      }
    }
    files.push(out);
  }
  return { cacheDir, files, hash: sha.digest("hex").slice(0, 16), count: files.length };
}
