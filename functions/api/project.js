// Accepts an enquiry, checks it with Cloudflare Turnstile, saves it to Supabase for the
// directors' dashboard and emails a notification through Resend. Success is reported only
// after at least one of those is confirmed. Enquiry contents are never logged.
import validation from '../../public/form-validation.js';

const MAX_BODY_BYTES = 16 * 1024;
const canStore = (env) => Boolean(env.SUPABASE_URL && env.SUPABASE_SECRET_KEY);
const canEmail = (env) => Boolean(env.RESEND_API_KEY && env.ENQUIRY_TO && env.ENQUIRY_FROM);
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

async function attempt(task, name) {
  try {
    const response = await task();
    if (response.ok) return true;
    console.error(`Enquiry ${name} failed with status`, response.status);
  } catch {
    console.error(`Enquiry ${name} could not be confirmed`);
  }
  return false;
}

function supabaseHeaders(env, extra) {
  return { apikey: env.SUPABASE_SECRET_KEY, authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`, 'content-type': 'application/json', ...extra };
}

function saveEnquiry(env, data, suspected) {
  const optional = (value) => oneLine(value) || null;
  // A repeated request id is ignored, so a retry cannot create a second enquiry.
  return fetch(`${env.SUPABASE_URL}/rest/v1/enquiries?on_conflict=request_id`, {
    method: 'POST',
    headers: supabaseHeaders(env, { prefer: 'resolution=ignore-duplicates,return=minimal' }),
    body: JSON.stringify({
      request_id: data.requestId,
      type: data.type,
      name: oneLine(data.name),
      email: oneLine(data.email),
      website: optional(data.website),
      message: data.message.trim(),
      project: optional(data.project),
      budget: optional(data.investment),
      timeline: optional(data.timeline),
      ...(suspected ? { status: 'spam' } : {}),
    }),
    signal: AbortSignal.timeout(8000),
  });
}

function markEmailed(env, requestId) {
  return fetch(`${env.SUPABASE_URL}/rest/v1/enquiries?request_id=eq.${requestId}`, {
    method: 'PATCH',
    headers: supabaseHeaders(env, { prefer: 'return=minimal' }),
    body: JSON.stringify({ email_delivered: true }),
    signal: AbortSignal.timeout(5000),
  });
}

function sendEmail(env, data) {
  const subject = `${data.type === 'assessment' ? 'Assessment request' : 'New enquiry'}: ${oneLine(data.name).slice(0, 80)}`;
  return fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
      // Resend returns the original response for a repeated key, so a retry cannot send twice.
      'idempotency-key': data.requestId,
    },
    body: JSON.stringify({ from: env.ENQUIRY_FROM, to: [env.ENQUIRY_TO], reply_to: oneLine(data.email), subject, text: emailText(data) }),
    signal: AbortSignal.timeout(12000),
  });
}

export async function onRequestPost({ request, env }) {
  if (!env.TURNSTILE_SECRET_KEY || !env.TURNSTILE_SITE_KEY || !(canStore(env) || canEmail(env))) {
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

  const fields = validation.validate(data);
  if (Object.keys(fields).length) return reply(422, { ok: false, fields });

  if (typeof data.requestId !== 'string' || !UUID.test(data.requestId)) {
    return reply(400, { ok: false, error: 'This request was not accepted.' });
  }
  if (typeof data.turnstileToken !== 'string' || !data.turnstileToken) {
    return reply(400, { ok: false, fields: { security: 'Complete the security check before sending.' } });
  }

  let human;
  try {
    human = await turnstilePasses(env, data.turnstileToken, request.headers.get('cf-connecting-ip'));
  } catch {
    console.error('Security check could not be completed');
    return reply(502, { ok: false, error: RETRY });
  }
  if (!human) return reply(400, { ok: false, fields: { security: 'The security check did not pass. Please try it again.' } });

  // The hidden field is normally only filled by bots, but browser autofill can fill it too.
  // Keep the enquiry under Spam so a real person is never silently lost, and skip the email.
  const suspected = Boolean(data.leave_blank || data.company_fax);
  const stored = canStore(env) && (await attempt(() => saveEnquiry(env, data, suspected), 'storage'));
  if (suspected) return stored ? reply(200, { ok: true }) : reply(502, { ok: false, error: RETRY });
  const emailed = canEmail(env) && (await attempt(() => sendEmail(env, data), 'email'));
  if (stored && emailed) await attempt(() => markEmailed(env, data.requestId), 'email flag');

  return stored || emailed ? reply(200, { ok: true }) : reply(502, { ok: false, error: RETRY });
}
