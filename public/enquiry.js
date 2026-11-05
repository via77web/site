'use strict';
// Enquiry form. Answers stay in the page until sent; nothing goes to browser storage or analytics.
document.querySelectorAll('.enquiry-form').forEach((form) => {
  const type = form.dataset.form;
  const submit = form.querySelector('.form-submit');
  const summary = form.querySelector('.form-error');
  const result = form.querySelector('.form-result');
  const note = form.querySelector('.delivery-note');
  const holder = form.querySelector('.security-check');
  const track = (name) => window.VIA77Analytics && window.VIA77Analytics.track(name, { type });
  let delivery = false;
  let widget = null;
  let token = '';
  let busy = false;
  let started = false;
  let requestId = crypto.randomUUID();
  let blobUrl = null;

  function values() {
    const fd = new FormData(form);
    const get = (key) => String(fd.get(key) || '').trim();
    return { type, name: get('name'), email: get('email'), website: get('website'), message: get('message'), project: get('project'), investment: get('investment'), timeline: get('timeline'), company_fax: get('company_fax') };
  }
  function clearErrors() {
    form.querySelectorAll('.field-error').forEach((el) => el.remove());
    form.querySelectorAll('[aria-invalid]').forEach((el) => { el.removeAttribute('aria-invalid'); el.removeAttribute('aria-describedby'); });
    summary.textContent = '';
  }
  function showErrors(errors) {
    clearErrors();
    let first = null;
    for (const [name, message] of Object.entries(errors)) {
      const control = form.querySelector(`[name="${name}"]`);
      if (!control) continue;
      const error = document.createElement('span');
      error.className = 'field-error';
      error.id = `${type}-${name}-error`;
      error.textContent = message;
      control.closest('label').append(error);
      control.setAttribute('aria-invalid', 'true');
      control.setAttribute('aria-describedby', error.id);
      if (!first) first = control;
    }
    const general = Object.entries(errors).filter(([name]) => !form.querySelector(`[name="${name}"]`)).map(([, message]) => message);
    summary.textContent = general.join(' ') || 'Please check the highlighted fields.';
    (first || summary).focus();
  }
  function loadTurnstile(siteKey) {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => {
      widget = window.turnstile.render(holder, {
        sitekey: siteKey,
        action: 'enquiry',
        size: 'flexible',
        callback: (value) => { token = value; },
        'expired-callback': () => { token = ''; },
        'error-callback': () => { token = ''; summary.textContent = 'The security check could not load. Your answers are still here. Please try again.'; },
      });
    };
    script.onerror = () => { summary.textContent = 'The security check could not load. Your answers are still here. Please reload when your connection is back.'; };
    document.head.append(script);
  }
  async function configure() {
    try {
      const response = await fetch('/api/form-config', { cache: 'no-store' });
      if (!response.ok) return;
      const config = await response.json();
      if (!config.enabled || !config.siteKey) return;
      delivery = true;
      submit.querySelector('span').textContent = type === 'assessment' ? 'Request an assessment' : 'Send enquiry';
      note.textContent = 'Your enquiry goes to VIA77. Cloudflare Turnstile checks for spam and Resend delivers the email.';
      holder.hidden = false;
      loadTurnstile(config.siteKey);
    } catch { /* Stays in the truthful download mode when configuration is unavailable. */ }
  }
  function downloadBrief(data) {
    const labels = { name: 'Name', email: 'Email', website: 'Website', project: 'Project type', investment: 'Budget', timeline: 'Timing', message: 'Project description' };
    const lines = ['VIA77 project brief', 'Prepared on your device. Not sent to VIA77.', ''];
    for (const [key, label] of Object.entries(labels)) if (data[key]) lines.push(`${label}: ${data[key]}`);
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }));
    result.replaceChildren();
    const message = document.createElement('p');
    message.textContent = 'Your brief is ready. It has not been sent to VIA77.';
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = `via77-${type}-brief.txt`;
    link.textContent = 'Download your brief ↓';
    link.addEventListener('click', () => track('brief_download'));
    result.append(message, link);
    result.hidden = false;
    result.focus();
  }
  async function send(data) {
    if (!token) { showErrors({ security: 'Complete the security check before sending.' }); return; }
    busy = true;
    submit.disabled = true;
    submit.querySelector('span').textContent = 'Sending…';
    form.setAttribute('aria-busy', 'true');
    let sent = false;
    try {
      const response = await fetch('/api/project', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...data, turnstileToken: token, requestId }),
        signal: AbortSignal.timeout(25000),
      });
      const reply = await response.json();
      if (!response.ok || reply.ok !== true) {
        showErrors(reply.fields || { delivery: reply.error || 'Sending failed. Your answers are still here, so please try again.' });
      } else {
        sent = true;
        result.textContent = 'Thanks. Your enquiry has been accepted for delivery to VIA77.';
        result.hidden = false;
        result.focus();
        track('enquiry_success');
        submit.hidden = true;
      }
    } catch {
      showErrors({ delivery: 'We could not confirm your enquiry was sent. Your answers are still here, so please try again. It will not be sent twice.' });
    } finally {
      busy = false;
      submit.disabled = false;
      form.removeAttribute('aria-busy');
      if (!sent) {
        submit.querySelector('span').textContent = 'Try again';
        token = '';
        if (widget !== null) window.turnstile.reset(widget);
      }
    }
  }
  form.addEventListener('input', () => {
    if (!started) { started = true; track(type === 'assessment' ? 'assessment_start' : 'project_form_start'); }
    requestId = crypto.randomUUID();
    result.hidden = true;
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    const data = values();
    const errors = window.VIA77Validation.validate(data);
    if (Object.keys(errors).length) { showErrors(errors); return; }
    clearErrors();
    if (delivery) await send(data);
    else downloadBrief(data);
  });
  addEventListener('pagehide', () => { if (blobUrl) URL.revokeObjectURL(blobUrl); });
  configure();
});
