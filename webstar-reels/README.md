# webstar-reels

A content engine for **WEBSTAR**, **VIA77** and **VERRANO** that runs on your Mac.

- **Sunday 6am**: makes the coming week. WEBSTAR and VIA77 get a concept site a day (designed, written, imaged, built, audited, previewed), each recorded from four angles. VERRANO gets a reel a day from its own project photos and website.
- **Every day 6am**: picks today's reel for each brand, notifies you, and waits on a local approval page. Each reel you approve is scheduled to Instagram Reels, TikTok and YouTube Shorts at the brand's calendar slot. **Nothing posts without a yes.**
- **Claude runs on your subscription.** Scripts, captions, site copy and briefs are written by Claude Code in headless mode (`claude -p`), not the API.
- Every run is logged to `logs/`, failed steps are retried once, and errors notify you.

## The week

| When | Job | What happens |
| --- | --- | --- |
| Sunday 6:00 | `weekly` | For each of the next 7 days that has no reel yet: WEBSTAR and VIA77 make a site (the queue in `brands/<id>/sites.json` first, then the running campaign's briefs, then the brief backlog, topped up by Claude when it runs dry), record all four angles and pre-render them. One angle is planned for that day and the other three are kept as spares. VERRANO renders one reel per day, cycling through its five formats. |
| Daily 6:00 | `daily` | Schedules anything approved earlier. Puts today's planned reels up for approval (one per brand per calendar slot, falling back to a spare if a day is missing), sends a notification, and serves the approval page at `http://localhost:4777`. Waits until 30 minutes before the day's first slot. Undecided reels don't post; they go back into the pool. |

The Mac wakes at 5:55 every day (`pmset`), and each job keeps it awake while it runs (`caffeinate`). If the Mac was asleep at 6:00, launchd runs the job as soon as it wakes. If it was switched off, that run is missed; `pmset` powers on desktop Macs, and you can always run `./scripts/run-job.sh daily` by hand.

### Posting slots

`calendar.json`, Melbourne time:

| Brand | Slot |
| --- | --- |
| VERRANO | 12:00 |
| WEBSTAR | 18:00 |
| VIA77 | 19:00 |

Add more times to a brand's `slots` to post more than once a day; the daily job then offers that many reels. A site never posts twice in a day. Seasonal campaigns (EOFY, Black Friday, Christmas, New Year) switch in their own hooks, briefs and hashtags on their dates.

## Approving

The notification opens the approval page (with `terminal-notifier` installed; otherwise open `http://localhost:4777` yourself). For each reel you can watch it, read the hook, caption and YouTube title, open the site preview, and:

- **Approve**: uploaded and scheduled to Buffer at the brand's next slot, straight away.
- **Swap for another**: reject this one and offer a spare reel instead.
- **Reject**: it never posts.

Other ways in:

- `npm run review`: open the page any time, e.g. for reels you made with `npm run make`, which appear under "Other ready reels".
- `npm run approve -- <batch-id> all` (or name variants, or `reject`).
- Email and phone copies of the notification: set `RESEND_API_KEY` + `NOTIFY_EMAIL`, or `NTFY_TOPIC` with the [ntfy](https://ntfy.sh) app. The approval page itself only opens on the Mac.

## Reels

### WEBSTAR and VIA77: four angles per site

| Angle | Footage |
| --- | --- |
| `full` | Hero to footer, pausing on key sections |
| `detail` | Slow push-ins on the headline, a product and a motion moment |
| `before-after` | The page with its design switched off, then a wipe reveals the real design (or a real earlier version, if the queue entry has `beforeUrl`) |
| `interaction` | A finger taps through add-to-bag, filters, tabs and FAQs |

Concept sites carry an on-screen "Concept" tag, and every caption starts "Concept ·".

### VERRANO: five formats from its own photos and website

| Format | Footage |
| --- | --- |
| `transformation` | A before photo, then a wipe to the after. Used where the library has a before/after pair; otherwise it becomes a showcase. |
| `showcase` | Slow pans and zooms across 3–4 photos of one space (cabinets, tea rooms, meeting rooms), each labelled |
| `finish` | Deep zooms into photos of one material, with its name on a swatch-style card (e.g. Cover Styl', 3M DI-NOC) |
| `explainer` | "Wrap vs replace": an animated comparison of cost, time, downtime and waste over a dimmed project photo |
| `site-scroll` | A phone recording of a verrano.com.au page, a different page each time |

Photos used recently are avoided, so the feed doesn't repeat. Verrano scripts may only state facts found in the crawled site copy: any figure that doesn't appear there is sent back to Claude to remove. So the explainer stays qualitative ("Lower", "Faster") unless Verrano's site states a number.

**Animated stills (optional):** set `ANIMATE_STILL_CMD` to your fal/Wan script, e.g. `python3 ~/scripts/wan.py --image {input} --out {output} --prompt {prompt}`. Showcase photos are then turned into short clips first, falling back to the still if a clip fails.

## Verrano's library

```bash
npm run library:crawl -- --brand verrano    # crawl verrano.com.au into brands/verrano/library
npm run library:tag -- --brand verrano      # optional: Claude looks at every photo
```

The crawl reads the sitemap and follows links (up to 80 pages). For every page it saves the title, headings and copy. For every image it saves the largest version (full-size originals instead of WordPress thumbnails, lightbox links, `srcset`, background images) with its alt text, caption, nearest heading and page. It then works out:

- **Spaces** (cabinets, tea room, meeting room, reception, doors, lifts, bathroom, desks, retail, walls) from the words around each image.
- **Materials and finishes**: Cover Styl', 3M / DI-NOC and other film brands mentioned, plus named finishes on finish or range pages.
- **Before/after pairs**: a "before" and an "after" in the same slider or figure.
- **Services copy and facts**: sentences with figures or comparisons. These are the only facts reels may state.
- **Logo**: saved to `public/brands/verrano/` for the end card.
- **Brand colours** found on buttons, for checking `brands/verrano.json`.

Duplicate images are dropped. **Images under 900px on the short side or 1200px on the long side are skipped and logged** (in `logs/` and in `library.json` under `skipped`); change the thresholds with `--min-short` / `--min-long`.

The tag step has Claude Code open each photo with its Read tool (on your subscription) and add a description, spaces, a before/after role and a quality grade. Photos graded "poor" are never used. It's worth running once: the crawler can only guess from surrounding text.

Everything is in `brands/verrano/library/library.json`. Edit it by hand to fix a pair, a material name or a space, and future reels pick it up.

## Setup on the Mac

### 1. Put this in its own repository

```bash
cp -r webstar-reels ~/webstar-reels && cd ~/webstar-reels
git init && git add -A && git commit -m "Initial commit"
gh repo create webstar-reels --public --source . --push
```

It must be **public**: Buffer downloads approved reels from GitHub Release files, which are only public on a public repo. Nothing runs on GitHub; it's only used for hosting the videos.

### 2. Tools

```bash
brew install node ffmpeg gh terminal-notifier
gh auth login
npm install -g @anthropic-ai/claude-code
claude          # then /login with your Claude account, and /exit
```

### 3. Keys

```bash
cp .env.example .env
```

Fill in ElevenLabs, Buffer, `GITHUB_REPOSITORY`, and each brand's voice and Buffer channel IDs (`npm run buffer:channels` lists them; connect each brand's Instagram, TikTok and YouTube in Buffer first). Add `GEMINI_API_KEY` for generated-site images and `VERCEL_TOKEN` for preview links. Leave `ANTHROPIC_API_KEY` empty to run Claude on your subscription.

### 4. Run the setup script

```bash
./scripts/setup-mac.sh
```

It:

1. checks the tools and installs dependencies and browsers
2. runs `npm run check -- --live` (keys, gh login, one tiny Claude Code call to confirm the subscription works)
3. installs two launchd jobs, `com.webstar-reels.weekly` (Sunday 6:00) and `com.webstar-reels.daily` (every day 6:00), in `~/Library/LaunchAgents`
4. sets the wake schedule with `sudo pmset repeat wakeorpoweron MTWRFSU 05:55:00` (asks for your password; replaces any existing repeating `pmset` schedule)
5. offers to crawl verrano.com.au and tag the photos
6. offers to make the first week now rather than waiting for Sunday

Run it again after moving the folder or updating Node. `./scripts/uninstall-mac.sh` removes the jobs and the wake schedule.

### Keep in mind

- **Keep the Mac plugged in** and logged in (launchd agents run in your user session). A MacBook with its lid closed and no external display may not wake on schedule. Under **System Settings → Battery → Options**, turn on "Prevent automatic sleeping on power adapter when the display is off" for the long Sunday run.
- **Subscription limits**: a week is about 14 site specs, 14 four-reel script sets, 7 Verrano scripts and a handful of briefs. On Pro this may hit a usage limit. If a step fails it waits 20 seconds and retries once, then logs, notifies and moves on to the next day's reel; rerun with `./scripts/run-job.sh weekly` later and it fills only the missing days. If it happens often, a Max plan or spreading the run out helps.
- **Run time**: Sunday takes roughly 1–3 hours depending on the Mac (each site is built, audited, recorded four ways and rendered four times).

## Logs and errors

- `logs/<date>-<job>.log`: every step with timings, retries and errors.
- `logs/<date>-<job>.out`: full console output.
- `logs/launchd-<job>.log`: anything launchd itself reports.

Each external step (Claude, images, Vercel, recording, ElevenLabs, rendering, upload, Buffer) is retried once after 20 seconds. If it fails again, the error is logged, that day's reel is skipped, and the job carries on. At the end of a run with errors you get a notification that opens the log. If a job crashes outright, `scripts/run-job.sh` notifies you instead.

## Commands

| Command | What it does |
| --- | --- |
| `./scripts/run-job.sh weekly` / `daily` | Run a job now, exactly as launchd does |
| `npm run weekly -- --brand verrano --days 3` | Make the next 3 days for one brand (`--start YYYY-MM-DD`, `--mock`, `--dry-run`) |
| `npm run daily -- --no-wait` | Offer today's reels without waiting (approve later with `npm run review`) |
| `npm run review` | Open the approval page |
| `npm run make "<brief>" --brand=webstar` | One concept site and its four reels now (left ready; approve on the review page) |
| `npm run approve -- <batch-id> all` | Approve from the terminal |
| `npm run schedule` | Schedule approved reels into their slots now |
| `npm run library:crawl -- --brand verrano` | Refresh Verrano's photo library |
| `npm run library:tag -- --brand verrano` | Have Claude look at and tag the photos |
| `npm run check` | Is this Mac ready? (`-- --live` also tests Claude Code) |
| `npm test` | Calendar, campaigns, slotting, daily picks, approval parsing, Verrano format fallbacks, design contrast |

Add `--mock` to `weekly` or `make` for a free run: example site, placeholder images, canned scripts and a silent voice.

## Generated sites

Unchanged from before: Claude picks one of the brand's design directions from [`library/`](library/README.md), writes the site, images come from Nano Banana 2, and the site is built on the motion-system tokens (WEBSTAR one-page sites; VIA77 demo stores on store-kit). It is then audited (axe-core, clipped controls, sideways scroll, alt text, concept label, banned phrases, motion easings), fixed once by Claude if needed, and deployed as a Vercel preview. Reels are recorded from the local build.

## State

All state is files in this folder, so back it up or commit it as you like:

- `brands/<id>.json`: brand voice, look, CTA and rules
- `brands/<id>/sites.json`: queue of existing sites
- `brands/<id>/briefs.json`: backlog of briefs for concept sites
- `brands/<id>/hooks.json`: hooks, used in order
- `brands/<id>/batches/*.json`: every reel: script, caption, status (`ready`, `awaiting`, `approved`, `scheduled`, `rejected`), planned day, slot, Buffer post IDs, photos used
- `brands/verrano/library/`: crawled photos and `library.json`
- `out/`: rendered videos and built sites (not committed)

## Good to know

- **Buffer's API fields** for Instagram Reels and YouTube Shorts (in `src/steps/post.ts`) haven't been checked against a live account. Approve one test reel and confirm it appears correctly in Buffer before relying on it.
- **Verrano's look** in `brands/verrano.json` (charcoal with a copper accent) is a placeholder: the crawl lists the colours it found on the site under `brandColors`. Update the config to match.
- **Verrano's music** is a copy of WEBSTAR's generated placeholder track; replace `public/brands/verrano/music.mp3` with a track you have the rights to.
- Remotion is free for individuals and companies of up to three people; larger companies need a [Remotion licence](https://www.remotion.dev/license).
