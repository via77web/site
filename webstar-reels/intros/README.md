# Intro clips for laptop-zoom reels

A laptop-zoom reel opens on someone at a laptop. The camera pushes into the screen until the
site fills the frame, then the reel carries on as a normal scroll. The site on the laptop is
always the real recording, pinned onto the screen when the reel is edited. No clip, filmed or
generated, ever supplies the website.

Each brand keeps 5 to 8 clips in `intros/<brand>/`. A clip is not reused by the same brand
within five days; if every clip is that recent, the laptop-zoom reel is skipped for that site.

## What a clip needs

- 3 to 4 seconds (longer clips are cut to the first 4 seconds), vertical, 1080x1920 or larger.
- The camera locked off. If the screen moves during the clip it is refused.
- The laptop screen fully visible and either:
  - **green**: a full-screen solid green image (`#00FF00`) on the laptop. The corners are found
    automatically, and the green is keyed out, so a hand or a cup in front of the laptop stays
    in front of the site.
  - **blank**: a switched-off or white screen. Give the four corners by hand (below).
- No other bright green in shot.

## Filming your own

1. Open a full-screen green image on the MacBook and turn its brightness up.
2. Put the phone on a tripod, vertical, with the whole screen in shot.
3. Film 5 seconds of yourself at the laptop. Keep your hands off the screen area.
4. Drop the file into `intros/<brand>/` and run `npm run intros`. New files are registered
   automatically and every clip is checked.

## Generating with fal

```
npm run intros:generate -- --brand webstar --count 6
```

Uses the `intro` preset in `ai.json` (Veo 3 by default; `FAL_INTRO_MODEL=kling` to switch) and
the brand's `introScene`. Each clip is checked as it arrives: one without a clean, still, green
screen is deleted and logged as rejected. The cost of every clip, kept or not, goes in
`logs/ai-costs.csv`. Watch the kept clips before they go out and delete any you don't like.

Add `--mock` to try the flow for free with stand-in clips.

## Corners by hand

When detection fails (a blank screen, or something covering a corner), add the screen's corners
to the clip's entry in `intros/intros.json`, in the clip's own pixels, in this order: top-left,
top-right, bottom-right, bottom-left.

```json
{ "file": "desk-01.mp4", "brand": "via77", "screen": "blank", "source": "filmed",
  "corners": [[297, 731], [861, 706], [858, 1085], [284, 1071]] }
```

Open a frame of the clip in Preview and read the pixel positions from the inspector.
