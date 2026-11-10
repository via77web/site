import type { Direction } from "../index.js";
import { emphasis, esc, money } from "../components/html.js";
import type { StoreSpec } from "../spec.js";
import { directionVars, fontLinks, styleAttr, type RenderedSite } from "./shared.js";

export interface StoreContext {
  brandName: string;
  images: Record<string, string>;
}

const VERSION = "1";
const ICON = {
  menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8h18M3 16h18"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
  bag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l-1 12H6L5 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>',
  done: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="22"/><path d="M15 25l6 6 12-13"/></svg>',
};

/** Demo store on the store-kit engine (library/store-kit), driven by kit.js and a catalogue. */
export function renderStore(spec: StoreSpec, d: Direction, ctx: StoreContext): RenderedSite {
  const cur = "A$";
  const m = (n: number) => money(n, cur);
  const name = esc(spec.storeName);
  const image = (id: string) => spec.images.find((i) => i.id === id);
  const src = (id: string) => esc(ctx.images[id] ?? "");
  const alt = (id: string) => esc(image(id)?.alt ?? "");
  const key = spec.storeName.toLowerCase().replace(/[^a-z0-9]/g, "") || "store";

  const lifestyle = [...new Set([...spec.story.steps.map((s) => s.imageId), ...spec.journal.imageIds])];
  const catalog = {
    products: spec.products.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      cat: p.cat,
      price: p.price,
      img: ctx.images[p.imageId],
      alt: image(p.imageId)?.alt ?? p.name,
      desc: p.desc,
      gallery: [ctx.images[p.imageId], ...lifestyle.slice(0, 2).map((id) => ctx.images[id])],
      options: {
        label: p.optionLabel,
        values: p.options.map((o) => (o.price && o.price !== p.price ? { v: o.v, price: o.price } : { v: o.v })),
      },
      details: p.details.map((x) => [x.k, x.v]),
    })),
  };
  const featured = spec.products[0];
  const featuredGallery = catalog.products[0].gallery;
  const vars = {
    ...directionVars(d),
    "--line": `color-mix(in srgb, ${d.colors.ink} 12%, transparent)`,
    "--line-strong": `color-mix(in srgb, ${d.colors.ink} 26%, transparent)`,
    // Long names get a smaller, tighter logo so the header still fits a 360px phone.
    "--logo-track": spec.storeName.length > 11 ? ".1em" : ".16em",
    "--logo-size": spec.storeName.length > 14 ? "13px" : spec.storeName.length > 11 ? "15px" : "17px",
    "--logo-w": "600",
    "--card-ar": "4/5",
    "--cols": "4",
    "--ft-bg": d.colors.bg2,
    "--ft-ink": d.colors.ink,
    "--big": "clamp(44px,11.6vw,205px)",
    "--big-track": "0",
    "--hero-ink": "#FFFFFF",
  };
  const nav = `<a href="#shop">Shop</a><a href="#story">${esc(spec.story.label)}</a><a href="#journal">${esc(spec.journal.title)}</a><a href="#pdp">Details</a>`;

  const card = (p: StoreSpec["products"][number]) => `
        <div class="card" data-id="${esc(p.id)}" data-cat="${esc(p.cat)}" data-r data-cursor="View">
          <div class="ph"><img src="${src(p.imageId)}" alt="${alt(p.imageId)}" loading="lazy" decoding="async"><button class="open" type="button" aria-label="View ${esc(p.name)}, ${m(p.price)}"></button><button class="qa" type="button" aria-label="Quick add ${esc(p.name)} to bag"><span>Quick add</span><span aria-hidden="true">+</span></button></div>
          <div class="meta"><h3>${esc(p.name)}</h3><span class="pr">${m(p.price)}</span><span class="ty">${esc(p.type)}</span></div>
        </div>`;

  const html = `<!DOCTYPE html>
<html lang="en" style="${styleAttr(vars)}" data-key="${key}" data-cur="${cur}" data-ship="${spec.shipThreshold}" data-shipfee="${spec.shipFee}">
<head>
<meta name="robots" content="noindex">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(spec.metaTitle)}</title>
<meta name="description" content="${esc(spec.metaDescription)}">
<meta name="theme-color" content="${d.colors.bg}">
${fontLinks(d)}
<link rel="stylesheet" href="assets/kit.css?v=${VERSION}">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<div class="notice"><div class="wrap"><span>A ${esc(ctx.brandName)} commerce concept · Demonstration checkout · Not a real store</span><span class="r">Free delivery over ${m(spec.shipThreshold)}</span></div></div>

<header class="hd" id="hd">
  <div class="wrap">
    <nav aria-label="Main">${nav}</nav>
    <button class="icon-btn menu-btn" id="menuBtn" type="button" aria-label="Open menu">${ICON.menu}</button>
    <a class="logo" href="#top" aria-label="${name} home">${name}</a>
    <div class="tools">
      <button class="icon-btn" id="openSearch" type="button" aria-label="Search">${ICON.search}<span class="lbl-t">Search</span></button>
      <button class="icon-btn" id="openCart" type="button" aria-label="Open bag">${ICON.bag}<span class="lbl-t">Bag</span><span class="count" id="cartCount"><span>0</span></span></button>
    </div>
  </div>
</header>
<div class="mnav" id="mnav" aria-label="Menu">${nav}<button class="x" type="button" aria-label="Close menu"></button></div>

<main id="main">
<section class="hero" id="top">
  <div class="bg"><img src="${src(spec.hero.imageId)}" alt="${alt(spec.hero.imageId)}" fetchpriority="high"></div>
  <div class="shade" aria-hidden="true"></div>
  <div class="in"><div class="wrap">
    <h1 class="disp" aria-label="${esc(spec.hero.lines.join(" "))}">${spec.hero.lines
      .map((l, i) => `<span class="ln" aria-hidden="true"><span style="--i:${i}">${esc(l)}</span></span>`)
      .join("")}</h1>
    <div class="side"><p>${esc(spec.hero.sub)}</p><a class="btn light" href="#shop">${esc(spec.hero.cta)} <span class="ar" aria-hidden="true">→</span></a></div>
  </div></div>
</section>

<section class="sec statement"><div class="wrap"><span class="eb lbl">${name}</span><p id="scrub">${emphasis(spec.statement)}</p></div></section>

<section class="sec" id="shop" style="padding-top:0">
  <div class="wrap">
    <div class="sec-h"><div><span class="eb lbl">The collection</span><h2 class="disp" data-r>${esc(spec.collection.title)}</h2></div><div style="display:flex;flex-direction:column;gap:16px;align-items:flex-end"><p data-r>${esc(spec.collection.intro)}</p><div class="filters" role="group" aria-label="Filter products"><button class="chip" type="button" data-f="all" aria-pressed="true">All</button>${spec.collection.categories
      .map((c) => `<button class="chip" type="button" data-f="${esc(c.id)}" aria-pressed="false">${esc(c.label)}</button>`)
      .join("")}</div></div></div>
    <div class="grid" id="grid">${spec.products.map(card).join("")}
    </div>
  </div>
</section>

<section class="sec" id="pdp" style="background:var(--bg2)">
  <div class="wrap">
    <form class="pdp" id="pdpForm" data-id="${esc(featured.id)}" novalidate>
      <div class="gal">
        <div class="thumbs">${featuredGallery
          .map((g, i) => `<button type="button" aria-label="Image ${i + 1} of ${featuredGallery.length}" aria-current="${i === 0}"><img src="${esc(g)}" alt="" loading="lazy"></button>`)
          .join("")}</div>
        <div class="stage" id="stage" data-cursor="Zoom">${featuredGallery
          .map((g, i) => `<img src="${esc(g)}" alt="${i === 0 ? alt(featured.imageId) : ""}" class="${i === 0 ? "on" : ""}" decoding="async"${i ? " loading=lazy" : ""}>`)
          .join("")}<span class="n lbl">1 / ${featuredGallery.length}</span></div>
      </div>
      <div class="info">
        <span class="lbl muted">${esc(spec.collection.categories.find((c) => c.id === featured.cat)?.label ?? "")} / 01</span>
        <h2 class="disp">${esc(featured.name)}</h2>
        <div class="price"><span class="pv"><span id="pdpPrice">${m(featured.price)}</span></span><small>${esc(featured.type)}</small></div>
        <p>${esc(featured.desc)}</p>
        <fieldset class="opt"><legend class="lbl muted">${esc(featured.optionLabel)}</legend><div class="opts">${featured.options
          .map((o, i) => `<input type="radio" name="opt" id="opt${i}" value="${esc(o.v)}"${i === 0 ? " checked" : ""}><label for="opt${i}">${esc(o.v)}</label>`)
          .join("")}</div></fieldset>
        <div class="buy"><div class="qty"><button type="button" data-d="-1" aria-label="Decrease quantity">−</button><output id="qty" aria-live="polite">1</output><button type="button" data-d="1" aria-label="Increase quantity">+</button></div>
          <button class="btn wide" id="addBtn" type="submit"><span class="st">Add to bag</span><span class="st2">Added ✓</span></button></div>
        <div class="acc">
          <details open><summary>Details <i></i></summary><div class="body"><dl>${featured.details
            .map((x) => `<dt>${esc(x.k)}</dt><dd>${esc(x.v)}</dd>`)
            .join("")}</dl></div></details>
          <details><summary>Delivery &amp; returns <i></i></summary><div class="body"><p>Free delivery over ${m(spec.shipThreshold)}. This is a concept store: checkout is a demonstration and takes no payment.</p></div></details>
        </div>
      </div>
    </form>
  </div>
</section>

<section class="sec" id="story">
  <div class="wrap">
    <div class="story">
      <div class="media" aria-hidden="true">${spec.story.steps
        .map((s, i) => `<img src="${src(s.imageId)}" alt="" class="${i === 0 ? "on" : ""}" loading="lazy" decoding="async">`)
        .join("")}<div class="prog">${spec.story.steps.map(() => "<i><b></b></i>").join("")}</div></div>
      <div class="steps"><span class="eb lbl">${esc(spec.story.label)}</span>${spec.story.steps
        .map((s, i, all) => `<div class="step"><span class="lbl muted">${String(i + 1).padStart(2, "0")} / ${String(all.length).padStart(2, "0")}</span><h3 class="disp">${esc(s.title)}</h3><p>${esc(s.body)}</p></div>`)
        .join("")}</div>
    </div>
  </div>
</section>

<section class="sec" id="journal" style="padding-top:0">
  <div class="wrap"><div class="sec-h"><div><span class="eb lbl">Journal</span><h2 class="disp" data-r>${esc(spec.journal.title)}</h2></div><p class="lbl muted">Drag to explore</p></div></div>
  <div class="reel" id="reel" data-cursor="Drag" tabindex="0" aria-label="${esc(spec.journal.title)} gallery, use arrow keys to scroll"><div class="track">${spec.journal.imageIds
    .map((id, i) => `<figure class="slide" style="margin:0"><div class="ph"><img src="${src(id)}" alt="${alt(id)}" loading="lazy" decoding="async" draggable="false"></div><figcaption class="cap"><span>${alt(id)}</span><span class="muted">${String(i + 1).padStart(2, "0")}</span></figcaption></figure>`)
    .join("")}</div></div>
  <div class="wrap"><div class="reel-bar"><div class="pg"><b></b></div><span class="lbl muted">${String(spec.journal.imageIds.length).padStart(2, "0")} images</span></div></div>
</section>

<section class="sec" style="padding-top:0"><div class="wrap"><div class="values">${spec.values
  .map((v) => `<div data-r><h3 class="disp">${esc(v.title)}</h3><p>${esc(v.body)}</p></div>`)
  .join("")}</div></div></section>

<section class="sec news"><div class="wrap"><div><span class="eb lbl">Newsletter</span><h2 class="disp">${esc(spec.newsletter.title)}</h2><p class="muted" style="margin:14px 0 0">${esc(spec.newsletter.body)}</p></div>
  <form class="nform" id="nform" novalidate><div class="f"><label class="lbl" for="nemail">Email</label><input id="nemail" type="email" autocomplete="email" placeholder="you@example.com"><span class="rule"></span></div><button class="btn" type="submit">Subscribe</button><span class="ok" aria-live="polite"></span></form></div></section>
</main>

<footer class="ft">
  <div class="wrap">
    <div class="cols"><div><span class="logo" style="padding-left:0">${name}</span><p style="opacity:.7;max-width:320px;font-size:14px;margin:16px 0 0">An original ${esc(ctx.brandName)} commerce concept. ${name} is not a real store; products, prices and checkout are for demonstration only.</p></div><div><h4 class="lbl">Shop</h4>${spec.collection.categories
      .map((c) => `<a href="#shop">${esc(c.label)}</a>`)
      .join("")}</div><div><h4 class="lbl">Help</h4><a href="#pdp">Delivery</a><a href="#pdp">Returns</a><a href="#pdp">Care</a></div><div><h4 class="lbl">${name}</h4><a href="#story">${esc(spec.story.label)}</a><a href="#journal">${esc(spec.journal.title)}</a></div></div>
    <div class="big" id="big" aria-hidden="true"><span class="o">${name}</span><span class="f">${name}</span></div>
    <div class="bot"><span>© ${new Date().getFullYear()} ${name} · A concept by ${esc(ctx.brandName)}</span><span>All prices in AUD, including GST</span><span class="sw-row">Motion <button class="mswitch" id="motionSwitch" role="switch" aria-checked="true" aria-label="Toggle motion"></button></span></div>
  </div>
</footer>

<div class="scrim" id="scrim" aria-hidden="true"></div>
<aside class="drawer" id="cart" role="dialog" aria-modal="true" aria-labelledby="cartTitle" aria-hidden="true">
  <div class="dh"><h2 class="disp" id="cartTitle">Your bag</h2><button class="x" type="button" data-close aria-label="Close bag"></button></div>
  <div class="ship" id="ship" style="padding:16px 24px 0"><span></span><div class="bar"><b></b></div></div>
  <div class="db" id="cartLines"></div>
  <div class="df"><div class="tot"><span>Subtotal</span><span id="subtotal">${cur}0</span></div><p class="fine">Delivery calculated at checkout. Concept store: no payment is taken.</p><button class="btn wide" id="checkoutBtn" type="button">Checkout <span class="ar" aria-hidden="true">→</span></button></div>
</aside>
<aside class="drawer wide" id="qv" role="dialog" aria-modal="true" aria-labelledby="qvTitle" aria-hidden="true">
  <div class="dh"><span class="lbl" id="qvTitle">Quick view</span><button class="x" type="button" data-close aria-label="Close"></button></div>
  <div id="qvBody" style="flex:1;min-height:0"></div>
</aside>
<div class="search" id="search" role="dialog" aria-modal="true" aria-label="Search" aria-hidden="true">
  <div class="sf"><label class="sr" for="sInput">Search products</label><input id="sInput" type="search" placeholder="Search ${name}" autocomplete="off" data-focus><button class="x" type="button" data-close aria-label="Close search"></button></div>
  <div class="sres" id="sRes" aria-live="polite"></div>
</div>
<div class="co" id="co" role="dialog" aria-modal="true" aria-labelledby="coTitle" aria-hidden="true">
  <div class="main">
    <div class="top"><span class="logo" style="padding-left:0">${name}</span><button class="x" type="button" data-close aria-label="Close checkout"></button></div>
    <div class="stepper lbl"><span class="on">Contact</span><span>Delivery</span><span>Payment</span><span>Done</span></div>
    <div class="panel on"><h2 class="disp" id="coTitle">A clear final step.</h2><span class="demo">Demonstration checkout. Nothing is charged or sent.</span>
      <label>Email<input type="email" required autocomplete="email" placeholder="you@example.com"></label>
      <div class="row2"><label>First name<input required autocomplete="given-name"></label><label>Last name<input required autocomplete="family-name"></label></div>
      <button class="btn" type="button" data-next>Continue to delivery <span class="ar" aria-hidden="true">→</span></button></div>
    <div class="panel"><h2 class="disp">Delivery</h2>
      <label>Address<input required autocomplete="street-address" placeholder="Street address"></label>
      <div class="row2"><label>Suburb<input required autocomplete="address-level2"></label><label>Postcode<input required inputmode="numeric" pattern="[0-9]{4}" autocomplete="postal-code"></label></div>
      <label class="radio"><span>Standard delivery</span><span><input type="radio" name="dm" checked> 3–5 business days</span></label>
      <label class="radio"><span>Express</span><span><input type="radio" name="dm"> Next business day</span></label>
      <div style="display:flex;gap:12px"><button class="btn ghost" type="button" data-back>Back</button><button class="btn" type="button" data-next>Continue to payment <span class="ar" aria-hidden="true">→</span></button></div></div>
    <div class="panel"><h2 class="disp">Payment</h2><span class="demo">This is a concept store. No card details are requested and no payment is taken.</span>
      <label class="radio"><span>Pay with card</span><span>Demo only</span></label>
      <div style="display:flex;gap:12px"><button class="btn ghost" type="button" data-back>Back</button><button class="btn" type="button" id="placeOrder">Place demo order <span class="ar" aria-hidden="true">→</span></button></div></div>
    <div class="panel"><div class="done-ok">${ICON.done}<h2 class="disp">Thank you.</h2>
      <p class="muted" style="margin:0">Demo order <b id="orderNo"></b> placed. In a live store this is where the confirmation email, delivery estimate and tracking would appear.</p>
      <button class="btn" type="button" data-close>Back to ${name}</button></div></div>
  </div>
  <div class="side"><span class="lbl muted">Order summary</span><div id="coLines" style="margin:16px 0"></div>
    <div class="tot" style="font-size:15px;margin-bottom:8px"><span>Subtotal</span><span id="coSub"></span></div><div class="tot" style="font-size:15px;margin-bottom:8px"><span>Delivery</span><span id="coShip"></span></div><div class="tot"><span>Total</span><span id="coTot"></span></div></div>
</div>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<div class="cur" id="cur" aria-hidden="true"><b></b></div>

<script type="application/json" id="catalog">${JSON.stringify(catalog).replace(/</g, "\\u003c")}</script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/lenis@1.1.13/dist/lenis.min.js"></script>
<script src="assets/kit.js?v=${VERSION}"></script>
</body>
</html>
`;
  return { files: { "index.html": html }, copy: { "assets/kit.css": "store-kit/kit.css", "assets/kit.js": "store-kit/kit.js" } };
}
