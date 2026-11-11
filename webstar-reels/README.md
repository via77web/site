# webstar-reels

A content engine for **WEBSTAR**, **VIA77** and **VERRANO** that runs on your Mac.

- **Sunday 6am**: makes the coming week. WEBSTAR and VIA77 get a concept site a day (designed, written, imaged, built, audited, previewed), each recorded from four angles. VERRANO gets a reel a day from its own project photos and website.
- **Every day 6am**: picks today's reel for each brand, notifies you, and waits on a local approval page. Each reel you approve is scheduled to Instagram Reels, TikTok and YouTube Shorts at the brand's calendar slot. **Nothing posts without a yes.**
- **Claude runs on your subscription.** Scripts, captions, site copy and briefs are written by Claude Code in headless mode (`claude -p`), not the API.
- Every run is logged to `logs/`, failed steps are retried once, and errors notify you.
- **It learns.** Every reel has a tracked link; clicks, enquiries and Stripe deposits are logged against it, and each Sunday the engine ranks hooks and formats and leans next week towards what worked.

## The week

| When | Job | What happens |
| --- | --- | --- |
| Sunday 6:00 | `weekly` | First, the learning step: pull last week's numbers, rank hooks and formats, write `insights.md`, retire the weakest hooks. Then, for each of the next 7 days that has no reel yet: WEBSTAR and VIA77 make a site (the queue in `brands/<id>/sites.json` first, then the running campaign's briefs, then the brief backlog, topped up by Claude when it runs dry), record all four angles and pre-render them. One angle is planned for that day and the other three are kept as spares. VERRANO renders one reel per day, cycling through its five formats, with two days a week given to AI visualisations. |
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

### WEBSTAR and VIA77: four angles per site, plus laptop zoom

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

## Verrano AI visualisations

Two of Verrano's seven weekly reels (`ai.perWeek` in `brands/verrano.json`) are AI visualisations made from real library photos with fal. They need `FAL_KEY`; without it, or if a visualisation fails its checks or the budget, that day gets a real-footage reel instead.

| Format | What it shows |
| --- | --- |
| `imagine` | "Imagine your space": one room re-finished in two or three finishes (walnut, matte black, stone by default), morphing from one to the next |
| `visualised` | A real before photo, labelled "Before · real photo", morphing into an AI-rendered wrapped result |
| `finish-mood` | Close, slow camera moves across a wrapped surface, showing texture |

How a reel is made: the real photo is cropped to 9:16, an image model re-finishes the surfaces (for `imagine` and `visualised`), and an image-to-video model animates it with a slow dolly, push-in or pan. The prompt asks that only the camera moves, lines stay straight, lighting stays photoreal, and there are no people or text. Photos whose description mentions people are not used.

**Always labelled.** Every reel containing AI footage shows a small "Visualisation" tag on screen from the first frame to the last, over the hook and the end card too, and its caption starts with "AI visualisation of a Verrano finish." Both are added in code, not left to the script. The script is told to write it as an invitation to imagine, and is sent back if it describes the visualisation as a completed job. The same label and caption line are applied to a showcase reel if `ANIMATE_STILL_CMD` animated any of its photos. AI-made images and clips are kept in the reel's own `out/` folder and never enter the photo library, so real-footage reels can't pick them up.

**Call to action:** these reels end on "Send us a photo of your space — we'll show you the result" instead of the usual quote line.

**Quality check.** Each clip must pass, or it is regenerated (two tries by default) and then dropped:

- at least 1080×1920 (an optional fal upscaler can be configured for models that output less)
- no flicker: frame-to-frame brightness must change smoothly
- no glitches or cuts: no sudden brightness jump
- Claude looks at frames from the clip beside the real photo and fails warped or melting geometry, distorted people, added or garbled text, popping light, or a room that no longer matches

Edited images get the same visual check against the source. If a morph clip is dropped, the reel cross-fades between the visualised stills instead; if nothing usable is left, the day falls back to real footage.

**Models and costs.** `ai.json` holds the fal presets (`kling`, `veo3`, `runway`), the image-edit model, quality thresholds and budgets. Pick the preset with `"video"` there or `FAL_VIDEO_MODEL` in `.env`. Every generation, including rejected ones, is logged to `logs/ai-costs.csv` (time, reel, model, request id, seconds, estimated cost, result, reason) and stored on the reel, and the review page shows each AI reel's estimated cost. Costs are estimates from the prices in `ai.json`, so keep those in line with fal's pricing pages. A reel stops generating at `maxUsdPerReel`, and no AI reels are made once the last 7 days reach `maxUsdPerWeek`.

**Before relying on it,** run `npm run ai:test -- --format visualised` once per preset you plan to use: it makes one real reel (spending fal credit) without adding it to the queue, and prints each generation's cost and check result. The model ids and input field names in `ai.json` were written without access to fal, so expect to correct them against each model's page. Add `--mock` for a free run with stand-in footage.

The finishes in `brands/verrano.json` are generic looks. Rename and re-describe them to match real catalogue finishes if the caption "a Verrano finish" should mean a specific product.

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

### 3. Accounts (per brand)

Do this once for WEBSTAR, VIA77 and VERRANO:

- [ ] **Instagram**: create the account, then switch it to a **Business** account (Settings → Account type and tools) and connect it to a Facebook Page for the brand. Business, not Creator: Buffer's direct publishing and ManyChat's comment automation both need it.
- [ ] **TikTok**: create the account and switch to a **Business Account** (Settings → Account). Business accounts can't use commercial sounds, which suits this setup: reels carry their own royalty-free audio.
- [ ] **YouTube**: create a channel for the brand (a Brand Account lets you add managers later). Verify it by phone so uploads over 15 minutes and custom thumbnails aren't restricted. Vertical videos under three minutes are filed as Shorts automatically.
- [ ] **Buffer**: Channels → Connect a channel, and connect all three for the brand. For Instagram choose the Business account through Facebook; for TikTok and YouTube approve posting on your behalf. Make sure your Buffer plan covers nine channels.
- [ ] **Profile IDs**: run `npm run buffer:channels`, and copy each brand's three lines into `.env`:
      `BUFFER_PROFILE_IDS_WEBSTAR=instagram:…,tiktok:…,youtube:…` (and `_VIA77`, `_VERRANO`).
- [ ] **Voice**: pick an ElevenLabs voice for the brand and put its ID in `ELEVENLABS_VOICE_ID_<BRAND>`.
- [ ] **Music**: download at least 8 tracks in the brand's genre and tempo from your royalty-free library (for example Epidemic Sound), put them in `music/` and list each in `music/library.json` with its BPM and licence ([music/README.md](music/README.md)).
- [ ] **Intro clips**: film or generate 5 to 8 laptop clips into `intros/<brand>/` and run `npm run intros` ([intros/README.md](intros/README.md)).
- [ ] **Bio link**: after lead tracking is set up, put the brand's link-in-bio link (from `npm run tracking:setup`) in the Instagram and TikTok profiles and the YouTube channel links.
- [ ] **ManyChat**: connect the brand's Instagram and add its keyword automation ([docs/manychat.md](docs/manychat.md)).
- [ ] **Test**: approve one reel and check it arrives in Buffer's queue for all three channels at the brand's slot, with the right caption on each.

### 4. Keys

```bash
cp .env.example .env
```

Fill in ElevenLabs, Buffer, `GITHUB_REPOSITORY`, and each brand's voice and Buffer channel IDs from the checklist above. For lead tracking add `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` and `TRACK_BASE_URL` ([docs/lead-tracking.md](docs/lead-tracking.md)). Add `OPENAI_API_KEY` for generated-site images and `VERCEL_TOKEN` for preview links. Leave `ANTHROPIC_API_KEY` empty to run Claude on your subscription.

### 5. Run the setup script

```bash
./scripts/setup-mac.sh
```

It:

1. checks the tools and installs dependencies and browsers
2. runs `npm run check -- --live` (keys, gh login, one tiny Claude Code call to confirm the subscription works)
3. installs two launchd jobs, `com.webstar-reels.weekly` (Sunday 6:00) and `com.webstar-reels.daily` (every day 6:00), in `~/Library/LaunchAgents`
4. sets the wake schedule with `sudo pmset repeat wakeorpoweron MTWRFSU 05:55:00` (asks for your password; replaces any existing repeating `pmset` schedule)
5. links `references/` to iCloud Drive › webstar-reels-references (anything already in `references/` is copied across and the old folder kept as a backup)
6. offers to crawl verrano.com.au and tag the photos
7. offers to make the first week now rather than waiting for Sunday

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
| `npm run intros` | Check every laptop-zoom intro clip and register new files in `intros/<brand>/` |
| `npm run intros:generate -- --brand webstar` | Generate intro clips with fal (spends fal credit; `--mock` is free) |
| `npm run make "<brief>" --brand=webstar` | One concept site and its four reels now, designed from `references/` (left ready; approve on the review page). `--refs=<folder>` names the folder; `-- --no-refs` skips references |
| `npm run approve -- <batch-id> all` | Approve from the terminal |
| `npm run schedule` | Schedule approved reels into their slots now |
| `npm run library:crawl -- --brand verrano` | Refresh Verrano's photo library |
| `npm run library:tag -- --brand verrano` | Have Claude look at and tag the photos |
| `npm run ai:test -- --format imagine` | Make one AI visualisation reel now to check the fal preset, checks and cost (`--mock` is free) |
| `npm run learn` | Pull results and rewrite each brand's `insights.md` now |
| `npm run tracking:setup` | Save and print each brand's link-in-bio and ManyChat DM links |
| `npm run check` | Is this Mac ready? (`-- --live` also tests Claude Code) |
| `npm test` | Calendar, campaigns, slotting, daily picks, approval parsing, Verrano format fallbacks, design contrast |

Add `--mock` to `weekly` or `make` for a free run: example site, placeholder images, canned scripts and a silent voice.

## Leads, comments and the learning loop

### Tracked links and the leads table

Every reel gets a unique link when it is scheduled, tagged with the brand and day (`utm_campaign`), the variant (`utm_content`), the hook (`utm_term`) and the platform (`utm_source`), pointing at the brand's `link` in `brands/<id>.json`. With the `go` function deployed it is a short redirect that counts the click itself.

Clicks, form submissions and Stripe deposits are logged against that link in Supabase, and the `reel_funnel` view shows each reel as **views → clicks → enquiries → deposits**. Setup (database, three small functions, a snippet for each site, the Stripe webhook) is in [docs/lead-tracking.md](docs/lead-tracking.md).

Where the link appears: TikTok and YouTube captions carry it. Instagram captions can't hold a tappable link, so Instagram relies on the bio link and comment-to-DM below; `npm run tracking:setup` prints both links for each brand. Bio and DM clicks can't say which reel prompted them, so the weekly report credits them to the brand's most recent reel and says it has done so.

### Comment-to-DM

Every caption ends its copy with the brand's keyword prompt, added in code: "Comment WEBSITE" (WEBSTAR), "Comment STORE" (VIA77), "Comment QUOTE" (VERRANO). Hashtags follow it. The keyword and line are `commentKeyword` and `commentPrompt` in each brand config. [docs/manychat.md](docs/manychat.md) walks through the ManyChat automation that answers those comments with the tracked link.

### Weekly learning loop

Before the Sunday build (or any time with `npm run learn`), for each brand:

1. **Gather.** For every reel posted in the last 60 days and live at least 48 hours: views, watch time, shares, reactions and comments from Buffer's post metrics, and clicks, enquiries and deposits from the leads table.
2. **Score.** Each reel is scored 0–100 against the brand's best on each signal. A signal nobody has yet (no leads table, say) drops out and the others share its weight.
3. **Rank** hooks, formats and angles, and design directions, and write `brands/<id>/insights.md` with the full table.
4. **Bias next week.** The top 20% of hooks come up twice as often. The bottom 20% are retired, and Claude writes replacements in the style of the winners so the pool keeps its size. The best format is planned more often and the weakest less often.

Guard rails, because early numbers are noisy: nothing is promoted or retired until at least 5 hooks have results; a brand never drops below 10 active hooks; formats are only re-weighted once three formats have two reels each, and the weakest format is used less, never dropped. Decisions are in `brands/<id>/learning.json`; delete it to reset, or edit a hook's status by hand.

## Music

Reels only use tracks from the local [`music/`](music/README.md) library: royalty-free only (for example Epidemic Sound), each tagged with its brands, BPM, genre, moods and licence source. Each brand has a `music` block in its config:

| Brand | Music |
| --- | --- |
| WEBSTAR | deep house / future house, 120-125 BPM, bright and bouncy, clear drops |
| VIA77 | minimal / melodic house, 115-120 BPM, polished and warm, no harsh drops |
| VERRANO | groovy tech house, 122-126 BPM, punchy and confident |

For every reel the engine picks the best-fitting track the brand hasn't used in the last 7 days, detects its beats and drop, starts it so **the drop lands on the reveal**, moves cuts and the end card onto beats, and ducks the music 12 dB under the voiceover. When a reel is scheduled, the track and its licence are written to `music/usage-log.csv`. Unlisted files are ignored, a brand with no licensed track gets voice only, and nothing ever attaches a platform's trending or commercial audio.

The three tracks included were generated for this project as placeholders, one per brand. With one track per brand the 7-day rule can't hold (the log says so each run): add at least 8 licensed tracks per brand. See [`music/README.md`](music/README.md).

## Laptop-zoom reels

A fifth angle for every site: the reel opens on someone at a MacBook with the site on its screen, the hook sits over the shot, the camera pushes in for about 1.8 seconds until the screen fills the frame, and it cross-fades into the full-quality recording. The voiceover starts on that reveal, and so does the music drop.

- **The site is always the real recording.** A desktop recording of the site is corner-pinned onto the laptop screen, dimmed and tinted to the room's light, with a faint glow and reflection. Intro clips only supply the room and the laptop; a generated clip that shows anything but a blank green screen is rejected.
- **Intro clips** live in `intros/<brand>/`, 5 to 8 per brand, 3 to 4 seconds each, camera locked off, laptop screen green or blank. Film your own, or generate them with fal: `npm run intros:generate -- --brand webstar` (per-brand rooms are set by `introScene` in each brand config). `npm run intros` checks every clip and registers new files.
- **The screen's corners** are found automatically on a green screen. If that fails, add four points to `intros/intros.json`.
- **Rotation.** A clip isn't reused by a brand within 5 days. With no clip available, the site simply gets no laptop-zoom reel.
- **Learning loop.** Laptop zoom is a variant like the others (`laptop-zoom`), so its results are ranked against the other angles and it is promoted or retired on the same rules.
- Verrano's site-scroll day opens as a laptop zoom when it has a clip free. A generated clip carries Verrano's "Visualisation" label while it is on screen.

See [`intros/README.md`](intros/README.md) for filming and generating clips.

## References (your Pinterest workflow)

Before a site is generated, the engine looks for screenshots you've saved for it and designs from them.

**Where to save them.** `references/` is linked to **iCloud Drive › webstar-reels-references** by the setup script, so you can add images from your phone: in Pinterest (or anywhere), share or screenshot, then save to Files › iCloud Drive › webstar-reels-references › the project's folder.

| Folder | Used for |
| --- | --- |
| `references/<project>/` | One site. The project name is the brief turned into a folder name (`"A dog groomer in Geelong"` → `a-dog-groomer-in-geelong`), or whatever you pass with `--refs=<folder>` |
| `references/webstar/`, `references/via77/` | A standing moodboard for the brand, used when a site has no folder of its own |

```bash
npm run make "A dog groomer in Geelong" --brand=webstar                 # uses references/a-dog-groomer-in-geelong/
npm run make "A dog groomer in Geelong" --brand=webstar --refs=pet-mood # uses references/pet-mood/
npm run make "A dog groomer in Geelong" --brand=webstar -- --no-refs    # library directions only
```

**If there are none,** `make` stops before generating anything: it creates the folder, tells you where to save screenshots, and waits for you to press Enter (or type `skip`). Run without a terminal, it sends a notification and exits. The Sunday job never waits: it uses a project or brand folder if one has images, and the library's directions otherwise.

**What happens with them:**

1. **Analyse.** Claude Code opens every image (up to 24) and notes its feel, layout pattern, grid, spacing, type style, palette, imagery, implied motion and standout components.
2. **Mood brief.** Those notes become `references/<project>/brief.md`: feel and emotion, layout patterns, grid, spacing, type, colour, imagery, motion cues and standout components.
3. **Tokens, direction and components.** The same brief carries a design direction in your tokens (colours, a font pairing from `library/fonts.json`, corner radius, motion scale and ease, signature moves, photography style) and a list of components to build: which nav, hero, cards, gallery and CTA, plus up to two standout pieces. Colours must pass contrast or the brief is sent back. The machine-readable copy is `direction.json` beside it.
4. **Build.** The site is written and built from that direction. The copywriter only ever sees the written brief, never the images, and the analysis is told not to transcribe wording, name brands or describe logos, so text and logos can't be carried over.
5. **Compare.** Phone and desktop screenshots of the built site are put beside the references and scored out of 10 for palette, type, spacing, layout, imagery and overall. If it has drifted (under 7), or sits too close to one reference, the direction is refined **once**, the site rebuilt and compared again. The result is saved as `comparison.md`, and a site still too close to a reference is flagged as a blocking issue on the review page.
6. **Keep.** A direction that scores 8 or more and passes the audit is saved to `library/directions/ref-<project>.json`, so future sites for that brand can use it without references.

The brief is reused until the images change; delete `brief.md` and `direction.json` to have it rewritten. You can also edit `direction.json` by hand.

For WEBSTAR's one-page sites the references change both the look and the structure (see the component variants in [`library/`](library/README.md)). VIA77's demo stores keep the store-kit structure, so references change their colour, type, radius, motion and imagery only.

Reference analysis runs on Claude Code (it reads the image files), so it needs the default `LLM=claude-code`. Each new project uses about 4 to 7 extra Claude calls.

## Generated sites

When references exist the direction comes from them (above). Otherwise Claude picks one of the brand's design directions from [`library/`](library/README.md), writes the site, images come from the OpenAI Images API (photoreal, high quality, portrait for heroes and square for product cards; set `IMAGE_PROVIDER=nano-banana` to use Google's model instead; each image's cost is logged in `logs/ai-costs.csv`), and the site is built on the motion-system tokens (WEBSTAR one-page sites; VIA77 demo stores on store-kit). It is then audited (axe-core, clipped controls, sideways scroll, alt text, concept label, banned phrases, motion easings), fixed once by Claude if needed, and deployed as a Vercel preview. Reels are recorded from the local build.

## State

All state is files in this folder, so back it up or commit it as you like:

- `brands/<id>.json`: brand voice, look, CTA and rules
- `brands/<id>/sites.json`: queue of existing sites
- `brands/<id>/briefs.json`: backlog of briefs for concept sites
- `brands/<id>/hooks.json`: hooks, used in order (winners more often, retired ones skipped)
- `brands/<id>/insights.md`, `learning.json`: last Sunday's results and what was decided from them
- `music/`: the royalty-free music library, and `music/usage-log.csv`, the track and licence for every scheduled reel
- `intros/`: laptop-zoom intro clips and `intros.json`
- `brands/<id>/batches/*.json`: every reel: script, caption, status (`ready`, `awaiting`, `approved`, `scheduled`, `rejected`), planned day, slot, Buffer post IDs, photos used
- `brands/verrano/library/`: crawled photos and `library.json`
- `references/`: your saved screenshots, with each project's `brief.md`, `direction.json` and `comparison.md` (in iCloud Drive, not committed)
- `out/`: rendered videos and built sites (not committed)

## Good to know

- **Buffer's API fields** for Instagram Reels and YouTube Shorts (in `src/steps/post.ts`) haven't been checked against a live account. Approve one test reel and confirm it appears correctly in Buffer before relying on it.
- **Verrano's look** in `brands/verrano.json` (charcoal with a copper accent) is a placeholder: the crawl lists the colours it found on the site under `brandColors`. Update the config to match.
- **Buffer's metric names** vary by network. The learning step sorts them into views, watch time, shares, reactions and comments by name; check the first `insights.md` against Buffer's own numbers.
- Remotion is free for individuals and companies of up to three people; larger companies need a [Remotion licence](https://www.remotion.dev/license).
