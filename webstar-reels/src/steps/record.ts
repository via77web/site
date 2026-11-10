import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { env } from "../lib/env.js";
import type { PageInfo } from "../types.js";

export interface RecordOptions {
  /** Total length of the recording in seconds. */
  duration: number;
  /** Seconds to rest on the footer at the end (the end card covers this part). */
  footerHold?: number;
  fps?: number;
}

export interface SiteSession {
  pageInfo: PageInfo;
  record(outFile: string, options: RecordOptions): Promise<void>;
  close(): Promise<void>;
}

// 360x640 CSS px at 3x = exactly 1080x1920, so the reel is pixel-sharp.
const VIEWPORT = { width: 360, height: 640 };
const SCALE = 3;
const HERO_HOLD = 1.6; // the hook text sits over the hero
const SECTION_HOLD = 0.55;
const MAX_KEY_SECTIONS = 4;

const USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

interface Segment {
  from: number;
  to: number;
  start: number;
  end: number;
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Hold on the hero, glide to each key section, pause, and finish on the footer. */
function buildTimeline(stops: number[], duration: number, footerHold: number): Segment[] {
  const holds = stops.map((_, i) =>
    i === 0 ? HERO_HOLD : i === stops.length - 1 ? footerHold : SECTION_HOLD,
  );
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
  return segments;
}

function scrollAt(segments: Segment[], t: number): number {
  const seg = segments.find((s) => t < s.end) ?? segments[segments.length - 1];
  if (seg.end === seg.start) return seg.to;
  const p = Math.min(Math.max((t - seg.start) / (seg.end - seg.start), 0), 1);
  return seg.from + (seg.to - seg.from) * easeInOut(p);
}

/**
 * Open `url` at a mobile viewport. The returned session exposes the page details
 * (used to write the script) and `record()`, which captures a hero-to-footer scroll
 * as a 1080x1920 MP4 of an exact length, so the footage fits the voiceover with no
 * speed change.
 *
 * Frames are captured one at a time at exact scroll positions and piped to ffmpeg,
 * which gives a perfectly smooth, full-resolution scroll regardless of machine speed
 * (Playwright's built-in screen recording is low-bitrate and drops frames in CI).
 */
export async function openSite(url: string): Promise<SiteSession> {
  const browser = await chromium.launch({ executablePath: env("CHROMIUM_PATH") });
  try {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: SCALE,
      isMobile: true,
      hasTouch: true,
      userAgent: USER_AGENT,
      reducedMotion: "no-preference",
    });
    const page = await context.newPage();

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

    const { maxScroll, sectionTops, pageInfo } = await page.evaluate(() => {
      const vh = window.innerHeight;
      const maxScroll = Math.max(document.documentElement.scrollHeight - vh, 0);
      const tops = new Set<number>();
      document
        .querySelectorAll("section, main > *, [class*='section'], article, footer")
        .forEach((el) => {
          const rect = el.getBoundingClientRect();
          const top = Math.round(rect.top + window.scrollY);
          if (rect.height >= vh * 0.4 && top > vh * 0.5 && top < maxScroll - vh * 0.3)
            tops.add(top);
        });
      // No named helpers in here: tsx wraps them in a helper that does not exist in the page.
      return {
        maxScroll,
        sectionTops: [...tops].sort((a, b) => a - b),
        pageInfo: {
          title: document.title,
          description:
            document.querySelector('meta[name="description"]')?.getAttribute("content") ?? "",
          headings: [...document.querySelectorAll("h1, h2, h3")]
            .map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim())
            .filter(Boolean)
            .slice(0, 20),
        },
      };
    });

    // Keep sections at least one screen apart, then spread the picks across the page.
    const spaced: number[] = [];
    for (const top of sectionTops) {
      if (!spaced.length || top - spaced[spaced.length - 1] >= VIEWPORT.height) spaced.push(top);
    }
    const keys =
      spaced.length <= MAX_KEY_SECTIONS
        ? spaced
        : Array.from(
            { length: MAX_KEY_SECTIONS },
            (_, i) => spaced[Math.round((i * (spaced.length - 1)) / (MAX_KEY_SECTIONS - 1))],
          );
    const stops = maxScroll > 0 ? [0, ...keys, maxScroll] : [0];

    const record = async (
      outFile: string,
      { duration, footerHold = 0.7, fps = 30 }: RecordOptions,
    ): Promise<void> => {
      const timeline = buildTimeline(stops, duration, footerHold);

      const ffmpeg = spawn(
        "ffmpeg",
        [
          "-y",
          "-loglevel",
          "error",
          "-f",
          "image2pipe",
          "-framerate",
          String(fps),
          "-c:v",
          "mjpeg",
          "-i",
          "-",
          "-vf",
          "scale=1080:1920:flags=lanczos",
          "-c:v",
          "libx264",
          "-preset",
          "medium",
          "-crf",
          "17",
          "-pix_fmt",
          "yuv420p",
          "-g",
          String(fps),
          "-movflags",
          "+faststart",
          outFile,
        ],
        { stdio: ["pipe", "ignore", "pipe"] },
      );
      let ffmpegError = "";
      ffmpeg.stderr.on("data", (d) => (ffmpegError += d));
      const ffmpegDone = new Promise<void>((resolve, reject) => {
        ffmpeg.on("error", (e) =>
          reject(new Error(`ffmpeg not found or failed to start: ${e.message}`)),
        );
        ffmpeg.on("close", (code) =>
          code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}: ${ffmpegError}`)),
        );
      });
      ffmpegDone.catch(() => {}); // surfaced via the await below

      const frames = Math.round(duration * fps);
      const frameMs = 1000 / fps;
      for (let f = 0; f < frames; f++) {
        await page.evaluate(
          async ({ y, frameMs }) => {
            window.scrollTo(0, y);
            // Step CSS animations and transitions by exactly one video frame so on-page
            // motion plays at real speed even though each capture takes longer than a frame.
            for (const anim of document.getAnimations()) {
              if (!(anim.timeline instanceof DocumentTimeline)) continue; // leave scroll-driven ones
              try {
                anim.pause();
                anim.currentTime = Number(anim.currentTime ?? 0) + frameMs;
              } catch {}
            }
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          },
          { y: scrollAt(timeline, f / fps), frameMs },
        );
        const jpeg = await page.screenshot({ type: "jpeg", quality: 92 });
        if (!ffmpeg.stdin.write(jpeg)) {
          await Promise.race([new Promise((r) => ffmpeg.stdin.once("drain", r)), ffmpegDone]);
        }
      }
      ffmpeg.stdin.end();
      await ffmpegDone;
    };

    return { pageInfo, record, close: () => browser.close() };
  } catch (error) {
    await browser.close();
    throw error;
  }
}
