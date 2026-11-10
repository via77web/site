import fs from "node:fs";
import path from "node:path";
import { LIBRARY_DIR, directionsFor } from "../../library/index.js";
import { ROOT, brandEnv, type Brand } from "../lib/brand.js";
import type { Campaign } from "../lib/calendar.js";
import { env } from "../lib/env.js";
import { slugify } from "../lib/queue.js";
import { auditSite, type AuditReport } from "./audit.js";
import { buildSite } from "./build.js";
import { deployPreview } from "./deploy.js";
import { makeImages } from "./images.js";
import { layoutFor, reviseSpec, writeSpec, type AnySpec, type SpecResult } from "./spec.js";

export interface MadeSite {
  dir: string;
  name: string;
  niche: string;
  brief: string;
  direction: string;
  layout: "onepage" | "store";
  spec: AnySpec;
  audit: AuditReport;
  previewUrl?: string;
  placeholders: string[];
}

export interface MakeOptions {
  /** No API calls: the example spec and placeholder images. */
  mock: boolean;
  /** Use placeholder images even when GEMINI_API_KEY is set. */
  placeholders: boolean;
  /** Build and audit, but don't deploy a preview. */
  noDeploy: boolean;
  campaign?: Campaign;
}

function mockSpec(brand: Brand): SpecResult {
  const layout = layoutFor(brand);
  const spec = JSON.parse(fs.readFileSync(path.join(LIBRARY_DIR, "examples", `${layout}.json`), "utf8")) as AnySpec;
  const direction = directionsFor(brand.id).find((d) => d.id === spec.directionId) ?? directionsFor(brand.id)[0];
  return { spec: { ...spec, directionId: direction.id }, direction, layout };
}

const siteName = (s: AnySpec) => ("storeName" in s ? s.storeName : s.businessName);
const siteNiche = (s: AnySpec) => s.category;

/**
 * Prompt to site: pick a direction and write the copy (Claude), generate imagery, build on the
 * library, audit, fix what the audit finds (one round), and deploy a Vercel preview.
 */
export async function makeSite(brand: Brand, brief: string, opts: MakeOptions): Promise<MadeSite> {
  const log = (m: string) => console.log(`[${brand.id}] ${m}`);

  log("make 1/5 Choosing a direction and writing the site");
  let result = opts.mock ? mockSpec(brand) : await writeSpec(brand, brief, opts.campaign);
  log(`   ${siteName(result.spec)} · ${result.direction.name}`);

  const dir = path.join(ROOT, "out", "sites", brand.id, `${new Date().toISOString().slice(0, 10)}-${slugify(siteName(result.spec))}`);
  fs.rmSync(dir, { recursive: true, force: true });

  const build = async () => {
    log("make 2/5 Generating images");
    const images = await makeImages(result.spec.images, result.direction, path.join(dir, "img"), {
      placeholders: opts.mock || opts.placeholders,
    });
    log("make 3/5 Building");
    buildSite(dir, brand, result.layout, result.spec, result.direction, images.paths);
    return images;
  };

  let images = await build();
  log("make 4/5 Auditing");
  let audit = await auditSite(dir);
  if (audit.blocking.length && !opts.mock) {
    log(`   ${audit.blocking.length} blocking issue(s); asking Claude to fix them`);
    result = await reviseSpec(brand, result, brief, audit.blocking, opts.campaign);
    images = await build();
    audit = await auditSite(dir);
  }
  if (images.placeholders.length) {
    audit.warnings.push(`Placeholder images (no generated photo): ${images.placeholders.join(", ")}`);
  }
  log(`   audit: ${audit.blocking.length} blocking, ${audit.warnings.length} warnings`);
  audit.blocking.forEach((b) => log(`   ! ${b}`));

  let previewUrl: string | undefined;
  if (!opts.noDeploy && env("VERCEL_TOKEN")) {
    log("make 5/5 Deploying a Vercel preview");
    previewUrl = await deployPreview(dir, brandEnv("VERCEL_PROJECT", brand) ?? `${brand.id}-concepts`);
    log(`   ${previewUrl}`);
  } else {
    log(`make 5/5 No preview deployed (${opts.noDeploy ? "dry run" : "VERCEL_TOKEN not set"}); site is in ${path.relative(ROOT, dir)}`);
  }

  return {
    dir,
    name: siteName(result.spec),
    niche: siteNiche(result.spec),
    brief,
    direction: result.direction.id,
    layout: result.layout,
    spec: result.spec,
    audit,
    previewUrl,
    placeholders: images.placeholders,
  };
}
