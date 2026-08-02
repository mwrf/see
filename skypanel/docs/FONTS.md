# Fonts

At 64 pixels wide, the font *is* the design. Everything else — colour, layout,
scrolling — is downstream of how many characters fit on a line and whether they
are readable from across a room.

## What SkyPanel uses

| Line | Face | Height | Advance | Chars per line |
|---|---|---|---|---|
| Airline name | **SkyPanel7** | 7 px | 4–6 px | ~11 |
| Flight / route / type | **TomThumb** | 5 px | 2–4 px | ~16 |
| Altitude / speed / distance | **TomThumb** | 5 px | 2–4 px | ~16 |

Three lines at 7 + 5 + 5 with 3 px gaps is 23 of the panel's 32 rows, leaving
room to centre the block and still fit a progress bar.

## TomThumb, for the body lines

TomThumb is a 3×5 face by Brian Swetland, shipped with Adafruit_GFX under a
3-clause BSD licence. It is a genuinely good choice here and not a compromise:

* Variable advance — `1`, `.` and `,` are narrower than `M` — so a string like
  `24,000FT` is tighter than a fixed-width face of the same height.
* 5 px cap height reads cleanly at P4 with a diffuser.
* 16 characters per line covers `FR1812  DUB→STN  B738` at 20 characters with
  only a short scroll.

The alternatives were tried and rejected: Picopixel and Org_01 are also 5 px
but wider per glyph, and Adafruit's built-in 5×7 `glcdfont` is fixed-width at
6 px advance, which drops you to 10 characters and forces almost everything to
scroll.

## SkyPanel7, for the airline name

No off-the-shelf GFX font is right for the title: the built-ins jump from 5 px
to `FreeSansBold9pt7b` at ~13 px, which is too tall for three lines. So this
one is authored here.

Design decisions, all of which were checked in the emulator's LED-dot view
rather than in a vector preview:

* **7 px cap height.** Big enough that `RYANAIR` reads at a glance from across
  a room; small enough that three lines plus a bar fit in 32 rows.
* **Single-pixel stems throughout.** Two-pixel stems look bolder in a preview
  and turn into mush on a P4 panel, where each LED already blooms into its
  neighbours. This is the decision most likely to be second-guessed and most
  likely to be right.
* **Uppercase only.** Airline names are uppercased server-side, so lowercase
  glyphs would be dead weight in flash. The renderer folds any that slip
  through, so the fallback is a capital rather than a missing character.
* **4-wide digits against 5-wide letters.** `24,000FT` is common and benefits
  from the extra column; `I` is 3 wide and `1` is 3 wide for the same reason.
* **Contiguous 0x20–0x5A.** `GFXfont` addresses glyphs by a first/last range,
  so the handful of rarely-used symbols in the middle (`@`, `#`, `\``) are
  cheaper to draw than to work around.

## Editing a font

The source of truth is ASCII art, not a packed byte array:

```
glyph A width=5
.###.
#...#
#...#
#####
#...#
#...#
#...#
```

`firmware/lib/render/fonts/SkyPanel7.font` holds all 59 glyphs like this. Edit
it, then:

```bash
just fonts          # regenerate SkyPanel7.h
just test-render    # golden images will fail; look at the .actual.png files
just approve-snapshots
```

`tools/genfont.py` does the packing. It validates as it goes — ragged rows,
duplicate code points, glyphs taller than the line height, and gaps in the code
point range are all errors rather than silently wrong output.

The generated header is committed so a fresh clone builds without Python.
`just check-fonts` fails if it drifts out of date with its source.

## Glyphs outside the fonts

Three characters in the frame contract are not ASCII:

| Character | Code point | Used for |
|---|---|---|
| `→` | U+2192 | Route separator, `DUB→STN` |
| `▲` `▼` | U+25B2/BC | Climb and descent rate |
| `°` | U+00B0 | Reserved for bearings |

`GFXfont`'s contiguous range cannot hold these, so `TextEngine` decodes UTF-8
and falls back to a small table of purpose-drawn bitmaps — one set at 5 px for
the body face, one at 7 px for the title.

This is why the backend sends a real `→` rather than `->`: the arrow costs one
glyph of 6 px instead of two characters of 8 px, and on a 64 px line those two
pixels are worth having.

An unmappable code point renders as `?` rather than being dropped, so a
character-set problem is visible on the panel instead of quietly shortening the
line.

## Measuring

`measureText()` and `drawText()` share one walk over the string, so a line can
never measure differently from how it draws. That equality is what makes the
frame contract's `"scroll": "auto"` — *scroll only if the string overflows
64 px* — exactly right rather than approximately right.

```bash
# What actually fits
./build/skypanel-emu --frame emulator/fixtures/ryanair.json --scale 12
```

| String | Face | Width | Fits? |
|---|---|---|---|
| `RYANAIR` | title | 40 px | yes |
| `AER LINGUS` | title | 54 px | yes |
| `KLM` | title | 18 px | yes |
| `BRITISH AIRWAYS` | title | 80 px | scrolls |
| `FR1812  B738` | body | 42 px | yes |
| `FR1812  DUB→STN  B738` | body | 76 px | scrolls |
| `24,000FT  410KT  6.1MI` | body | 75 px | scrolls |
