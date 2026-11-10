import fs from "node:fs";
import path from "node:path";
import { brandDir, type Brand } from "./brand.js";
import type { Batch } from "../types.js";

const dir = (brand: Pick<Brand, "id">) => path.join(brandDir(brand as Brand), "batches");

export function loadBatches(brand: Pick<Brand, "id">): Batch[] {
  if (!fs.existsSync(dir(brand))) return [];
  return fs
    .readdirSync(dir(brand))
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir(brand), f), "utf8")) as Batch)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function loadBatch(brand: Pick<Brand, "id">, id: string): Batch {
  const file = path.join(dir(brand), `${id}.json`);
  if (!fs.existsSync(file)) throw new Error(`No batch ${id} for ${brand.id}`);
  return JSON.parse(fs.readFileSync(file, "utf8")) as Batch;
}

export function saveBatch(batch: Batch): void {
  fs.mkdirSync(dir({ id: batch.brand }), { recursive: true });
  fs.writeFileSync(path.join(dir({ id: batch.brand }), `${batch.id}.json`), JSON.stringify(batch, null, 2) + "\n");
}

/** Find a batch in any brand by id or by its approval issue number. */
export function findBatch(brands: Pick<Brand, "id">[], ref: { id?: string; issue?: number }): Batch | undefined {
  for (const brand of brands) {
    const hit = loadBatches(brand).find((b) => (ref.id && b.id === ref.id) || (ref.issue && b.issue === ref.issue));
    if (hit) return hit;
  }
  return undefined;
}
