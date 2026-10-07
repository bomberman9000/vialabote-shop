"""Catalog card image for an editorial product photo (no AI, no cut-out).

The tonic originals are editorial scenes with a transparent bottle: automatic
background removal damages the clear cap/liquid, so the bottle is NOT cut out.
Instead:
  1. crop the original to the 3:4 card stage around the bottle;
  2. keep the "protected" box (bottle + label + margin) pixel-identical to the
     original;
  3. fade only the surrounding background to white with a soft gradient.
The card stage multiplies its ivory tone over white (`.vl-stage`), so the
faded area reads as the same ivory as the white-studio packshots.
Label/text are never touched. Result is flagged MANUAL_REVIEW in the manifest.

usage: python3 scripts/media/tonic-card.py <src> <out.webp> <cx> <top> <bottom> <protect l,t,r,b>
  cx, top, bottom: bottle centre x and vertical extent in source pixels
  protect: box kept 100% original (source pixels)
"""
import sys
from PIL import Image, ImageChops, ImageFilter

src, out = sys.argv[1], sys.argv[2]
cx, top, bottom = (int(v) for v in sys.argv[3:6])
pl, pt, pr, pb = (int(v) for v in sys.argv[6].split(","))

# Pad with white so the crop may extend past the photo (the margin is faded
# to white anyway); all source coordinates shift by PAD.
PAD = 600
raw = Image.open(src).convert("RGB")
im = Image.new("RGB", (raw.width + 2 * PAD, raw.height + 2 * PAD), (255, 255, 255))
im.paste(raw, (PAD, PAD))
W, H = im.size
cx, top, bottom = cx + PAD, top + PAD, bottom + PAD
pl, pt, pr, pb = pl + PAD, pt + PAD, pr + PAD, pb + PAD

# Bottle occupies ~70% of the stage height, like the studio packshots.
bottle_h = bottom - top
crop_h = round(bottle_h / 0.70)
crop_w = round(crop_h * 3 / 4)
if crop_w > W:
    crop_w = W
    crop_h = round(crop_w * 4 / 3)
cy = (top + bottom) / 2
x0 = max(0, min(W - crop_w, round(cx - crop_w / 2)))
y0 = max(0, min(H - crop_h, round(cy - crop_h / 2)))
crop = im.crop((x0, y0, x0 + crop_w, y0 + crop_h))

# Mask: 255 = keep original, 0 = white. Protected box is solid; a blurred
# edge gives a soft falloff outside it only (box is expanded by the blur
# radius first, so the blur never eats into the protected pixels).
feather = round(crop_w * 0.14)
mask = Image.new("L", crop.size, 0)
box = (pl - x0 - feather, pt - y0 - feather, pr - x0 + feather, pb - y0 + feather)
mask.paste(255, box)
mask = mask.filter(ImageFilter.GaussianBlur(feather / 1.6))
# The photo's own border must also melt into white, otherwise the edge of the
# (white-padded) source shows as a faint line where the crop passes it.
edge = Image.new("L", crop.size, 0)
edge.paste(255, (PAD - x0 + 30, PAD - y0 + 30, PAD + raw.width - x0 - 30, PAD + raw.height - y0 - 30))
edge = edge.filter(ImageFilter.GaussianBlur(10))
mask = ImageChops.multiply(mask, edge)
mask.paste(255, (pl - x0, pt - y0, pr - x0, pb - y0))

white = Image.new("RGB", crop.size, (255, 255, 255))
result = Image.composite(crop, white, mask).resize((900, 1200), Image.LANCZOS)
result.save(out, "WEBP", quality=88, method=6)

# Verify the protected box is untouched (before resize).
check = Image.composite(crop, white, mask).crop((pl - x0, pt - y0, pr - x0, pb - y0))
orig = crop.crop((pl - x0, pt - y0, pr - x0, pb - y0))
assert list(check.getdata()) == list(orig.getdata()), "protected box changed"
print(f"{out}: crop=({x0},{y0},{crop_w}x{crop_h}) protected box identical to original")
