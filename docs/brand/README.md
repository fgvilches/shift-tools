# Brand — shift-tools

The app icon and identity mark. Everything here is source: SVG masters, renders and the
concept studies they came from.

## Status

**Concepts — awaiting a pick.** Three directions were built, audited with `svg_audit.py` (100/99/100
production-readiness) and rendered at 64 / 32 / 16 px. `concepts.png` is the overview sheet.

| File | Concept | Type | Note |
|---|---|---|---|
| `concepts/a-keycap-v3.svg` | **A · Keycap** | pictorial | The shift glyph knocked out of the app tile. Reads instantly at Dock size; risks reading as a generic "up". |
| `concepts/b-shifts-v2.svg` | **B · Leaned S** | letterform | The S leaned 9° — the name as a form. Survives 16 px best. |
| `concepts/c-plates-v2.svg` | **C · Cascade** | abstract | Three plates stepping off-axis: a multitool in motion. Weakest at small sizes. |

`concepts/a-shiftkey.svg`, `b-shifts.svg`, `c-plates.svg` are the first round, kept for comparison.

## When a direction is approved

```bash
# 1. Colour master: 1024 × 1024 PNG with the tile, transparent margin
# 2. Generate every size Tauri needs (icns, ico, Windows tiles, PNG ladder)
npm run icons

# 3. Web / README assets
python3 <logo-design-skill>/scripts/export_variants.py logo-1024.svg \
    --mono "#0a84ff" --icon-bg "#0a0a0f" --web-icons
```

`npm run icons` calls `tauri icon` against the 1024 px master and rewrites `src-tauri/icons/`.

## Identity rules

- **Colour**: one accent (`#0a84ff`) plus on-surface white (`#e4e1ea`) on the canvas `#0a0a0f`.
  One-colour and reversed versions must both survive.
- **Clear space**: at least the width of the mark's stem on all four sides.
- **Minimum size**: 16 px for the symbol; 96 px where the wordmark is paired with it.
- **Never**: gradients to rescue the form, drop shadows, strokes thinner than 1/48 of the mark,
  or live `<text>` in a shipped file.

The wordmark (`shift-tools`) is set in **Inter SemiBold** and is *not* outlined yet — outline it
before shipping any lockup, and check the licence before embedding the font file.

## Craft notes

- Every concept is a single path or a small set of primitives, single colour, no rasters, no filters.
- Geometry is built on the 256 × 256 grid with 4 px units; apexes are truncated at 16 px so they
  do not turn into needles at small sizes.
- The concepts were checked for accidental readings (mirror, rotate 180°, squint) and against the
  developer-tool shelf (295 marks in the reference library): the crowded conventions there are
  terminal prompts, gears, wrenches, brackets, hexagons and blue-on-dark abstracts.
