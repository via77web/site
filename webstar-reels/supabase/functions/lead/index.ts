// Receives enquiries (and direct-link clicks) from the site snippet in tracking/track.js.
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST, OPTIONS" };
const clip = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return new Response("POST only", { status: 405, headers: cors });
  const raw = await req.text();
  if (raw.length > 8000) return new Response("Too large", { status: 413, headers: cors });
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("Bad JSON", { status: 400, headers: cors });
  }
  const type = body.type === "click" ? "click" : body.type === "enquiry" ? "enquiry" : null;
  const linkId = clip(body.r, 200);
  if (!type) return new Response("Unknown type", { status: 400, headers: cors });

  // The link decides the brand, so a made-up brand can't be written. Without a link, the brand must already exist.
  let brand = clip(body.brand, 40);
  let reelId: string | null = null;
  if (linkId) {
    const { data: link } = await db.from("tracked_links").select("brand, reel_id").eq("id", linkId).maybeSingle();
    if (link) {
      brand = link.brand;
      reelId = link.reel_id;
    }
  }
  if (!brand) return new Response("Unknown brand", { status: 400, headers: cors });
  const { count } = await db.from("tracked_links").select("id", { count: "exact", head: true }).eq("brand", brand);
  if (!count) return new Response("Unknown brand", { status: 400, headers: cors });

  const utm: Record<string, string> = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) {
    const v = clip((body.utm as Record<string, unknown> | undefined)?.[k], 120);
    if (v) utm[k] = v;
  }
  const { error } = await db.from("lead_events").insert({
    type,
    brand,
    link_id: linkId,
    reel_id: reelId,
    platform: utm.utm_source ?? null,
    utm,
    email: type === "enquiry" ? clip(body.email, 200) : null,
    name: type === "enquiry" ? clip(body.name, 120) : null,
    message: type === "enquiry" ? clip(body.message, 2000) : null,
    meta: { page: clip(body.page, 300) },
  });
  if (error) return new Response("Could not save", { status: 500, headers: cors });
  return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, "content-type": "application/json" } });
});
