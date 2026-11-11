# Music

The only music reels use. Royalty-free tracks only (for example from an Epidemic Sound
subscription), each listed in `library.json` with its brands, BPM, genre, moods and licence.

## What each brand plays

Set by the `music` block in `brands/<id>.json`:

| Brand | Genre | BPM | Feel | Drops |
| --- | --- | --- | --- | --- |
| WEBSTAR | deep house, future house | 120-125 | bright, bouncy, friendly, energetic | clear |
| VIA77 | minimal house, melodic house | 115-120 | polished, warm, airy, luxurious | soft, nothing harsh |
| VERRANO | groovy tech house | 122-126 | punchy, confident, satisfying | clear |

`level` in the same block is how loud the music sits between lines (0 to 1).

## What the code does with a track

- **Chooses it.** The best fit for the brand's brief (tempo in range first, then mood and genre)
  among the tracks tagged with that brand. Reels made together get different tracks.
- **Seven-day rule.** A brand does not reuse a track within 7 days. If every track is that
  recent, the one used longest ago plays again and the log says to add more tracks.
- **Finds the beat and the drop.** Each track is analysed once (results cached in
  `analysis.json`): tempo and beat grid from the kick, and the drop as the beat where the low
  end steps up and stays up. Set `"drop": <seconds>` on a track to override it.
- **Syncs the edit.** The track starts part-way in so the drop lands exactly on the reveal: the
  hook clearing, the before/after wipe, or the end of a laptop zoom. Cuts between shots and the
  start of the end card are moved onto beats, and the slow zoom breathes in 16-beat phrases.
- **Ducks under the voice.** Music drops 12 dB while a line is spoken and comes back up between
  lines, with short ramps.
- **Logs the licence.** Every scheduled reel adds a line to `usage-log.csv`: date, brand, reel,
  platforms, track, and its licence source and licence. Keep this file; it is your record if a
  platform ever questions a track.

## Rules the code enforces

- A track is used only if it is listed in `library.json` with `"royaltyFree": true`, a `source`
  and a `license`. Files in this folder that aren't listed are ignored, and `npm run check`
  names them.
- If a brand has no licensed track, its reels are made with voice only. There is no fallback.
- Reels are uploaded with their own audio. Nothing ever attaches a platform's trending sound.

## Adding a track

1. Download it from your royalty-free library and keep the licence or receipt.
2. Put the file here and add an entry:

```json
{
  "file": "night-drive.mp3",
  "title": "Night Drive",
  "artist": "Artist Name",
  "brands": ["webstar"],
  "bpm": 124,
  "genre": "future house",
  "moods": ["bright", "bouncy", "energetic"],
  "royaltyFree": true,
  "source": "Epidemic Sound",
  "license": "Epidemic Sound commercial subscription, track id 123456"
}
```

`bpm` is the tempo the library states; detection refines it within 3 BPM either side. Aim for
at least 8 tracks per brand so the seven-day rule never has to bend with daily posting.

Do not add chart music, trending TikTok or Instagram audio, or anything "free to use" only
inside an app's own editor. Those licences don't cover a brand account uploading its own file.

The three tracks here now were generated for this project (one per brand, in each brand's
genre and tempo). They are placeholders in quality, not in rights: replace them with licensed
tracks as you get them.
