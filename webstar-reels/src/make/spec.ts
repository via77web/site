import { directionsFor, loadAntiPatterns, type Direction } from "../../library/index.js";
import { OnePageSpecSchema, StoreSpecSchema, specProblems, type OnePageSpec, type StoreSpec } from "../../library/spec.js";
import type { Brand } from "../lib/brand.js";
import type { Campaign } from "../lib/calendar.js";
import { generate } from "../lib/llm.js";

export type Layout = "onepage" | "store";
export type AnySpec = OnePageSpec | StoreSpec;

export function layoutFor(brand: Brand): Layout {
  const layouts = new Set(directionsFor(brand.id).map((d) => d.layout));
  if (layouts.size !== 1) throw new Error(`Directions for ${brand.id} mix layouts; each brand needs one layout`);
  return [...layouts][0];
}

const LAYOUT_BRIEF: Record<Layout, string> = {
  onepage:
    "A one-page website for a small local business: hero, a statement, services (shown as tabs), a showcase with an image, three steps, a small gallery, an FAQ and a closing call to action. It is a concept: the business is fictional and the site says so.",
  store:
    "A demo online store on a shared commerce engine: full-bleed hero, a statement, a filterable collection of exactly four products, a featured product page with options, a three-step story, a journal gallery, three values and a newsletter. It is a concept store: the brand is fictional, checkout is a demonstration, and the site says so.",
};

function systemPrompt(brand: Brand, layout: Layout, directions: Direction[], campaign: Campaign | undefined): string {
  const anti = loadAntiPatterns();
  return `You are the design lead at ${brand.name}. ${brand.about}

You turn a one-line brief into a complete concept site: you choose a design direction from the studio's library, invent a fictional business that fits the brief, and write every word on the page. Your sites are used to show ${brand.audience.toLowerCase()} what ${brand.name} can do.

What you are making: ${LAYOUT_BRIEF[layout]}

Design directions you may use (pick exactly one by id):
${directions.map((d) => `- ${d.id}: ${d.name}. ${d.mood} Best for: ${d.bestFor}`).join("\n")}

Copy:
- Write in Australian English, for an Australian audience. Set the business in a real Australian suburb or city that fits the brief.
- Invent an original business name. Never use the name of a real company or brand.
- Headlines are specific to this business. Short sentences. Concrete details over adjectives.
- Never use these phrases: ${anti.bannedPhrases.join(", ")}.
${anti.rules.map((r) => `- ${r}`).join("\n")}
${layout === "store" ? "- Prices are realistic for the category in Australian dollars, whole dollars only." : "- No prices on the page."}
${campaign ? `\nThis site is part of the ${campaign.name} campaign. ${campaign.angle} Let it shape the business and the copy without turning the page into an advert for a sale.\n` : ""}
Images: list every image the page uses. Each has a subject, scene and lighting written as plain descriptive sentences for a photographer; the chosen direction's photography style is added for you. No text, signage, logos or packaging labels in any image. Real-looking people are fine, but never a recognisable real person.`;
}

export interface SpecResult {
  spec: AnySpec;
  direction: Direction;
  layout: Layout;
}

const banned = (text: string) => {
  const lower = text.toLowerCase();
  return loadAntiPatterns().bannedPhrases.filter((p) => lower.includes(p));
};

/** Problems in a spec, as feedback Claude can act on. */
function problems(spec: AnySpec, layout: Layout, directions: Direction[]): string[] {
  const p = specProblems(spec, layout);
  if (!directions.some((d) => d.id === spec.directionId)) {
    p.push(`directionId "${spec.directionId}" is not one of: ${directions.map((d) => d.id).join(", ")}`);
  }
  const { images, ...copy } = spec as AnySpec & { images: unknown };
  const hits = banned(JSON.stringify(copy));
  if (hits.length) p.push(`Remove these banned phrases from the copy: ${hits.join(", ")}`);
  return p;
}

async function ask(
  brand: Brand,
  layout: Layout,
  directions: Direction[],
  campaign: Campaign | undefined,
  prompt: string,
): Promise<SpecResult> {
  const schema = layout === "store" ? StoreSpecSchema : OnePageSpecSchema;
  const spec = (await generate({
    label: `site spec (${brand.id})`,
    schema: schema as typeof OnePageSpecSchema,
    system: systemPrompt(brand, layout, directions, campaign),
    prompt,
    effort: "high",
    check: (s) => problems(s, layout, directions),
  })) as AnySpec;
  return { spec, direction: directions.find((d) => d.id === spec.directionId)!, layout };
}

/** Pick a direction and write the whole site from a one-line brief. */
export async function writeSpec(brand: Brand, brief: string, campaign: Campaign | undefined): Promise<SpecResult> {
  const layout = layoutFor(brand);
  const directions = directionsFor(brand.id);
  return ask(brand, layout, directions, campaign, `Brief: ${brief}`);
}

/** Fix a spec after the audit. Image ids are kept so existing images are reused. */
export async function reviseSpec(
  brand: Brand,
  previous: SpecResult,
  brief: string,
  issues: string[],
  campaign: Campaign | undefined,
): Promise<SpecResult> {
  const directions = directionsFor(brand.id).filter((d) => d.id === previous.direction.id);
  return ask(
    brand,
    previous.layout,
    directions,
    campaign,
    `Brief: ${brief}

Here is the site you wrote:
${JSON.stringify(previous.spec)}

The design and accessibility audit of the built page found these problems:
${issues.map((i) => `- ${i}`).join("\n")}

Return the complete spec with these fixed. Keep the same direction, business and image ids; change only what the problems need.`,
  );
}
