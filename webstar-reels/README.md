# webstar-reels

A content engine for WEBSTAR and VIA77: **prompt → site → reels → approval → post**.

- Give it a one-line brief and it designs and builds a concept site (or a demo store for VIA77) on your design system, generates its imagery, audits it, and deploys a Vercel preview.
- Every site, generated or from a queue, becomes **four reels** from one recording session: a full scroll, detail zooms, a before/after wipe and an interaction demo. Each reel has its own hook, voiceover and caption.
- You get a review issue (and optionally an email) with the preview link and all four reels. **Nothing posts until you approve.**
- Approved reels go into each brand's calendar slots across Instagram Reels, TikTok and YouTube Shorts, never the same site twice in a day.
- Seasonal campaigns (EOFY, Black Friday, Christmas, New Year) switch in their own hooks and briefs on their dates.

## How it fits together

```
brief ──► make: direction + copy (Claude) ─► images (Nano Banana 2) ─► build (library/) ─► audit ─► Vercel preview
                                                                                                        │
sites.json queue ───────────────────────────────────────────────────────────────────────────────────────┤
                                                                                                        ▼
                         reels: one recording session ─► 4 scripts (Claude) ─► 4 voiceovers (ElevenLabs) ─► 4 edits (Remotion)
                                                                                                        │
                                                    review issue + email ◄──────────────────────────────┘
                                                            │  /approve all · /approve full detail · /reject
                                                            ▼
                                       calendar slots ─► Buffer ─► Instagram Reels · TikTok · YouTube Shorts
```

## The four reels

| Variant | Footage | Script angle |
| --- | --- | --- |
| `full` | Hero to footer, pausing on key sections | The whole site |
| `detail` | Slow push-in zooms on two or three spots: the headline, a product, a motion moment | Craft and detail |
| `before-after` | The page with its design switched off, then a wipe reveals the real design; both scroll in step | What design does. If a site in `sites.json` has a `beforeUrl`, its real earlier version is used instead. The script is told never to call the unstyled page someone's "old website". |
| `interaction` | A visible finger taps through add-to-bag, filters, tabs, FAQs and drawers, and the site responds | How it feels to use. Skipped if the page has nothing tappable. |

Concept sites carry a "Concept" tag on screen, and every post caption starts with "Concept ·" (enforced in code, not left to the script).

## Commands

| Command | What it does |
| --- | --- |
| `npm run make "<brief>" --brand=webstar` | Brief → site → preview → four reels → review request |
| `npm run make "<brief>" --brand=via77 -- --dry-run` | Build, audit and render, but don't deploy, save or send |
| `npm run make "<brief>" --brand=via77 -- --mock` | Same with the example spec, placeholder images, canned scripts and a silent voice: no API keys, no cost |
| `npm run make "<brief>" --brand=webstar -- --no-reels` | Stop after the site (preview and audit only) |
| `npm run daily` | What the daily Action runs: schedule approved reels, then make the next batch if the calendar needs it |
| `npm run approve -- <batch-id> all` | Approve every reel in a batch. Or name variants (`full detail`), or `reject` |
| `npm run schedule` | Put approved reels into their slots now |
| `npm run reel:mock` | Mock reels for each brand's next queued site |
| `npm test` | Unit tests: calendar, campaigns, slotting rules, approval parsing, contrast of every direction |
| `npm run buffer:channels` | List your Buffer channel IDs |
| `npm run studio` | Remotion editor for the reel design (run a mock first) |

`--brand=via77` works as written: npm keeps that flag for itself, so `make` reads it back from npm.

## Approval

When a batch is ready, a GitHub issue labelled `reel-review` opens with the preview link, the audit result, each reel's video link, hook, caption and YouTube title. GitHub notifies you about new issues in your repo; set `RESEND_API_KEY` and `NOTIFY_EMAIL` to also get an email.

Reply on the issue:

| Comment | Result |
| --- | --- |
| `/approve all` | All four approved |
| `/approve full detail` | Those approved, the rest rejected |
| `/reject` | All rejected |
| `/reject before-after` | That one rejected, the rest still waiting |

The Approve workflow records your decision, schedules approved reels into the next free slots, replies on the issue and closes it. Only people with a role on the repo (owner, member, collaborator) can approve. Without GitHub, use `npm run approve`.

## Calendar and campaigns

`calendar.json` holds the posting slots and campaigns:

- **Slots**: WEBSTAR at 12pm and 6pm, VIA77 at 7pm, Melbourne time, every day (`days` can limit it).
- **Spacing**: a site gets at most one post a day across its four reels, and where another site is available the same site is never posted twice in a row. A slot stays empty rather than break the one-a-day rule.
- **Making more**: each day, if the next `lookaheadDays` of slots can't be filled from what's approved or awaiting review (reviews older than three days stop counting), the daily run makes one new batch for that brand: the next `pending` site in `brands/<id>/sites.json`, else (with `autoMake`) an unused brief from the running campaign, else the next one in `brands/<id>/briefs.json`.
- **Campaigns**: each has a date range (`from`/`to` as MM-DD; New Year wraps past 1 January), an angle given to Claude for sites and scripts, hashtags added to every caption, and hooks and briefs per brand. While a campaign runs, its hooks are used before the brand's own. Included: EOFY (June), Black Friday (16–30 Nov), Christmas (1–24 Dec), New Year (26 Dec–15 Jan).

## Generated sites

`make` and the daily auto-make use the design library in [`library/`](library/README.md):

1. **Direction and copy**: Claude picks one of the brand's design directions and writes the whole site as a typed spec: business name, copy, products and prices for stores, and a photography brief for each image. Banned phrases and invented reviews, stats or real brand names are refused; the spec is checked and sent back if it breaks a rule.
2. **Images**: each image prompt follows your Nano Banana brand photographer structure (subject, scene, lighting, then the direction's style) and is generated with Nano Banana 2 (`gemini-3.1-flash-image`) through the Gemini API. Without `GEMINI_API_KEY`, or if an image fails, a placeholder in the direction's colours is used and the review lists it.
3. **Build**: WEBSTAR gets a one-page site (`library/layouts/onepage.ts`); VIA77 gets a demo store on the store-kit engine (`library/layouts/store.ts`). Both use only the motion-system tokens and say clearly that they are concepts.
4. **Audit**: axe-core accessibility checks at phone and desktop size, controls cut off at the screen edge, sideways scroll, missing alt text, the concept label, banned phrases, console errors and easings outside the motion system. If anything blocks, Claude gets one round to fix the spec; anything still failing is flagged at the top of the review.
5. **Preview**: deployed to Vercel as a preview in a per-brand project (`<brand>-concepts`). Reels are recorded from the local build, so Vercel's preview protection doesn't get in the way. Logged into Vercel, you can open the preview; to share it more widely, change the project's Deployment Protection.

## Setup

### 1. Put this in its own repository

GitHub only runs workflows from `.github/workflows/` at the root of a repository, so this folder needs to be its own repo:

```bash
cp -r webstar-reels ~/webstar-reels && cd ~/webstar-reels
git init && git add -A && git commit -m "Initial commit"
gh repo create webstar-reels --public --source . --push
```

It needs to be **public**: Buffer downloads each video from a URL, and reels are hosted as GitHub Release files, which are only publicly downloadable on a public repo.

### 2. Accounts and keys

Connect each brand's Instagram (Business or Creator), TikTok and YouTube channel in Buffer. Then set these as repository secrets (**Settings → Secrets and variables → Actions**) and, for local runs, in `.env`:

| Secret | For |
| --- | --- |
| `ANTHROPIC_API_KEY` | Sites and scripts |
| `ELEVENLABS_API_KEY` | Voiceovers |
| `BUFFER_ACCESS_TOKEN` | Scheduling |
| `GEMINI_API_KEY` | Images for generated sites |
| `VERCEL_TOKEN` (and `VERCEL_TEAM_ID` for a team) | Preview deployments |
| `ELEVENLABS_VOICE_ID_WEBSTAR`, `ELEVENLABS_VOICE_ID_VIA77` | Each brand's voice |
| `BUFFER_PROFILE_IDS_WEBSTAR`, `BUFFER_PROFILE_IDS_VIA77` | Each brand's Instagram, TikTok and YouTube channels, e.g. `instagram:abc,tiktok:def,youtube:ghi` |
| `RESEND_API_KEY`, `NOTIFY_EMAIL`, `NOTIFY_FROM` | Optional review emails |
| `BUFFER_ACCESS_TOKEN_VIA77` | Optional, if VIA77's channels are in a separate Buffer account |

### 3. Try it locally

Needs Node 20+ and `ffmpeg`.

```bash
npm install
npx playwright install chromium
npx remotion browser ensure
cp .env.example .env

npm test
npm run make "A mobile dog groomer in Melbourne's south-east" --brand=webstar -- --mock
```

The site lands in `out/sites/<brand>/` and the reels in `out/<brand>/<batch>/`.

### 4. Turn it on

The three workflows run themselves once the secrets are set:

- **Daily** (`daily.yml`): every day at 9am AEDT.
- **Make** (`make.yml`): **Actions → Make → Run workflow** with a brief and a brand.
- **Approve** (`approve.yml`): runs when you comment on a review issue.

Try **Daily** with **dry_run** ticked first; the reels are attached to the run as an artifact.

## State

Everything the engine remembers is committed to the repo by the workflows:

- `brands/<id>/sites.json`: queue of existing sites (`pending` → `rendered`, or `failed` after 3 attempts).
- `brands/<id>/briefs.json`: backlog of one-line briefs for concept sites.
- `brands/<id>/batches/<id>.json`: each batch: site, preview link, audit, and per reel its script, caption, video URL, status (`awaiting`, `approved`, `rejected`, `scheduled`), slot and Buffer post IDs.

Rendered files live in `out/` (not committed) and as workflow artifacts for 14 days; the reels themselves stay in GitHub Releases.

## Brands

Brand voice, theme, scroll speed, CTA and rules are in `brands/<id>.json`, as before; see the comments in `src/lib/brand.ts`. Each brand's hooks are in `brands/<id>/hooks.json`, used in order, one per reel. To add a brand: add its config, `sites.json`, `hooks.json`, `briefs.json`, music in `public/brands/<id>/`, slots in `calendar.json`, at least one direction in `library/directions/` listing it, and its secrets in the three workflows.

## Good to know

- **Cost per batch**: one Claude call for four scripts, four ElevenLabs voiceovers, and for generated sites one or two Claude calls for the site plus 5–9 images.
- **Buffer's API** isn't public documentation this project could check while being built. The Instagram Reel and YouTube Shorts fields in `src/steps/post.ts` follow Buffer's GraphQL API as best understood; run one approval on a test batch and confirm the posts appear correctly in Buffer before relying on it.
- GitHub pauses scheduled workflows in repos with no activity for 60 days; the daily state commits keep it active.
- Remotion is free for individuals and companies of up to three people; larger companies need a [Remotion licence](https://www.remotion.dev/license).
