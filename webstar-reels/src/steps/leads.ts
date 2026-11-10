import type { Brand } from "../lib/brand.js";
import { env } from "../lib/env.js";
import { brandLinks, reelId, reelUtm } from "../lib/tracking.js";
import type { Batch, BatchVariant } from "../types.js";

/** Lead tracking is on when the Supabase project is configured. */
export const leadsEnabled = () => !!env("SUPABASE_URL") && !!env("SUPABASE_SERVICE_KEY");

async function rest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = env("SUPABASE_SERVICE_KEY")!;
  const res = await fetch(`${env("SUPABASE_URL")!.replace(/\/$/, "")}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : null) as T;
}

const upsert = (table: string, rows: object[]) =>
  rest(table, { method: "POST", headers: { prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows) });

/** Record a reel and its tracked link when it is scheduled, so clicks can be counted from the first minute. */
export async function registerReel(brand: Brand, batch: Batch, variant: BatchVariant, at: Date): Promise<void> {
  if (!leadsEnabled()) return;
  const id = reelId(batch, variant);
  await upsert("reels", [
    {
      id,
      brand: brand.id,
      variant: variant.id,
      hook: variant.hookSource ?? variant.script.hook,
      day: at.toISOString().slice(0, 10),
      scheduled_for: at.toISOString(),
      title: batch.site.name,
    },
  ]);
  await upsert("tracked_links", [
    { id, brand: brand.id, kind: "reel", destination: brand.link, reel_id: id, utm: reelUtm(brand, batch, variant, at) },
  ]);
}

/** Create or refresh each brand's bio and DM links. */
export async function registerBrandLinks(brands: Brand[]): Promise<void> {
  await upsert(
    "tracked_links",
    brands.flatMap((b) => brandLinks(b).map((l) => ({ id: l.id, brand: b.id, kind: l.kind, destination: b.link, reel_id: null, utm: l.utm }))),
  );
}

export interface LeadEvent {
  created_at: string;
  type: "click" | "enquiry" | "deposit";
  brand: string;
  link_id: string | null;
  reel_id: string | null;
  amount_cents: number | null;
}

export async function fetchEvents(since: Date): Promise<LeadEvent[]> {
  if (!leadsEnabled()) return [];
  const all: LeadEvent[] = [];
  for (let from = 0; ; from += 1000) {
    const page = await rest<LeadEvent[]>(
      `lead_events?select=created_at,type,brand,link_id,reel_id,amount_cents&created_at=gte.${since.toISOString()}&order=created_at.asc`,
      { headers: { range: `${from}-${from + 999}` } },
    );
    all.push(...page);
    if (page.length < 1000) return all;
  }
}

/** Write the week's Buffer numbers onto each reel, so the funnel view is complete in Supabase. */
export async function saveMetrics(
  rows: { id: string; views?: number; watch_seconds?: number; shares?: number; reactions?: number; comments?: number }[],
): Promise<void> {
  if (!leadsEnabled() || !rows.length) return;
  for (const r of rows) {
    const { id, ...metrics } = r;
    await rest(`reels?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify({ ...metrics, metrics_updated_at: new Date().toISOString() }),
    });
  }
}
