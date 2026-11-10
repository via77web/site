// Stripe webhook: records a deposit against the reel that brought the customer.
// Listen for checkout.session.completed. The reel comes from client_reference_id, which the
// site snippet adds to Stripe Payment Links.
import Stripe from "npm:stripe@^17";
import { createClient } from "npm:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!);
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

Deno.serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("No signature", { status: 400 });
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      await req.text(),
      signature,
      Deno.env.get("STRIPE_WEBHOOK_SECRET")!,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch {
    return new Response("Bad signature", { status: 400 });
  }
  if (event.type !== "checkout.session.completed") return new Response("ignored");

  const s = event.data.object as Stripe.Checkout.Session;
  if (s.payment_status !== "paid") return new Response("not paid");
  const linkId = s.client_reference_id ?? (s.metadata?.r as string | undefined) ?? null;
  let brand = (s.metadata?.brand as string | undefined) ?? null;
  let reelId: string | null = null;
  if (linkId) {
    const { data: link } = await db.from("tracked_links").select("brand, reel_id").eq("id", linkId).maybeSingle();
    if (link) {
      brand = link.brand;
      reelId = link.reel_id;
    }
  }
  // A payment with no link and no brand metadata still gets recorded, as unattributed.
  const { error } = await db.from("lead_events").upsert(
    {
      type: "deposit",
      brand: brand ?? "unknown",
      link_id: linkId,
      reel_id: reelId,
      platform: "stripe",
      email: s.customer_details?.email ?? null,
      name: s.customer_details?.name ?? null,
      amount_cents: s.amount_total,
      currency: s.currency,
      stripe_session_id: s.id,
    },
    { onConflict: "stripe_session_id", ignoreDuplicates: true },
  );
  return error ? new Response("Could not save", { status: 500 }) : new Response("ok");
});
