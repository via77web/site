# Library

Everything `npm run make` builds sites from. Edit these files to change what every future generated site looks like; nothing here is per-site.

| Path | What it is |
| --- | --- |
| `directions/*.json` | Design directions (style presets). Each lists the brands that may use it, its layout, palette, type pairing, radius, motion scale and primary ease, up to three signature moves, and a photography style for the image workflow. Claude picks one per site. |
| `tokens/motion.css`, `tokens/motion.ts` | SOHEL Motion System v1: the draft, build, snap and press easings and the duration scale. The only motion a generated site may use; the audit flags anything else. The reels use the same eases (the before/after wipe is `snap`). |
| `fonts.json` | The Google Fonts a reference-derived direction may use, with their weights. Add families here to widen the choice. |
| `anti-patterns.json` | Banned phrases (checked by the audit) and rules (given to Claude). Add to it whenever a site does something you never want to see again. |
| `components/` | Building blocks: the one-page site's CSS and JS, and shared HTML helpers. |
| `layouts/onepage.ts` | One-page business site (WEBSTAR concepts): hero, statement, tabbed services, showcase, steps, gallery, FAQ, call to action. |
| `layouts/store.ts` | Demo store (VIA77 concepts) on the store-kit engine, matching the structure of the existing concept stores. |
| `store-kit/kit.css`, `store-kit/kit.js` | Copy of the store engine from the VIA77 site. One fix: footer headings used `opacity:.6`, which fails contrast; they now use the muted colour. |
| `spec.ts` | The schema Claude fills in for each layout, and the size checks. |
| `examples/` | One complete spec per layout. `--mock` runs use them, and they're a good reference for what a spec looks like. |

## Component variants

One-page sites are assembled from versions of each part, chosen by the direction's `components` recipe (defaults apply without one):

| Part | Versions |
| --- | --- |
| nav | `bar`, `pill`, `centered` |
| hero | `split`, `fullbleed`, `type` |
| services | `tabs`, `cards`, `list` |
| gallery | `bento`, `strip`, `stack` |
| cta | `card`, `band` |
| standouts (up to two) | `marquee`, `badge`, `big-numbers` |

The markup is in `layouts/onepage.ts` and the styles at the end of `components/onepage.css`. To add a version, add it to `ComponentsSchema` in `index.ts`, then its markup and CSS.

## Directions saved from references

When a site built from `references/<project>/` matches its references well (8/10 or better) and passes the audit, its direction and component recipe are saved here as `directions/ref-<project>.json`, and from then on Claude can choose it for any site of that brand. Delete the file to retire it.

## Adding a direction

Copy a file in `directions/`, change the id and values, and list the brands that may use it. Every direction must keep body-text colour pairs at WCAG AA (4.5:1); `npm test` checks this.

## Not found when this was built

- **taste-kit**: the skill wasn't available in this environment, so `directions/` and `anti-patterns.json` were written from scratch to match your existing work. Copy taste-kit's directions, tokens and anti-patterns in here to replace them.
- **store-kit `build.py`**: only `kit.css` and `kit.js` exist in the VIA77 site repo. The build is done in TypeScript by `layouts/store.ts`. If you have `build.py` elsewhere, it can replace that file as long as it writes the same `index.html` from a spec.
