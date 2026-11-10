import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { z } from "zod";
import type { Brand } from "../lib/brand.js";
import { env } from "../lib/env.js";
import { generate } from "../lib/llm.js";
import { serveDir } from "../lib/serve.js";
import { BriefSchema, briefProblems, designSystemContext, toDirection, type ReferenceBrief } from "./analyse.js";
import type { PreparedRefs } from "./sync.js";

const score = z.number().describe("1 (nothing alike) to 10 (clearly the same family)");

const ComparisonSchema = z.object({
  palette: score,
  type: score,
  spacing: score,
  layout: score,
  imagery: score,
  overall: score,
  drift: z.boolean().describe("True if the built site has drifted from the feel of the references and should be refined"),
  tooClose: z.boolean().describe("True if the built site copies a reference: an exact layout reproduced, or wording or a logo lifted from it"),
  copied: z.array(z.string()).describe("What was copied, if anything"),
  adjustments: z.array(z.string()).describe("Concrete changes to tokens or components that would close the gap, most important first. Empty if none needed"),
  summary: z.string().describe("Two sentences: how the site relates to the references"),
});

export type Comparison = z.infer<typeof ComparisonSchema>;

/** Phone and desktop screenshots of a built site, saved beside the prepared references. */
export async function screenshotSite(siteDir: string, cacheDir: string): Promise<string[]> {
  const server = await serveDir(siteDir);
  const browser = await chromium.launch({ executablePath: env("CHROMIUM_PATH") });
  const shots: string[] = [];
  try {
    for (const vp of [
      { name: "phone", width: 390, height: 844, stops: [0, 0.35, 0.75] },
      { name: "desktop", width: 1280, height: 800, stops: [0, 0.4] },
    ]) {
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.name === "phone", deviceScaleFactor: 1 });
      await page.goto(server.url, { waitUntil: "load" });
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      for (const [i, stop] of vp.stops.entries()) {
        const y = Math.round(Math.max(height - vp.height, 0) * stop);
        await page.evaluate((y) => window.scrollTo(0, y), y);
        await page.waitForTimeout(900); // let reveals finish
        const file = path.join(cacheDir, `built-${vp.name}-${i + 1}.jpg`);
        await page.screenshot({ path: file, type: "jpeg", quality: 82 });
        shots.push(file);
      }
      await page.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }
  return shots;
}

/** Claude looks at the built site beside the references and scores how well the feel carried over. */
export async function compareWithReferences(siteDir: string, refs: PreparedRefs, brief: ReferenceBrief): Promise<Comparison> {
  for (const f of fs.readdirSync(refs.cacheDir)) if (f.startsWith("built-")) fs.rmSync(path.join(refs.cacheDir, f));
  const built = await screenshotSite(siteDir, refs.cacheDir);
  return generate({
    label: "reference comparison",
    schema: ComparisonSchema,
    system:
      "You are a design director checking a newly built site against the references the client saved. The site should share their feel and structure, and must not copy any one of them. Judge like a client would at a glance, and be specific.",
    prompt: `Open these files with the Read tool.

References: ${refs.files.map((f) => path.basename(f)).join(", ")}
The built site (phone, then desktop): ${built.map((f) => path.basename(f)).join(", ")}

The site was built from this direction: ${brief.direction.name}. ${brief.direction.mood}
Images on the built site may be gradient placeholders standing in for photos; if so, don't mark imagery down for that.

Score how well each aspect of the references' feel carried over. Set drift if the overall impression is off (overall under 7), and list the changes that would fix it in terms of colours, type, spacing, corner radius, and the choice of nav, hero, services, gallery and CTA styles. Set tooClose only if the site reproduces a specific reference's exact layout, wording or logo.`,
    effort: "medium",
    readDir: refs.cacheDir,
    rounds: 1,
  });
}

/** One refinement: adjust the direction and component recipe using the comparison's notes. */
export async function refineBrief(
  brief: ReferenceBrief,
  comparison: Comparison,
  brand: Brand,
  layout: "onepage" | "store",
): Promise<ReferenceBrief> {
  const revised = await generate({
    label: "refine direction",
    schema: BriefSchema,
    system: `You are the design lead at ${brand.name}, refining a design direction after comparing the built site with the client's references.

${designSystemContext(layout)}`,
    prompt: `Current brief and direction:
${JSON.stringify(brief.brief)}

A comparison of the built site with the references found:
${comparison.summary}
${comparison.tooClose ? `It copies a reference too closely: ${comparison.copied.join("; ")}. Change the structure so it no longer does.\n` : ""}
Changes to make, most important first:
${comparison.adjustments.map((a) => `- ${a}`).join("\n") || "- (none listed)"}

Return the complete brief with the direction and component recipe adjusted. Keep everything the comparison did not question.`,
    effort: "medium",
    check: (b) => briefProblems(b, brand, layout, brief.project),
  });
  return { ...brief, brief: revised, direction: toDirection(revised, brand, layout, brief.project) };
}

export function comparisonMarkdown(first: Comparison, final: Comparison | undefined): string {
  const row = (label: string, c: Comparison) =>
    `| ${label} | ${c.palette} | ${c.type} | ${c.spacing} | ${c.layout} | ${c.imagery} | **${c.overall}** |`;
  return `# Comparison with the references

| | Palette | Type | Spacing | Layout | Imagery | Overall |
| --- | --- | --- | --- | --- | --- | --- |
${row("First build", first)}
${final ? row("After refining", final) : ""}

${(final ?? first).summary}

${first.adjustments.length ? `## Changes asked for after the first build\n${first.adjustments.map((a) => `- ${a}`).join("\n")}\n` : ""}${(final ?? first).tooClose ? `\n**Too close to a reference:** ${(final ?? first).copied.join("; ")}\n` : ""}`;
}
