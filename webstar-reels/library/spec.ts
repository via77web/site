import { z } from "zod";

/**
 * The site specs Claude writes for `npm run make`. Everything is required (empty strings and
 * empty lists are allowed) so the schema works with structured outputs; sizes are checked after.
 */

export const ASPECTS = ["16:9", "4:5", "1:1", "3:4", "9:16"] as const;

export const SiteImageSchema = z.object({
  id: z.string().describe("Short kebab-case id, referenced by sections"),
  alt: z.string().describe("Alt text describing the image for a screen reader user"),
  aspect: z.enum(ASPECTS),
  subject: z.string().describe("The main focal point"),
  scene: z.string().describe("Location, composition and surroundings"),
  lighting: z.string().describe("Lighting set-up and atmosphere"),
});

const Item = z.object({ title: z.string(), body: z.string() });

export const OnePageSpecSchema = z.object({
  directionId: z.string(),
  directionReason: z.string().describe("One sentence on why this direction suits the brief"),
  businessName: z.string(),
  category: z.string().describe("Short lowercase business type, e.g. 'sourdough bakery' or 'mobile dog groomer'"),
  tagline: z.string(),
  metaTitle: z.string(),
  metaDescription: z.string(),
  location: z.string().describe("Suburb and city the concept business is set in"),
  hero: z.object({ eyebrow: z.string(), headline: z.string(), sub: z.string(), cta: z.string(), imageId: z.string() }),
  statement: z.string().describe("One or two sentences. Wrap the key phrase in *asterisks* for emphasis"),
  services: z.object({ title: z.string(), intro: z.string(), items: z.array(Item).describe("3 or 4 services") }),
  showcase: z.object({
    title: z.string(),
    body: z.string(),
    imageId: z.string(),
    points: z.array(z.string()).describe("3 short points"),
  }),
  steps: z.object({ title: z.string(), items: z.array(Item).describe("3 steps") }),
  gallery: z.object({ title: z.string(), imageIds: z.array(z.string()).describe("3 or 4 image ids") }),
  faq: z.object({ title: z.string(), items: z.array(z.object({ q: z.string(), a: z.string() })).describe("4 questions") }),
  cta: z.object({ headline: z.string(), body: z.string(), button: z.string() }),
  images: z.array(SiteImageSchema).describe("Every image referenced above, 5 to 7 in total"),
});

export type OnePageSpec = z.infer<typeof OnePageSpecSchema>;

const Product = z.object({
  id: z.string().describe("kebab-case"),
  name: z.string(),
  type: z.string().describe("Short material or format line, e.g. 'Oak / Natural cord'"),
  cat: z.string().describe("One of the collection category ids"),
  price: z.number().describe("Whole dollars"),
  desc: z.string(),
  imageId: z.string(),
  optionLabel: z.string().describe("e.g. Size, Finish, Colour"),
  options: z
    .array(z.object({ v: z.string(), price: z.number().describe("0 means the base price") }))
    .describe("2 options"),
  details: z.array(z.object({ k: z.string(), v: z.string() })).describe("3 or 4 detail rows"),
});

export const StoreSpecSchema = z.object({
  directionId: z.string(),
  directionReason: z.string().describe("One sentence on why this direction suits the brief"),
  storeName: z.string().describe("Short, ownable, not an existing brand"),
  tagline: z.string(),
  category: z.string(),
  metaTitle: z.string(),
  metaDescription: z.string(),
  shipThreshold: z.number().describe("Free delivery threshold in dollars"),
  shipFee: z.number(),
  hero: z.object({
    lines: z.array(z.string()).describe("The headline split into 2 or 3 short lines"),
    sub: z.string(),
    cta: z.string(),
    imageId: z.string(),
  }),
  statement: z.string().describe("One or two sentences. Wrap the key word in *asterisks*"),
  collection: z.object({
    title: z.string(),
    intro: z.string(),
    categories: z.array(z.object({ id: z.string(), label: z.string() })).describe("2 to 4 categories"),
  }),
  products: z.array(Product).describe("Exactly 4 products"),
  story: z.object({
    label: z.string(),
    steps: z.array(z.object({ title: z.string(), body: z.string(), imageId: z.string() })).describe("3 steps"),
  }),
  journal: z.object({ title: z.string(), imageIds: z.array(z.string()).describe("4 to 6 image ids") }),
  values: z.array(Item).describe("3 values"),
  newsletter: z.object({ title: z.string(), body: z.string() }),
  images: z.array(SiteImageSchema).describe("Every image referenced above, 6 to 8 in total"),
});

export type StoreSpec = z.infer<typeof StoreSpecSchema>;
export type SiteImage = z.infer<typeof SiteImageSchema>;

/** Size and reference checks the schema can't express. Returned as feedback Claude can act on. */
export function specProblems(spec: OnePageSpec | StoreSpec, layout: "onepage" | "store"): string[] {
  const p: string[] = [];
  const ids = new Set(spec.images.map((i) => i.id));
  const need = (id: string, where: string) => {
    if (!ids.has(id)) p.push(`${where} uses image "${id}", which is not in images[]`);
  };
  const range = (n: number, lo: number, hi: number, what: string) => {
    if (n < lo || n > hi) p.push(`${what} has ${n}; it needs ${lo === hi ? lo : `${lo} to ${hi}`}`);
  };
  if (layout === "onepage") {
    const s = spec as OnePageSpec;
    need(s.hero.imageId, "hero");
    need(s.showcase.imageId, "showcase");
    s.gallery.imageIds.forEach((id) => need(id, "gallery"));
    range(s.services.items.length, 3, 4, "services.items");
    range(s.steps.items.length, 3, 3, "steps.items");
    range(s.faq.items.length, 3, 5, "faq.items");
    range(s.gallery.imageIds.length, 3, 4, "gallery.imageIds");
    range(s.images.length, 4, 8, "images");
    if (s.hero.headline.length > 70) p.push("hero.headline is too long for a phone; keep it under 70 characters");
  } else {
    const s = spec as StoreSpec;
    need(s.hero.imageId, "hero");
    s.products.forEach((x) => need(x.imageId, `product ${x.id}`));
    s.story.steps.forEach((x) => need(x.imageId, "story"));
    s.journal.imageIds.forEach((id) => need(id, "journal"));
    range(s.products.length, 4, 4, "products");
    range(s.hero.lines.length, 2, 3, "hero.lines");
    range(s.story.steps.length, 3, 3, "story.steps");
    range(s.values.length, 3, 3, "values");
    range(s.images.length, 5, 9, "images");
    const cats = new Set(s.collection.categories.map((c) => c.id));
    s.products.forEach((x) => {
      if (!cats.has(x.cat)) p.push(`product ${x.id} has category "${x.cat}", which is not in collection.categories`);
      range(x.options.length, 2, 2, `product ${x.id} options`);
    });
    if (new Set(s.products.map((x) => x.id)).size !== s.products.length) p.push("product ids must be unique");
  }
  if (new Set(spec.images.map((i) => i.id)).size !== spec.images.length) p.push("image ids must be unique");
  return p;
}
