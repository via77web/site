/* =====================================================================
   VIA77 Store Kit · interactions + motion
   Reads the catalogue from <script type="application/json" id="catalog">
   and brand settings from <html data-*>. Works without GSAP/Lenis;
   every element is readable without JS.
   ===================================================================== */
(function () {
  var html = document.documentElement;
  var S = parseFloat(getComputedStyle(html).getPropertyValue('--s')) || 1;
  var CUR = html.dataset.cur || 'A$';
  var SHIP = +html.dataset.ship || 0;
  var KEY = (html.dataset.key || 'store') + '-';
  var cat = JSON.parse(document.getElementById('catalog').textContent);
  var byId = {}; cat.products.forEach(function (p) { byId[p.id] = p; });
  var hasGSAP = !!(window.gsap && window.ScrollTrigger);
  var fine = matchMedia('(hover:hover) and (pointer:fine)').matches;
  var store = { get: function (k) { try { return localStorage.getItem(KEY + k); } catch (e) { return null; } }, set: function (k, v) { try { localStorage.setItem(KEY + k, v); } catch (e) {} } };
  var reduced = store.get('motion') ? store.get('motion') === 'off' : matchMedia('(prefers-reduced-motion: reduce)').matches;
  function $(s, c) { return (c || document).querySelector(s); }
  function $$(s, c) { return [].slice.call((c || document).querySelectorAll(s)); }
  function money(n) { return CUR + (n % 1 ? n.toFixed(2) : n.toLocaleString('en-AU')); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  html.classList.toggle('m', !reduced); html.classList.toggle('off', reduced);

  /* ---------------- reveals ---------------- */
  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { (e.target._t || e.target).classList.add('in'); io.unobserve(e.target); } }); }, { threshold: .14 }) : null;
  $$('[data-r]').forEach(function (el) { var sib = $$(':scope > [data-r]', el.parentElement), i = sib.indexOf(el); if (i > 0) el.style.setProperty('--d', Math.min(i, 7) * 70 * S + 'ms'); io ? io.observe(el) : el.classList.add('in'); });
  $$('[data-seen]').forEach(function (el) { if (!io) { el.classList.add('seen'); return; } var o = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { el.classList.add('seen'); o.disconnect(); } }, { threshold: .25 }); o.observe(el); });
  /* clip-path hides an element from IntersectionObserver: watch the parent */
  $$('.wipe').forEach(function (el) { if (!io) { el.classList.add('in'); return; } el.parentElement._t = el; io.observe(el.parentElement); });

  /* ---------------- header ---------------- */
  var hd = $('#hd'), notice = $('.notice');
  function headerState() {
    var y = scrollY, nh = notice ? notice.offsetHeight : 0;
    hd.style.setProperty('--nh', nh + 'px');
    var heroH = $('.hero') ? $('.hero').offsetHeight - 80 : 0;
    hd.classList.toggle('solid', document.body.classList.contains('solid-hd') || y > heroH * .9 || !$('.hero'));
    hd.style.top = Math.max(0, nh - y) + 'px';
  }
  addEventListener('scroll', headerState, { passive: true }); addEventListener('resize', headerState); headerState();

  /* ---------------- mobile menu ---------------- */
  var mnav = $('#mnav');
  $('#menuBtn') && $('#menuBtn').addEventListener('click', function () { mnav.classList.add('open'); lock(true); $('a', mnav).focus(); });
  mnav && $$('a,.x', mnav).forEach(function (a) { a.addEventListener('click', function () { mnav.classList.remove('open'); lock(false); }); });

  /* ---------------- statement scrub ---------------- */
  var scrub = $('#scrub'), words = [];
  if (scrub) {
    var walk = function (node) { [].slice.call(node.childNodes).forEach(function (n) {
      if (n.nodeType === 3) { var frag = document.createDocumentFragment(); n.textContent.split(/(\s+)/).forEach(function (t) { if (!t) return; if (/^\s+$/.test(t)) frag.appendChild(document.createTextNode(t)); else { var s = document.createElement('span'); s.className = 'w'; s.textContent = t; frag.appendChild(s); words.push(s); } }); n.parentNode.replaceChild(frag, n); }
      else if (n.nodeType === 1) walk(n); }); };
    walk(scrub);
    if (reduced || !hasGSAP) words.forEach(function (w) { w.style.opacity = 1; });
  }

  /* ---------------- filters (FLIP) ---------------- */
  var grid = $('#grid');
  $$('.chip[data-f]').forEach(function (b) {
    b.addEventListener('click', function () {
      var f = b.dataset.f; $$('.chip[data-f]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      var cards = $$('.card', grid), first = cards.map(function (c) { return c.getBoundingClientRect(); });
      cards.forEach(function (c) { c.classList.toggle('hidden', !(f === 'all' || c.dataset.cat === f)); });
      if (reduced) return;
      cards.forEach(function (c, i) {
        if (c.classList.contains('hidden')) return; var l = c.getBoundingClientRect(), a = first[i];
        var dx = a.left - l.left, dy = a.top - l.top, wasHidden = !a.width;
        c.animate(wasHidden ? [{ opacity: 0, transform: 'translateY(30px) scale(.97)' }, { opacity: 1, transform: 'none' }] : [{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'none' }], { duration: 700 * S, easing: 'cubic-bezier(.16,1,.3,1)' });
      });
      hasGSAP && setTimeout(function () { ScrollTrigger.refresh(); }, 50);
    });
  });

  /* ---------------- cart ---------------- */
  var cart = []; try { cart = JSON.parse(store.get('cart') || '[]'); } catch (e) { cart = []; }
  cart = cart.filter(function (l) { return byId[l.id]; });
  function lineKey(id, v) { return id + '|' + (v || ''); }
  function unitPrice(p, v) { var o = p.options && p.options.values.filter(function (x) { return x.v === v; })[0]; return o && o.price ? o.price : p.price; }
  function add(id, v, q, quiet) {
    var p = byId[id]; v = v || (p.options ? p.options.values[0].v : ''); q = q || 1;
    var k = lineKey(id, v), l = cart.filter(function (x) { return x.k === k; })[0];
    if (l) l.q += q; else cart.push({ k: k, id: id, v: v, q: q });
    save(); renderCart();
    var c = $('#cartCount'); c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump');
    if (!quiet) toast(p.name + (v ? ' · ' + v : '') + ' added to bag');
  }
  function save() { store.set('cart', JSON.stringify(cart)); }
  function count() { return cart.reduce(function (n, l) { return n + l.q; }, 0); }
  function subtotal() { return cart.reduce(function (n, l) { return n + unitPrice(byId[l.id], l.v) * l.q; }, 0); }
  function renderCart() {
    $('#cartCount span').textContent = count();
    var box = $('#cartLines'); if (!box) return;
    if (!cart.length) box.innerHTML = '<div class="empty"><p class="disp" style="font-size:28px;color:var(--ink);margin:0 0 10px">Your bag is empty.</p><p>Start with the collection.</p></div>';
    else box.innerHTML = cart.map(function (l) { var p = byId[l.id];
      return '<div class="line" data-k="' + esc(l.k) + '"><div class="ph"><img src="' + p.img + '" alt=""></div><div><h4>' + esc(p.name) + '</h4><div class="v">' + esc([p.type, l.v].filter(Boolean).join(' · ')) + '</div>' +
        '<div class="q"><button data-d="-1" aria-label="Decrease">−</button><span>' + l.q + '</span><button data-d="1" aria-label="Increase">+</button></div><button class="rm">Remove</button></div><div>' + money(unitPrice(p, l.v) * l.q) + '</div></div>'; }).join('');
    var st = subtotal(); $('#subtotal').textContent = money(st);
    var ship = $('#ship');
    if (ship && SHIP) { var left = SHIP - st; ship.querySelector('span').textContent = left > 0 ? 'You are ' + money(left) + ' away from free delivery' : 'Free delivery unlocked'; ship.style.setProperty('--k', Math.min(1, st / SHIP)); }
    $('#checkoutBtn').disabled = !cart.length;
  }
  $('#cartLines') && $('#cartLines').addEventListener('click', function (e) {
    var line = e.target.closest('.line'); if (!line) return; var l = cart.filter(function (x) { return x.k === line.dataset.k; })[0];
    if (e.target.closest('.rm')) cart.splice(cart.indexOf(l), 1);
    else if (e.target.dataset.d) { l.q += +e.target.dataset.d; if (l.q < 1) cart.splice(cart.indexOf(l), 1); }
    else return; save(); renderCart();
  });
  renderCart();

  /* ---------------- overlays ---------------- */
  var scrim = $('#scrim'), openEl = null, lastFocus = null;
  function lock(on) { document.body.classList.toggle('lock', on); if (lenis) on ? lenis.stop() : lenis.start(); }
  function open(el) { if (openEl && openEl !== el) close(true); lastFocus = document.activeElement; openEl = el; el.classList.add('open'); el.setAttribute('aria-hidden', 'false'); if (!el.classList.contains('co') && !el.classList.contains('search')) scrim.classList.add('on'); lock(true); setTimeout(function () { var f = el.querySelector('[data-focus]') || el.querySelector('button,input,a'); f && f.focus(); }, 60); }
  function close(keep) { if (!openEl) return; openEl.classList.remove('open'); openEl.setAttribute('aria-hidden', 'true'); openEl = null; scrim.classList.remove('on'); if (!keep) { lock(false); lastFocus && lastFocus.focus && lastFocus.focus(); } }
  scrim.addEventListener('click', function () { close(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && openEl) close();
    if (e.key === 'Tab' && openEl) { var f = $$('button:not([disabled]),a[href],input,select,[tabindex="0"]', openEl).filter(function (x) { return x.offsetParent !== null; }); if (!f.length) return; var a = f[0], z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); } }
  });
  $$('[data-close]').forEach(function (b) { b.addEventListener('click', function () { close(); }); });
  $('#openCart').addEventListener('click', function () { open($('#cart')); });
  var tt; function toast(t) { var el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(tt); tt = setTimeout(function () { el.classList.remove('on'); }, 2400); }

  /* quick add + card open */
  grid && grid.addEventListener('click', function (e) {
    var qa = e.target.closest('.qa'); var card = e.target.closest('.card'); if (!card) return;
    if (qa) { add(card.dataset.id); var t = qa.querySelector('span'); var o = t.textContent; t.textContent = 'Added ✓'; setTimeout(function () { t.textContent = o; }, 1400); return; }
    quickView(card.dataset.id);
  });

  function optionsHTML(p, name) {
    if (!p.options) return '';
    return '<fieldset class="opt"><legend class="lbl muted">' + esc(p.options.label) + '</legend><div class="opts">' + p.options.values.map(function (o, i) {
      var id = name + '-' + i; return '<input type="radio" name="' + name + '" id="' + id + '" value="' + esc(o.v) + '"' + (i ? '' : ' checked') + '><label for="' + id + '">' + (o.sw ? '<i class="sw" style="background:' + o.sw + '"></i>' : '') + esc(o.v) + '</label>'; }).join('') + '</div></fieldset>';
  }
  function quickView(id) {
    var p = byId[id], el = $('#qv');
    $('#qvBody').innerHTML = '<div class="qv"><div class="qimg"><img src="' + (p.gallery ? p.gallery[0] : p.img) + '" alt="' + esc(p.alt) + '"></div><div class="qinfo"><span class="lbl muted">' + esc(p.type) + '</span><h2 class="disp" id="qvTitle">' + esc(p.name) + '</h2>' +
      '<div class="price"><span class="pv"><span id="qvPrice">' + money(p.price) + '</span></span></div><p class="muted" style="margin:0">' + esc(p.desc) + '</p>' + optionsHTML(p, 'qvopt') +
      '<button class="btn wide" id="qvAdd" data-focus><span class="st">Add to bag</span><span class="st2">Added ✓</span></button>' +
      (p.details ? '<div class="acc"><details open><summary>Details <i></i></summary><div class="body"><dl>' + p.details.map(function (d) { return '<dt>' + esc(d[0]) + '</dt><dd>' + esc(d[1]) + '</dd>'; }).join('') + '</dl></div></details></div>' : '') +
      '<p class="fine">A VIA77 commerce concept. Checkout is a demonstration and takes no payment.</p></div></div>';
    $$('input[name=qvopt]', el).forEach(function (r) { r.addEventListener('change', function () { $('#qvPrice').textContent = money(unitPrice(p, r.value)); }); });
    $('#qvAdd').addEventListener('click', function () { var v = ($('input[name=qvopt]:checked', el) || {}).value; add(id, v, 1, true); var b = this; b.classList.add('done'); setTimeout(function () { b.classList.remove('done'); close(true); open($('#cart')); }, 700); });
    open(el);
  }

  /* ---------------- generic hooks: any [data-qv] opens quick view, [data-add] adds to bag ---------------- */
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-add]');
    if (a && byId[a.dataset.add]) { e.preventDefault(); add(a.dataset.add, a.dataset.v); var t = a.querySelector('.t'); if (t) { var o = t.textContent; t.textContent = 'Added ✓'; setTimeout(function () { t.textContent = o; }, 1400); } return; }
    var q = e.target.closest && e.target.closest('[data-qv]');
    if (q && byId[q.dataset.qv]) { e.preventDefault(); quickView(q.dataset.qv); }
  });
  window.Store = { add: add, quickView: function (id) { quickView(id); }, toast: toast, money: money, product: function (id) { return byId[id]; }, reduced: function () { return reduced; } };

  /* ---------------- counters: [data-count] count up once in view ---------------- */
  var cio = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) { es.forEach(function (en) { if (!en.isIntersecting) return; cio.unobserve(en.target); var el = en.target, to = +el.dataset.count, suf = el.dataset.suffix || '';
    if (reduced) { el.textContent = to + suf; return; } var t0 = null, d = 1400 * S; (function f(t) { if (!t0) t0 = t; var k = Math.min(1, (t - t0) / d), v = 1 - Math.pow(1 - k, 4); el.textContent = Math.round(to * v) + suf; if (k < 1) requestAnimationFrame(f); })(performance.now()); }); }, { threshold: .6 }) : null;
  $$('[data-count]').forEach(function (el) { if (cio) { el.textContent = '0' + (el.dataset.suffix || ''); cio.observe(el); } });

  /* ---------------- hotspots: .hs > .hs-b toggles .hs-pop ---------------- */
  function closeHs(except) { $$('.hs.open').forEach(function (h) { if (h !== except) { h.classList.remove('open'); $('.hs-b', h).setAttribute('aria-expanded', 'false'); } }); }
  $$('.hs').forEach(function (h) { var bt = $('.hs-b', h);
    bt.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); var o = !h.classList.contains('open'); closeHs(h); h.classList.toggle('open', o); bt.setAttribute('aria-expanded', String(o)); });
    if (fine) { h.addEventListener('pointerenter', function () { closeHs(h); h.classList.add('open'); bt.setAttribute('aria-expanded', 'true'); }); h.addEventListener('pointerleave', function () { h.classList.remove('open'); bt.setAttribute('aria-expanded', 'false'); }); } });
  document.addEventListener('click', function (e) { if (!e.target.closest('.hs')) closeHs(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeHs(); });

  /* ---------------- [data-jump]: scroll to the shop and apply that filter ---------------- */
  $$('[data-jump]').forEach(function (b) { b.addEventListener('click', function () { var c = $('.chip[data-f="' + b.dataset.jump + '"]'), shop = $('#shop'); if (lenis) lenis.scrollTo(shop, { offset: -70, duration: 1.3 }); else shop.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' }); setTimeout(function () { c && c.click(); }, reduced ? 0 : 700); }); });

  /* ---------------- FORME: layering steps swap the product shown ---------------- */
  var fsteps = $$('#fmSteps .fm-step');
  if (fsteps.length) { var vis = $$('.fm-panel-vis img'); var setStep = function (i) { fsteps.forEach(function (b, k) { b.classList.toggle('on', k === i); }); vis.forEach(function (im) { im.classList.toggle('on', +im.dataset.i === i); }); };
    fsteps.forEach(function (b) { var i = +b.dataset.step; b.addEventListener('click', function () { setStep(i); }); if (fine) b.addEventListener('pointerenter', function () { setStep(i); }); }); }

  /* ---------------- STILL HOUSE: cm / in toggle ---------------- */
  $$('.sh-unit').forEach(function (b) { b.addEventListener('click', function () { var u = b.dataset.u; $$('.sh-unit').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    $$('[data-cm]').forEach(function (el) { var cm = +el.dataset.cm, v = u === 'cm' ? cm + ' cm' : (cm / 2.54).toFixed(1) + ' in', pre = el.textContent.match(/^[A-Z] /); var nv = (pre ? pre[0] : '') + v;
      if (reduced) { el.textContent = nv; return; } el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-6px)' }], { duration: 160 }).onfinish = function () { el.textContent = nv; el.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.16,1,.3,1)' }); }; }); }); });

  /* ---------------- feature PDP ---------------- */
  var pdp = $('#pdp');
  if (pdp) {
    var pid = pdp.dataset.id || $('#pdpForm').dataset.id, P = byId[pid], stage = $('#stage'), imgs = $$('img', stage), thumbs = $$('.thumbs button', pdp), cur = 0, num = $('.n', stage);
    function show(i) { if (i === cur) return; imgs.forEach(function (im, k) { im.classList.remove('was'); if (k === cur) im.classList.add('was'); im.classList.toggle('on', k === i); });
      thumbs.forEach(function (t, k) { t.setAttribute('aria-current', String(k === i)); }); cur = i; if (num) num.textContent = (i + 1) + ' / ' + imgs.length; }
    thumbs.forEach(function (t, i) { t.addEventListener('click', function () { show(i); }); });
    var sx = 0; stage.addEventListener('pointerdown', function (e) { sx = e.clientX; });
    stage.addEventListener('pointerup', function (e) { var dx = e.clientX - sx; if (Math.abs(dx) > 40) show((cur + (dx < 0 ? 1 : imgs.length - 1)) % imgs.length); });
    if (fine) {
      stage.addEventListener('click', function () { stage.classList.toggle('zoom'); });
      stage.addEventListener('pointermove', function (e) { var r = stage.getBoundingClientRect(); stage.style.setProperty('--zx', ((e.clientX - r.left) / r.width * 100) + '%'); stage.style.setProperty('--zy', ((e.clientY - r.top) / r.height * 100) + '%'); });
      stage.addEventListener('pointerleave', function () { stage.classList.remove('zoom'); });
    }
    var pv = $('#pdpPrice'), q = 1, qo = $('#qty');
    $$('input[name=opt]', pdp).forEach(function (r) { r.addEventListener('change', function () {
      var np = money(unitPrice(P, r.value)); if (pv.textContent === np) return;
      if (reduced) { pv.textContent = np; return; }
      pv.style.transform = 'translateY(-100%)'; setTimeout(function () { pv.style.transition = 'none'; pv.textContent = np; pv.style.transform = 'translateY(100%)'; void pv.offsetWidth; pv.style.transition = ''; pv.style.transform = ''; }, 200 * S);
      var im = r.dataset.img; if (im !== undefined) show(+im);
    }); });
    $$('.qty button', pdp).forEach(function (b) { b.addEventListener('click', function () { q = Math.max(1, Math.min(9, q + +b.dataset.d)); qo.textContent = q; }); });
    $('#pdpForm').addEventListener('submit', function (e) { e.preventDefault(); var v = ($('input[name=opt]:checked', pdp) || {}).value; add(pid, v, q, true); var b = $('#addBtn'); b.classList.add('done');
      setTimeout(function () { b.classList.remove('done'); open($('#cart')); }, 900); });
  }

  /* ---------------- story steps ---------------- */
  var story = $('.story');
  if (story) {
    var simgs = $$('.media img', story), bars = $$('.prog i', story), steps = $$('.step', story), sc = 0;
    function sstep(i) { if (i === sc) return; simgs.forEach(function (im, k) { im.classList.remove('was'); if (k === sc) im.classList.add('was'); im.classList.toggle('on', k === i); }); bars.forEach(function (b, k) { b.classList.toggle('on', k <= i); }); steps.forEach(function (s, k) { s.classList.toggle('on', k === i); }); sc = i; }
    steps[0].classList.add('on'); bars[0] && bars[0].classList.add('on');
    if ('IntersectionObserver' in window) { var sio = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) sstep(steps.indexOf(e.target)); }); }, { rootMargin: '-45% 0px -45% 0px' }); steps.forEach(function (s) { sio.observe(s); }); }
  }

  /* ---------------- reel: drag with inertia ---------------- */
  var reel = $('#reel');
  if (reel) {
    var track = $('.track', reel), x = 0, tx = 0, dragging = false, startX = 0, startT = 0, vel = 0, lastX = 0, pg = $('#reelPg b');
    function bounds() { return Math.min(0, reel.clientWidth - track.scrollWidth); }
    reel.addEventListener('pointerdown', function (e) { dragging = true; reel.classList.add('drag'); startX = e.clientX; startT = tx; lastX = e.clientX; vel = 0; reel.setPointerCapture(e.pointerId); });
    reel.addEventListener('pointermove', function (e) { if (!dragging) return; tx = startT + (e.clientX - startX); vel = e.clientX - lastX; lastX = e.clientX; });
    function end() { if (!dragging) return; dragging = false; reel.classList.remove('drag'); tx += vel * 8; }
    reel.addEventListener('pointerup', end); reel.addEventListener('pointercancel', end);
    reel.addEventListener('keydown', function (e) { if (e.key === 'ArrowRight') tx -= 300; if (e.key === 'ArrowLeft') tx += 300; });
    (function loop() { var b = bounds(); if (!dragging) tx = Math.max(b, Math.min(0, tx)); x += (tx - x) * (reduced ? 1 : .12); track.style.transform = 'translate3d(' + x.toFixed(2) + 'px,0,0)';
      if (pg && b) { var k = x / b; pg.style.transform = 'translateX(' + (k * (100 / .3 - 100)) + '%)'; } requestAnimationFrame(loop); })();
  }

  /* ---------------- newsletter ---------------- */
  var nf = $('#nform');
  nf && nf.addEventListener('submit', function (e) { e.preventDefault(); var i = $('input', nf); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(i.value)) { $('.ok', nf).textContent = 'Please enter a valid email.'; return; } $('.ok', nf).textContent = 'Thank you. (Concept store: nothing was sent.)'; i.value = ''; });

  /* ---------------- footer wordmark: shrink to fit so the whole word shows ---------------- */
  var bigEl = $('#big');
  if (bigEl) {
    var fitBig = function () { var o = bigEl.querySelector('.o'); bigEl.style.fontSize = ''; var w = o.getBoundingClientRect().width, W = bigEl.clientWidth; if (w > W) bigEl.style.fontSize = (parseFloat(getComputedStyle(bigEl).fontSize) * W / w * .995) + 'px'; };
    fitBig(); addEventListener('resize', fitBig); if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitBig);
    addEventListener('scroll', function () { if (scrollY + innerHeight >= document.documentElement.scrollHeight - 4) bigEl.style.setProperty('--fp', 1); }, { passive: true });
  }

  /* ---------------- search ---------------- */
  var sEl = $('#search'), sIn = $('#sInput'), sRes = $('#sRes');
  function renderSearch() { var t = sIn.value.trim().toLowerCase(); var list = cat.products.filter(function (p) { return !t || (p.name + ' ' + p.type + ' ' + p.cat).toLowerCase().indexOf(t) > -1; });
    sRes.innerHTML = list.length ? list.map(function (p, i) { return '<a href="#" data-id="' + p.id + '" style="animation-delay:' + i * 40 + 'ms"><img src="' + p.img + '" alt=""><span><span class="disp" style="font-size:20px;display:block">' + esc(p.name) + '</span><span class="muted">' + esc(p.type) + ' · ' + money(p.price) + '</span></span></a>'; }).join('') : '<p class="none">Nothing matches “' + esc(sIn.value) + '”.</p>'; }
  $('#openSearch') && $('#openSearch').addEventListener('click', function () { open(sEl); sIn.value = ''; renderSearch(); });
  sIn && sIn.addEventListener('input', renderSearch);
  sRes && sRes.addEventListener('click', function (e) { var a = e.target.closest('a'); if (!a) return; e.preventDefault(); close(true); quickView(a.dataset.id); });

  /* ---------------- checkout (demonstration) ---------------- */
  var co = $('#co'), stepN = 0;
  function coStep(n) { stepN = n; $$('.panel', co).forEach(function (p, i) { p.classList.toggle('on', i === n); }); $$('.stepper span', co).forEach(function (s, i) { s.classList.toggle('on', i <= n); }); co.querySelector('.main').scrollTop = 0; }
  function coSummary() { $('#coLines').innerHTML = cart.map(function (l) { var p = byId[l.id]; return '<div class="line" style="grid-template-columns:64px 1fr auto"><div class="ph"><img src="' + p.img + '" alt=""></div><div><h4>' + esc(p.name) + '</h4><div class="v">' + esc([l.v, '× ' + l.q].filter(Boolean).join(' · ')) + '</div></div><div>' + money(unitPrice(p, l.v) * l.q) + '</div></div>'; }).join(''); var st = subtotal(), sh = SHIP && st >= SHIP ? 0 : (+html.dataset.shipfee || 0); $('#coSub').textContent = money(st); $('#coShip').textContent = sh ? money(sh) : 'Free'; $('#coTot').textContent = money(st + sh); }
  $('#checkoutBtn').addEventListener('click', function () { coSummary(); coStep(0); close(true); open(co); });
  $$('[data-next]', co).forEach(function (b) { b.addEventListener('click', function () { var panel = b.closest('.panel'); var bad = $$('input[required]', panel).filter(function (i) { return !i.checkValidity(); }); if (bad.length) { bad[0].reportValidity(); return; } coStep(stepN + 1); }); });
  $$('[data-back]', co).forEach(function (b) { b.addEventListener('click', function () { coStep(Math.max(0, stepN - 1)); }); });
  $('#placeOrder').addEventListener('click', function () { $('#orderNo').textContent = (html.dataset.key || 'V').slice(0, 2).toUpperCase() + '-' + Math.floor(100000 + Math.random() * 899999); coStep(3); var d = $('.done-ok', co); d.classList.remove('on'); void d.offsetWidth; d.classList.add('on'); cart = []; save(); renderCart(); });

  /* ---------------- cursor ---------------- */
  var curEl = $('#cur');
  if (curEl && fine) {
    var b = curEl.querySelector('b'), cx = 0, cy = 0, mx = 0, my = 0;
    addEventListener('pointermove', function (e) { mx = e.clientX; my = e.clientY; var t = e.target.closest && e.target.closest('[data-cursor]'); if (t && !openEl) { b.textContent = t.dataset.cursor; curEl.classList.add('on'); } else curEl.classList.remove('on'); });
    (function cl() { cx += (mx - cx) * .2; cy += (my - cy) * .2; curEl.style.transform = 'translate(' + cx.toFixed(1) + 'px,' + cy.toFixed(1) + 'px)'; requestAnimationFrame(cl); })();
  }

  /* ---------------- smooth scroll + scrubs ---------------- */
  var lenis = null, tick = null;
  function startLenis() { if (lenis || reduced || !window.Lenis) return; lenis = new Lenis({ lerp: .1 / Math.sqrt(S), smoothWheel: true });
    if (hasGSAP) { lenis.on('scroll', ScrollTrigger.update); tick = function (t) { lenis && lenis.raf(t * 1000); }; gsap.ticker.add(tick); gsap.ticker.lagSmoothing(0); } else { (function r(t) { if (!lenis) return; lenis.raf(t); requestAnimationFrame(r); })(performance.now()); } }
  function stopLenis() { if (lenis) { if (tick) gsap.ticker.remove(tick); lenis.destroy(); lenis = null; } }
  document.addEventListener('click', function (e) { var a = e.target.closest && e.target.closest('a[href^="#"]'); if (!a || a.getAttribute('href').length < 2) return; var t = document.querySelector(a.getAttribute('href')); if (!t) return; e.preventDefault(); if (lenis) lenis.scrollTo(t, { offset: -70, duration: 1.4 }); else t.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' }); });
  if (hasGSAP) {
    gsap.registerPlugin(ScrollTrigger);
    var bg = $('.hero .bg');
    if (bg) ScrollTrigger.create({ trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true, onUpdate: function (s) { if (!reduced) bg.style.transform = 'translate3d(0,' + (s.progress * 14).toFixed(2) + '%,0)'; } });
    if (scrub && !reduced) ScrollTrigger.create({ trigger: scrub, start: 'top 80%', end: 'bottom 55%', scrub: true, onUpdate: function (s) { var n = words.length * s.progress; words.forEach(function (w, i) { w.style.opacity = Math.min(1, Math.max(.16, n - i + .16)); }); } });
    $$('[data-speed]').forEach(function (el) { var k = +el.dataset.speed; ScrollTrigger.create({ trigger: el.parentElement, start: 'top bottom', end: 'bottom top', scrub: true, onUpdate: function (st) { if (!reduced) el.style.transform = 'translate3d(0,' + ((st.progress - .5) * k * 600).toFixed(1) + 'px,0)'; } }); });
    var big = $('#big');
    if (big) ScrollTrigger.create({ trigger: big, start: 'top 98%', end: 'max', scrub: true, onUpdate: function (s) { big.style.setProperty('--fp', reduced ? 1 : Math.min(1, s.progress * 1.1).toFixed(3)); } });
    if (big && !reduced) big.style.setProperty('--fp', 0);
  }

  /* ---------------- motion switch ---------------- */
  var ms = $('#motionSwitch');
  function apply(v) { reduced = v; html.classList.toggle('m', !v); html.classList.toggle('off', v); ms && ms.setAttribute('aria-checked', String(!v));
    if (v) { stopLenis(); words.forEach(function (w) { w.style.opacity = 1; }); $$('[data-r],.wipe').forEach(function (el) { el.classList.add('in'); }); var big = $('#big'); big && big.style.setProperty('--fp', 1); var bg = $('.hero .bg'); if (bg) bg.style.transform = ''; }
    else startLenis(); hasGSAP && ScrollTrigger.refresh(); }
  ms && ms.setAttribute('aria-checked', String(!reduced));
  ms && ms.addEventListener('click', function () { apply(!reduced); store.set('motion', reduced ? 'off' : 'on'); });

  startLenis();
  function ready() { html.classList.add('ready'); }
  if (document.readyState === 'complete') requestAnimationFrame(ready); else addEventListener('load', function () { requestAnimationFrame(ready); });
  setTimeout(ready, 1800);
})();
