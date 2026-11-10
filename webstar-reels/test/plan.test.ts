import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT } from "../src/lib/brand.ts";
import { saveBatch } from "../src/lib/batches.ts";
import { picksFor } from "../src/plan.ts";
import { planReel } from "../src/stills/produce.ts";
import type { Library } from "../src/stills/library.ts";
import type { Batch, VariantId } from "../src/types.ts";

// A throwaway brand folder, removed afterwards.
const ID = "zz-plan-test";
const DIR = path.join(ROOT, "brands", ID);
const brand = { id: ID, name: "Test" } as any;

function batch(id: string, variants: { id: VariantId; status?: string; plannedFor?: string; proposedOn?: string }[]): Batch {
  return {
    id,
    brand: ID,
    createdAt: `2026-11-0${id.slice(-1)}T00:00:00Z`,
    source: "make",
    site: { name: id, url: "", niche: "", concept: true },
    variants: variants.map((v) => ({ status: "ready", script: {} as any, postText: "", seconds: 15, file: "", ...v })) as any,
  };
}

before(() => fs.mkdirSync(DIR, { recursive: true }));
after(() => fs.rmSync(DIR, { recursive: true, force: true }));

test("daily picks: the planned reel first, then the oldest spare from another site", () => {
  saveBatch(batch("site-1", [{ id: "full", plannedFor: "2026-11-12" }, { id: "detail" }]));
  saveBatch(batch("site-2", [{ id: "full", plannedFor: "2026-11-13" }, { id: "detail" }]));
  const one = picksFor(brand, "2026-11-12", 1);
  assert.deepEqual(one.map((p) => `${p.batch.id}/${p.variant.id}`), ["site-1/full"]);
  // Two slots: never the same site twice in a day, and future-planned reels keep their day.
  const two = picksFor(brand, "2026-11-12", 2);
  assert.deepEqual(two.map((p) => `${p.batch.id}/${p.variant.id}`), ["site-1/full", "site-2/detail"]);
  // A swap excludes the rejected site.
  assert.deepEqual(picksFor(brand, "2026-11-12", 1, new Set(["site-1"])).map((p) => p.batch.id), ["site-2"]);
});

test("library reels fall back to a showcase when the library can't support the format", () => {
  const img = (id: string, extra = {}) => ({ id, file: `${id}.png`, url: "", width: 2000, height: 1500, alt: id, caption: "", page: "", heading: "", spaces: ["cabinets"], materials: [], role: null, ...extra });
  fs.mkdirSync(path.join(DIR, "library"), { recursive: true });
  for (const id of ["a", "b", "c", "d"]) {
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=gray:s=32x24", "-frames:v", "1", path.join(DIR, "library", `${id}.png`)]);
  }
  const lib = { site: "https://example.com/", pages: [], pairs: [], materials: [], facts: [], images: ["a", "b", "c", "d"].map((i) => img(i)) } as unknown as Library;
  assert.equal(planReel(brand, lib, "transformation").format, "showcase");
  assert.equal(planReel(brand, lib, "finish").format, "showcase");
  assert.equal(planReel(brand, lib, "showcase").images.length, 4);

  lib.pairs = [{ id: "p1", before: "a", after: "b" }];
  lib.images[2].materials = ["Cover Styl'"];
  lib.materials = [{ name: "Cover Styl'", mentions: 1, pages: [], images: ["c"] }];
  assert.deepEqual(planReel(brand, lib, "transformation").images.map((i) => i.id), ["a", "b"]);
  const finish = planReel(brand, lib, "finish");
  assert.equal(finish.material, "Cover Styl'");
  assert.deepEqual(finish.images.map((i) => i.id), ["c"]);
  // Photos graded poor are never used.
  lib.images.forEach((i) => ((i as any).quality = "poor"));
  assert.throws(() => planReel(brand, lib, "showcase"), /no usable photos/);
});
