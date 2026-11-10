import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { chromium, type CDPSession, type Page } from "playwright";
import { env } from "../lib/env.js";
import type { PageInfo, VariantId } from "../types.js";

// 360x640 CSS px captured at 3x = exactly 1080x1920, so the reel is pixel-sharp.
const VIEW = { width: 360, height: 640 };
const SCALE = 3;
const FPS = 30;
const FRAME_MS = 1000 / FPS;
const MAX_KEY_SECTIONS = 4;
const MAX_ZOOM = 1.45;

const USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

/** A spot worth a slow zoom. Coordinates are in page (document) pixels. */
export interface DetailTarget {
  kind: "hero" | "product" | "motion" | "section";
  label: string;
  scrollY: number;
  focusX: number;
  focusY: number;
  /** Deepest zoom that still shows the whole subject (e.g. every word of a headline). */
  maxZoom: number;
}

/** Something on the page that responds to a tap. */
export interface InteractionTarget {
  kind: "add" | "cart" | "disclosure" | "toggle";
  label: string;
  index: number;
}

/** What the recorder found on the page. Given to Claude so each script matches its footage. */
export interface SitePlan {
  details: DetailTarget[];
  interactions: InteractionTarget[];
  /** "custom": a real earlier version at beforeUrl. "unstyled": the same page with its design switched off. */
  before: "custom" | "unstyled";
}

export interface ClipOptions {
  /** Output file. The before-after variant also writes `<file minus .mp4>-before.mp4`. */
  file: string;
  /** Total length in seconds. */
  duration: number;
  /** Seconds to rest on the opening shot (the hook text sits over this part). */
  heroHold: number;
  /** Seconds to pause on each key section of a scroll. */
  sectionHold: number;
  /** Seconds to rest at the end (the end card covers this part). */
  footerHold: number;
}

export interface SiteSession {
  pageInfo: PageInfo;
  plan: SitePlan;
  /** Variants this page can support. "interaction" is dropped when nothing tappable was found. */
  variants: VariantId[];
  record(clips: Partial<Record<VariantId, ClipOptions>>): Promise<void>;
  close(): Promise<void>;
}

export const beforeFile = (file: string) => file.replace(/\.mp4$/, "-before.mp4");

// Runs in the page before any site script. Plain JS on purpose: it is not compiled.
const PAGE_HELPERS = `
window.__name = (f) => f; // tsx wraps named functions in this helper; the page needs it defined
window.__reel = {
  // Scroll, then advance CSS animations and transitions by exactly one video frame, so on-page
  // motion plays at real speed even though a capture does not take exactly one frame.
  step(y, ms) {
    return new Promise((resolve) => {
      if (y !== null) window.scrollTo(0, y);
      for (const anim of document.getAnimations()) {
        if (!(anim.timeline instanceof DocumentTimeline)) continue; // leave scroll-driven ones
        try { anim.pause(); anim.currentTime = Number(anim.currentTime || 0) + ms; } catch {}
      }
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(window.scrollY)));
    });
  },
  cursor(x, y, pressed) {
    let el = document.getElementById("__reel_cursor");
    if (!el) {
      el = document.createElement("div");
      el.id = "__reel_cursor";
      el.setAttribute("aria-hidden", "true");
      el.style.cssText = "position:fixed;left:0;top:0;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;" +
        "background:rgba(255,255,255,.55);border:2px solid rgba(20,20,20,.55);box-shadow:0 4px 18px rgba(0,0,0,.28);" +
        "z-index:2147483647;pointer-events:none;transition:none";
      document.documentElement.appendChild(el);
    }
    el.style.transform = "translate(" + x + "px," + y + "px) scale(" + (pressed ? 0.72 : 1) + ")";
    el.style.background = pressed ? "rgba(255,255,255,.9)" : "rgba(255,255,255,.55)";
  },
  hideCursor() { const el = document.getElementById("__reel_cursor"); if (el) el.remove(); },
};
`;

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

interface Segment {
  from: number;
  to: number;
  start: number;
  end: number;
}

/** Hold on the first stop, glide to each next one, pause, and finish on the last. */
function scrollTimeline(
  stops: number[],
  duration: number,
  hold: { first: number; middle: number; last: number },
): (t: number) => number {
  const holds = stops.map((_, i) => (i === 0 ? hold.first : i === stops.length - 1 ? hold.last : hold.middle));
  const travel = Math.max(duration - holds.reduce((a, b) => a + b, 0), duration * 0.5);
  const distance = stops[stops.length - 1] - stops[0] || 1;
  const segments: Segment[] = [];
  let t = 0;
  stops.forEach((y, i) => {
    segments.push({ from: y, to: y, start: t, end: (t += holds[i]) });
    const next = stops[i + 1];
    if (next !== undefined) {
      segments.push({ from: y, to: next, start: t, end: (t += (travel * (next - y)) / distance) });
    }
  });
  return (time) => {
    const seg = segments.find((s) => time < s.end) ?? segments[segments.length - 1];
    if (seg.end === seg.start) return seg.to;
    const p = clamp((time - seg.start) / (seg.end - seg.start), 0, 1);
    return seg.from + (seg.to - seg.from) * easeInOut(p);
  };
}

/**
 * Writes frames to an MP4. Each frame is a region of the page rendered by Chrome at the
 * exact output size, so zoomed shots are as sharp as full ones, and the result is perfectly
 * smooth regardless of machine speed.
 */
class Clip {
  private ffmpeg: ChildProcessWithoutNullStreams;
  private done: Promise<void>;
  private error = "";

  constructor(
    private page: Page,
    private cdp: CDPSession,
    file: string,
  ) {
    this.ffmpeg = spawn("ffmpeg", [
      "-y", "-loglevel", "error",
      "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
      "-vf", `scale=${VIEW.width * SCALE}:${VIEW.height * SCALE}:flags=lanczos`,
      "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p",
      "-g", String(FPS), "-movflags", "+faststart",
      file,
    ]);
    this.ffmpeg.stderr.on("data", (d) => (this.error += d));
    this.done = new Promise<void>((resolve, reject) => {
      this.ffmpeg.on("error", (e) => reject(new Error(`ffmpeg not found or failed to start: ${e.message}`)));
      this.ffmpeg.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}: ${this.error}`)),
      );
    });
    this.done.catch(() => {}); // surfaced by finish()
  }

  /**
   * Capture one frame. `y` scrolls first (null leaves the scroll alone). `zoom` and the focus
   * point (viewport pixels) crop into the view; the crop is re-rendered, not upscaled.
   */
  async frame(y: number | null, zoom = 1, focusX = VIEW.width / 2, focusY = VIEW.height / 2): Promise<void> {
    const scrollY = (await this.page.evaluate(
      ([y, ms]) => (window as any).__reel.step(y, ms),
      [y, FRAME_MS] as const,
    )) as number;
    const width = VIEW.width / zoom;
    const height = VIEW.height / zoom;
    const { data } = await this.cdp.send("Page.captureScreenshot", {
      format: "jpeg",
      quality: 92,
      clip: {
        x: clamp(focusX - width / 2, 0, VIEW.width - width),
        y: scrollY + clamp(focusY - height / 2, 0, VIEW.height - height),
        width,
        height,
        scale: SCALE * zoom,
      },
    });
    if (!this.ffmpeg.stdin.write(Buffer.from(data, "base64"))) {
      await Promise.race([new Promise((r) => this.ffmpeg.stdin.once("drain", r)), this.done]);
    }
  }

  async finish(): Promise<void> {
    this.ffmpeg.stdin.end();
    await this.done;
  }
}

const frames = (seconds: number) => Math.max(Math.round(seconds * FPS), 1);

/** Let reveals and lazy content settle at a new scroll position without recording it. */
async function settle(page: Page, y: number, seconds = 0.8): Promise<void> {
  for (let i = 0; i < frames(seconds); i++) {
    await page.evaluate(([y, ms]) => (window as any).__reel.step(y, ms), [y, FRAME_MS] as const);
  }
}

async function measure(page: Page) {
  return page.evaluate(() => {
    const vh = window.innerHeight;
    const maxScroll = Math.max(document.documentElement.scrollHeight - vh, 0);
    const tops = new Set<number>();
    document.querySelectorAll("section, main > *, [class*='section'], article, footer").forEach((el) => {
      const rect = el.getBoundingClientRect();
      const top = Math.round(rect.top + window.scrollY);
      if (rect.height >= vh * 0.4 && top > vh * 0.5 && top < maxScroll - vh * 0.3) tops.add(top);
    });
    return { maxScroll, sectionTops: [...tops].sort((a, b) => a - b) };
  });
}

/** Stops for a full scroll: top, a few key sections spread down the page, bottom. */
function keyStops(maxScroll: number, sectionTops: number[]): number[] {
  if (maxScroll <= 0) return [0];
  const spaced: number[] = [];
  for (const top of sectionTops) {
    if (!spaced.length || top - spaced[spaced.length - 1] >= VIEW.height) spaced.push(top);
  }
  const keys =
    spaced.length <= MAX_KEY_SECTIONS
      ? spaced
      : Array.from({ length: MAX_KEY_SECTIONS }, (_, i) =>
          spaced[Math.round((i * (spaced.length - 1)) / (MAX_KEY_SECTIONS - 1))],
        );
  return [0, ...keys, maxScroll];
}

/** Find the shots for the detail variant and the tappable things for the interaction variant. */
async function planPage(page: Page): Promise<Pick<SitePlan, "details" | "interactions">> {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const maxScroll = Math.max(document.documentElement.scrollHeight - vh, 0);
    const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top + window.scrollY, w: r.width, h: r.height };
    };
    const shown = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) return false;
      if (el.closest('[aria-hidden="true"], [hidden], dialog:not([open])')) return false;
      const s = getComputedStyle(el);
      return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05;
    };
    const heading = (el: Element) => {
      const scope = el.closest("section, article, li, [class*='card'], form, main > *") ?? el;
      return text(scope.querySelector("h1, h2, h3, h4")).slice(0, 60);
    };

    // ---- detail shots ----
    const details: any[] = [];
    const shot = (kind: string, el: Element, label: string) => {
      const b = box(el);
      if (b.w < 60 || b.h < 60) return;
      const focusY = b.y + Math.min(b.h, vh) / 2;
      const scrollY = Math.min(Math.max(focusY - vh / 2, 0), maxScroll);
      if (details.some((d) => Math.abs(d.scrollY - scrollY) < vh * 0.8)) return; // not the same screen twice
      details.push({
        kind,
        label: label || kind,
        scrollY: Math.round(scrollY),
        focusX: Math.min(Math.max(b.x + b.w / 2, vw * 0.3), vw * 0.7),
        focusY: Math.round(focusY),
        maxZoom: 9,
      });
    };
    const media = [...document.querySelectorAll("img, video, picture, canvas")].filter(shown);
    const big = (el: Element) => box(el).w >= vw * 0.45 && box(el).h >= 110;

    const heroMedia = media.find((el) => box(el).y < vh * 0.9 && big(el));
    const h1 = document.querySelector("h1");
    // Push in on the headline when it is on the first screen, otherwise on the hero image.
    // Measure the text itself: a left-aligned h1 box spans the page, but its words may not.
    let textBox: { x: number; y: number; w: number; h: number } | null = null;
    if (h1 && shown(h1) && box(h1).y < vh) {
      const range = document.createRange();
      range.selectNodeContents(h1);
      const r = range.getBoundingClientRect();
      if (r.width && r.height) textBox = { x: r.left, y: r.top + window.scrollY, w: r.width, h: r.height };
    }
    details.push({
      kind: "hero",
      label: text(h1).slice(0, 60) || "hero",
      scrollY: 0,
      focusX: textBox ? textBox.x + textBox.w / 2 : vw / 2,
      focusY: textBox
        ? Math.min(textBox.y + textBox.h / 2, vh * 0.75)
        : heroMedia
          ? Math.min(box(heroMedia).y + box(heroMedia).h / 2, vh * 0.6)
          : vh * 0.42,
      maxZoom: textBox ? Math.max(1, Math.min(vw / (textBox.w + 28), vh / (textBox.h + 60))) : 9,
    });
    const productMedia = media.find(
      (el) =>
        box(el).y > vh * 0.9 &&
        box(el).w >= vw * 0.3 &&
        el.closest("[data-id], [class*='product' i], [class*='pdp' i], [class*='card' i], [class*='item' i]"),
    );
    if (productMedia) shot("product", productMedia, heading(productMedia));

    const motion = [
      ...document.querySelectorAll(
        "video, canvas, [class*='story' i], [class*='scrub' i], [class*='marquee' i], [class*='reel' i], [class*='gallery' i], [class*='slider' i]",
      ),
    ].find((el) => shown(el) && box(el).y > vh * 0.9 && box(el).h >= 110);
    if (motion) shot("motion", motion, heading(motion));

    // Fill up to three shots with the largest remaining images further down the page.
    for (const el of media.filter((m) => box(m).y > vh * 0.9 && big(m)).sort((a, b) => box(b).h - box(a).h)) {
      if (details.length >= 3) break;
      shot("section", el, heading(el));
    }
    details.sort((a, b) => a.scrollY - b.scrollY);

    // ---- interactions ----
    const found: { kind: string; el: Element; label: string }[] = [];
    const label = (el: Element) => (el.getAttribute("aria-label") || text(el)).slice(0, 50);
    const buttons = [...document.querySelectorAll("button, [role='button'], summary, [role='tab']")].filter(
      (el) => shown(el) && !(el as HTMLButtonElement).disabled && !el.closest("header, nav, footer, form[role='search']"),
    );
    const pick = (kind: string, test: (el: Element) => boolean) => {
      if (found.some((f) => f.kind === kind)) return;
      const el = buttons.find((b) => !found.some((f) => f.el === b) && test(b));
      if (el) found.push({ kind, el, label: label(el) });
    };
    // Submit buttons are only safe to tap when they add to a cart, never when they send a form.
    const submits = (el: Element) =>
      el.getAttribute("type") === "submit" || (el.tagName === "BUTTON" && !el.getAttribute("type") && !!el.closest("form"));
    pick("add", (el) => /add to (bag|cart|basket)|quick add|add to order/i.test(label(el)));
    pick(
      "disclosure",
      (el) =>
        !submits(el) &&
        (el.tagName === "SUMMARY"
          ? !(el.parentElement as HTMLDetailsElement)?.open
          : el.getAttribute("aria-expanded") === "false"),
    );
    pick(
      "toggle",
      (el) => !submits(el) && (el.getAttribute("aria-pressed") === "false" || el.getAttribute("aria-selected") === "false"),
    );
    if (!found.some((f) => f.kind === "add")) {
      const cart = [...document.querySelectorAll("button, [role='button']")].find(
        (el) => shown(el) && /\b(bag|cart|basket)\b/i.test(label(el)) && !/close/i.test(label(el)),
      );
      if (cart) found.push({ kind: "cart", el: cart, label: label(cart) });
    }
    found.sort((a, b) => box(a.el).y - box(b.el).y);
    found.forEach((f, i) => f.el.setAttribute("data-reel-target", String(i)));

    return {
      details: details.slice(0, 3),
      interactions: found.map((f, i) => ({ kind: f.kind, label: f.label, index: i })),
    } as any;
  });
}

/** full: the complete hero-to-footer scroll, pausing on key sections. */
async function recordFull(page: Page, cdp: CDPSession, o: ClipOptions): Promise<void> {
  const { maxScroll, sectionTops } = await measure(page);
  const at = scrollTimeline(keyStops(maxScroll, sectionTops), o.duration, {
    first: o.heroHold,
    middle: o.sectionHold,
    last: o.footerHold,
  });
  await settle(page, 0);
  const clip = new Clip(page, cdp, o.file);
  for (let f = 0; f < frames(o.duration); f++) await clip.frame(at(f / FPS));
  await clip.finish();
}

/** detail: a slow push-in on each of the best two or three spots, cutting between them. */
async function recordDetail(page: Page, cdp: CDPSession, o: ClipOptions, shots: DetailTarget[]): Promise<void> {
  const clip = new Clip(page, cdp, o.file);
  // The first shot carries the hook and the last sits under the end card, so both run longer.
  const body = Math.max(o.duration - o.heroHold - o.footerHold, shots.length);
  const lengths = shots.map(
    (_, i) => body / shots.length + (i === 0 ? o.heroHold : 0) + (i === shots.length - 1 ? o.footerHold : 0),
  );
  for (const [i, shot] of shots.entries()) {
    await settle(page, shot.scrollY);
    const n = frames(lengths[i]);
    for (let f = 0; f < n; f++) {
      const p = easeInOut(f / Math.max(n - 1, 1));
      // Start a touch wide of 1x on later shots so every shot is already moving when it cuts in.
      const deepest = Math.max(Math.min(MAX_ZOOM, shot.maxZoom), 1.12);
      const zoom = lerp(i === 0 ? 1 : 1.06, deepest, p);
      await clip.frame(
        shot.scrollY,
        zoom,
        lerp(VIEW.width / 2, shot.focusX, p),
        lerp(VIEW.height / 2, shot.focusY - shot.scrollY, p),
      );
    }
  }
  await clip.finish();
}

/** One top-to-bottom scroll at an even pace. Before and after use the same pacing so they stay in step. */
async function recordSweep(page: Page, cdp: CDPSession, file: string, o: ClipOptions): Promise<void> {
  const { maxScroll } = await measure(page);
  const at = scrollTimeline([0, maxScroll], o.duration, { first: o.heroHold, middle: 0, last: o.footerHold });
  await settle(page, 0);
  const clip = new Clip(page, cdp, file);
  for (let f = 0; f < frames(o.duration); f++) await clip.frame(at(f / FPS));
  await clip.finish();
}

/** Switch the page's design off: no author styles, browser defaults only. */
async function unstyle(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const sheet of [...document.styleSheets]) sheet.disabled = true;
    document.querySelectorAll("[style]").forEach((el) => el.removeAttribute("style"));
    const plain = document.createElement("style");
    plain.textContent =
      "html{background:#fff;color:#000}body{margin:12px;font:16px/1.35 Times,'Times New Roman',serif}" +
      "img,video,svg,canvas{max-width:100%;height:auto}svg{max-height:40px}" +
      "*{opacity:1!important;transform:none!important;animation:none!important;transition:none!important}" +
      "[aria-hidden='true'],dialog:not([open]){display:none!important}::-webkit-scrollbar{display:none!important}";
    document.head.appendChild(plain);
    window.scrollTo(0, 0);
  });
}

/** interaction: scroll to each tappable thing, tap it with a visible touch point, and let it respond. */
async function recordInteraction(
  page: Page,
  cdp: CDPSession,
  o: ClipOptions,
  targets: InteractionTarget[],
): Promise<void> {
  const { maxScroll } = await measure(page);
  await settle(page, 0);
  const clip = new Clip(page, cdp, o.file);
  const cursor = (x: number, y: number, pressed = false) =>
    page.evaluate(([x, y, p]) => (window as any).__reel.cursor(x, y, p), [x, y, pressed] as const);
  const capture = async (seconds: number, y: number | null = null) => {
    for (let f = 0; f < frames(seconds); f++) await clip.frame(y);
  };
  const modalOpen = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('[aria-modal="true"], dialog[open]')].some((d) => {
        const r = d.getBoundingClientRect();
        return (
          d.getAttribute("aria-hidden") !== "true" && r.width > 40 && r.height > 40 && r.right > 0 && r.left < window.innerWidth
        );
      }),
    );

  let scrollY = 0;
  let cx = VIEW.width * 0.78;
  let cy = VIEW.height * 0.8;
  await cursor(cx, cy);
  await capture(o.heroHold, 0);

  const each = Math.max((o.duration - o.heroHold - o.footerHold) / targets.length, 2);
  for (const target of targets) {
    const rect = await page
      .locator(`[data-reel-target="${target.index}"]`)
      .evaluate((node) => {
        const r = node.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + window.scrollY + r.height / 2 };
      })
      .catch(() => null);
    if (!rect) {
      await capture(each);
      continue;
    }

    // Glide so the target sits a little below the middle of the screen.
    const nextY = clamp(rect.y - VIEW.height * 0.56, 0, maxScroll);
    const tx = clamp(rect.x, 24, VIEW.width - 24);
    const ty = rect.y - nextY;
    const glide = frames(each * 0.34);
    for (let f = 0; f < glide; f++) {
      const p = easeInOut(f / Math.max(glide - 1, 1));
      await cursor(lerp(cx, tx, p), lerp(cy, ty, p));
      await clip.frame(lerp(scrollY, nextY, p));
    }
    [scrollY, cx, cy] = [nextY, tx, ty];

    await capture(each * 0.08);
    await cursor(cx, cy, true);
    await capture(0.12);
    // A real tap, so the site's own handlers and transitions run.
    await page.touchscreen.tap(cx, cy).catch(() => {});
    await capture(0.1);
    await cursor(cx, cy, false);
    await capture(each * 0.4);

    // If the tap opened a drawer or dialog, show it, then close it before moving on.
    if (await modalOpen()) {
      await page.keyboard.press("Escape");
      await capture(each * 0.18);
      if (await modalOpen()) {
        await page
          .locator('[aria-modal="true"]:not([aria-hidden="true"]) [data-close], dialog[open] [data-close]')
          .first()
          .click({ timeout: 800 })
          .catch(() => {});
        await capture(0.3);
      }
    } else {
      await capture(each * 0.18);
    }
  }
  await page.evaluate(() => (window as any).__reel.hideCursor());
  await capture(o.footerHold);
  await clip.finish();
}

async function loadPage(page: Page, url: string): Promise<void> {
  const response = await page.goto(url, { waitUntil: "load", timeout: 60_000 });
  if (!response || !response.ok()) {
    throw new Error(`Could not load ${url} (HTTP ${response?.status() ?? "no response"})`);
  }
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

  // Best-effort cookie banner dismissal.
  await page
    .getByRole("button", { name: /^(accept|accept all|agree|i agree|got it|allow all|ok)$/i })
    .first()
    .click({ timeout: 1500 })
    .catch(() => {});

  await page.addStyleTag({
    content: `html{scroll-behavior:auto!important}::-webkit-scrollbar{display:none!important}`,
  });

  // Scroll through once so lazy-loaded images are in place, then return to the top.
  await page.evaluate(async () => {
    const step = window.innerHeight * 0.8;
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(400);
}

/**
 * Open `url` at a phone viewport. One session plans and records every variant, so the four
 * reels of a site come from the same page load.
 *
 * `beforeUrl`, when given, is an earlier version of the site for the before-after variant.
 * Without it, "before" is the same page with its design switched off.
 */
export async function openSite(url: string, beforeUrl?: string): Promise<SiteSession> {
  const browser = await chromium.launch({ executablePath: env("CHROMIUM_PATH") });
  try {
    const context = await browser.newContext({
      viewport: VIEW,
      deviceScaleFactor: SCALE,
      isMobile: true,
      hasTouch: true,
      userAgent: USER_AGENT,
      reducedMotion: "no-preference",
    });
    await context.addInitScript(PAGE_HELPERS);
    const page = await context.newPage();
    await loadPage(page, url);
    const cdp = await context.newCDPSession(page);

    const pageInfo = await page.evaluate(() => ({
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.getAttribute("content") ?? "",
      headings: [...document.querySelectorAll("h1, h2, h3")]
        .map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, 20),
    }));
    const found = await planPage(page);
    const plan: SitePlan = { ...found, before: beforeUrl ? "custom" : "unstyled" };
    const variants: VariantId[] = ["full", "detail", "before-after"];
    if (plan.interactions.length) variants.push("interaction");

    const record: SiteSession["record"] = async (clips) => {
      // Order matters: the interaction taps change the page, and "before" replaces it,
      // so the untouched passes go first.
      if (clips.full) await recordFull(page, cdp, clips.full);
      if (clips.detail) await recordDetail(page, cdp, clips.detail, plan.details);
      if (clips["before-after"]) await recordSweep(page, cdp, clips["before-after"].file, clips["before-after"]);
      if (clips.interaction && plan.interactions.length) {
        await recordInteraction(page, cdp, clips.interaction, plan.interactions);
      }
      if (clips["before-after"]) {
        if (beforeUrl) await loadPage(page, beforeUrl);
        else await unstyle(page);
        await recordSweep(page, cdp, beforeFile(clips["before-after"].file), clips["before-after"]);
      }
    };

    return { pageInfo, plan, variants, record, close: () => browser.close() };
  } catch (error) {
    await browser.close();
    throw error;
  }
}
