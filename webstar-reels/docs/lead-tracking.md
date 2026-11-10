# Lead tracking setup

Each reel gets its own tracked link. Clicks, enquiries and Stripe deposits are logged against it in Supabase, so every reel shows **views → clicks → enquiries → deposits**.

```
reel caption / bio / ManyChat DM
        │  tracked link:  …/functions/v1/go/<reel id>?p=ig|tt|yt
        ▼
   go  (edge function)  ── logs a click ──►  lead_events
        │  302 to the brand's page with utm_source, utm_medium=reel, utm_campaign=<brand>-<day>,
        │  utm_content=<variant>, utm_term=<hook>, r=<reel id>
        ▼
   brand's site  +  tracking/track.js  (remembers the reel for 30 days)
        ├─ form submitted ──► lead (edge function) ──► lead_events: enquiry
        └─ Stripe Payment Link gets client_reference_id=<reel id>
                 └─ payment ──► stripe-webhook (edge function) ──► lead_events: deposit
```

## 1. Database

The schema is in `supabase/migrations/0001_reel_leads.sql`: tables `reels`, `tracked_links` and `lead_events`, and a view `reel_funnel` with one row per reel. Row-level security is on with no policies, so only the service role (these functions and the reel pipeline) can read or write. Nothing is readable with the public key.

```bash
supabase link --project-ref <your project ref>
supabase db push
```

Or paste the file into the Supabase SQL editor. You can use the existing `via77` project or a new one; a separate project keeps lead data away from the site's enquiry tables.

## 2. Functions

```bash
supabase functions deploy go --no-verify-jwt
supabase functions deploy lead --no-verify-jwt
supabase functions deploy stripe-webhook --no-verify-jwt
supabase secrets set STRIPE_SECRET_KEY=sk_live_... STRIPE_WEBHOOK_SECRET=whsec_...
```

`--no-verify-jwt` is needed because visitors and Stripe call these without a Supabase login. Each function checks its own input: `go` only redirects to destinations stored in `tracked_links`, `lead` only accepts events for brands and links that exist, and `stripe-webhook` verifies Stripe's signature.

## 3. Pipeline settings

In `.env`:

```
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_KEY=<service role key>          # keep this on the Mac only
TRACK_BASE_URL=https://<ref>.supabase.co/functions/v1/go
```

Then:

```bash
npm run tracking:setup
```

It saves each brand's link-in-bio and ManyChat DM links and prints them. Put the bio link in each Instagram and TikTok profile, and the DM link in ManyChat (see `manychat.md`).

From then on, every reel is registered with its own link when it is scheduled. TikTok and YouTube captions carry that link; Instagram captions carry the comment prompt (links in Instagram captions can't be tapped).

Without `TRACK_BASE_URL`, links go straight to the brand's page with the UTM tags on the end, and the site snippet counts the click instead.

## 4. On each brand's site

Copy `tracking/track.js` to the site and add it to every page:

```html
<script src="/track.js" data-endpoint="https://<ref>.supabase.co/functions/v1/lead" data-brand="webstar" defer></script>
```

Use `data-brand="via77"` or `"verrano"` on those sites. It:

- remembers the reel and UTM tags a visitor arrived with, for 30 days (in the browser's local storage; no cookies)
- logs an enquiry when any form is submitted, with the email, name and message fields it finds. Add `data-no-track` to a form to leave it out
- adds `client_reference_id=<reel id>` to Stripe Payment Links on the page

It only records people who arrive through a tracked link or submit a form. Mention it in each site's privacy policy: you are storing enquiry details and which post brought the visitor.

## 5. Stripe deposits

In Stripe → Developers → Webhooks, add an endpoint:

- URL: `https://<ref>.supabase.co/functions/v1/stripe-webhook`
- Event: `checkout.session.completed`

Copy its signing secret into `STRIPE_WEBHOOK_SECRET` (step 2). Deposits taken through Payment Links or Checkout are then recorded with their amount. One taken without a tracked visit is still recorded, as unattributed. If a brand has its own Stripe account, add the same endpoint there; set `metadata.brand` on its Payment Links so unattributed deposits still land under the right brand.

## Reading the funnel

In the Supabase table editor, open the `reel_funnel` view, or:

```sql
select day, brand, variant, hook, views, clicks, enquiries, deposits, deposit_cents / 100.0 as deposit_dollars
from reel_funnel
order by day desc;
```

Views, watch time and shares are filled in each Sunday from Buffer. The same numbers, ranked, are written to `brands/<id>/insights.md`.
