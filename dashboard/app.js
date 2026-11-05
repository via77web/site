'use strict';
// VIA77 directors' dashboard. Customer text is untrusted, so it is only ever written
// with textContent. Access is enforced by row-level security in Supabase.
const { supabaseUrl, supabaseKey } = window.VIA77_CONFIG;
const db = window.supabase.createClient(supabaseUrl, supabaseKey, { auth: { flowType: 'implicit', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
const app = document.getElementById('app');

const PIPELINE = [['new', 'New'], ['contacted', 'Contacted'], ['qualified', 'Qualified'], ['proposal', 'Proposal'], ['won', 'Won']];
const CLOSED = ['won', 'lost', 'spam'];
const VIEWS = [
  { group: null, items: [['reply', 'Needs a reply', (e) => e.status === 'new'], ['open', 'All open', (e) => !CLOSED.includes(e.status)], ['mine', 'Mine', (e, me) => e.owner_email === me && !CLOSED.includes(e.status)]] },
  { group: 'In progress', items: [['contacted', 'Contacted', (e) => e.status === 'contacted'], ['qualified', 'Qualified', (e) => e.status === 'qualified'], ['proposal', 'Proposal', (e) => e.status === 'proposal']] },
  { group: 'Closed', items: [['won', 'Won', (e) => e.status === 'won'], ['lost', 'Lost', (e) => e.status === 'lost'], ['spam', 'Spam', (e) => e.status === 'spam']] },
];
const ALL_VIEWS = VIEWS.flatMap((g) => g.items);
const state = { user: null, me: '', enquiries: [], directors: [], notes: [], view: 'reply', search: '', selected: null, noteDraft: '', justOpened: false };

// ---------- Helpers ----------
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else if (key === 'k') el.dataset.k = value;
    else if (key in el && !key.startsWith('aria') && key !== 'role') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) el.append(child);
  return el;
}
function toast(message) {
  document.querySelector('.toast')?.remove();
  const t = h('div', { class: 'toast', role: 'alert' }, message);
  document.body.append(t);
  setTimeout(() => t.remove(), 6000);
}
function age(value) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(value)) / 60000));
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.round(mins / 60)}h`;
  if (mins < 43200) return `${Math.round(mins / 1440)}d`;
  return new Date(value).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}
function ageWords(value) {
  const days = Math.floor((Date.now() - new Date(value)) / 86400000);
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'}`;
  const hours = Math.floor((Date.now() - new Date(value)) / 3600000);
  return hours >= 1 ? `${hours} hour${hours === 1 ? '' : 's'}` : 'under an hour';
}
const fullDate = (value) => new Date(value).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
function safeUrl(raw) {
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}
const directorName = (email) => state.directors.find((d) => d.email === email)?.name || (email || '').split('@')[0];
const initial = (email) => directorName(email).charAt(0).toUpperCase();

// ---------- Theme ----------
function themeControl(prefix = '') {
  let saved = 'system';
  try { saved = localStorage.getItem('via77-theme') || 'system'; } catch {}
  const set = (value) => {
    try { value === 'system' ? localStorage.removeItem('via77-theme') : localStorage.setItem('via77-theme', value); } catch {}
    if (value === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', value);
    render();
  };
  return h('div', { class: 'theme', role: 'radiogroup', 'aria-label': 'Colour theme' }, [['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([value, text]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(saved === value), k: `${prefix}theme-${value}`, onclick: () => set(value) }, text)));
}

// ---------- Sign in ----------
function loginView(message) {
  const email = h('input', { type: 'email', name: 'email', required: true, autocomplete: 'email', autofocus: true });
  const msg = h('p', { class: 'form-msg', role: 'status' }, message || '');
  const button = h('button', { class: 'btn', type: 'submit' }, 'Email me a sign-in link', h('span', { 'aria-hidden': 'true' }, '↗'));
  const form = h('form', { onsubmit: async (event) => {
    event.preventDefault();
    button.disabled = true;
    msg.className = 'form-msg';
    msg.textContent = 'Sending…';
    const { error } = await db.auth.signInWithOtp({ email: email.value.trim().toLowerCase(), options: { emailRedirectTo: `${location.origin}/` } });
    button.disabled = false;
    msg.className = error ? 'form-msg bad' : 'form-msg good';
    msg.textContent = error ? 'We could not send a link. Check this email is approved, or wait a minute and try again.' : 'Check your email. The link signs you in on this device.';
  } }, h('label', { class: 'field' }, h('span', {}, 'Director email'), email), button, msg);
  app.replaceChildren(h('main', { class: 'login' },
    h('section', { class: 'login-art' }, h('img', { src: '/assets/via77-logo-black.svg', alt: 'VIA77', width: 92, height: 22 }),
      h('div', {}, h('h1', {}, 'The directors’', h('br'), 'ledger.'), h('p', {}, 'Enquiries, owners and notes for VIA77. Approved emails only.'))),
    h('section', { class: 'login-form' }, form)));
}
function messageView(title, text) {
  app.replaceChildren(h('main', { class: 'no-access' }, h('div', {}, h('h1', {}, title), h('p', {}, text), h('button', { class: 'btn', type: 'button', onclick: signOut }, 'Sign out'))));
}
async function signOut() {
  await db.auth.signOut();
  Object.assign(state, { user: null, me: '', enquiries: [], selected: null, notes: [], noteDraft: '' });
  history.replaceState(null, '', '/');
  loginView();
}

// ---------- Data ----------
async function loadAll() {
  const [enquiries, directors] = await Promise.all([
    db.from('enquiries').select('*').order('created_at', { ascending: false }).limit(500),
    db.from('directors').select('email,name').order('email'),
  ]);
  if (enquiries.error || directors.error) throw enquiries.error || directors.error;
  state.enquiries = enquiries.data;
  state.directors = directors.data;
}
async function loadNotes(id) {
  const { data, error } = await db.from('enquiry_notes').select('*').eq('enquiry_id', id).order('created_at');
  if (error) throw error;
  state.notes = data;
}
async function updateEnquiry(enquiry, patch) {
  const before = { status: enquiry.status, owner_email: enquiry.owner_email };
  Object.assign(enquiry, patch);
  render();
  const { data, error } = await db.from('enquiries').update(patch).eq('id', enquiry.id).select().single();
  if (error) {
    Object.assign(enquiry, before);
    toast('That change was not saved. Please try again.');
  } else Object.assign(enquiry, data);
  render();
}

// ---------- Rail ----------
function railView() {
  const waiting = state.enquiries.filter((e) => e.status === 'new');
  const oldest = waiting[waiting.length - 1];
  const stale = oldest && Date.now() - new Date(oldest.created_at) > 172800000;
  const count = (fn) => state.enquiries.filter((e) => fn(e, state.me)).length;
  const button = ([key, text, fn]) => {
    const n = count(fn);
    return h('button', { type: 'button', k: `view-${key}`, class: `view ${n ? '' : 'zero'}`, 'aria-current': String(state.view === key), onclick: () => { state.view = key; state.selected = null; history.pushState(null, '', '/'); render(); } }, text, h('span', { class: 'count' }, String(n)));
  };
  return h('nav', { class: 'rail', 'aria-label': 'Enquiry views' },
    h('div', { class: 'rail-top' }, h('img', { src: '/assets/via77-logo-black.svg', alt: 'VIA77', width: 76, height: 18 }), h('span', { class: 'tag' }, 'Directors')),
    h('div', { class: `pulse ${stale ? 'urgent' : ''}` }, h('b', {}, String(waiting.length)), h('div', {}, h('p', {}, waiting.length === 1 ? 'enquiry needs a reply' : 'enquiries need a reply'), oldest && h('small', {}, `Oldest has waited ${ageWords(oldest.created_at)}`))),
    h('div', { class: 'views' }, VIEWS.map((group) => h('div', {}, group.group && h('h2', {}, group.group), group.items.map(button)))),
    accountControls('rail-foot', ''));
}
function accountControls(cls, prefix) {
  return h('div', { class: cls }, themeControl(prefix), h('div', { class: 'me' }, h('span', {}, state.user.email), h('button', { type: 'button', k: `${prefix}signout`, onclick: signOut }, 'Sign out')));
}

// ---------- Ledger ----------
function visible() {
  const view = ALL_VIEWS.find(([key]) => key === state.view);
  const query = state.search.trim().toLowerCase();
  return state.enquiries.filter((e) => view[2](e, state.me) && (!query || [e.name, e.email, e.website, e.message].some((v) => (v || '').toLowerCase().includes(query))));
}
function ledgerView() {
  const rows = visible();
  const title = ALL_VIEWS.find(([key]) => key === state.view)[1];
  const empty = state.search ? ['Nothing matches.', 'Try a different name, email or word.']
    : !state.enquiries.length ? ['The ledger is clear.', 'New enquiries from the website will appear here.']
    : state.view === 'reply' ? ['All replied to.', 'Nobody is waiting on you right now.']
    : ['Nothing here.', 'Enquiries in this stage will appear here.'];
  return h('section', { class: 'ledger', 'aria-label': title },
    h('div', { class: 'ledger-head' }, h('h1', {}, title), h('label', {}, h('span', { class: 'sr' }, 'Search enquiries'), h('input', { type: 'search', k: 'search', placeholder: 'Search   /', value: state.search, oninput: (event) => { state.search = event.target.value; render(); } }))),
    rows.length ? h('ul', { class: 'rows' }, rows.map((e) => h('li', {}, h('button', { type: 'button', k: `row-${e.id}`, class: `row ${e.status === 'new' ? 'fresh' : ''}`, 'aria-current': String(state.selected === e.id), onclick: () => select(e.id) },
      h('span', { class: 'age' }, age(e.created_at)),
      h('span', { class: 'row-main' },
        h('span', { class: 'row-name' }, h('b', {}, e.name), e.owner_email && h('span', { class: 'row-owner', title: `Owner: ${directorName(e.owner_email)}` }, initial(e.owner_email))),
        h('span', { class: 'row-snip' }, e.message),
        h('span', { class: 'row-state tag' }, e.status)))))) : h('div', { class: 'nothing rows' }, h('b', {}, empty[0]), empty[1]),
    accountControls('phone-foot', 'phone-'));
}

// ---------- File ----------
function stepper(e) {
  const position = PIPELINE.findIndex(([key]) => key === e.status);
  return h('div', { class: 'track' },
    h('ol', { class: 'steps', 'aria-label': 'Enquiry stage' }, PIPELINE.map(([key, text], index) => h('li', {}, h('button', { type: 'button', k: `step-${key}`, class: `step ${position > index ? 'done' : ''}`, 'aria-current': position === index ? 'step' : null, onclick: () => e.status !== key && updateEnquiry(e, { status: key }) }, text, h('small', {}, position === index ? 'Now' : ' '))))),
    h('div', { class: 'track-foot' },
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Owner' }, h('span', { class: 'tag' }, 'Owner'),
        [...state.directors.map((d) => [d.email, directorName(d.email)]), [null, 'Nobody']].map(([email, text]) => h('button', { type: 'button', k: `owner-${email}`, 'aria-pressed': String(e.owner_email === email), onclick: () => e.owner_email !== email && updateEnquiry(e, { owner_email: email }) }, text))),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Close without winning' }, ['lost', 'spam'].map((status) => h('button', { type: 'button', k: `close-${status}`, 'aria-pressed': String(e.status === status), onclick: () => e.status !== status && updateEnquiry(e, { status }) }, status === 'lost' ? 'Mark lost' : 'Mark spam')))));
}
function notesView(e) {
  const box = h('textarea', { k: 'note', 'aria-label': 'Add a note', required: true, maxLength: 10000, placeholder: 'What happened, or what should happen next?', value: state.noteDraft, oninput: (event) => { state.noteDraft = event.target.value; }, onkeydown: (event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) event.target.form.requestSubmit(); } });
  const save = h('button', { class: 'btn', type: 'submit', k: 'note-save' }, 'Add note');
  return h('section', { class: 'notes', 'aria-label': 'Notes' }, h('h2', {}, 'Notes'),
    state.notes.map((n) => h('article', { class: 'note' }, h('div', { class: 'note-meta' }, `${directorName(n.author_email)} · ${fullDate(n.created_at)}`), h('p', {}, n.body))),
    h('form', { class: 'note-form', onsubmit: async (event) => {
      event.preventDefault();
      const body = state.noteDraft.trim();
      if (!body) return;
      save.disabled = true;
      const { error } = await db.from('enquiry_notes').insert({ enquiry_id: e.id, body, author_email: state.me });
      save.disabled = false;
      if (error) { toast('Your note was not saved. Your text is still here.'); return; }
      state.noteDraft = '';
      await loadNotes(e.id);
      render();
    } }, box, h('div', { class: 'row-end' }, h('span', { class: 'hint' }, 'Ctrl or ⌘ + Enter'), save)));
}
function fileView() {
  const e = state.enquiries.find((x) => x.id === state.selected);
  if (!e) return h('section', { class: 'file', 'aria-label': 'Enquiry' }, h('div', { class: 'file-empty' }, h('b', {}, state.enquiries.length ? 'Choose someone from the ledger.' : 'Nothing to open yet.'), h('p', {}, 'J and K move through the list. / searches.')));
  const site = e.website && safeUrl(e.website);
  const subject = encodeURIComponent('Your VIA77 enquiry');
  const facts = [['Received', fullDate(e.created_at)], ['Type', e.type === 'assessment' ? 'Commerce Assessment' : 'Project enquiry'], ['Project', e.project], ['Budget', e.budget], ['Timing', e.timeline]].filter(([, v]) => v);
  return h('section', { class: `file ${state.justOpened ? 'open' : ''}`, 'aria-label': `Enquiry from ${e.name}` }, h('div', { class: 'file-in' },
    h('button', { class: 'btn quiet back', type: 'button', k: 'back', onclick: () => { state.selected = null; history.pushState(null, '', '/'); render(); } }, '← Ledger'),
    h('span', { class: 'tag' }, e.status === 'new' ? `Waiting ${ageWords(e.created_at)}` : e.status),
    h('h1', { tabIndex: -1, id: 'file-title' }, e.name),
    h('div', { class: 'file-actions' },
      h('a', { class: 'btn', href: `mailto:${e.email}?subject=${subject}`, k: 'reply' }, 'Reply by email', h('span', { 'aria-hidden': 'true' }, '↗')),
      h('span', { class: 'plain mono' }, e.email),
      site && h('a', { class: 'plain', href: site, target: '_blank', rel: 'noopener noreferrer' }, `${e.website} ↗`)),
    !e.email_delivered && h('p', { class: 'warn' }, 'The notification email was not confirmed, so check this one by hand.'),
    stepper(e),
    h('section', { class: 'brief', 'aria-label': 'What they asked' }, h('span', { class: 'tag' }, 'What they asked'), h('p', { class: 'message' }, e.message),
      h('dl', { class: 'facts' }, facts.map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, v))))),
    notesView(e)));
}

// ---------- Rendering ----------
function render() {
  if (!state.user) return;
  const focusKey = document.activeElement?.dataset?.k;
  const caret = document.activeElement?.selectionStart;
  const scrolls = [...document.querySelectorAll('.rows,.file,.views')].map((el) => [el.className.split(' ')[0], el.scrollTop, el.scrollLeft]);
  app.replaceChildren(h('div', { class: `shell ${state.selected ? 'at-file' : 'at-list'}` }, railView(), ledgerView(), fileView()));
  for (const [cls, top, left] of scrolls) { const el = document.querySelector(`.${cls}`); if (el) { el.scrollTop = top; el.scrollLeft = left; } }
  if (focusKey) {
    const el = document.querySelector(`[data-k="${CSS.escape(focusKey)}"]`);
    if (el) { el.focus({ preventScroll: true }); if (caret !== undefined && caret !== null && el.setSelectionRange && el.type !== 'email') el.setSelectionRange(caret, caret); }
  }
  state.justOpened = false;
}
async function select(id, push = true) {
  state.selected = id;
  state.notes = [];
  state.noteDraft = '';
  state.justOpened = true;
  if (push) history.pushState(null, '', `/?id=${encodeURIComponent(id)}`);
  render();
  document.querySelector('.file')?.scrollTo(0, 0);
  if (innerWidth <= 860) scrollTo(0, 0);
  document.getElementById('file-title')?.focus({ preventScroll: true });
  try { await loadNotes(id); if (state.selected === id) render(); } catch { toast('Notes could not be loaded.'); }
}
async function refresh() {
  if (!state.user) return;
  // A background refresh should never interrupt someone typing.
  if (['TEXTAREA', 'INPUT'].includes(document.activeElement?.tagName) || state.noteDraft) return;
  try { await loadAll(); if (state.selected) await loadNotes(state.selected); render(); } catch { /* The next refresh tries again. */ }
}
function openFromUrl() {
  const id = new URLSearchParams(location.search).get('id');
  if (id && state.enquiries.some((e) => e.id === id)) { select(id, false); return; }
  state.selected = null;
  render();
}
async function start(session) {
  if (!session) { state.user = null; loginView(); return; }
  if (state.user && state.user.id === session.user.id) return;
  state.user = session.user;
  state.me = session.user.email.toLowerCase();
  try {
    const { data: allowed, error } = await db.rpc('is_director');
    if (error) throw error;
    if (!allowed) { messageView('No access', 'This account is not approved for the VIA77 dashboard.'); return; }
    await loadAll();
    if (!state.enquiries.some((e) => e.status === 'new') && state.enquiries.length) state.view = 'open';
    openFromUrl();
  } catch {
    messageView('Could not load', 'Check your connection, then reload this page.');
  }
}

// ---------- Keyboard ----------
addEventListener('keydown', (event) => {
  if (!state.user || event.metaKey || event.ctrlKey || event.altKey) return;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) { if (event.key === 'Escape') event.target.blur(); return; }
  if (event.key === '/') { event.preventDefault(); document.querySelector('[data-k="search"]')?.focus(); return; }
  if (event.key === 'j' || event.key === 'k') {
    const rows = visible();
    if (!rows.length) return;
    const index = rows.findIndex((e) => e.id === state.selected);
    const next = event.key === 'j' ? Math.min(rows.length - 1, index + 1) : Math.max(0, index - 1);
    select(rows[next].id);
  }
});
addEventListener('popstate', () => { if (state.user) openFromUrl(); });

// ---------- Start ----------
const hashParams = new URLSearchParams(location.hash.slice(1));
const linkError = hashParams.get('error_description');
db.auth.getSession().then(({ data }) => {
  if (linkError && !data.session) {
    history.replaceState(null, '', location.pathname);
    loginView('That sign-in link has expired. Please request a new one.');
    return;
  }
  start(data.session);
});
// Supabase locks auth during this callback, so database work waits until it ends.
db.auth.onAuthStateChange((event, session) => { if (event === 'SIGNED_IN') setTimeout(() => start(session), 0); if (event === 'SIGNED_OUT') state.user = null; });
addEventListener('focus', refresh);
setInterval(refresh, 60000);
