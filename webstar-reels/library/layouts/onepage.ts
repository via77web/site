import { DEFAULT_COMPONENTS, type Direction } from "../index.js";
import { emphasis, esc, plain } from "../components/html.js";
import type { OnePageSpec } from "../spec.js";
import { directionVars, fontLinks, styleAttr, type RenderedSite } from "./shared.js";

export interface OnePageContext {
  brandName: string;
  /** image id -> file path relative to the site root */
  images: Record<string, string>;
}

const VERSION = "2";

export function renderOnePage(spec: OnePageSpec, d: Direction, ctx: OnePageContext): RenderedSite {
  const img = (id: string) => spec.images.find((i) => i.id === id);
  const picture = (id: string, eager = false) => {
    const i = img(id);
    return i
      ? `<img src="${esc(ctx.images[id])}" alt="${esc(i.alt)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`
      : "";
  };
  // Emphasis markers are only for the statement; strip any that end up in the headline.
  const headline = plain(spec.hero.headline);
  const words = headline.split(/\s+/);
  const half = Math.ceil(words.length / 2);
  const lines = words.length > 3 ? [words.slice(0, half).join(" "), words.slice(half).join(" ")] : [headline];
  const name = esc(spec.businessName);

  const c = { ...DEFAULT_COMPONENTS, ...(d.components ?? {}) };
  const has = (x: (typeof c.standouts)[number]) => c.standouts.includes(x);
  const h1 = `<h1 class="disp" aria-label="${esc(headline)}">${lines
    .map((l, i) => `<span class="ln" aria-hidden="true"><span style="--i:${i}">${esc(l)}</span></span>`)
    .join("")}</h1>`;
  const heroCta = `<a class="btn" href="#contact" data-magnet>${esc(spec.hero.cta)} <span class="ar" aria-hidden="true">→</span></a>`;
  const eyebrow = `<span class="eyebrow lbl">${esc(spec.hero.eyebrow)}</span>`;
  const badge = has("badge") ? `<span class="badge" aria-hidden="true">${esc(spec.location.split(",")[0])}</span>` : "";

  const hero =
    c.hero === "fullbleed"
      ? `<section class="hero hero--fullbleed" id="top">
  <div class="bg">${picture(spec.hero.imageId, true)}</div><div class="shade" aria-hidden="true"></div>
  <div class="wrap">${eyebrow}${h1}<div class="sub"><p>${esc(spec.hero.sub)}</p>${heroCta}</div></div>${badge}
</section>`
      : c.hero === "type"
        ? `<section class="hero hero--type" id="top"><div class="wrap">
  ${eyebrow}${h1}
  <div class="sub"><p>${esc(spec.hero.sub)}</p>${heroCta}</div>
  <div class="hero-img-wrap">${badge}<div class="hero-img">${picture(spec.hero.imageId, true)}</div></div>
</div></section>`
        : `<section class="hero" id="top"><div class="wrap"><div class="grid">
  <div>${eyebrow}${h1}<div class="sub"><p>${esc(spec.hero.sub)}</p>${heroCta}</div></div>
  <div class="hero-img-wrap">${badge}<div class="hero-img">${picture(spec.hero.imageId, true)}</div></div>
</div></div></section>`;

  const num = (i: number) => String(i + 1).padStart(2, "0");
  const services =
    c.services === "cards"
      ? `<div class="svc-cards">${spec.services.items
          .map((x, i) => `<div class="svc-card" data-r><b>${num(i)}</b><h3 class="disp">${esc(x.title)}</h3><p>${esc(x.body)}</p></div>`)
          .join("")}</div>`
      : c.services === "list"
        ? `<div class="svc-list">${spec.services.items
            .map((x, i) => `<div class="svc-row" data-r><b>${num(i)}</b><h3 class="disp">${esc(x.title)}</h3><p>${esc(x.body)}</p></div>`)
            .join("")}</div>`
        : `<div class="tabs" role="group" aria-label="Services">${spec.services.items
            .map((x, i) => `<button class="tab" type="button" aria-pressed="${i === 0}" aria-controls="svc-${i}">${esc(x.title)}</button>`)
            .join("")}</div>
  ${spec.services.items
    .map((x, i) => `<div class="panel${i === 0 ? " on" : ""}" id="svc-${i}"><h3 class="disp">${esc(x.title)}</h3><p>${esc(x.body)}</p></div>`)
    .join("\n  ")}`;

  // The band repeats its words once so the loop is seamless; the copy is hidden from screen readers.
  const words3 = spec.services.items.map((x) => `<span>${esc(x.title)}</span>`).join("");
  const marquee = has("marquee") ? `<div class="marquee" aria-hidden="true"><div>${words3}${words3}${words3}${words3}</div></div>` : "";

  const ctaInner = `<h2 class="disp">${esc(spec.cta.headline)}</h2><div><p>${esc(spec.cta.body)}</p>
  <div style="margin-top:22px"><a class="btn" href="#top">${esc(spec.cta.button)} <span class="ar" aria-hidden="true">→</span></a></div></div>`;
  const cta =
    c.cta === "band"
      ? `<section class="cta-band" id="contact"><div class="wrap"><div class="inner" data-r>${ctaInner}</div></div></section>`
      : `<section class="sec" id="contact" style="padding-top:0"><div class="wrap"><div class="cta" data-r>${ctaInner}</div></div></section>`;

  const html = `<!DOCTYPE html>
<html lang="en" style="${styleAttr(directionVars(d))}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(spec.metaTitle)}</title>
<meta name="description" content="${esc(spec.metaDescription)}">
<meta name="theme-color" content="${d.colors.bg}">
${fontLinks(d)}
<link rel="stylesheet" href="assets/motion.css?v=${VERSION}">
<link rel="stylesheet" href="assets/site.css?v=${VERSION}">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<div class="concept"><div class="wrap"><span>Concept site by ${esc(ctx.brandName)}. ${name} is not a real business.</span><span class="r">${esc(spec.location)}</span></div></div>
<header class="nav${c.nav === "bar" ? "" : ` nav--${c.nav}`}"><div class="wrap">
  <a class="brand" href="#top">${name}</a>
  <nav aria-label="Main"><a href="#services">Services</a><a href="#how">How it works</a><a href="#faq">FAQ</a></nav>
  <a class="btn sm" href="#contact">${esc(spec.cta.button)}</a>
</div></header>

<main id="main">
${hero}
${marquee}
<section class="sec statement alt" aria-label="About ${name}"><div class="wrap"><p>${emphasis(spec.statement)}</p></div></section>

<section class="sec" id="services"><div class="wrap">
  <div class="sec-h"><h2 class="disp" data-r>${esc(spec.services.title)}</h2><p data-r>${esc(spec.services.intro)}</p></div>
  ${services}
</div></section>

<section class="sec alt"><div class="wrap"><div class="show">
  <figure data-r>${picture(spec.showcase.imageId)}</figure>
  <div data-r><div class="sec-h" style="margin-bottom:0"><h2 class="disp">${esc(spec.showcase.title)}</h2><p>${esc(spec.showcase.body)}</p></div>
    <ul>${spec.showcase.points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul></div>
</div></div></section>

<section class="sec" id="how"><div class="wrap">
  <div class="sec-h"><h2 class="disp" data-r>${esc(spec.steps.title)}</h2></div>
  <div class="steps${has("big-numbers") ? " steps--big" : ""}">${spec.steps.items
    .map((s, i) => `<div class="step" data-r><b>${String(i + 1).padStart(2, "0")}</b><h3 class="disp">${esc(s.title)}</h3><p>${esc(s.body)}</p></div>`)
    .join("")}</div>
</div></section>

<section class="sec alt"><div class="wrap">
  <div class="sec-h"><h2 class="disp" data-r>${esc(spec.gallery.title)}</h2></div>
  <div class="gal${c.gallery === "bento" ? "" : ` gal--${c.gallery}`}"${c.gallery === "strip" ? ' tabindex="0" role="group" aria-label="Gallery, scroll sideways"' : ""}>${spec.gallery.imageIds.map((id) => `<figure data-r>${picture(id)}</figure>`).join("")}</div>
</div></section>

<section class="sec" id="faq"><div class="wrap">
  <div class="sec-h"><h2 class="disp" data-r>${esc(spec.faq.title)}</h2></div>
  <div class="faq">${spec.faq.items
    .map((f) => `<details><summary>${esc(f.q)}<i aria-hidden="true"></i></summary><div class="a"><div><p>${esc(f.a)}</p></div></div></details>`)
    .join("")}</div>
</div></section>

${cta}
</main>

<footer class="ft"><div class="wrap">
  <span class="brand">${name}</span>
  <span>${esc(plain(spec.tagline))} · ${esc(spec.location)}</span>
  <span>A concept site designed by ${esc(ctx.brandName)}. ${name} is not a real business, and nothing on this page can be booked or bought.</span>
</div></footer>
<script src="assets/site.js?v=${VERSION}"></script>
</body>
</html>
`;
  return {
    files: { "index.html": html },
    copy: {
      "assets/motion.css": "tokens/motion.css",
      "assets/site.css": "components/onepage.css",
      "assets/site.js": "components/onepage.js",
    },
  };
}
