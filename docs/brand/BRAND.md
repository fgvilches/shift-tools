# shift-tools — brand guidelines

The short version. Everything here is a rule you can check, not a mood.

## 1. The mark

A single letter **S**, leaned 9° — the name, made into a form. The lean *is* the shift.

| | |
|---|---|
| Construction | One stroked path on a 256 × 256 grid, stroke 42, round caps, rotated −9° about the centre |
| Type of mark | Letterform |
| Ownable detail | The lean. No other dev-tool mark in the reference shelf (295 logos) uses a leaned letterform as its whole idea |

**Masters**

| File | Use |
|---|---|
| `logo-mark.svg` | The mark alone, single colour, 256 grid |
| `logo-mark-small.svg` | Small-size cut: heavier stroke (50), lean reduced to 6° |
| `logo-tile.svg` | App icon master, 1024 canvas, 824 content box (Apple grid) |
| `logo-tile-mono.svg` / `logo-tile-reversed.svg` | One-colour and reversed tiles |
| `logo-horizontal.svg` / `-ink` / `-mono` | Horizontal lockup: symbol + outlined wordmark |
| `logo-1024.png` | Raster master for `npm run icons` |

The mark is a **stroke-based master** (constant 42 px stroke, round caps). It is mathematically an
outline, but if you need a filled path for cutting, engraving or a mask, expand it first.

## 2. Colour

| Role | Hex | Where |
|---|---|---|
| Accent | `#0a84ff` | The mark on dark, links, focus rings |
| Tile | `#14141b` | App icon background |
| On-surface | `#e4e1ea` | Wordmark on dark |
| Ink | `#0a0a0f` | Wordmark on light |
| Paper | `#f5f5f7` | Light backgrounds |

Contrast: accent on `#14141b` ≈ 4.9:1, accent on `#0a0a0f` ≈ 5.0:1 — above the 3:1 needed for
graphical objects. Never place the accent mark on a mid-tone; it is built for very dark or white.

## 3. Lockups

- **Horizontal** is the default. Symbol and wordmark share the same height and the same baseline;
  the gap is 0.21 × the symbol height.
- **Symbol only** for the app icon, favicon and anywhere the name is already on screen.
- **Wordmark only** is allowed in running text where the mark would be smaller than 16 px.

The wordmark is **Inter Bold**, outlined to paths, tracking −14/2048 em. The outlines ship in
`logo-horizontal*.svg`; the font file is not redistributed.

## 4. Clear space and minimum sizes

- **Clear space**: 0.5 × the symbol height on every side. Nothing enters that box — no text, no
  border, no button edge.
- **Minimum sizes**: symbol 16 px (use the small cut below 24 px), horizontal lockup 96 px wide.
- Below those sizes, use the small cut. Do not just scale down the standard one.

## 5. Misuse

Don't:

- Un-lean, re-lean or italicise the mark further — the 9° is the idea.
- Put the mark in a rounded-rectangle container that is not the app tile; it already reads as one.
- Add a gradient, inner shadow or glow to "make it pop".
- Change the stroke weight, or set the mark in any typeface.
- Place the wordmark in a second typeface or in all caps.
- Reverse the mark out of a photo or a busy pattern.

## 6. Assets pipeline

```bash
npm run icons        # logo-1024.png -> src-tauri/icons (icns, ico, PNG ladder)
```

Web assets live in `public/`: `favicon.svg`, `favicon-16.png`, `favicon-32.png`,
`apple-touch-icon.png`, `icon-512.png`.

## 7. Honest limits

- No trademark search was run. Before using this commercially, check registries and do a reverse
  image search.
- The lockup was tested at 16/32/64 px and greyscale, but not printed or embroidered.
- Inter is licensed under the SIL Open Font License; the outlined paths inherit no font licence
  obligation, but keep the licence note if you redistribute the source font.
