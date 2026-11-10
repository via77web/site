/* Reel attribution for a brand's site.
   <script src="/track.js" data-endpoint="https://<project>.supabase.co/functions/v1/lead" data-brand="webstar" defer></script>

   - Remembers which reel (and UTM tags) brought the visitor, for 30 days.
   - Sends an enquiry to the leads table when a form is submitted.
   - Adds the reel to Stripe Payment Links so deposits are attributed too.
   No cookies, and nothing is stored until a visitor arrives through a tracked link. */
(function () {
  var script = document.currentScript;
  var endpoint = script && script.getAttribute("data-endpoint");
  var brand = script && script.getAttribute("data-brand");
  if (!endpoint || !brand) return;
  var KEY = "reel_attribution";
  var DAYS = 30;
  var params = new URLSearchParams(location.search);

  function read() {
    try {
      var saved = JSON.parse(localStorage.getItem(KEY) || "null");
      return saved && Date.now() - saved.at < DAYS * 864e5 ? saved : null;
    } catch (e) {
      return null;
    }
  }
  function send(payload) {
    var body = JSON.stringify(Object.assign({ brand: brand, page: location.pathname }, payload));
    try {
      // text/plain keeps this a simple request, so no CORS preflight is needed.
      if (!navigator.sendBeacon || !navigator.sendBeacon(endpoint, new Blob([body], { type: "text/plain" }))) {
        fetch(endpoint, { method: "POST", body: body, keepalive: true });
      }
    } catch (e) {}
  }

  // Arriving through a tracked link (last one wins).
  if (params.get("r") || params.get("utm_source")) {
    var utm = {};
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach(function (k) {
      if (params.get(k)) utm[k] = params.get(k);
    });
    var landed = { r: params.get("r"), utm: utm, at: Date.now() };
    try {
      localStorage.setItem(KEY, JSON.stringify(landed));
    } catch (e) {}
    // The redirect link has already counted this click when g=1.
    if (params.get("g") !== "1") send({ type: "click", r: landed.r, utm: utm });
  }

  var attribution = read();

  // Enquiries: any form, unless it opts out with data-no-track.
  document.addEventListener(
    "submit",
    function (e) {
      var form = e.target;
      if (!form || form.hasAttribute("data-no-track") || form.getAttribute("role") === "search") return;
      var field = function (selector) {
        var el = form.querySelector(selector);
        return el && el.value ? String(el.value).slice(0, 2000) : null;
      };
      var a = read() || {};
      send({
        type: "enquiry",
        r: a.r || null,
        utm: a.utm || {},
        email: field('input[type="email"], input[name*="email" i]'),
        name: field('input[name*="name" i]'),
        message: field("textarea"),
      });
    },
    true
  );

  // Deposits: Stripe Payment Links carry the reel as client_reference_id.
  function tagStripe() {
    if (!attribution || !attribution.r) return;
    document.querySelectorAll('a[href*="buy.stripe.com"], a[href*="checkout.stripe.com"]').forEach(function (a) {
      try {
        var u = new URL(a.href);
        if (!u.searchParams.get("client_reference_id")) {
          u.searchParams.set("client_reference_id", attribution.r);
          a.href = u.toString();
        }
      } catch (e) {}
    });
  }
  tagStripe();
  document.addEventListener("DOMContentLoaded", tagStripe);
})();
