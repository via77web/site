/* One-page concept site: reveals, word scrub, tabs, magnetic CTA. Motion only through the
   motion system tokens in CSS; everything is readable without JavaScript. */
(function () {
  var html = document.documentElement;
  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $$ = function (s, c) { return [].slice.call((c || document).querySelectorAll(s)); };
  if (!reduced) html.classList.add('m');
  requestAnimationFrame(function () { html.classList.add('ready'); });

  // reveals with a capped stagger
  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
  }, { threshold: 0.14 }) : null;
  $$('[data-r]').forEach(function (el) {
    var sib = $$(':scope > [data-r]', el.parentElement), i = sib.indexOf(el);
    if (i > 0) el.style.setProperty('--d', Math.min(i, 7) * 60 + 'ms');
    io ? io.observe(el) : el.classList.add('in');
  });

  // S4 word scrub
  var st = document.querySelector('.statement p');
  if (st && !reduced) {
    var words = [];
    (function split(node) {
      [].slice.call(node.childNodes).forEach(function (n) {
        if (n.nodeType === 3) {
          var frag = document.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach(function (t) {
            if (!t) return;
            if (/^\s+$/.test(t)) { frag.appendChild(document.createTextNode(t)); return; }
            var s = document.createElement('span'); s.className = 'w'; s.textContent = t; frag.appendChild(s); words.push(s);
          });
          n.parentNode.replaceChild(frag, n);
        } else if (n.nodeType === 1) split(n);
      });
    })(st);
    var paint = function () {
      var r = st.getBoundingClientRect(), vh = innerHeight;
      var p = Math.min(1, Math.max(0, (vh * 0.85 - r.top) / (r.height + vh * 0.35)));
      var k = Math.round(p * words.length);
      words.forEach(function (w, i) { w.style.opacity = i < k ? 1 : 0.16; });
    };
    addEventListener('scroll', paint, { passive: true }); paint();
  }

  // tabs
  $$('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
      $$('.tab').forEach(function (x) { x.setAttribute('aria-pressed', String(x === t)); });
      $$('.panel').forEach(function (p) { p.classList.toggle('on', p.id === t.getAttribute('aria-controls')); });
    });
  });

  // M07 magnetic primary CTA (fine pointers only)
  if (!reduced && matchMedia('(hover:hover) and (pointer:fine)').matches) {
    $$('[data-magnet]').forEach(function (b) {
      var x = 0, y = 0, tx = 0, ty = 0, raf = 0;
      var loop = function () { x += (tx - x) * 0.18; y += (ty - y) * 0.18; b.style.transform = 'translate(' + x.toFixed(2) + 'px,' + y.toFixed(2) + 'px)'; if (Math.abs(tx - x) + Math.abs(ty - y) > 0.1) raf = requestAnimationFrame(loop); else raf = 0; };
      b.addEventListener('pointermove', function (e) { var r = b.getBoundingClientRect(); tx = (e.clientX - r.left - r.width / 2) * 0.35; ty = (e.clientY - r.top - r.height / 2) * 0.35; raf || (raf = requestAnimationFrame(loop)); });
      b.addEventListener('pointerleave', function () { tx = ty = 0; raf || (raf = requestAnimationFrame(loop)); });
    });
  }
})();
