// Tells the enquiry form whether delivery is configured. Never exposes a secret:
// the Turnstile site key is public by design.

export function onRequestGet({ env }) {
  const canStore = env.SUPABASE_URL && env.SUPABASE_SECRET_KEY;
  const canEmail = env.RESEND_API_KEY && env.ENQUIRY_TO && env.ENQUIRY_FROM;
  const enabled = Boolean(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY && (canStore || canEmail));
  return new Response(JSON.stringify({ enabled, siteKey: enabled ? env.TURNSTILE_SITE_KEY : null }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex',
    },
  });
}
