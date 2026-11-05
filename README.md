# VIA77 website

Source for [www.via77.com.au](https://www.via77.com.au). Static site served from `public/`, with two small server functions in `functions/`.

## Cloudflare

Deployed by the `via77-site` Cloudflare Pages project (build output `public`, no build command). Merging to `main` goes live automatically. Every other branch gets a preview at `https://<branch>.via77-site.pages.dev`, which Cloudflare keeps out of search results.

- `public/_redirects`: page redirects. Pages cannot redirect one hostname to another from this file.
- `public/_headers`: noindex for `pages.dev` and the concept stores, plus basic security headers. These do not apply to Functions.
- `public/_routes.json`: limits Functions to `/api/*`, so static pages use no Function requests.
- `public/sitemap.xml`: lists indexable pages only. Update `lastmod` when a page changes substantively.

## Enquiry forms

`/contact/` and `/commerce-assessment/` use `public/enquiry.js`, `public/form-validation.js` and `functions/api/`.

Until these are set in Cloudflare Pages under Settings > Variables and Secrets (Production), the form prepares a downloadable brief and says plainly that nothing is sent:

| Name | Type | What it is |
| --- | --- | --- |
| `TURNSTILE_SITE_KEY` | Text | Cloudflare Turnstile site key |
| `TURNSTILE_SECRET_KEY` | Secret | Cloudflare Turnstile secret key |
| `SUPABASE_URL` | Text | `https://lvdxatacwqaiveoimrbc.supabase.co` |
| `SUPABASE_SECRET_KEY` | Secret | Supabase secret key, which saves enquiries for the dashboard |
| `RESEND_API_KEY` | Secret | Resend API key |
| `ENQUIRY_FROM` | Text | Verified Resend sender: `VIA77 Website <website@via77.com.au>` |
| `ENQUIRY_TO` | Text | Notification inbox: `info@via77.com.au` |

An enquiry counts as accepted once Supabase stores it or Resend accepts the email. Either service can fail without losing it.

Redeploy after setting them. Once they are in place, the button changes to "Send enquiry".

## Directors' dashboard

`dashboard/` is a separate static app, deployed by its own Cloudflare Pages project to `dashboard.via77.com.au` (root directory `dashboard`, no build command). Data and sign-in use the `via77` Supabase project. To add a director, add their email to the `directors` table.

## Concept stores

`/forme/`, `/atelier-09/`, `/still-house/`, `/aliyaskin/`, `/fern-and-field/`, `/uppers/`, `/salim/` and `/glassi/` are demonstrations and carry `noindex`. Case studies at `/work/<name>/` are the indexable versions. If one becomes a real client site, give it its own domain and remove its `noindex` rule.

Status labels on the site: Commerce concept, In development, Launched client project. Use the last two only when true and with permission.

## Before merging

Run `python3 tools/check-site.py`. It checks links, assets, titles, descriptions, canonicals, headings, JSON-LD and the sitemap.

## Caching

Cloudflare tells browsers to keep files for 4 hours. When changing CSS, JS or an image at the same path, use a new filename or `?v=` value.
