# webstar-reels

Turns one website a day, per brand, into a vertical reel (1080×1920) and schedules it to that brand's Instagram Reels and TikTok for 6pm Melbourne time. You supply API keys; the rest runs from a daily GitHub Action.

## Brands

Each brand is one config file plus its own queue, hooks and assets:

```
brands/
  webstar.json          look, tone, voice, scroll speed, CTA
  webstar/sites.json    queue of sites
  webstar/hooks.json    hooks, one per day, in order
  via77.json
  via77/sites.json
  via77/hooks.json
public/brands/
  webstar/music.mp3     (optional logo.svg or logo.png)
  via77/music.mp3
  via77/logo.svg
```

| | WEBSTAR | VIA77 |
| --- | --- | --- |
| Tone | fun, transparent, punchy | premium, calm, considered |
| Scroll | fast, about 12s | slow and cinematic, about 18s |
| Reel length | about 14.5s | about 21s |
| Text | big bold uppercase, yellow highlight | small sans, sentence case, VIA77 palette |
| Music | upbeat | soft ambient |
| Voice | energetic, slightly fast, up to 30 words | calm, slightly slow, up to 32 words |
| Prices | allowed | never mentioned in script, captions or post |
| End card | "Pick a tier", "Link in bio" button | VIA77 logo, "Start a project", "via77.com.au" |

## What happens each day, for each brand

1. **Queue**: picks the first site in the brand's `sites.json` with `"status": "pending"`.
2. **Record**: Playwright opens the site at a phone viewport and captures a smooth hero-to-footer scroll, pausing on key sections (`src/steps/record.ts`).
3. **Script**: Claude writes `{hook, voiceover, captions[], cta}` plus a post caption and hashtags, in the brand's tone and within its rules. The hook comes from the brand's `hooks.json` (`src/steps/script.ts`).
4. **Voice**: ElevenLabs turns the voiceover into an MP3 with word timestamps, using the brand's voice (`src/steps/voice.ts`).
5. **Edit**: Remotion adds the hook text, word-by-word captions, a slow zoom, quiet music and the brand's end card, in the brand's theme (`remotion/`).
6. **Post**: uploads the MP4 and schedules it through Buffer to the brand's channels (`src/steps/post.ts`), then marks the site `posted`.

Brands run one after another and independently. If one brand fails, the others still post, and the run is marked failed at the end.

## Setup

### 1. Put this in its own repository

This project was built inside the `webstar-reels/` folder of another repo. GitHub only runs workflows from `.github/workflows/` at the root of a repository, so the daily schedule will not run until this folder is the root of its own repo:

```bash
cp -r webstar-reels ~/webstar-reels && cd ~/webstar-reels
git init && git add -A && git commit -m "Initial commit"
gh repo create webstar-reels --public --source . --push
```

The repo needs to be **public**, or you need to host the videos yourself (`VIDEO_PUBLIC_URL_<BRAND>`): Buffer downloads the video from a URL, and the Action hosts it as a GitHub Release file, which is only publicly downloadable on a public repo.

### 2. Get the keys

Shared by every brand:

| Variable | Where to get it |
| --- | --- |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API keys |
| `ELEVENLABS_API_KEY` | elevenlabs.io → profile → API keys |
| `BUFFER_ACCESS_TOKEN` | publish.buffer.com → Settings → API |

Per brand (the suffix is the brand id in capitals):

| Variable | What it is |
| --- | --- |
| `ELEVENLABS_VOICE_ID_WEBSTAR`, `ELEVENLABS_VOICE_ID_VIA77` | The ElevenLabs voice for each brand. Pick a calm, low voice for VIA77; the config already slows it down and steadies it. |
| `BUFFER_PROFILE_IDS_WEBSTAR`, `BUFFER_PROFILE_IDS_VIA77` | Comma-separated Buffer channel IDs for that brand's Instagram and TikTok. Run `npm run buffer:channels` and copy the lines you want, e.g. `instagram:abc123,tiktok:def456` |

Connect each brand's Instagram (Business or Creator account) and TikTok in Buffer first. A brand only ever posts to its own `BUFFER_PROFILE_IDS_<BRAND>`; there is no shared fallback. If VIA77's channels are in a separate Buffer account, also set `BUFFER_ACCESS_TOKEN_VIA77`.

### 3. Run it locally

Needs Node 20+ and `ffmpeg` on your PATH.

```bash
npm install
npx playwright install chromium
npx remotion browser ensure
cp .env.example .env        # then fill in the keys

npm run reel:dry            # one reel per brand, no posting
```

Reels land in `out/<brand>/<brand>-day-001-<site>/`, next to the script, word timings and caption.

### 4. Turn on the daily run

In the GitHub repo, go to **Settings → Secrets and variables → Actions** and add every variable above as a repository secret. The workflow in `.github/workflows/daily-reel.yml` then runs every day at 9am AEDT and makes one reel per brand. To test it first, open **Actions → Daily reel → Run workflow** and tick **dry_run** (optionally naming one brand); the reels are attached to the run as an artifact.

## Commands

| Command | What it does |
| --- | --- |
| `npm run reel` | For every brand: process its next pending site and schedule the post |
| `npm run reel -- --brand via77` | The same, for one brand (comma-separate for several) |
| `npm run reel -- --dry-run` | Render the videos, do not post, do not change any queue |
| `npm run reel:mock` | Dry run with a canned script and silent voice: no API keys, no cost. For checking the look |
| `npm run reel -- --dry-run --brand via77 --url <url> --name <name> --niche <niche>` | One-off dry run for any URL in a brand's look |
| `npm run studio` | Open the Remotion editor to tweak the design (run `reel:mock` once first) |
| `npm run buffer:channels` | List your Buffer channel IDs |

## Queues and hooks

Add sites to a brand's `sites.json`:

```json
{ "url": "https://example.com", "name": "Example", "niche": "coffee roaster", "status": "pending" }
```

After a successful run the entry becomes `posted` with the day number, schedule time and Buffer post IDs. If a run fails, the entry stays `pending` and is retried the next day; after 3 failed attempts it is marked `failed` with the error so the queue keeps moving. Missing API keys do not count as an attempt. When a brand has nothing pending it is skipped quietly.

Each brand's `hooks.json` is used in order by that brand's day number and wraps after the last one. `{niche}` and `{name}` are filled in from the site entry.

## Editing a brand

Everything about a brand's reels is in `brands/<id>.json`:

| Field | Effect |
| --- | --- |
| `about`, `audience`, `tone`, `rules` | Given to Claude as the brief for every script |
| `allowPrices` | `false` forbids prices, costs and discounts in the script, captions, post caption and hashtags. A script that breaks this is sent back to Claude. A figure inside the hook itself is left alone, since you wrote the hook |
| `cta` | End card text. ` — ` splits it into the headline and the line under it |
| `spokenCta` | How the voice says the call to action (spell out web addresses) |
| `captionSpokenCta` | `false` keeps the spoken call to action out of the captions, for when it is a spelled-out URL |
| `voice` | Word limit and ElevenLabs settings: `stability`, `similarityBoost`, `style`, `speed` (0.7 to 1.2) |
| `scroll` | `seconds` for the hero-to-footer scroll, and how long to rest on the hero and on each section |
| `post` | Time and timezone to schedule for |
| `style.theme` | `bold` or `minimal` |
| `style.colors` | `background` and `text` (end card), `accent` (highlights), `scrim` (tint over the footage behind text) |
| `style.hookSeconds`, `endCardSeconds`, `zoom`, `musicVolume` | Timing and intensity |

The reel is as long as the scroll plus the end card. If a voiceover runs longer than the scroll, the scroll stretches to fit it.

Replace `public/brands/<id>/music.mp3` with any track you have the rights to (the shipped ones are generated placeholders), and add `logo.svg` or `logo.png` beside it to use a logo on the end card. Theme layouts are in `remotion/bold.tsx` and `remotion/minimal.tsx`.

### Adding a brand

1. Copy `brands/via77.json` to `brands/<id>.json` and edit it.
2. Add `brands/<id>/sites.json` and `brands/<id>/hooks.json`.
3. Add `public/brands/<id>/music.mp3` (and a logo if you have one).
4. Add `ELEVENLABS_VOICE_ID_<ID>` and `BUFFER_PROFILE_IDS_<ID>` to `.env`, to the repo's secrets, and to the `env:` block in `.github/workflows/daily-reel.yml`.

## Good to know

- GitHub schedules run in UTC, so the job starts at 9am during daylight saving (AEDT) and 8am in winter (AEST). The 6pm post time is calculated in Melbourne time and is always right.
- GitHub pauses scheduled workflows in repos with no activity for 60 days. The daily queue commit keeps it active while there are sites to process.
- Remotion is free for individuals and companies of up to three people; larger companies need a [Remotion licence](https://www.remotion.dev/license).
