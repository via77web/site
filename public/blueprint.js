'use strict';
// An allowlisted analytics boundary. No names, email addresses, URLs or free text.
// Events reach dataLayer only if an analytics tool is added and consent is given.
const allowedEvents = new Set(['hero_cta', 'solution_view', 'case_study_view', 'case_study_cta', 'demo_open', 'assessment_start', 'enquiry_success', 'brief_download', 'project_form_start', 'email_click', 'phone_click', 'insight_cta']);
window.VIA77Analytics = Object.freeze({
  track(name, properties = {}) {
    if (!allowedEvents.has(name)) return;
    const detail = { event: name, path: location.pathname };
    for (const key of ['step', 'mode', 'type']) if (['string', 'number'].includes(typeof properties[key])) detail[key] = properties[key];
    window.dispatchEvent(new CustomEvent('via77:analytics', { detail }));
    if (window.VIA77_ANALYTICS_CONSENT === true && Array.isArray(window.dataLayer)) window.dataLayer.push(detail);
  },
});
document.querySelectorAll('[data-event]').forEach((el) => el.addEventListener('click', () => window.VIA77Analytics.track(el.dataset.event)));
const depth = location.pathname.split('/').filter(Boolean).length;
if (location.pathname.startsWith('/solutions/') && depth > 1) window.VIA77Analytics.track('solution_view');
if (location.pathname.startsWith('/work/') && depth > 1) window.VIA77Analytics.track('case_study_view');
document.querySelectorAll('a[href^="mailto:"]').forEach((a) => a.addEventListener('click', () => window.VIA77Analytics.track('email_click')));
document.querySelectorAll('a[href^="tel:"]').forEach((a) => a.addEventListener('click', () => window.VIA77Analytics.track('phone_click')));
