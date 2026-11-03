# VIA77 website

Source for [via77.com.au](https://www.via77.com.au). Static site, served from `public/`.

## Cloudflare

If this repo is connected to Cloudflare Pages, use no build command and `public` as the output directory.

## Not in this repo yet

The live site has server code behind its forms at `/api/project` and `/api/form-config`. Only the public files could be copied from the live site, so that code is missing here. Add it to `functions/` before deploying this repo over the live site, or the contact and assessment forms will stop working.
