import { z } from "zod";
import type { Brand } from "./lib/brand.js";
import { loadBatches } from "./lib/batches.js";
import type { Campaign } from "./lib/calendar.js";
import { generate } from "./lib/llm.js";
import { loadBriefs, saveBriefs } from "./lib/queue.js";

/** Top the brief backlog up to `n` pending briefs, with fresh ideas that don't repeat earlier ones. */
export async function ensureBriefs(brand: Brand, n: number, campaign?: Campaign): Promise<void> {
  const briefs = loadBriefs(brand);
  const pending = briefs.filter((b) => b.status === "pending").length;
  if (pending >= n) return;
  const used = [...briefs.map((b) => b.brief), ...loadBatches(brand).map((b) => b.site.brief).filter(Boolean)];
  const { briefs: fresh } = await generate({
    label: `${brand.id} briefs`,
    schema: z.object({ briefs: z.array(z.string()).describe(`Exactly ${n - pending} one-line briefs`) }),
    system: `You plan concept sites for ${brand.name}. ${brand.about} Audience: ${brand.audience}`,
    prompt: `Write ${n - pending} new one-line briefs for concept ${brand.content === "sites" && brand.id === "via77" ? "online stores" : "small-business websites"}, each a different kind of business, set in Australia. Each brief names the business type and one specific detail, like "A mobile dog groomer working across Melbourne's south-east".${campaign ? ` Lean towards the ${campaign.name} campaign: ${campaign.angle}` : ""}

Don't repeat or closely echo any of these:
${used.map((u) => `- ${u}`).join("\n") || "- (none yet)"}`,
    effort: "low",
    check: (r) => (r.briefs.length < n - pending ? [`Need ${n - pending} briefs, got ${r.briefs.length}`] : []),
  });
  saveBriefs(brand, [...briefs, ...fresh.slice(0, n - pending).map((brief) => ({ brief, status: "pending" as const }))]);
}
