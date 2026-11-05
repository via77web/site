// Tells the enquiry form whether delivery is configured. Never exposes a secret:
// the Turnstile site key is public by design.
const REQUIRED = ['TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY', 'RESEND_API_KEY', 'ENQUIRY_TO', 'ENQUIRY_FROM'];

export function onRequestGet({ env }) {
  const enabled = REQUIRED.every((name) => Boolean(env[name]));
  return new Response(JSON.stringify({ enabled, siteKey: enabled ? env.TURNSTILE_SITE_KEY : null }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex',
    },
  });
}
