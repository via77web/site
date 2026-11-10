import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  ComponentsSchema,
  DirectionSchema,
  directionContrastProblems,
  loadAntiPatterns,
  loadFonts,
  type Direction,
} from "../../library/index.js";
import type { Brand } from "../lib/brand.js";
import { generate, llmBackend } from "../lib/llm.js";
import { log, step } from "../lib/log.js";
import type { PreparedRefs } from "./sync.js";

const BATCH = 6;
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const NO_COPY =
  "Describe patterns and feelings only. Never transcribe wording from a reference, never name the brand, product or person shown, and never describe a logo. Someone reading your notes should be unable to recreate the reference's text or identify whose site it is.";

const NotesSchema = z.object({
  images: z.array(
    z.object({
      file: z.string(),
      feel: z.string().describe("The emotion and personality in a sentence"),
      layout: z.string().describe("Layout pattern: how the page or screen is organised"),
      grid: z.string().describe("Columns, alignment, asymmetry, density"),
      spacing: z.string().describe("Whitespace and rhythm: tight, airy, generous margins"),
      type: z.string().describe("Type style: serif or sans, weight, width, case, scale contrast, tracking"),
      palette: z.array(hex).describe("3 to 6 dominant colours as hex, most used first"),
      imagery: z.string().describe("Photography or illustration style, crops, treatment"),
      motion: z.string().describe("Any motion the still implies: marquees, parallax layers, reveals, hover states. 'none visible' if none"),
      components: z.array(z.string()).describe("Standout components worth borrowing as ideas, e.g. 'pill navigation', 'oversized numbered list', 'sticker badge on hero image'"),
    }),
  ),
});

type Notes = z.infer<typeof NotesSchema>["images"];

const BriefSchema = z.object({
  feel: z.string().describe("Two or three sentences on the overall feel the references share"),
  emotion: z.array(z.string()).describe("3 to 5 single words"),
  layoutPatterns: z.array(z.string()).describe("3 to 5 recurring layout patterns"),
  grid: z.string(),
  spacing: z.string(),
  typeStyle: z.string(),
  palette: z.array(z.object({ hex, role: z.string().describe("e.g. background, text, accent, secondary surface") })),
  imageryStyle: z.string(),
  motionCues: z.array(z.string()),
  standoutComponents: z.array(z.string()),
  direction: z.object({
    name: z.string().describe("Two-word name for this direction, your own invention"),
    mood: z.string().describe("One or two sentences, like the library's directions"),
    colors: z.object({ bg: hex, bg2: hex, ink: hex, muted: hex, accent: hex, accentInk: hex }),
    displayFont: z.string(),
    displayWeight: z.number(),
    bodyFont: z.string(),
    displayCase: z.enum(["none", "uppercase"]),
    displayTracking: z.string().describe("CSS letter-spacing for headlines, e.g. -0.03em"),
    radius: z.number().describe("Corner radius in px, 0 to 32"),
    motionScale: z.number().describe("0.8 (snappy) to 1.5 (slow and calm)"),
    primaryEase: z.enum(["draft", "build", "snap"]),
    signatureMoves: z.array(z.string()).describe("Up to 3 motion moves from the motion system that suit the references"),
    imageStyle: z.string().describe("Photography direction for generated images, in sentences"),
  }),
  components: ComponentsSchema,
  componentsToBuild: z
    .array(z.object({ part: z.string().describe("hero, nav, cards, gallery, CTA or standout"), build: z.string().describe("What to build and why it fits the references") }))
    .describe("One entry per part"),
});

export type MoodBrief = z.infer<typeof BriefSchema>;

export interface ReferenceBrief {
  project: string;
  refsHash: string;
  references: number;
  brief: MoodBrief;
  direction: Direction;
  /** Set once the built site has been compared with the references. */
  comparison?: { overall: number; refined: boolean; summary: string };
}

/** Turn the model's direction into a library Direction, with real font stacks. */
export function toDirection(b: MoodBrief, brand: Brand, layout: "onepage" | "store", project: string): Direction {
  const fonts = loadFonts();
  const d = b.direction;
  const fallback = (name: string) => (/serif/i.test(fonts[name]?.kind ?? "") && !/sans/i.test(fonts[name]?.kind ?? "") ? "Georgia,serif" : "system-ui,sans-serif");
  const stack = (name: string) => `"${name}",${fallback(name)}`;
  const bodyWeights = (fonts[d.bodyFont]?.weights ?? [400]).filter((w) => w <= 600).slice(0, 3);
  return DirectionSchema.parse({
    id: `ref-${project}`,
    name: d.name,
    brands: [brand.id],
    layout,
    mood: d.mood,
    bestFor: `Projects in the spirit of the "${project}" references.`,
    colors: d.colors,
    fonts: {
      display: { family: d.displayFont, weights: String(d.displayWeight), stack: stack(d.displayFont) },
      body: { family: d.bodyFont, weights: (bodyWeights.length ? bodyWeights : [400]).join(";"), stack: stack(d.bodyFont) },
    },
    display: { case: d.displayCase, weight: d.displayWeight, tracking: d.displayTracking },
    radius: Math.round(Math.min(Math.max(d.radius, 0), 32)),
    motionScale: Math.min(Math.max(d.motionScale, 0.8), 1.5),
    primaryEase: d.primaryEase,
    signatureMoves: d.signatureMoves.slice(0, 3),
    imageStyle: d.imageStyle,
    components: b.components,
    source: `references/${project}`,
  });
}

/** Rules a derived direction must meet. Returned as feedback Claude can act on. */
export function briefProblems(b: MoodBrief, brand: Brand, layout: "onepage" | "store", project: string): string[] {
  const fonts = loadFonts();
  const p: string[] = [];
  for (const [role, name] of [["displayFont", b.direction.displayFont], ["bodyFont", b.direction.bodyFont]] as const) {
    if (!fonts[name]) p.push(`${role} "${name}" is not in the allowed font list.`);
  }
  const dw = fonts[b.direction.displayFont]?.weights;
  if (dw && !dw.includes(b.direction.displayWeight)) p.push(`${b.direction.displayFont} has no weight ${b.direction.displayWeight}; choose from ${dw.join(", ")}.`);
  if (/^(mono|script|hand)/.test(fonts[b.direction.bodyFont]?.kind ?? "") || /mono|script|handwritten/.test(fonts[b.direction.bodyFont]?.kind ?? "")) {
    p.push("The body font must be an easy-to-read sans or serif, not mono or script.");
  }
  if (!p.length) p.push(...directionContrastProblems(toDirection(b, brand, layout, project)).map((x) => `${x}. Adjust the colour so body text stays readable.`));
  const banned = loadAntiPatterns().bannedPhrases.filter((x) => JSON.stringify(b).toLowerCase().includes(x));
  if (banned.length) p.push(`Remove these phrases: ${banned.join(", ")}.`);
  return p;
}

const fontList = () =>
  Object.entries(loadFonts())
    .map(([name, f]) => `${name} (${f.kind}; weights ${f.weights.join("/")})`)
    .join("; ");

const MOTION_MOVES =
  "S2 ink-fill headline; S4 word scrub on the statement; S6 plotted stack on the FAQ; S8 footer outline wordmark fill; S9 background grid parallax; M01 button fill wipe with press; M07 magnetic primary CTA";

export function designSystemContext(layout: "onepage" | "store"): string {
  return `The studio's design system, which the direction must be expressed in:
- Fonts (Google Fonts, choose exactly from this list): ${fontList()}.
- Colours: bg (page), bg2 (alternate sections), ink (text), muted (secondary text), accent (buttons and a few highlights), accentInk (text on accent). ink and muted on bg and bg2, and accentInk on accent, must each reach 4.5:1 contrast.
- Motion: only the studio motion system. Scale 0.8 (snappy) to 1.5 (calm); primary ease draft, build or snap; signature moves from: ${MOTION_MOVES}.
${
  layout === "onepage"
    ? `- Components (one-page site), one choice each: nav bar | pill | centered; hero split (text beside image) | fullbleed (text over full-screen image) | type (oversized headline, image below); services tabs | cards | list (large numbered rows); gallery bento | strip (sideways scroll) | stack (full-width images); cta card | band (full-width accent band); and up to two standouts from marquee (scrolling text band), badge (round sticker on the hero), big-numbers (oversized outline numerals on the steps).`
    : `- This brand's sites are demo stores on a fixed commerce engine: the structure is set, so the references shape colour, type, radius, motion and imagery. Still fill in "components" (it is kept for reuse on one-page sites).`
}`;
}

function markdown(r: ReferenceBrief): string {
  const b = r.brief;
  const d = r.direction;
  const list = (items: string[]) => items.map((i) => `- ${i}`).join("\n");
  return `# ${r.project}: mood brief

Written from ${r.references} reference image${r.references === 1 ? "" : "s"} in this folder. The references set the feel and structure only: no wording, logos or exact layouts are carried over. Delete this file (and direction.json) to have it rewritten; it is also rewritten whenever the images change.

## Feel
${b.feel}

**Emotion:** ${b.emotion.join(", ")}

## Layout
${list(b.layoutPatterns)}

**Grid:** ${b.grid}

**Spacing:** ${b.spacing}

## Type
${b.typeStyle}

## Colour
${b.palette.map((c) => `- \`${c.hex}\` ${c.role}`).join("\n")}

## Imagery
${b.imageryStyle}

## Motion cues
${list(b.motionCues)}

## Standout components
${list(b.standoutComponents)}

## Design direction: ${d.name}
${d.mood}

| Token | Value |
| --- | --- |
| Background | \`${d.colors.bg}\`, alternate \`${d.colors.bg2}\` |
| Text | \`${d.colors.ink}\`, muted \`${d.colors.muted}\` |
| Accent | \`${d.colors.accent}\` with \`${d.colors.accentInk}\` text |
| Display type | ${d.fonts.display.family} ${d.display.weight}${d.display.case === "uppercase" ? ", uppercase" : ""}, tracking ${d.display.tracking} |
| Body type | ${d.fonts.body.family} |
| Corner radius | ${d.radius}px |
| Motion | scale ${d.motionScale}, primary ease ${d.primaryEase} |
| Signature moves | ${d.signatureMoves.join("; ") || "none"} |
| Photography | ${d.imageStyle} |

## Components to build
${b.componentsToBuild.map((c) => `- **${c.part}:** ${c.build}`).join("\n")}

Recipe: nav \`${d.components?.nav}\`, hero \`${d.components?.hero}\`, services \`${d.components?.services}\`, gallery \`${d.components?.gallery}\`, CTA \`${d.components?.cta}\`${d.components?.standouts.length ? `, standouts \`${d.components.standouts.join("`, `")}\`` : ""}.
${r.comparison ? `\n## Comparison with the built site\nMatch ${r.comparison.overall}/10${r.comparison.refined ? ", after one refinement" : ""}. ${r.comparison.summary}\n` : ""}`;
}

export function saveBrief(dir: string, r: ReferenceBrief): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "brief.md"), markdown(r));
  fs.writeFileSync(path.join(dir, "direction.json"), JSON.stringify(r, null, 2) + "\n");
}

/** The saved brief, if it was written from exactly these images. */
export function loadBrief(dir: string, refsHash: string): ReferenceBrief | undefined {
  const file = path.join(dir, "direction.json");
  if (!fs.existsSync(file)) return undefined;
  try {
    const r = JSON.parse(fs.readFileSync(file, "utf8")) as ReferenceBrief;
    return r.refsHash === refsHash ? { ...r, direction: DirectionSchema.parse(r.direction) } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Look at every reference image, then write the mood brief, design tokens, direction and
 * component list. Runs on Claude Code, which opens the images with its Read tool.
 */
export async function analyseReferences(
  refs: PreparedRefs,
  dir: string,
  project: string,
  brand: Brand,
  layout: "onepage" | "store",
  siteBrief: string,
): Promise<ReferenceBrief> {
  if (llmBackend() !== "claude-code") throw new Error("Reference analysis needs the Claude Code backend (it reads the image files). Remove LLM=api.");
  const cached = loadBrief(dir, refs.hash);
  if (cached) {
    log(`   using the saved brief (references unchanged)`);
    return cached;
  }

  const notes: Notes = [];
  for (let i = 0; i < refs.files.length; i += BATCH) {
    const chunk = refs.files.slice(i, i + BATCH).map((f) => path.basename(f));
    const r = await step(`study references ${i + 1}-${i + chunk.length}`, () =>
      generate({
        label: "reference notes",
        schema: NotesSchema,
        system: `You are a design director studying visual references a client saved for a new website. ${NO_COPY}`,
        prompt: `Open each of these image files with the Read tool and note what makes it work:\n${chunk.map((f) => `- ${f}`).join("\n")}\n\nReturn one entry per file, using the file name exactly as given.`,
        effort: "medium",
        readDir: refs.cacheDir,
        check: (n) => chunk.filter((f) => !n.images.some((x) => x.file === f)).map((f) => `Missing entry for ${f}`),
      }),
    );
    notes.push(...r.images);
  }

  const brief = await step("write mood brief", () =>
    generate({
      label: "mood brief",
      schema: BriefSchema,
      system: `You are the design lead at ${brand.name}. ${brand.about}

You turn a client's saved references into a mood brief and a design direction for a new site. Capture what the references share: the feel and the structure. ${NO_COPY} The new site must be its own thing: borrow the spirit, never an exact layout.

${designSystemContext(layout)}`,
      prompt: `The site to design: ${siteBrief}

Notes on the ${notes.length} reference images:
${JSON.stringify(notes, null, 1)}

Write the mood brief, the design direction in the studio's tokens, the component recipe, and the list of components to build (hero, nav, cards, gallery, CTA, and any standout).`,
      effort: "high",
      check: (b) => briefProblems(b, brand, layout, project),
    }),
  );

  const result: ReferenceBrief = { project, refsHash: refs.hash, references: refs.count, brief, direction: toDirection(brief, brand, layout, project) };
  saveBrief(dir, result);
  log(`   brief saved: ${path.join(dir, "brief.md")}`);
  return result;
}

export { BriefSchema };
