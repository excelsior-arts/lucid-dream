"""Cut every icon this thing is asked for, from one photograph.

    python tools/cut_icons.py shell/static/icons/source.jpg shell/static/icons

The source photograph is kept beside what it produced, so the set can be cut
again — a size nobody asked for last year, a crop that turned out to be wrong
— without going looking for a file on somebody's desktop.

One crop, one grade, many sizes. Everything is a flat square that bleeds to
all four edges: iOS rounds it into a squircle, Android masks it to whatever
its launcher uses, and a maskable icon is cropped to a circle — a frame drawn
in here would survive none of that.

The exception is the maskable one, which is the same picture standing back
from its own edges: Android may crop anything outside the middle 80%, so the
artwork is scaled to fit that circle and the corners are filled with the
sky's own color rather than left to be cut.
"""
import sys, os
from PIL import Image, ImageEnhance

def darker(im, top=.48, foot=.24, sat=1.12, keep=.86):
    """Take the light out of the top and leave the horizon nearly alone, and
    let the brightest pixels resist it, so the rim-light on the cloud stays."""
    im = im.convert("RGB"); w, h = im.size
    px = im.load(); out = Image.new("RGB", (w, h)); opx = out.load()
    for y in range(h):
        k = top + (foot - top) * ((y / (h - 1)) ** .9)
        for x in range(w):
            r, g, b = px[x, y]
            lum = (r * 3 + g * 6 + b) / 10 / 255
            f = 1 - k * (1 - keep * lum ** 2)
            opx[x, y] = (int(r * f), int(g * f), int(b * f))
    return ImageEnhance.Color(out).enhance(sat)

src = Image.open(sys.argv[1]); out_dir = sys.argv[2]
W, H = src.size
s = int(min(W, H) * .88)                      # "low and wide"
x = max(0, min(W - s, int(W * .46 - s / 2)))
y = max(0, min(H - s, int(H * .66 - s / 2)))
art = darker(src.crop((x, y, x + s, y + s)).resize((1024, 1024), Image.LANCZOS))
art.save(os.path.join(out_dir, "icon-1024.png"))

for size in (512, 192, 180, 32, 16):
    art.resize((size, size), Image.LANCZOS).save(
        os.path.join(out_dir, f"icon-{size}.png"))

"""The maskable one is a wider view, not a smaller picture.

Android may crop anything outside the middle 80%, and the temptation is to
shrink the artwork and fill the border — which letterboxes it: the fill cannot
match a gradient at both ends, so the join shows as a line across the foot.
A wider crop of the same sky bleeds to all four edges as it should, and simply
leaves the cloud far enough in that a circular mask takes sky."""
mw = int(min(W, H) * 1.0)
mx = max(0, min(W - mw, int(W * .46 - mw / 2)))
my = max(0, min(H - mw, int(H * .60 - mw / 2)))
darker(src.crop((mx, my, mx + mw, my + mw)).resize((512, 512), Image.LANCZOS)) \
    .save(os.path.join(out_dir, "icon-maskable-512.png"))

"""And the .ico: three pictures in one file, for everything that asks the root
of a site for that name and nothing else.

Written as plain bitmaps rather than as PNGs inside the container. Both are
legal and the PNG form is smaller, and the PNG form is also the one the older
readers refuse — which is a bad trade for a file whose entire job is being
readable by whatever turns up asking for it."""
art.resize((48, 48), Image.LANCZOS).save(
    os.path.join(out_dir, "favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48)],
    bitmap_format="bmp")

for f in sorted(os.listdir(out_dir)):
    p = os.path.join(out_dir, f)
    print(f"   {f:<26}{os.path.getsize(p):>8} bytes")
