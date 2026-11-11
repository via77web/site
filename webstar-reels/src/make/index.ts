import fs from "node:fs";
import path from "node:path";
import { LIBRARY_DIR, directionsFor } from "../../library/index.js";
import { ROOT, brandEnv, type Brand } from "../lib/brand.js";
import type { Campaign } from "../lib/calendar.js";
import { env } from "../lib/env.js";
import { slugify } from "../lib/queue.js";
import { step } from "../lib/log.js";
import { auditSite, type AuditReport } from "./audit.js";
import { buildSite } from "./build.js";
import { deployPreview } from "./deploy.js";
import { makeImages, type Placement } from "./images.js";
import { saveDirection } from "../../library/index.js";
import { analyseReferences, saveBrief, type ReferenceBrief } from "../refs/analyse.js";
import { compareWithReferences, comparisonMarkdown, refineBrief } from "../refs/compare.js";
import { prepareReferences } from "../refs/sync.js";
import { layoutFor, reviseSpec, writeSpec, type AnySpec, type SpecResult } from "./spec.js";

/** Thrown when a site should be built from references and the folder has none. */
export class NeedsReferences extends Error {
  constructor(public dir: string) {
    super(`No reference images in ${dir}`);
  }
}

/** Overall match needed, with a clean audit, before a reference-derived direction is kept in the library. */
const KEEP_SCORE = 8;

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
  /** How the built site compared with the references, when it was built from some. */
  references?: { dir: string; overall: number; refined: boolean; savedDirection?: string };
}

export interface MakeOptions {
  /** No API calls: the example spec and placeholder images. */
  mock: boolean;
  /** Use placeholder images even when an image API key is set. */
  placeholders: boolean;
  /** Build and audit, but don't deploy a preview. */
  noDeploy: boolean;
  campaign?: Campaign;
  /** Build from the reference images in this folder (references/<project>). */
  refs?: { project: string; dir: string };
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

  // References first: they decide the direction before a word is written.
  let refs: Awaited<ReturnType<typeof prepareReferences>> | undefined;
  let refBrief: ReferenceBrief | undefined;
  if (opts.refs && !opts.mock) {
    log(`make 0/5 Reading references in ${opts.refs.dir}`);
    refs = await prepareReferences(opts.refs.dir, opts.refs.project);
    if (!refs.count) throw new NeedsReferences(opts.refs.dir);
    const prepared = refs;
    refBrief = await analyseReferences(prepared, opts.refs.dir, opts.refs.project, brand, layoutFor(brand), brief);
    log(`   ${refs.count} reference(s) → direction "${refBrief.direction.name}"`);
  }
  const mood = (r: ReferenceBrief) =>
    `${r.brief.feel} Emotion: ${r.brief.emotion.join(", ")}. Type: ${r.brief.typeStyle} Imagery: ${r.brief.imageryStyle}`;

  log("make 1/5 Choosing a direction and writing the site");
  let result = opts.mock
    ? mockSpec(brand)
    : await step(`site spec "${brief}"`, () =>
        writeSpec(brand, brief, opts.campaign, refBrief ? { direction: refBrief.direction, mood: mood(refBrief) } : undefined),
      );
  log(`   ${siteName(result.spec)} · ${result.direction.name}`);

  const dir = path.join(ROOT, "out", "sites", brand.id, `${new Date().toISOString().slice(0, 10)}-${slugify(siteName(result.spec))}`);
  fs.rmSync(dir, { recursive: true, force: true });

  const build = async () => {
    log("make 2/5 Generating images");
    // Heroes are generated portrait (they open every reel), product cards square.
    const spec = result.spec as { hero?: { imageId?: string }; products?: { imageId?: string }[] };
    const placements: Record<string, Placement> = {};
    for (const p of spec.products ?? []) if (p.imageId) placements[p.imageId] = "product";
    if (spec.hero?.imageId) placements[spec.hero.imageId] = "hero";
    const images = await makeImages(result.spec.images, result.direction, path.join(dir, "img"), {
      placeholders: opts.mock || opts.placeholders,
      placements,
      costKey: `${brand.id}/${path.basename(dir)}`,
    });
    if (images.usd) log(`   images cost $${images.usd.toFixed(2)}`);
    log("make 3/5 Building");
    buildSite(dir, brand, result.layout, result.spec, result.direction, images.paths);
    return images;
  };

  let images = await build();
  log("make 4/5 Auditing");
  let audit = await step("audit", () => auditSite(dir));
  if (audit.blocking.length && !opts.mock) {
    log(`   ${audit.blocking.length} blocking issue(s); asking Claude to fix them`);
    const before = result;
    result = await step("fix audit issues", () => reviseSpec(brand, before, brief, audit.blocking, opts.campaign));
    images = await build();
    audit = await step("re-audit", () => auditSite(dir));
  }
  // Compare the built site with the references; refine the direction once if it has drifted.
  let references: MadeSite["references"];
  if (refs && refBrief && opts.refs) {
    log("   comparing with the references");
    const prepared = refs;
    const first = await step("compare with references", () => compareWithReferences(dir, prepared, refBrief!));
    log(`   match ${first.overall}/10${first.drift ? ", drifted" : ""}${first.tooClose ? ", too close to a reference" : ""}`);
    let final: typeof first | undefined;
    if (first.drift || first.tooClose) {
      const base = refBrief;
      refBrief = await step("refine direction", () => refineBrief(base, first, brand, result.layout));
      result = { ...result, direction: refBrief.direction, spec: { ...result.spec, directionId: refBrief.direction.id } };
      images = await build();
      audit = await step("re-audit", () => auditSite(dir));
      const refined = refBrief;
      final = await step("compare again", () => compareWithReferences(dir, prepared, refined));
      log(`   after refining: ${final.overall}/10`);
    }
    const last = final ?? first;
    refBrief.comparison = { overall: last.overall, refined: !!final, summary: last.summary };
    saveBrief(opts.refs.dir, refBrief);
    fs.writeFileSync(path.join(opts.refs.dir, "comparison.md"), comparisonMarkdown(first, final));
    if (last.tooClose) audit.blocking.push(`Too close to a reference: ${last.copied.join("; ") || last.summary}`);
    if (last.overall < 7) audit.warnings.push(`Only a ${last.overall}/10 match with the references after refining: ${last.summary}`);
    // A direction that matched well and built cleanly joins the library for future sites.
    let savedDirection: string | undefined;
    if (last.overall >= KEEP_SCORE && !last.tooClose && !audit.blocking.length) {
      savedDirection = path.relative(ROOT, saveDirection(refBrief.direction));
      log(`   kept for reuse: ${savedDirection}`);
    }
    references = { dir: opts.refs.dir, overall: last.overall, refined: !!final, savedDirection };
  }

  if (images.placeholders.length) {
    audit.warnings.push(`Placeholder images (no generated photo): ${images.placeholders.join(", ")}`);
  }
  log(`   audit: ${audit.blocking.length} blocking, ${audit.warnings.length} warnings`);
  audit.blocking.forEach((b) => log(`   ! ${b}`));

  let previewUrl: string | undefined;
  if (!opts.noDeploy && env("VERCEL_TOKEN")) {
    log("make 5/5 Deploying a Vercel preview");
    previewUrl = await step("Vercel preview", () => deployPreview(dir, brandEnv("VERCEL_PROJECT", brand) ?? `${brand.id}-concepts`));
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
    references,
  };
}
