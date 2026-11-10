import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { chromium, type Page } from "playwright";
import { loadAntiPatterns } from "../../library/index.js";
import { ALLOWED_BEZIERS } from "../../library/tokens/motion.js";
import { env } from "../lib/env.js";
import { serveDir } from "../lib/serve.js";

export interface AuditReport {
  /** Must be fixed before the site is shown to anyone. */
  blocking: string[];
  /** Worth a look; does not stop the pipeline. */
  warnings: string[];
}

const require = createRequire(import.meta.url);
const AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const normaliseBezier = (s: string) =>
  s.replace(/\s+/g, "").replace(/(^|[(,])0\./g, "$1.").replace(/(^|[(,])-0\./g, "$1-.");

async function checkPage(page: Page, label: string, report: AuditReport, mobile: boolean): Promise<void> {
  // Let reveals finish so the audit sees the page as a visitor does after scrolling.
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += window.innerHeight * 0.7) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 1500));
  });

  await page.addScriptTag({ content: AXE });
  const axe = (await page.evaluate(async () =>
    (window as any).axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } }),
  )) as { violations: { id: string; impact: string; help: string; nodes: { target: string[] }[] }[] };
  for (const v of axe.violations) {
    const where = v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(", ");
    const line = `[${label}] ${v.help} (${v.id}, ${v.nodes.length} element${v.nodes.length > 1 ? "s" : ""}: ${where})`;
    (v.impact === "serious" || v.impact === "critical" ? report.blocking : report.warnings).push(line);
  }

  const layout = await page.evaluate((mobile) => {
    const overflow = document.documentElement.scrollWidth - window.innerWidth;
    const small: string[] = [];
    if (mobile) {
      document.querySelectorAll("a[href], button, input, select, summary, [role='button']").forEach((el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        if (!r.width || !r.height || s.visibility === "hidden" || el.closest("[aria-hidden='true']")) return;
        if (el.closest("p, li, dd, footer") && el.tagName === "A") return; // inline text links are exempt
        if (r.height < 40 || r.width < 40) small.push((el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 30));
      });
    }
    // Controls partly pushed off-screen. Body overflow-x:hidden hides the sideways scroll, so
    // the overflow check alone misses these. Carousels that scroll on purpose are exempt.
    const clipped = [...document.querySelectorAll("a[href], button, input")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (!r.width || el.closest("[aria-hidden='true'], .reel, .track, [class*='slider'], [class*='carousel']")) return false;
        return r.left < window.innerWidth && r.right > window.innerWidth + 1;
      })
      .map((el) => (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 30));
    // A header item that wraps below the bar (a broken nav layout).
    const bar = document.querySelector("header");
    const fallen = bar
      ? [...bar.querySelectorAll("a, button")]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            const b = bar.getBoundingClientRect();
            return r.height > 0 && getComputedStyle(el).visibility !== "hidden" && r.bottom > b.bottom + 6;
          })
          .map((el) => (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30))
      : [];
    const missingAlt = [...document.querySelectorAll("img:not([alt])")].map((i) => i.getAttribute("src"));
    const text = document.body.innerText;
    const bodySize = parseFloat(getComputedStyle(document.body).fontSize);
    return { overflow, fallen: [...new Set(fallen)], clipped: [...new Set(clipped)], small: [...new Set(small)].slice(0, 6), missingAlt, text, bodySize };
  }, mobile);

  if (layout.overflow > 1) report.blocking.push(`[${label}] The page scrolls sideways by ${layout.overflow}px`);
  if (layout.clipped.length) report.blocking.push(`[${label}] Controls cut off at the right edge: ${layout.clipped.join(", ")}`);
  if (layout.fallen.length) report.blocking.push(`[${label}] Header items fall outside the header bar: ${layout.fallen.join(", ")}`);
  if (/\*\S[^*\n]{0,60}\*/.test(layout.text)) report.blocking.push(`[${label}] Literal *asterisks* are showing in the text`);
  if (layout.missingAlt.length) report.blocking.push(`[${label}] Images with no alt attribute: ${layout.missingAlt.join(", ")}`);
  if (layout.small.length) report.warnings.push(`[${label}] Tap targets under 40px: ${layout.small.join(", ")}`);
  if (mobile && layout.bodySize < 16) report.warnings.push(`[${label}] Body text is ${layout.bodySize}px; use at least 16px`);
  if (mobile) {
    if (!/\bconcept\b/i.test(layout.text)) report.blocking.push("The page never says it is a concept");
    const lower = layout.text.toLowerCase();
    const hits = loadAntiPatterns().bannedPhrases.filter((p) => lower.includes(p));
    if (hits.length) report.blocking.push(`Banned phrases in the copy: ${hits.join(", ")}`);
  }
}

/** Static checks on the files: only motion-system easings. */
function checkFiles(dir: string, report: AuditReport): void {
  const allowed = new Set(ALLOWED_BEZIERS.map(normaliseBezier));
  const walk = (d: string): string[] =>
    fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const file of walk(dir).filter((f) => /\.(css|js|html)$/.test(f))) {
    const found = fs.readFileSync(file, "utf8").match(/cubic-bezier\([^)]*\)/g) ?? [];
    const off = [...new Set(found.map(normaliseBezier))].filter((b) => !allowed.has(b));
    if (off.length) report.warnings.push(`${path.relative(dir, file)} uses easings outside the motion system: ${off.join(", ")}`);
  }
}

/** Design and accessibility audit of a built site, on a phone and a desktop viewport. */
export async function auditSite(dir: string): Promise<AuditReport> {
  const report: AuditReport = { blocking: [], warnings: [] };
  const server = await serveDir(dir);
  const browser = await chromium.launch({ executablePath: env("CHROMIUM_PATH") });
  try {
    for (const vp of [
      { label: "phone", width: 360, height: 740, mobile: true },
      { label: "desktop", width: 1280, height: 800, mobile: false },
    ]) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        isMobile: vp.mobile,
        hasTouch: vp.mobile,
        // Scroll-driven effects (word scrub, story steps) dim text on purpose while they play.
        // Check the page in its settled state, which is also what reduced-motion visitors get.
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      const errors: string[] = [];
      const offline = new Set<string>();
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
      page.on("requestfailed", (r) => {
        const u = new URL(r.url());
        if (u.hostname === "127.0.0.1") errors.push(`Missing file: ${u.pathname}`);
        else offline.add(u.hostname);
      });
      await page.goto(server.url, { waitUntil: "load", timeout: 60_000 });
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
      await checkPage(page, vp.label, report, vp.mobile);
      for (const e of [...new Set(errors)]) report.blocking.push(`[${vp.label}] ${e}`);
      if (offline.size && vp.mobile) {
        report.warnings.push(`Could not reach ${[...offline].join(", ")} during the audit (fonts or scripts from a CDN)`);
      }
      await context.close();
    }
    checkFiles(dir, report);
  } finally {
    await browser.close();
    await server.close();
  }
  return report;
}
