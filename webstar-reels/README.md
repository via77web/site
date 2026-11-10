# webstar-reels

Turns one website a day into a 15–20 second vertical reel (1080×1920) and schedules it to Instagram Reels and TikTok for 6pm Melbourne time. You supply API keys; the rest runs from a daily GitHub Action.

## What happens each day

1. **Queue**: picks the first site in `sites.json` with `"status": "pending"`.
2. **Record**: Playwright opens the site at a phone viewport and captures a smooth hero-to-footer scroll, pausing on key sections (`src/steps/record.ts`).
3. **Script**: Claude writes `{hook, voiceover (≤40 words), captions[], cta}` plus a post caption and hashtags. The hook comes from `hooks.json`, one per day, in order (`src/steps/script.ts`).
4. **Voice**: ElevenLabs turns the voiceover into an MP3 with word timestamps (`src/steps/voice.ts`).
5. **Edit**: Remotion adds big hook text for the first 1.5s, word-by-word captions, a slow zoom, quiet background music and a WEBSTAR "Link in bio" end card (`remotion/`).
6. **Post**: uploads the MP4 and schedules it through Buffer to each channel in `BUFFER_PROFILE_IDS` (`src/steps/post.ts`), then marks the site `posted`.

## Setup

### 1. Put this in its own repository

This project was built inside the `webstar-reels/` folder of another repo. GitHub only runs workflows from `.github/workflows/` at the root of a repository, so the daily schedule will not run until this folder is the root of its own repo:

```bash
cp -r webstar-reels ~/webstar-reels && cd ~/webstar-reels
git init && git add -A && git commit -m "Initial commit"
gh repo create webstar-reels --public --source . --push
```

The repo needs to be **public**, or you need to set `VIDEO_PUBLIC_URL` yourself: Buffer downloads the video from a URL, and the Action hosts it as a GitHub Release file, which is only publicly downloadable on a public repo.

### 2. Get the keys

| Variable | Where to get it |
| --- | --- |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API keys |
| `ELEVENLABS_API_KEY` | elevenlabs.io → profile → API keys |
| `ELEVENLABS_VOICE_ID` | elevenlabs.io → Voices → the voice's ID |
| `BUFFER_ACCESS_TOKEN` | publish.buffer.com → Settings → API |
| `BUFFER_PROFILE_IDS` | Comma-separated Buffer channel IDs for Instagram and TikTok. Run `npm run buffer:channels` once the token is set and copy the lines you want, e.g. `instagram:abc123,tiktok:def456` |

Connect your Instagram (Business or Creator account) and TikTok channels in Buffer first.

### 3. Run it locally

Needs Node 20+ and `ffmpeg` on your PATH.

```bash
npm install
npx playwright install chromium
npx remotion browser ensure
cp .env.example .env        # then fill in the keys

npm run reel:dry            # full reel for the next pending site, no posting
```

The reel lands in `out/day-001-<site>/`, next to the script, word timings and caption.

### 4. Turn on the daily run

In the GitHub repo, go to **Settings → Secrets and variables → Actions** and add the five variables above as repository secrets. The workflow in `.github/workflows/daily-reel.yml` then runs every day at 9am AEDT. To test it first, open **Actions → Daily reel → Run workflow** and tick **dry_run**; the reel is attached to the run as an artifact.

## Commands

| Command | What it does |
| --- | --- |
| `npm run reel` | Process the next pending site and schedule the post |
| `npm run reel -- --dry-run` | Render the video, do not post, do not change `sites.json` |
| `npm run reel:mock` | Dry run with a canned script and silent voice: no API keys, no cost. For checking the look |
| `npm run reel -- --dry-run --url <url> --name <name> --niche <niche>` | One-off dry run for any URL |
| `npm run studio` | Open the Remotion editor to tweak the design (run `reel:mock` once first) |
| `npm run buffer:channels` | List your Buffer channel IDs |

## The queue

Add sites to `sites.json`:

```json
{ "url": "https://example.com", "name": "Example", "niche": "coffee roaster", "status": "pending" }
```

After a successful run the entry becomes `posted` with the day number, schedule time and Buffer post IDs. If a run fails, the entry stays `pending` and is retried the next day; after 3 failed attempts it is marked `failed` with the error so the queue keeps moving. When nothing is pending the run exits quietly.

`hooks.json` holds 30 hooks used in order by day number (day 31 wraps to the first). `{niche}` and `{name}` are filled in from the site entry.

## Customising

- **Logo**: drop `logo.png` (or `logo.svg`) into `public/` to replace the built-in WEBSTAR wordmark on the end card.
- **Music**: `public/music.mp3` is a generated ambient bed. Replace it with any track you have the rights to; it loops and plays at 12% volume.
- **Look**: colours, fonts and type sizes are at the top of `remotion/Reel.tsx`; timings are in `remotion/timing.ts`.
- **Post time**: set `POST_TIME` and `POST_TIMEZONE` (defaults `18:00`, `Australia/Melbourne`).
- **Model and voice**: `CLAUDE_MODEL` (default `claude-opus-5-5`) and `ELEVENLABS_MODEL_ID`.

## Good to know

- GitHub schedules run in UTC, so the job starts at 9am during daylight saving (AEDT) and 8am in winter (AEST). The 6pm post time is calculated in Melbourne time and is always right.
- GitHub pauses scheduled workflows in repos with no activity for 60 days. The daily queue commit keeps it active while there are sites to process.
- Remotion is free for individuals and companies of up to three people; larger companies need a [Remotion licence](https://www.remotion.dev/license).
