#!/usr/bin/env python3
"""
Prepare the supplied landing-page product images for the web (MODELLIO 2.1 landing refinement).

    python3 scripts/prepare-landing-art.py HERO KEYRING KEYTAG SIGN PLANTER SPLIT

Writes WebP images with alpha to public/landing/art/. Products are never stretched or redrawn:
  * images that already have transparency keep it; stray specks of colour outside the product
    (small islands in the alpha channel, e.g. along the sign's top edge) are removed;
  * the Split Studio image is opaque with a checkerboard painted in, so its background is removed
    by flood-filling from the border over the light, grey checkerboard (the purple product is not
    touched), with a one-pixel soft edge;
  * each image is trimmed to the product plus even padding and scaled down (never up) to a web size.
"""
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent.parent / 'public' / 'landing' / 'art'
JOBS = [  # (output name, max width, opaque checkerboard background?)
    ('modellio-hero-products.webp', 1600, False),
    ('maker-keyring.webp', 900, False),
    ('maker-keytag.webp', 900, False),
    ('maker-sign.webp', 900, False),
    ('maker-vase-planter.webp', 900, False),
    ('maker-split-studio.webp', 900, True),
]


def remove_checkerboard(im: Image.Image) -> Image.Image:
    rgb = np.asarray(im.convert('RGB')).astype(np.int16)
    sat = rgb.max(axis=2) - rgb.min(axis=2)
    light = rgb.mean(axis=2)
    candidate = ((sat < 22) & (light > 170)).astype(np.uint8) * 255
    # .copy(): an image made from a numpy array is a read-only view, and flood fill would silently do nothing.
    mask = Image.fromarray(candidate, 'L').copy()
    h, w = candidate.shape
    # Everything reachable from the border through light grey pixels is background.
    for x, y in [(x, 0) for x in range(0, w, 7)] + [(x, h - 1) for x in range(0, w, 7)] + [(0, y) for y in range(0, h, 7)] + [(w - 1, y) for y in range(0, h, 7)]:
        if mask.getpixel((x, y)) == 255:
            ImageDraw.floodfill(mask, (x, y), 128)
    bg = (np.asarray(mask) == 128)
    # Soft edge: feather the boundary by about a pixel.
    alpha = Image.fromarray(np.where(bg, 0, 255).astype(np.uint8), 'L').filter(ImageFilter.GaussianBlur(0.8))
    a = np.minimum(np.asarray(alpha), np.where(bg, 0, 255)).astype(np.uint8)
    out = im.convert('RGBA')
    out.putalpha(Image.fromarray(a, 'L'))
    return out


def drop_specks(im: Image.Image, min_fraction=0.002) -> Image.Image:
    """Remove small islands of visible alpha (specks and fringe away from the product)."""
    a = np.asarray(im.getchannel('A'))
    # Label components on a 4× smaller grid (fast enough in plain Python).
    k = 4
    small = a[: a.shape[0] // k * k, : a.shape[1] // k * k].reshape(a.shape[0] // k, k, a.shape[1] // k, k).max(axis=(1, 3)) > 16
    labels = np.zeros(small.shape, np.int32)
    sizes = [0]
    for sy, sx in zip(*np.nonzero(small)):
        if labels[sy, sx]:
            continue
        n = len(sizes)
        sizes.append(0)
        q = deque([(sy, sx)])
        labels[sy, sx] = n
        while q:
            y, x = q.popleft()
            sizes[n] += 1
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < small.shape[0] and 0 <= nx < small.shape[1] and small[ny, nx] and not labels[ny, nx]:
                        labels[ny, nx] = n
                        q.append((ny, nx))
    keep = np.array([s >= min_fraction * small.size for s in sizes])
    keep[0] = False
    big = np.kron(keep[labels], np.ones((k, k), bool))
    full = np.zeros(a.shape, bool)
    full[: big.shape[0], : big.shape[1]] = big
    removed = int(((a > 16) & ~full).sum())
    out = im.copy()
    out.putalpha(Image.fromarray(np.where(full, a, 0).astype(np.uint8), 'L'))
    print(f'    removed {removed} speck pixels in {sum(1 for i, s in enumerate(sizes) if i and not keep[i])} islands')
    return out


def trim(im: Image.Image, pad_fraction=0.04) -> Image.Image:
    box = im.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    im = im.crop(box)
    pad = round(max(im.size) * pad_fraction)
    out = Image.new('RGBA', (im.width + 2 * pad, im.height + 2 * pad), (0, 0, 0, 0))
    out.paste(im, (pad, pad))
    return out


def main(paths):
    if len(paths) != len(JOBS):
        sys.exit(__doc__)
    OUT.mkdir(parents=True, exist_ok=True)
    for (name, max_w, checker), src in zip(JOBS, paths):
        im = Image.open(src)
        print(f'{name}: {Path(src).name} {im.mode} {im.size}')
        im = remove_checkerboard(im) if checker else im.convert('RGBA')
        im = trim(drop_specks(im))
        if im.width > max_w:
            im = im.resize((max_w, round(im.height * max_w / im.width)), Image.LANCZOS)
        # Fully transparent pixels: clear their colour so the hidden glow cannot leak at edges.
        arr = np.asarray(im).copy()
        arr[arr[..., 3] == 0, :3] = 0
        Image.fromarray(arr, 'RGBA').save(OUT / name, 'WEBP', quality=90, method=6, exact=False)
        print(f'    → {OUT / name} {im.size} {(OUT / name).stat().st_size // 1024} KB')


if __name__ == '__main__':
    main(sys.argv[1:])
