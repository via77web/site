import fs from "node:fs";
import path from "node:path";
import { brandDir, type Brand } from "../lib/brand.js";

/** One photo in a brand's library (brands/<id>/library/library.json). */
export interface LibraryImage {
  id: string;
  /** Path relative to brands/<id>/library. */
  file: string;
  url: string;
  width: number;
  height: number;
  alt: string;
  caption: string;
  /** Page the image was found on, and the nearest heading above it. */
  page: string;
  heading: string;
  /** e.g. "cabinets", "tea room", "meeting room". */
  spaces: string[];
  /** Material or finish names mentioned with the image, e.g. "Cover Styl'", "3M DI-NOC". */
  materials: string[];
  role: "before" | "after" | null;
  pairId?: string;
  /** Filled in by `library:tag` (Claude looks at the photo). */
  description?: string;
  quality?: "good" | "soft" | "poor";
}

export interface LibraryPage {
  url: string;
  title: string;
  headings: string[];
  text: string;
}

export interface Library {
  site: string;
  crawledAt: string;
  pages: LibraryPage[];
  images: LibraryImage[];
  pairs: { id: string; before: string; after: string; space?: string }[];
  materials: { name: string; brand?: string; mentions: number; pages: string[]; images: string[] }[];
  services: { title: string; text: string; page: string }[];
  /** Sentences from the site with figures or comparisons (cost, time, waste, downtime). The only facts reels may state. */
  facts: string[];
  spaces: { name: string; images: number }[];
  brandColors: string[];
  logo?: string;
  skipped: { url: string; reason: string; width?: number; height?: number }[];
}

export const libraryDir = (brand: Pick<Brand, "id">) => path.join(brandDir(brand as Brand), "library");
const libraryFile = (brand: Pick<Brand, "id">) => path.join(libraryDir(brand), "library.json");

export function hasLibrary(brand: Pick<Brand, "id">): boolean {
  return fs.existsSync(libraryFile(brand));
}

export function loadLibrary(brand: Pick<Brand, "id">): Library {
  if (!hasLibrary(brand)) {
    throw new Error(`brands/${brand.id}/library/library.json is missing. Run: npm run library:crawl -- --brand ${brand.id}`);
  }
  return JSON.parse(fs.readFileSync(libraryFile(brand), "utf8")) as Library;
}

export function saveLibrary(brand: Pick<Brand, "id">, lib: Library): void {
  fs.mkdirSync(libraryDir(brand), { recursive: true });
  fs.writeFileSync(libraryFile(brand), JSON.stringify(lib, null, 2) + "\n");
}

/** Usable photos: present on disk and not judged poor. */
export function usableImages(brand: Pick<Brand, "id">, lib: Library): LibraryImage[] {
  return lib.images.filter((i) => i.quality !== "poor" && fs.existsSync(path.join(libraryDir(brand), i.file)));
}

/** Whole-library text, used to check that every figure in a script came from the site. */
export function libraryText(lib: Library): string {
  return [...lib.pages.map((p) => `${p.title}\n${p.headings.join("\n")}\n${p.text}`), ...lib.facts].join("\n");
}
