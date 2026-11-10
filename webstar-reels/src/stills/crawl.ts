import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { ROOT, type Brand } from "../lib/brand.js";
import { env } from "../lib/env.js";
import { run } from "../lib/exec.js";
import { log, logError, warn } from "../lib/log.js";
import { libraryDir, saveLibrary, type Library, type LibraryImage } from "./library.js";

export interface CrawlOptions {
  maxPages: number;
  /** Skip images whose shorter side is under this (px). A 1080x1920 reel needs real resolution. */
  minShortSide: number;
  /** Skip images whose longer side is under this (px). */
  minLongSide: number;
}

export const DEFAULT_CRAWL: CrawlOptions = { maxPages: 80, minShortSide: 900, minLongSide: 1200 };

/** Finish and film brands to recognise in copy. Extend as needed. */
const MATERIAL_BRANDS = [
  { brand: "Cover Styl'", pattern: /cover\s*styl['’`]?e?/i },
  { brand: "3M", pattern: /\b3M\b(?:\s*(?:DI-?NOC|Di-?Noc|Dinoc|Fasara))?/ },
  { brand: "3M DI-NOC", pattern: /\bdi-?noc\b/i },
  { brand: "Hexis", pattern: /\bhexis\b/i },
  { brand: "Avery Dennison", pattern: /\bavery\b/i },
  { brand: "LX Hausys", pattern: /\b(lx|lg)\s*hausys\b|\bbenif\b/i },
  { brand: "Bodaq", pattern: /\bbodaq\b/i },
  { brand: "Interiorfilm", pattern: /\binterior\s?film\b/i },
];

/** Spaces worth grouping reels by. First match wins; plural forms are folded in. */
const SPACES: [string, RegExp][] = [
  ["tea room", /\btea\s?rooms?\b|\bkitchenettes?\b|\bstaff\s?rooms?\b|\bbreakout/i],
  ["meeting room", /\bmeeting\s?rooms?\b|\bboard\s?rooms?\b|\bconference/i],
  ["cabinets", /\bcabinet(ry|s)?\b|\bcupboards?\b|\bjoinery\b|\bkitchens?\b/i],
  ["reception", /\breception\b|\bfoyer\b|\blobby\b/i],
  ["doors", /\bdoors?\b|\bdoor\s?frames?\b/i],
  ["lifts", /\blifts?\b|\belevators?\b/i],
  ["bathroom", /\bbathrooms?\b|\bvanit(y|ies)\b|\bwashrooms?\b/i],
  ["desks", /\bdesks?\b|\bworkstations?\b|\btables?\b/i],
  ["retail", /\bretail\b|\bshop\s?fit|\bcounters?\b/i],
  ["walls", /\bwalls?\b|\bcolumns?\b|\bfeature wall/i],
];

const FACT_PATTERN =
  /\b\d[\d,.]*\s?(%|percent|days?|weeks?|hours?|years?|x\b|times)|\$\s?\d|\b(cheaper|faster|less waste|landfill|downtime|disruption|fraction of|compared to|instead of replac|without (the )?(demolition|replacing))/i;

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

function spacesIn(text: string): string[] {
  return SPACES.filter(([, re]) => re.test(text)).map(([name]) => name);
}

function materialsIn(text: string): string[] {
  const found = new Set<string>();
  for (const m of MATERIAL_BRANDS) if (m.pattern.test(text)) found.add(m.brand);
  if (found.has("3M DI-NOC")) found.delete("3M");
  return [...found];
}

/** WordPress-style thumbnails (photo-300x200.jpg): try the original first. */
function originalCandidates(url: string): string[] {
  const out = [url];
  const stripped = url.replace(/-\d{2,4}x\d{2,4}(?=\.(jpe?g|png|webp|avif)(\?|$))/i, "").replace(/-scaled(?=\.(jpe?g|png|webp)(\?|$))/i, "");
  if (stripped !== url) out.unshift(stripped);
  return out;
}

interface RawImage {
  url: string;
  alt: string;
  caption: string;
  heading: string;
  context: string;
  roleHint: string;
  group: string;
  isLogo: boolean;
}

async function extract(page: Page) {
  // Scroll the whole page so lazy images and sliders load.
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += window.innerHeight * 0.7) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 150));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});

  return page.evaluate(() => {
    const t = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    const abs = (u: string | null | undefined) => {
      try {
        return u ? new URL(u, location.href).href : "";
      } catch {
        return "";
      }
    };
    const biggestFromSrcset = (srcset: string) =>
      srcset
        .split(",")
        .map((c) => c.trim().split(/\s+/))
        .map(([u, d]) => ({ u, w: parseFloat(d) || 1 }))
        .sort((a, b) => b.w - a.w)[0]?.u;
    const headingAbove = (el: Element) => {
      let node: Element | null = el;
      while (node && node !== document.body) {
        let sib = node.previousElementSibling;
        while (sib) {
          const h = sib.matches("h1,h2,h3,h4") ? sib : sib.querySelector("h1,h2,h3,h4");
          if (h && t(h)) return t(h);
          sib = sib.previousElementSibling;
        }
        node = node.parentElement;
      }
      return "";
    };
    const groupOf = (el: Element) => {
      const g = el.closest("[class*='before' i], [class*='compare' i], [class*='twentytwenty' i], [class*='beer' i], figure, li, section, article");
      if (!g) return "";
      if (!g.getAttribute("data-reel-group")) g.setAttribute("data-reel-group", String(Math.random()).slice(2, 10));
      return g.getAttribute("data-reel-group")!;
    };

    const images: any[] = [];
    const push = (url: string, el: Element, extra: Partial<{ alt: string }> = {}) => {
      if (!url || url.startsWith("data:") || /\.svg(\?|$)/i.test(url) && !/logo/i.test(url)) return;
      const cls = `${el.getAttribute("class") ?? ""} ${el.parentElement?.getAttribute("class") ?? ""}`;
      const fig = el.closest("figure");
      images.push({
        url,
        alt: extra.alt ?? el.getAttribute("alt") ?? "",
        caption: t(fig?.querySelector("figcaption")),
        heading: headingAbove(el),
        context: t(el.closest("section, article, li, figure, div"))?.slice(0, 400),
        roleHint: `${url} ${el.getAttribute("alt") ?? ""} ${cls} ${el.closest("[class*='before' i],[class*='after' i]")?.getAttribute("class") ?? ""}`,
        group: groupOf(el),
        isLogo: /logo/i.test(`${url} ${cls} ${el.getAttribute("alt") ?? ""}`) && !!el.closest("header, nav, [class*='logo' i]"),
      });
    };

    document.querySelectorAll("img").forEach((img) => {
      const link = img.closest("a")?.getAttribute("href");
      const linkIsImage = link && /\.(jpe?g|png|webp|avif)(\?|$)/i.test(link);
      const src = linkIsImage
        ? abs(link)
        : abs(biggestFromSrcset(img.getAttribute("srcset") || img.getAttribute("data-srcset") || "") || img.getAttribute("data-src") || img.getAttribute("data-lazy-src") || img.currentSrc || img.src);
      push(src, img);
    });
    // Background images on large elements (hero banners, gallery tiles).
    document.querySelectorAll("section, div, a, figure, li").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 200 || r.height < 150) return;
      const m = getComputedStyle(el).backgroundImage.match(/url\(["']?([^"')]+)["']?\)/);
      if (m) push(abs(m[1]), el, { alt: el.getAttribute("aria-label") ?? "" });
    });
    const og = document.querySelector('meta[property="og:image"]')?.getAttribute("content");
    if (og) push(abs(og), document.body, { alt: document.title });

    const links = [...document.querySelectorAll("a[href]")].map((a) => abs(a.getAttribute("href")));
    const headings = [...document.querySelectorAll("h1, h2, h3")].map(t).filter(Boolean);
    const blocks = [...document.querySelectorAll("main p, main li, article p, section p, p, li")]
      .map(t)
      .filter((s) => s.length > 30);
    const colors = [...document.querySelectorAll("a.button, .btn, button, header a, [class*='button' i]")]
      .map((el) => getComputedStyle(el).backgroundColor)
      .filter((c) => c && !/rgba?\(0, 0, 0, 0\)|rgb\(255, 255, 255\)|rgb\(0, 0, 0\)/.test(c));
    return {
      title: document.title,
      headings,
      text: [...new Set(blocks)].join("\n"),
      images,
      links,
      themeColor: document.querySelector('meta[name="theme-color"]')?.getAttribute("content") ?? "",
      colors,
    };
  });
}

async function download(url: string, toDir: string): Promise<{ file: string; width: number; height: number } | { error: string }> {
  for (const candidate of originalCandidates(url)) {
    try {
      const res = await fetch(candidate, { headers: { "user-agent": "Mozilla/5.0 (Macintosh) webstar-reels library crawler" } });
      if (!res.ok) continue;
      const type = res.headers.get("content-type") ?? "";
      if (!/image\/(jpe?g|png|webp|avif|gif)/i.test(type)) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : type.includes("avif") ? "avif" : "jpg";
      const id = crypto.createHash("sha1").update(candidate).digest("hex").slice(0, 12);
      const file = path.join(toDir, `${id}.${ext}`);
      fs.writeFileSync(file, buf);
      const probe = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file]);
      const [width, height] = probe.trim().split(",").map(Number);
      if (!width || !height) {
        fs.rmSync(file, { force: true });
        return { error: "could not read image size" };
      }
      return { file, width, height };
    } catch {
      /* try the next candidate */
    }
  }
  return { error: "download failed" };
}

/**
 * Crawl a brand's website into brands/<id>/library: every project and gallery photo with its
 * context, finish and material names, service copy, spaces, facts and before/after pairs.
 */
export async function crawlLibrary(brand: Brand, start: string, opts: CrawlOptions = DEFAULT_CRAWL): Promise<Library> {
  const host = new URL(start).host.replace(/^www\./, "");
  const dir = libraryDir(brand);
  const imgDir = path.join(dir, "images");
  fs.mkdirSync(imgDir, { recursive: true });

  const browser = await chromium.launch({ executablePath: env("CHROMIUM_PATH") });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  // tsx wraps named functions in a __name helper that pages don't define.
  await context.addInitScript("window.__name = (f) => f");
  const page = await context.newPage();

  const queue: string[] = [start];
  try {
    const sitemap = await (await fetch(new URL("/sitemap.xml", start))).text();
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
    // A sitemap index lists more sitemaps; read one level down.
    for (const loc of locs) {
      if (/\.xml(\?|$)/.test(loc)) {
        const sub = await (await fetch(loc)).text().catch(() => "");
        queue.push(...[...sub.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim()).filter((u) => !/\.xml/.test(u)));
      } else queue.push(loc);
    }
    log(`sitemap: ${queue.length - 1} pages`);
  } catch {
    warn("no sitemap.xml; following links from the home page");
  }

  const seen = new Set<string>();
  const lib: Library = {
    site: start,
    crawledAt: new Date().toISOString(),
    pages: [],
    images: [],
    pairs: [],
    materials: [],
    services: [],
    facts: [],
    spaces: [],
    brandColors: [],
    skipped: [],
  };
  const raw: (RawImage & { page: string })[] = [];
  const colorCount = new Map<string, number>();

  while (queue.length && lib.pages.length < opts.maxPages) {
    const url = queue.shift()!.split("#")[0];
    const key = url.replace(/\/$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      continue;
    }
    if (u.host.replace(/^www\./, "") !== host || /\.(pdf|jpe?g|png|webp|zip|docx?)$/i.test(u.pathname) || /wp-(admin|login)|\/feed\/?$|\/cart|\/checkout|\/account/.test(u.pathname)) {
      continue;
    }
    try {
      const res = await page.goto(url, { waitUntil: "load", timeout: 45_000 });
      if (!res?.ok() || !(res.headers()["content-type"] ?? "").includes("html")) continue;
      const data = await extract(page);
      lib.pages.push({ url, title: data.title, headings: data.headings, text: data.text.slice(0, 20_000) });
      raw.push(...data.images.map((i: RawImage) => ({ ...i, page: url })));
      for (const l of data.links) if (l && !seen.has(l.split("#")[0].replace(/\/$/, ""))) queue.push(l);
      for (const c of [data.themeColor, ...data.colors].filter(Boolean)) colorCount.set(c, (colorCount.get(c) ?? 0) + 1);
      log(`page ${lib.pages.length}: ${url} (${data.images.length} images)`);
    } catch (error) {
      warn(`could not read ${url}: ${error instanceof Error ? error.message : error}`);
    }
  }
  await browser.close();

  // ---- download, dedupe, size-check ----
  const byUrl = new Map<string, RawImage & { page: string }>();
  for (const r of raw) if (!byUrl.has(r.url)) byUrl.set(r.url, r);
  const seenHash = new Set<string>();
  for (const r of byUrl.values()) {
    if (r.isLogo) {
      if (!lib.logo) {
        const got = await download(r.url, imgDir);
        if ("file" in got) {
          const ext = path.extname(got.file);
          const dest = path.join(ROOT, "public", "brands", brand.id, `logo${ext}`);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.renameSync(got.file, dest);
          lib.logo = path.relative(ROOT, dest);
          log(`logo: ${lib.logo}`);
        }
      }
      continue;
    }
    const got = await download(r.url, imgDir);
    if ("error" in got) {
      lib.skipped.push({ url: r.url, reason: got.error });
      continue;
    }
    const hash = crypto.createHash("sha1").update(fs.readFileSync(got.file)).digest("hex");
    if (seenHash.has(hash)) {
      fs.rmSync(got.file);
      continue;
    }
    seenHash.add(hash);
    const short = Math.min(got.width, got.height);
    const long = Math.max(got.width, got.height);
    if (short < opts.minShortSide || long < opts.minLongSide) {
      fs.rmSync(got.file);
      lib.skipped.push({ url: r.url, reason: `too low-res for a 1080x1920 reel (needs ${opts.minShortSide}px short side, ${opts.minLongSide}px long side)`, width: got.width, height: got.height });
      warn(`skipped low-res image ${got.width}x${got.height}: ${r.url}`);
      continue;
    }
    const words = `${r.alt} ${r.caption} ${r.heading} ${r.context} ${new URL(r.page).pathname.replace(/[-/]/g, " ")}`;
    const role = /\bbefore\b/i.test(r.roleHint) ? "before" : /\bafter\b/i.test(r.roleHint) ? "after" : null;
    lib.images.push({
      id: path.basename(got.file).replace(/\.\w+$/, ""),
      file: path.relative(dir, got.file),
      url: r.url,
      width: got.width,
      height: got.height,
      alt: clean(r.alt),
      caption: clean(r.caption),
      page: r.page,
      heading: clean(r.heading),
      spaces: spacesIn(words),
      materials: materialsIn(words),
      role,
      ...(r.group ? { pairId: `${r.page}#${r.group}` } : {}),
    } as LibraryImage);
  }

  // ---- before/after pairs: a before and an after in the same slider or figure ----
  const groups = new Map<string, LibraryImage[]>();
  for (const img of lib.images) if (img.pairId && img.role) groups.set(img.pairId, [...(groups.get(img.pairId) ?? []), img]);
  for (const [key, imgs] of groups) {
    const before = imgs.find((i) => i.role === "before");
    const after = imgs.find((i) => i.role === "after");
    if (before && after) {
      const id = `pair-${lib.pairs.length + 1}`;
      lib.pairs.push({ id, before: before.id, after: after.id, space: after.spaces[0] ?? before.spaces[0] });
      before.pairId = after.pairId = id;
    }
  }
  for (const img of lib.images) if (img.pairId && !img.pairId.startsWith("pair-")) delete img.pairId;

  // ---- copy: materials, services, facts, spaces ----
  const allText = lib.pages.map((p) => `${p.headings.join("\n")}\n${p.text}`).join("\n");
  for (const m of MATERIAL_BRANDS) {
    const pages = lib.pages.filter((p) => m.pattern.test(`${p.title} ${p.headings.join(" ")} ${p.text}`)).map((p) => p.url);
    const mentions = (allText.match(new RegExp(m.pattern.source, "gi")) ?? []).length;
    if (mentions) {
      lib.materials.push({
        name: m.brand,
        brand: m.brand,
        mentions,
        pages,
        images: lib.images.filter((i) => i.materials.includes(m.brand)).map((i) => i.id),
      });
    }
  }
  // Named finishes: headings on pages that talk about films or finishes, e.g. "Cover Styl' NE12 Oak".
  for (const p of lib.pages.filter((p) => /finish|material|film|range|colou?r|texture|wood|stone|metal/i.test(`${p.url} ${p.title}`))) {
    for (const h of p.headings) {
      if (h.length > 3 && h.length < 50 && !lib.materials.some((m) => m.name === h) && /[A-Z0-9]/.test(h)) {
        lib.materials.push({ name: h, brand: materialsIn(`${p.title} ${p.text}`)[0], mentions: 1, pages: [p.url], images: [] });
      }
    }
  }
  for (const p of lib.pages.filter((p) => /service|what-we-do|wrap|refurb|commercial|residential|about|process/i.test(p.url) || p.url === start)) {
    lib.services.push({ title: p.headings[0] ?? p.title, text: p.text.slice(0, 2500), page: p.url });
  }
  lib.facts = [...new Set(allText.split(/(?<=[.!?])\s+|\n/).map(clean).filter((s) => s.length > 20 && s.length < 260 && FACT_PATTERN.test(s)))].slice(0, 60);
  lib.spaces = SPACES.map(([name]) => ({ name, images: lib.images.filter((i) => i.spaces.includes(name)).length })).filter((s) => s.images);
  lib.brandColors = [...colorCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c]) => c);

  saveLibrary(brand, lib);
  log(
    `library: ${lib.pages.length} pages, ${lib.images.length} images (${lib.skipped.length} skipped), ${lib.pairs.length} before/after pairs, ${lib.materials.length} materials, ${lib.facts.length} facts`,
  );
  if (!lib.images.length) logError(`No usable images found on ${start}`);
  return lib;
}
