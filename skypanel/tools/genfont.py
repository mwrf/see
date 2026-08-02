#!/usr/bin/env python3
"""Turn a readable ASCII-art font source into an Adafruit ``GFXfont`` header.

Hand-editing packed GFXfont bitmap arrays is miserable and unreviewable, which
is exactly why bad fonts survive in projects like this.  Here the source of
truth is a ``.font`` file you can read in a diff:

    glyph A width=5
    .###.
    #...#
    #####
    #...#
    #...#

and this script emits the header the renderer compiles against.  Run
``just fonts`` after editing; the generated headers are committed so a fresh
clone builds without Python.

Usage:
    genfont.py FONT.font -o OUTPUT.h
    genfont.py FONT.font --check OUTPUT.h    # CI: fail if the header is stale
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass, field
from pathlib import Path

ON = "#"


@dataclass
class Glyph:
    codepoint: int
    label: str
    rows: list[str] = field(default_factory=list)
    width: int | None = None
    advance: int | None = None
    #: Rows to shift the glyph down relative to the font's top line.
    top: int = 0

    @property
    def height(self) -> int:
        return len(self.rows)

    def trimmed_width(self) -> int:
        if self.width is not None:
            return self.width
        return max((len(row.rstrip(".")) for row in self.rows), default=0)


@dataclass
class Font:
    name: str = "Font"
    y_advance: int = 8
    baseline: int = 7
    gap: int = 1
    glyphs: list[Glyph] = field(default_factory=list)


def parse(path: Path) -> Font:
    font = Font()
    current: Glyph | None = None

    for lineno, raw in enumerate(path.read_text().splitlines(), start=1):
        line = raw.rstrip()
        if not line or line.lstrip().startswith("#") and not line.startswith("#"):
            #  A leading '#' is bitmap data, so only indented or bare comments
            #  are treated as comments.
            continue
        stripped = line.strip()
        if stripped.startswith("//") or stripped.startswith(";"):
            continue

        if "=" in stripped and not stripped.startswith("glyph") and current is None:
            key, _, value = stripped.partition("=")
            _apply_header(font, key.strip(), value.strip(), lineno)
            continue

        if stripped.startswith("glyph "):
            if current is not None:
                font.glyphs.append(current)
            current = _parse_glyph_header(stripped, lineno)
            continue

        if set(stripped) <= {ON, "."}:
            if current is None:
                raise SystemExit(f"{path}:{lineno}: bitmap data before any glyph")
            current.rows.append(stripped)
            continue

        if "=" in stripped:
            key, _, value = stripped.partition("=")
            _apply_header(font, key.strip(), value.strip(), lineno)
            continue

        raise SystemExit(f"{path}:{lineno}: cannot parse {raw!r}")

    if current is not None:
        font.glyphs.append(current)
    if not font.glyphs:
        raise SystemExit(f"{path}: no glyphs found")
    font.glyphs.sort(key=lambda g: g.codepoint)
    _validate(font, path)
    return font


def _apply_header(font: Font, key: str, value: str, lineno: int) -> None:
    match key:
        case "name":
            font.name = value
        case "yAdvance" | "y_advance":
            font.y_advance = int(value)
        case "baseline":
            font.baseline = int(value)
        case "gap":
            font.gap = int(value)
        case _:
            raise SystemExit(f"line {lineno}: unknown font setting {key!r}")


def _parse_glyph_header(line: str, lineno: int) -> Glyph:
    parts = line.split()
    if len(parts) < 2:
        raise SystemExit(f"line {lineno}: 'glyph' needs a character or code point")

    token = parts[1]
    if token.startswith("0x") or token.startswith("U+"):
        codepoint = int(token.replace("U+", "0x"), 16)
        label = f"U+{codepoint:04X}"
    elif len(token) == 1:
        codepoint = ord(token)
        label = token
    else:
        raise SystemExit(f"line {lineno}: {token!r} is neither a single char nor 0xNN")

    glyph = Glyph(codepoint=codepoint, label=label)
    for option in parts[2:]:
        key, _, value = option.partition("=")
        match key:
            case "width":
                glyph.width = int(value)
            case "advance":
                glyph.advance = int(value)
            case "top":
                glyph.top = int(value)
            case _:
                raise SystemExit(f"line {lineno}: unknown glyph option {key!r}")
    return glyph


def _validate(font: Font, path: Path) -> None:
    seen: set[int] = set()
    for glyph in font.glyphs:
        if glyph.codepoint in seen:
            raise SystemExit(f"{path}: duplicate glyph U+{glyph.codepoint:04X}")
        seen.add(glyph.codepoint)
        if glyph.rows and len({len(r) for r in glyph.rows}) != 1:
            raise SystemExit(f"{path}: glyph {glyph.label} has ragged rows")
        if glyph.top + glyph.height > font.y_advance:
            raise SystemExit(
                f"{path}: glyph {glyph.label} is {glyph.height} rows at top={glyph.top},"
                f" which overflows yAdvance={font.y_advance}"
            )


def pack(font: Font) -> tuple[list[int], list[tuple[int, ...]], list[str]]:
    """Bit-pack every glyph, returning (bitmap bytes, glyph records, comments).

    GFXfont stores one contiguous MSB-first bit stream per glyph, so bytes are
    shared across rows exactly as Adafruit's own fontconvert emits them.
    """
    bitmap: list[int] = []
    records: list[tuple[int, ...]] = []
    comments: list[str] = []

    accumulator = 0
    bits = 0

    def flush() -> None:
        nonlocal accumulator, bits
        if bits:
            bitmap.append((accumulator << (8 - bits)) & 0xFF)
            accumulator = 0
            bits = 0

    for glyph in font.glyphs:
        offset = len(bitmap)
        width = glyph.trimmed_width()
        height = glyph.height if width else 0
        if not width or not height:
            #  A blank glyph (space) carries no bitmap bytes at all.
            width, height = 0, 0
        else:
            for row in glyph.rows:
                for column in range(width):
                    accumulator = (accumulator << 1) | (1 if row[column] == ON else 0)
                    bits += 1
                    if bits == 8:
                        bitmap.append(accumulator & 0xFF)
                        accumulator = 0
                        bits = 0
            flush()

        advance = glyph.advance if glyph.advance is not None else glyph.trimmed_width() + font.gap
        y_offset = -(font.baseline - glyph.top)
        records.append((offset, width, height, advance, 0, y_offset))
        comments.append(f"0x{glyph.codepoint:02X} {glyph.label}")

    return bitmap, records, comments


def render_header(font: Font, source: Path) -> str:
    bitmap, records, comments = pack(font)
    first = font.glyphs[0].codepoint
    last = font.glyphs[-1].codepoint

    expected = last - first + 1
    if expected != len(font.glyphs):
        missing = sorted(
            set(range(first, last + 1)) - {g.codepoint for g in font.glyphs}
        )
        raise SystemExit(
            f"{source}: GFXfont needs a contiguous code-point range; missing "
            + ", ".join(f"0x{m:02X}" for m in missing)
        )

    lines: list[str] = [
        "// Generated by tools/genfont.py -- do not edit.",
        f"// Source: {source.name}",
        "//",
        f"// {font.name}: {font.y_advance}px line height, baseline {font.baseline},",
        f"// {len(font.glyphs)} glyphs, {len(bitmap)} bitmap bytes.",
        "#pragma once",
        "",
        "#include <Adafruit_GFX.h>",
        "",
        f"const uint8_t {font.name}Bitmaps[] PROGMEM = {{",
    ]

    for index in range(0, len(bitmap), 12):
        chunk = ", ".join(f"0x{b:02X}" for b in bitmap[index : index + 12])
        lines.append(f"    {chunk},")
    lines.append("};")
    lines.append("")
    lines.append(f"const GFXglyph {font.name}Glyphs[] PROGMEM = {{")
    for record, comment in zip(records, comments, strict=True):
        offset, width, height, advance, x_offset, y_offset = record
        lines.append(
            f"    {{{offset}, {width}, {height}, {advance}, {x_offset}, {y_offset}}},"
            f"  // {comment}"
        )
    lines.append("};")
    lines.append("")
    lines.append(f"const GFXfont {font.name} PROGMEM = {{")
    lines.append(f"    (uint8_t *){font.name}Bitmaps,")
    lines.append(f"    (GFXglyph *){font.name}Glyphs,")
    lines.append(f"    0x{first:02X},")
    lines.append(f"    0x{last:02X},")
    lines.append(f"    {font.y_advance}}};")
    lines.append("")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("-o", "--output", type=Path)
    parser.add_argument("--check", type=Path, help="verify an existing header is current")
    args = parser.parse_args(argv)

    header = render_header(parse(args.source), args.source)

    if args.check:
        current = args.check.read_text() if args.check.exists() else ""
        if current != header:
            print(f"{args.check} is stale; run 'just fonts'", file=sys.stderr)
            return 1
        return 0

    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(header)
    else:
        sys.stdout.write(header)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
