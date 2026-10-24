"""The bus marker of an arrow style: the source picture, made <width> x <height> px (default: its
own size), turned clockwise from north in steps of 2 degrees, each in a square just wide enough
for its visible pixels at every angle (no corner is cut off): arrow_rotation_000.png ... arrow_rotation_358.png, next to
the source.

python make_arrows.py <maps/arrows/<style>/<arrow>.png> [<width> <height>]
"""
import glob
import math
import os
import sys
from PIL import Image

STEP = 2
K = 4       # drawn this much larger, then made smaller: smooth edges

src_path = sys.argv[1]
out = os.path.dirname(os.path.abspath(src_path))
for old in glob.glob(os.path.join(out, 'arrow_rotation_*.png')):
    os.remove(old)
# (premultiplied alpha, else the transparent pixels' colour fringes the edges)
src = Image.open(src_path).convert('RGBA').convert('RGBa')
w, h = (float(sys.argv[2]), float(sys.argv[3])) if len(sys.argv) > 3 else src.size
# The square holds the arrow at every angle: as wide as twice the distance from the centre (the
# point it turns about) to its furthest visible pixel. Not the picture's diagonal: transparent
# corners need no room, and an arrow inside a circle needs no more than its own size.
alpha = src.getchannel('a').load()
sx, sy = w / src.width, h / src.height
cx, cy = src.width / 2, src.height / 2
reach = max((math.hypot((x + 0.5 - cx) * sx, (y + 0.5 - cy) * sy)
             for y in range(src.height) for x in range(src.width) if alpha[x, y] > 0), default=0)
n = max(1, int(math.ceil(2 * reach)))
n += n % 2
big = src.resize((max(1, round(w * K)), max(1, round(h * K))), Image.LANCZOS)
canvas = Image.new('RGBa', (n * K, n * K), (0, 0, 0, 0))
canvas.paste(big, ((n * K - big.width) // 2, (n * K - big.height) // 2))
for deg in range(0, 360, STEP):
    turned = canvas.rotate(-deg, resample=Image.BICUBIC)
    turned.resize((n, n), Image.LANCZOS).convert('RGBA').save(os.path.join(out, 'arrow_rotation_%03d.png' % deg))
print('%d arrows of %d px (the arrow %g x %g px) in %s' % (360 // STEP, n, w, h, out))
