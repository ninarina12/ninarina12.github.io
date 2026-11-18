"""Make web-sized WebP copies of figure images for the website.

For every image given (or every PNG/JPG in the standard folders when none are
given), writes next to it:

    <folder>/thumbs/<name>-800.webp    card image, 1x screens
    <folder>/thumbs/<name>-1600.webp   card image, 2x screens
    <folder>/thumbs/<name>-2400.webp   lightbox / full view

Sizes larger than the original are skipped (the largest available size is
always written). Prints each image's width/height so you can copy them into
the <img width=... height=...> attributes in index.html.

Usage (Pillow is the only dependency):
    python3 -m venv /tmp/thumbs-env && /tmp/thumbs-env/bin/pip install pillow
    /tmp/thumbs-env/bin/python tools/make_thumbs.py                  # all figures
    /tmp/thumbs-env/bin/python tools/make_thumbs.py publications/new.png
"""

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
FOLDERS = ["workshops", "publications", "data_visualization", "animations"]
WIDTHS = [800, 1600, 2400]
QUALITY = 86


def flatten(im: Image.Image) -> Image.Image:
    """Composite any transparency onto white (figures sit on white plates)."""
    if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
        im = im.convert("RGBA")
        bg = Image.new("RGB", im.size, (255, 255, 255))
        bg.paste(im, mask=im.getchannel("A"))
        return bg
    return im.convert("RGB")


def process(path: Path) -> None:
    im = flatten(Image.open(path))
    w, h = im.size
    out_dir = path.parent / "thumbs"
    out_dir.mkdir(exist_ok=True)
    targets = [t for t in WIDTHS if t < w] + [min(w, WIDTHS[-1])]
    for tw in sorted(set(targets)):
        th = round(h * tw / w)
        out = out_dir / f"{path.stem}-{tw}.webp"
        im.resize((tw, th), Image.LANCZOS).save(out, "WEBP", quality=QUALITY, method=6)
        print(f"  {out.relative_to(ROOT)}  {tw}x{th}  {out.stat().st_size // 1024} KB")
    print(f"{path.relative_to(ROOT)}: original {w}x{h} (aspect {w / h:.3f})")


def main(argv: list[str]) -> None:
    if argv:
        paths = [Path(a).resolve() for a in argv]
    else:
        paths = sorted(
            p
            for folder in FOLDERS
            if (ROOT / folder).is_dir()
            for p in (ROOT / folder).iterdir()
            if p.suffix.lower() in (".png", ".jpg", ".jpeg")
        )
    for p in paths:
        process(p)


if __name__ == "__main__":
    main(sys.argv[1:])
