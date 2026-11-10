// Tracked redirect: /functions/v1/go/<link id>?p=<platform>
// Logs a click, then sends the visitor to the brand's page with UTM tags and the reel id.
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const PLATFORMS: Record<string, string> = { ig: "instagram", tt: "tiktok", yt: "youtube", dm: "manychat", bio: "bio" };

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const id = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? "").slice(0, 200);
  const { data: link } = await db.from("tracked_links").select("id, brand, kind, destination, reel_id, utm").eq("id", id).maybeSingle();
  if (!link) return new Response("Link not found", { status: 404 });

  const platform = PLATFORMS[url.searchParams.get("p") ?? ""] ?? (link.kind === "reel" ? "social" : link.kind);
  const utm = { ...(link.utm as Record<string, string>), utm_source: platform };
  // Don't hold up the redirect on the insert, and skip obvious link-preview bots.
  const agent = req.headers.get("user-agent") ?? "";
  if (!/bot|crawler|spider|preview|facebookexternalhit|slackbot|whatsapp/i.test(agent)) {
    await db.from("lead_events").insert({ type: "click", brand: link.brand, link_id: link.id, reel_id: link.reel_id, platform, utm });
  }

  const dest = new URL(link.destination);
  for (const [k, v] of Object.entries(utm)) if (v) dest.searchParams.set(k, String(v));
  dest.searchParams.set("r", link.id); // the site snippet keeps this for forms and Stripe
  dest.searchParams.set("g", "1"); // tells the snippet this click is already logged
  return Response.redirect(dest.toString(), 302);
});
