/* =====================================================================
   WEBSTAR motion layer: micro-animations for the demo sites
   ---------------------------------------------------------------------
   Drop-in. Each page sets window.MOTION = { accent, feel } before
   loading this file. feel: "calm" (law, physio), "warm" (hospitality,
   retail) or "sharp" (trades). Everything respects reduced-motion,
   and never touches elements the page already animates itself.
   ===================================================================== */
(function () {
  var cfg = window.MOTION || {};
  var FEELS = {
    calm:  { dist: 14, dur: 1000, stag: 90,  ease: 'cubic-bezier(.22,.8,.24,1)', mag: 4 },
    warm:  { dist: 22, dur: 900,  stag: 80,  ease: 'cubic-bezier(.16,1,.3,1)',   mag: 6 },
    sharp: { dist: 26, dur: 700,  stag: 60,  ease: 'cubic-bezier(.2,.9,.1,1)',   mag: 7 }
  };
  var F = FEELS[cfg.feel] || FEELS.warm;
  var accent = cfg.accent || '#888';
  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
  var doc = document.documentElement;

  /* ---------- styles ---------- */
  var css = [
    ':root{--m-accent:' + accent + ';--m-ease:' + F.ease + ';--m-dur:' + F.dur + 'ms;--m-dist:' + F.dist + 'px}',
    /* scroll progress */
    '#m-progress{position:fixed;top:0;left:0;height:2px;width:100%;transform-origin:0 50%;transform:scaleX(0);background:var(--m-accent);z-index:9999;pointer-events:none}',
    /* reveals use the individual translate/scale properties so they compose with any transform the site already uses */
    '.m-r{opacity:0;translate:0 var(--m-dist);transition:opacity var(--m-dur) var(--m-ease),translate var(--m-dur) var(--m-ease),filter var(--m-dur) var(--m-ease);transition-delay:var(--m-d,0ms)}',
    '.m-r.m-h{filter:blur(6px)}',
    '.m-r.m-in{opacity:1;translate:none;filter:none}',
    '.m-img{clip-path:inset(0 0 100% 0);scale:1.12;transition:clip-path calc(var(--m-dur)*1.3) var(--m-ease),scale calc(var(--m-dur)*1.8) var(--m-ease);transition-delay:var(--m-d,0ms)}',
    '.m-img.m-in{clip-path:inset(0 0 0 0);scale:1}',
    /* hero headline words */
    '.m-w{display:inline-block;opacity:0;translate:0 .45em;transition:opacity .8s var(--m-ease),translate .9s var(--m-ease)}',
    '.m-go .m-w{opacity:1;translate:none}',
    /* buttons */
    '.m-btn{position:relative;overflow:hidden;isolation:isolate;transition:translate .35s var(--m-ease),box-shadow .35s var(--m-ease),background-color .25s,color .25s}',
    '.m-btn::after{content:"";position:absolute;inset:0;z-index:-1;pointer-events:none;background:linear-gradient(105deg,transparent 30%,rgba(255,255,255,.28) 50%,transparent 70%);translate:-120% 0;transition:translate .8s var(--m-ease)}',
    '.m-btn:hover::after{translate:120% 0}',
    '.m-btn:active{scale:.97}',
    '.m-arr{display:inline-block;transition:translate .35s var(--m-ease)}',
    'a:hover>.m-arr,button:hover>.m-arr,a:hover .m-arr{translate:4px 0}',
    /* underline links */
    '.m-ul{background-image:linear-gradient(currentColor,currentColor);background-repeat:no-repeat;background-position:0 100%;background-size:0 1px;transition:background-size .4s var(--m-ease),opacity .2s,color .2s;padding-bottom:2px}',
    '.m-ul:hover,.m-ul:focus-visible{background-size:100% 1px}',
    /* cards */
    '.m-card{transition:translate .5s var(--m-ease),box-shadow .5s var(--m-ease),opacity var(--m-dur) var(--m-ease),filter var(--m-dur) var(--m-ease)}',
    '.m-card.m-in:hover,.m-card:not(.m-r):hover{translate:0 -5px;box-shadow:0 22px 44px -26px rgba(0,0,0,.45)}',
    '.m-zoom{overflow:hidden}.m-zoom img{transition:scale 1s var(--m-ease)}.m-card:hover .m-zoom img,.m-card:hover>img{scale:1.045}',
    /* parallax media */
    '.m-px{will-change:translate;scale:1.1}',
    /* fields + focus */
    '.m-field{transition:box-shadow .25s,border-color .25s}',
    '.m-field:focus{box-shadow:0 0 0 3px color-mix(in srgb,var(--m-accent) 30%,transparent);border-color:var(--m-accent)!important;outline:none}',
    ':focus-visible{outline:2px solid var(--m-accent);outline-offset:3px}',
    /* marquee pause */
    '.m-marq:hover *{animation-play-state:paused!important}',
    /* page entrance */
    '.m-enter body{animation:m-in .7s var(--m-ease) both}',
    '@keyframes m-in{from{opacity:0}to{opacity:1}}',
    '@media (prefers-reduced-motion:reduce){.m-r,.m-img,.m-w{opacity:1!important;translate:none!important;clip-path:none!important;scale:none!important;filter:none!important}.m-px{scale:none}#m-progress{display:none}.m-enter body{animation:none}}'
  ].join('\n');
  var st = document.createElement('style'); st.id = 'm-style'; st.textContent = css;
  document.head.appendChild(st);
  if (!reduced) doc.classList.add('m-enter');

  function ready(fn) { if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }

  ready(function () {
    var cs = function (el, p) { return getComputedStyle(el, p || null); };
    var ALREADY = '.reveal,.reveal-up,.rv,[data-reveal],.mstage,.m-skip,[class*="marquee"],[class*="ticker"]';
    var skipped = function (el) { return el.closest(ALREADY) || el.closest('header') || el.closest('[aria-hidden="true"]'); };
    var inView = function (el) { var r = el.getBoundingClientRect(); return r.top < innerHeight * 0.95 && r.bottom > 0; };

    /* ---------- progress bar ---------- */
    var bar = document.createElement('div'); bar.id = 'm-progress'; document.body.appendChild(bar);

    /* ---------- hero: first section with the h1 is left to the site ---------- */
    var h1 = document.querySelector('h1');
    var hero = h1 && (h1.closest('section,header,.hero') || h1.parentElement);

    /* hero headline word rise (unless the site animates it already) */
    if (h1 && !reduced && !h1.closest('.mstage,[data-split]')) {
      var animated = false, n = h1;
      for (var i = 0; i < 4 && n; i++, n = n.parentElement) { if (cs(n).animationName !== 'none') animated = true; }
      if (!animated) {
        var w = 0;
        (function walk(node) {
          [].slice.call(node.childNodes).forEach(function (c) {
            if (c.nodeType === 3) {
              var parts = c.textContent.split(/(\s+)/), frag = document.createDocumentFragment();
              parts.forEach(function (p) {
                if (!p) return;
                if (/^\s+$/.test(p)) { frag.appendChild(document.createTextNode(p)); return; }
                var s = document.createElement('span'); s.className = 'm-w'; s.textContent = p;
                s.style.transitionDelay = (120 + w++ * 70) + 'ms'; frag.appendChild(s);
              });
              c.replaceWith(frag);
            } else if (c.nodeType === 1 && c.tagName !== 'BR') {
              if (cs(c).display === 'block' || c.children.length) walk(c);
              else { c.classList.add('m-w'); c.style.transitionDelay = (120 + w++ * 70) + 'ms'; }
            }
          });
        })(h1);
        requestAnimationFrame(function () { requestAnimationFrame(function () { h1.classList.add('m-go'); }); });
      }
    }

    /* ---------- collect reveal targets ---------- */
    var BLOCK = /^(H2|H3|H4|P|UL|OL|BLOCKQUOTE|FIGURE|TABLE|FORM|DL)$/;
    var targets = [];
    function similarKids(el) {
      var kids = [].slice.call(el.children).filter(function (k) { return cs(k).display !== 'none' && cs(k).position !== 'absolute'; });
      if (kids.length < 3) return null;
      var sig = function (k) { return k.tagName + '.' + (k.classList[0] || ''); };
      var s0 = sig(kids[1] || kids[0]), same = kids.filter(function (k) { return sig(k) === s0; });
      return same.length >= 3 && same.length >= kids.length * 0.6 ? same : null;
    }
    function visit(el) {
      [].slice.call(el.children).forEach(function (c) {
        if (skipped(c) || c === hero || (hero && c.contains(hero) === false && hero.contains(c))) return;
        var pos = cs(c).position; if (pos === 'fixed' || pos === 'sticky' || pos === 'absolute') return;
        if (c.tagName === 'SCRIPT' || c.tagName === 'STYLE') return;
        var group = similarKids(c);
        if (group && !BLOCK.test(c.tagName)) {
          group.forEach(function (k, i) { if (!skipped(k)) targets.push({ el: k, d: i * F.stag, card: true }); });
          return;
        }
        if (c.tagName === 'IMG' || (c.tagName === 'FIGURE' && c.querySelector('img'))) { targets.push({ el: c, img: true }); return; }
        if (BLOCK.test(c.tagName)) { targets.push({ el: c, h: c.tagName === 'H2' }); return; }
        visit(c);
      });
    }
    [].slice.call(document.querySelectorAll('main>section,body>section,main>div>section,footer,body>main>article')).forEach(function (sec) {
      if (sec === hero || sec.contains(h1) || skipped(sec)) return;
      visit(sec);
    });

    /* stagger siblings that land in the same row (heading, then lede, etc.) */
    var lastParent = null, idx = 0;
    targets.forEach(function (t) {
      if (t.d == null) { if (t.el.parentElement === lastParent) idx++; else { idx = 0; lastParent = t.el.parentElement; } t.d = Math.min(idx, 4) * F.stag; }
    });

    /* ---------- cards: hover lift where the card is visually a card ---------- */
    targets.forEach(function (t) {
      if (!t.card) return;
      var el = t.el, s = cs(el);
      var looksCard = s.backgroundColor !== 'rgba(0, 0, 0, 0)' || parseFloat(s.borderTopWidth) > 0 || s.boxShadow !== 'none' || el.querySelector('img');
      if (!looksCard || /transform|translate|all/.test(s.transitionProperty) && s.transitionDuration !== '0s') return;
      el.classList.add('m-card');
      var im = el.querySelector('img'); if (im && im.parentElement !== el && cs(im.parentElement).overflow === 'hidden' && !/transform|scale|all/.test(cs(im).transitionProperty + '')) im.parentElement.classList.add('m-zoom');
    });

    if (!reduced) {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) { (e.target.__mimg || e.target).classList.add('m-in'); io.unobserve(e.target); } });
      }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
      targets.forEach(function (t) {
        if (inView(t.el)) return; /* never hide what the visitor is already looking at */
        if (!t.el.offsetParent || t.el.closest('[role=dialog],dialog,aside,[class*=drawer],[class*=modal]')) return;
        var el = t.el;
        if (t.img) { var im = el.tagName === 'IMG' ? el : el.querySelector('img'); if (im && im.offsetHeight > 120 && !im.closest('.m-px')) { im.classList.add('m-img'); im.style.setProperty('--m-d', t.d + 'ms'); im.parentElement.__mimg = im; io.observe(im.parentElement); return; } }
        el.classList.add('m-r'); if (t.h) el.classList.add('m-h');
        el.style.setProperty('--m-d', t.d + 'ms');
        io.observe(el);
      });
    }

    /* ---------- buttons ---------- */
    [].slice.call(document.querySelectorAll('a,button')).forEach(function (b) {
      var s = cs(b);
      var arrow = [].slice.call(b.childNodes).filter(function (c) { return c.nodeType === 3 && /[→↗›]\s*$/.test(c.textContent); })[0];
      if (arrow) { var t = arrow.textContent, m = t.match(/\s*([→↗›])\s*$/); arrow.textContent = t.slice(0, m.index) + ' '; var sp = document.createElement('span'); sp.className = 'm-arr'; sp.textContent = m[1]; b.insertBefore(sp, arrow.nextSibling); }
      [].slice.call(b.querySelectorAll('.arr,.arrow,[class*="arrow"]')).forEach(function (a) { a.classList.add('m-arr'); });
      var filled = s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent';
      var pill = parseFloat(s.borderTopLeftRadius) >= 6 || parseFloat(s.paddingLeft) >= 14;
      var isBtn = (filled || parseFloat(s.borderTopWidth) > 0) && pill && b.offsetHeight >= 34 && b.offsetHeight <= 80 && b.offsetWidth < 520;
      if (isBtn && !b.closest('header') && s.position === 'static' && cs(b, '::after').content === 'none' && !b.querySelector('img')) {
        b.classList.add('m-btn');
        if (finePointer && !reduced && filled) {
          b.addEventListener('pointermove', function (e) { var r = b.getBoundingClientRect(); b.style.translate = (((e.clientX - r.left) / r.width - 0.5) * F.mag * 2).toFixed(1) + 'px ' + (((e.clientY - r.top) / r.height - 0.5) * F.mag).toFixed(1) + 'px'; });
          b.addEventListener('pointerleave', function () { b.style.translate = ''; });
        }
      }
      /* nav + footer text links get a drawn underline */
      if (!isBtn && b.tagName === 'A' && b.closest('nav,footer') && !filled && cs(b, '::after').content === 'none' && cs(b).backgroundImage === 'none' && !b.querySelector('img,svg') && b.textContent.trim().length > 1) b.classList.add('m-ul');
    });

    /* ---------- form fields ---------- */
    [].slice.call(document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=hidden]),textarea,select')).forEach(function (f) { f.classList.add('m-field'); });

    /* ---------- marquees pause on hover ---------- */
    [].slice.call(document.querySelectorAll('[class*="ticker"],[class*="marquee"]')).forEach(function (m) { m.classList.add('m-marq'); });

    /* ---------- count-up numbers ---------- */
    var NUM = /^(\D{0,1})(\d{1,3}(?:,\d{3})*|\d+)(\.\d)?(\+|%|k|K|★|\/5|yrs?)?$/;
    [].slice.call(document.querySelectorAll('b,strong,span,div,dt,dd,em,h3,h4,p')).forEach(function (el) {
      if (el.children.length || skipped(el) || el.closest('a,button,form,[id*="price"],[class*="price"],.mstage') || el.id) return;
      var txt = el.textContent.trim(); var m = txt.match(NUM);
      if (!m || m[1] === '$' || txt.length > 8 || el.closest('[class*="stat"],[class*="num"],[class*="count"],[class*="metric"],[class*="figure"],[class*="proof"]') === null && parseFloat(cs(el).fontSize) < 26) return;
      var target = parseFloat((m[2] + (m[3] || '')).replace(/,/g, '')); if (!target || target < 3 && !m[3] || (target >= 1900 && target <= 2100 && !m[4])) return;
      if (reduced) return;
      var dec = m[3] ? 1 : 0, comma = m[2].indexOf(',') > -1;
      var fmt = function (v) { var s = v.toFixed(dec); if (comma) s = Number(s).toLocaleString('en-AU'); return m[1] + s + (m[4] || ''); };
      el.style.fontVariantNumeric = 'tabular-nums';
      var io2 = new IntersectionObserver(function (es) {
        if (!es[0].isIntersecting) return; io2.disconnect();
        var t0 = null; (function step(ts) { if (!t0) t0 = ts; var k = Math.min((ts - t0) / 1400, 1); el.textContent = fmt(target * (1 - Math.pow(1 - k, 4))); if (k < 1) requestAnimationFrame(step); else el.textContent = txt; })(performance.now());
      }, { threshold: 0.6 });
      el.textContent = fmt(0); io2.observe(el);
    });

    /* ---------- gentle parallax on large standalone images ---------- */
    var pxs = [];
    if (!reduced) [].slice.call(document.querySelectorAll('section img')).forEach(function (im) {
      if (skipped(im) || im.closest('.m-card') || (hero && hero.contains(im)) || im.classList.contains('m-img')) return;
      var box = im.parentElement, bs = cs(box);
      if (im.offsetHeight < 320 || bs.overflow !== 'hidden' || cs(im).objectFit !== 'cover' || cs(im).transform !== 'none' || /transform|scale|all/.test(cs(im).transitionProperty)) return;
      im.classList.add('m-px'); pxs.push(im);
    });

    /* ---------- one rAF loop for progress + parallax ---------- */
    var ticking = false;
    function frame() {
      ticking = false;
      var max = doc.scrollHeight - innerHeight;
      if (max - scrollY < 6) [].slice.call(document.querySelectorAll('.m-r:not(.m-in)')).forEach(function (e) { if (e.getBoundingClientRect().top < innerHeight) e.classList.add('m-in'); });
      bar.style.transform = 'scaleX(' + (max > 0 ? scrollY / max : 0).toFixed(4) + ')';
      for (var i = 0; i < pxs.length; i++) {
        var r = pxs[i].parentElement.getBoundingClientRect();
        if (r.bottom < -100 || r.top > innerHeight + 100) continue;
        var c = (r.top + r.height / 2 - innerHeight / 2) / innerHeight;
        pxs[i].style.translate = '0 ' + (c * -6).toFixed(2) + '%';
      }
    }
    addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(frame); } }, { passive: true });
    addEventListener('resize', frame, { passive: true });
    frame();
  });
})();
