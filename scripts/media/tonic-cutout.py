"""Studio packshot for a cylindrical bottle cut out of an editorial photo.

No AI and no repainting: the bottle is a straight-walled cylinder, so its
silhouette is a geometric mask built from edges measured on the original
(cap box + body box with rounded base). Only the pixels inside that mask are
used, unchanged; everything else (scene, props, coloured background) is
dropped. The cut-out is then placed exactly like the studio packshots
(public/images/products/packshot/rosemary-hair-oil.webp): 1200x1600 white
canvas, bottle top at y=172, base at y=1295, centred, with a soft contact
shadow and a fading mirror reflection.

usage: python3 -P scripts/media/tonic-cutout.py <src> <out.webp> <overlay.png> \
         <cap l,r,top,bottom,arc> <body l,r,base,radius> [hinge x,y_start,y_end]
  cap top is an arc in perspective: `top` is its highest point, `arc` how far
  it drops towards the cap edges (measured on the original).
  hinge: the flip-top lid sits lower towards its hinge; everything above the
  line (x, y_start) -> (cap right edge, y_end) is removed.
"""
import sys
from PIL import Image, ImageChops, ImageDraw, ImageFilter

src, out, overlay_out = sys.argv[1:4]
cl, cr, ct, cb, arc = (int(v) for v in sys.argv[4].split(","))
bl, br, base, brad = (int(v) for v in sys.argv[5].split(","))
hinge = [int(v) for v in sys.argv[6].split(",")] if len(sys.argv) > 6 else None

CANVAS = (1200, 1600)
TOP, BASE = 172, 1295  # bottle extent in the reference packshots
SS = 4  # supersampling for anti-aliased mask edges
INSET = 1.5  # px pulled inside the measured edge so no background fringe stays

raw = Image.open(src).convert("RGB")
W, H = raw.size

# Geometric silhouette at SS x resolution.
big = Image.new("L", (W * SS, H * SS), 0)
d = ImageDraw.Draw(big)
i = INSET
# Cap: half-ellipse top (perspective arc) + straight sides down to the seam.
d.ellipse(((cl + i) * SS, (ct + i) * SS, (cr - i) * SS, (ct + 2 * arc) * SS), fill=255)
d.rectangle(((cl + i) * SS, (ct + arc) * SS, (cr - i) * SS, (cb + 2) * SS), fill=255)
d.rounded_rectangle(((bl + i) * SS, (cb - 2) * SS, (br - i) * SS, (base - i) * SS), radius=brad * SS, fill=255)
# Square off the top of the body (only its base is rounded).
d.rectangle(((bl + i) * SS, (cb - 2) * SS, (br - i) * SS, (cb + brad + 2) * SS), fill=255)
if hinge:
    hx, hy0, hy1 = hinge
    d.polygon([(hx * SS, (ct - 10) * SS), ((cr + 4) * SS, (ct - 10) * SS), ((cr + 4) * SS, (hy1 + i) * SS), (hx * SS, (hy0 + i) * SS)], fill=0)
mask = big.resize((W, H), Image.LANCZOS)

# Overlay for visual check of the mask fit.
ov = raw.copy()
edge = mask.filter(ImageFilter.FIND_EDGES).point(lambda v: 255 if v > 40 else 0)
ov.paste((255, 0, 80), mask=edge)
ov.save(overlay_out)

# Cut out on transparent, crop to the bottle.
bottle = raw.copy()
bottle.putalpha(mask)
bottle = bottle.crop((min(cl, bl), ct, max(cr, br), base))

# Scale to the reference height and place it.
scale = (BASE - TOP) / bottle.height
bw, bh = round(bottle.width * scale), BASE - TOP
bottle = bottle.resize((bw, bh), Image.LANCZOS)
x0 = (CANVAS[0] - bw) // 2

canvas = Image.new("RGB", CANVAS, (255, 255, 255))

# Mirror reflection: flipped bottle, ~22% opacity, fading out over 320 px.
refl = bottle.transpose(Image.FLIP_TOP_BOTTOM)
fade = Image.linear_gradient("L").resize(refl.size).point(lambda v: 255 - v)
fade = fade.point(lambda v: int(v * 0.22 * min(1, v / 255 * 1.4)))
ra = ImageChops.multiply(refl.getchannel("A"), fade.resize(refl.size))
cut = 320
refl.putalpha(ra)
refl = refl.crop((0, 0, bw, min(cut, bh)))
canvas.paste(refl, (x0, BASE + 2), refl)

# Contact shadow: soft dark ellipse under the base.
shadow = Image.new("L", CANVAS, 0)
ImageDraw.Draw(shadow).ellipse((x0 + bw * 0.06, BASE - 10, x0 + bw * 0.94, BASE + 14), fill=90)
shadow = shadow.filter(ImageFilter.GaussianBlur(9))
canvas = Image.composite(Image.new("RGB", CANVAS, (60, 55, 50)), canvas, shadow)

canvas.paste(bottle, (x0, TOP), bottle)
canvas.save(out, "WEBP", quality=90, method=6)
print(f"{out}: bottle {bw}x{bh} at x={x0}, scale={scale:.3f}")
