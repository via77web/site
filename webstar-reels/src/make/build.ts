import fs from "node:fs";
import path from "node:path";
import { LIBRARY_DIR, type Direction } from "../../library/index.js";
import { renderOnePage } from "../../library/layouts/onepage.js";
import { renderStore } from "../../library/layouts/store.js";
import type { OnePageSpec, StoreSpec } from "../../library/spec.js";
import type { Brand } from "../lib/brand.js";
import type { AnySpec, Layout } from "./spec.js";

/** Write the site into `dir`. Images must already be in `dir/img`. */
export function buildSite(
  dir: string,
  brand: Brand,
  layout: Layout,
  spec: AnySpec,
  direction: Direction,
  images: Record<string, string>,
): void {
  const ctx = { brandName: brand.name, images };
  const site =
    layout === "store"
      ? renderStore(spec as StoreSpec, direction, ctx)
      : renderOnePage(spec as OnePageSpec, direction, ctx);
  for (const [rel, content] of Object.entries(site.files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  for (const [rel, from] of Object.entries(site.copy)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.copyFileSync(path.join(LIBRARY_DIR, from), path.join(dir, rel));
  }
  fs.writeFileSync(path.join(dir, "spec.json"), JSON.stringify({ layout, direction: direction.id, spec }, null, 2));
}
