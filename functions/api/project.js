// Accepts an enquiry, checks it with Cloudflare Turnstile and hands it to Resend.
// Success is reported only after Resend accepts the message. Enquiry contents are
// never logged or stored here.
import validation from '../../public/form-validation.js';

const MAX_BODY_BYTES = 16 * 1024;
const REQUIRED = ['TURNSTILE_SECRET_KEY', 'RESEND_API_KEY', 'ENQUIRY_TO', 'ENQUIRY_FROM'];
const ALLOWED_HOSTS = /^(www\.)?via77\.com\.au$|^([a-z0-9-]+\.)?via77-site\.pages\.dev$|^localhost$|^127\.0\.0\.1$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RETRY = 'We could not confirm your enquiry was sent. Your answers are still here, so please try again.';

function reply(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex',
    },
  });
}

function sameSite(request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return ALLOWED_HOSTS.test(new URL(origin).hostname);
  } catch {
    return false;
  }
}

function oneLine(value) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').trim();
}

function emailText(data) {
  const label = data.type === 'assessment' ? 'Commerce Assessment request' : 'Project enquiry';
  const rows = [
    ['Name', data.name],
    ['Email', data.email],
    ['Website', data.website],
    ['Project type', data.project],
    ['Budget', data.investment],
    ['Timing', data.timeline],
  ].filter(([, value]) => value);
  return [label, '', ...rows.map(([key, value]) => `${key}: ${oneLine(value)}`), '', 'Project description:', data.message].join('\n');
}

async function turnstilePasses(env, token, ip) {
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET_KEY);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) return false;
  const result = await response.json();
  return result.success === true && (!result.action || result.action === 'enquiry');
}

export async function onRequestPost({ request, env }) {
  if (!REQUIRED.every((name) => Boolean(env[name]))) {
    return reply(503, { ok: false, error: 'Online enquiries are not connected yet.' });
  }
  if (!sameSite(request)) return reply(403, { ok: false, error: 'This request was not accepted.' });
  if (!(request.headers.get('content-type') || '').includes('application/json')) {
    return reply(415, { ok: false, error: 'This request was not accepted.' });
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return reply(413, { ok: false, error: 'That enquiry is too long. Please shorten it and try again.' });
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return reply(400, { ok: false, error: 'This request was not accepted.' });
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return reply(400, { ok: false, error: 'This request was not accepted.' });
  }

  // Filled only by bots. Answer as a normal bot-facing success and send nothing.
  if (data.company_fax) return reply(200, { ok: true });

  const fields = validation.validate(data);
  if (Object.keys(fields).length) return reply(422, { ok: false, fields });

  if (typeof data.requestId !== 'string' || !UUID.test(data.requestId)) {
    return reply(400, { ok: false, error: 'This request was not accepted.' });
  }
  if (typeof data.turnstileToken !== 'string' || !data.turnstileToken) {
    return reply(400, { ok: false, fields: { security: 'Complete the security check before sending.' } });
  }

  try {
    const human = await turnstilePasses(env, data.turnstileToken, request.headers.get('cf-connecting-ip'));
    if (!human) return reply(400, { ok: false, fields: { security: 'The security check did not pass. Please try it again.' } });

    const subject = `${data.type === 'assessment' ? 'Assessment request' : 'New enquiry'}: ${oneLine(data.name).slice(0, 80)}`;
    const delivery = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
        // Resend returns the original response for a repeated key, so a retry cannot send twice.
        'idempotency-key': data.requestId,
      },
      body: JSON.stringify({
        from: env.ENQUIRY_FROM,
        to: [env.ENQUIRY_TO],
        reply_to: oneLine(data.email),
        subject,
        text: emailText(data),
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!delivery.ok) {
      console.error('Enquiry delivery failed with status', delivery.status);
      return reply(502, { ok: false, error: RETRY });
    }
    return reply(200, { ok: true });
  } catch {
    console.error('Enquiry delivery could not be confirmed');
    return reply(502, { ok: false, error: RETRY });
  }
}
