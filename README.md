# VIA77 website

Source for [via77.com.au](https://www.via77.com.au). Static site, served from `public/`.

## Cloudflare

Deployed by the `via77-site` Cloudflare Pages project. Anything merged to `main` goes live automatically.

## Forms

The contact and assessment forms don't send enquiries anywhere. People only get a copy of their own answers. `/api/project` and `/api/form-config` aren't in this repo.

## Caching

Cloudflare tells browsers to keep files for 4 hours. When changing CSS, JS or an image at the same path, update its `?v=` value or filename so visitors get the new version.
