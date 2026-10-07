# Media pipeline (VIA LABOTE)

Deterministic, no AI. Runs locally with the installed Google Chrome via Playwright
(`channel: "chrome"`; the project already depends on `playwright`).

```bash
# 1. packshots: assets/product-media/original/*.png -> enhanced/*.webp (+ JSON report)
node scripts/media/normalize-packshots.mjs assets/product-media/original assets/product-media/enhanced /tmp/normalize-report.json
#    then copy the SKUs sold in the shop to public/images/products/packshot/

# 2. concern textures (seeded, reproducible) -> assets/product-media/concern/
node scripts/media/concern-art.mjs assets/product-media/concern
#    then copy to public/images/concern/

# 3. text-free hero crop of the brand banner (x >= 760) + cream tone sample
node scripts/media/hero-crop.mjs assets/product-media/editorial/vialabote-hero-banner.jpg public/images/hero/vialabote-hero-beauty.jpg 760
```

# 4. tonic card images from owner editorial photos (crop + background fade, bottle untouched)
#    python3 -P scripts/media/tonic-card.py assets/product-media/original/toner-serum-ph6-original.jpeg assets/product-media/enhanced/toner-serum-ph6.webp 580 195 1135 434,186,726,1140
#    python3 -P scripts/media/tonic-card.py assets/product-media/original/toner-serum-ph55-original.jpeg assets/product-media/enhanced/toner-serum-ph55.webp 721 80 815 612,72,830,822

See `assets/product-media/PRODUCT-MEDIA-MANIFEST.md` for what each step does and the per-SKU results.
