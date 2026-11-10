# Music

The only music reels use. Each track is listed in `library.json` with its moods, the brands allowed to use it, and where the licence comes from.

**Rules the code enforces**

- A track is used only if it is listed in `library.json`, has `"royaltyFree": true`, and has a `license` filled in. Files in this folder that aren't listed are ignored, and `npm run check` names them.
- A brand gets tracks tagged with its id, in the moods set by `musicMoods` in `brands/<id>.json`, rotating so consecutive reels differ.
- If a brand has no licensed track, its reels are made with voice only. There is no fallback to anything else.
- Reels are uploaded with their own audio. Nothing ever attaches a platform's trending sound.

**Adding a track**

1. Get it from a royalty-free source whose licence covers commercial social media use (for example a paid library subscription, or a track you commissioned or made). Keep the licence or receipt.
2. Put the file here and add an entry:

```json
{
  "file": "warm-morning.mp3",
  "title": "Warm Morning",
  "moods": ["calm", "ambient"],
  "brands": ["via77"],
  "royaltyFree": true,
  "license": "Example Library standard licence, order 12345, covers commercial social media",
  "source": "https://example.com/track/warm-morning"
}
```

Do not add chart music, trending TikTok or Instagram audio, or anything "free to use" only inside an app's own editor. Those licences don't cover a brand account uploading its own file.

The two tracks here now were generated for this project and are placeholders in quality, not in rights.
