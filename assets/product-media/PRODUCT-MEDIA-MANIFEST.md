# VIA LABOTE — Product Media Manifest

Каноническая библиотека товарных изображений Vialabote Shop. Обновлено: 2026-10-07 (Visual V2).

## Источники и правила

- `original/` — байт-в-байт оригиналы с https://vialabote.ru/images/products/*.png (собственные packshot-снимки бренда). Каждый файл **идентичен по md5** владельческому оригиналу из `public/images/products/source/` (коммит d43aacd) — источник подтверждён дважды.
- `enhanced/` — нормализованные packshot (см. «Обработка»). В витрину копируются в `public/images/products/packshot/` только SKU, которые есть в каталоге магазина.
- `cutout/` — **не создавались** (см. `cutout/README.md`).
- `editorial/` — редакционные снимки реальных продуктов бренда (английские этикетки) + hero-баннер. Используются в storytelling/hero, не как основное фото карточки.
- `concern/` — процедурные абстрактные текстуры для карточек потребностей. Без продуктов, упаковки, лиц.
- `references/` — только ссылки и анализ принципов, без чужих изображений.

**Исключено:** кампейн-изображения со старого сайта (`/images/banner-personal-care.webp`, `/images/hero/hero-main-*-custom.webp`, `/images/products/ready-care-*-custom.webp`, `/images/personal-mobile-custom.webp`, `/images/cards/z1.webp`) — на них банки/флаконы, которых нет в линейке VIA LABOTE (по виду сгенерированы). Использование показало бы несуществующие продукты.

## Обработка (enhanced)

Детерминированно, без AI и без перерисовки — `scripts/media/normalize-packshots.mjs` (см. `scripts/media/README.md`):

1. **Flat-field**: поле студийного фона оценивается по сетке 24 px из ячеек без продукта, за продуктом — диффузионная интерполяция; изображение делится на это поле по каналам → неравномерный свет/виньетка становятся чистым белым. Пиксели > 249 → 255 (шум фона).
2. **Центрирование** bbox продукта по горизонтали (сдвиг в px указан ниже). Без масштабирования — реальное соотношение размеров упаковок сохранено.
3. **WebP q=0.9**, 1200×1600.

Этикетки не редактировались. Проверка 1:1 (retinal): текст этикетки, прозрачный колпачок, края — без изменений, без ореолов; белая бумага этикетки становится чистым белым (как и фон).

На витрине packshot выводится на тёплой «сцене» `.vl-stage` (#F1EADF) с `mix-blend-mode: multiply` — белый фон становится тоном сцены, все товары выглядят как одна фотосессия.

## SKU

### hyaluron-8in1

```
SKU=hyaluron-8in1
NAME=Сыворотка 8 в 1 (гиалурон)
SHOP_PRODUCT=serum-8-in-1-white-tea / «Сыворотка 8 in 1 White Tea»
SOURCE_URL=https://vialabote.ru/images/products/hyaluron-8in1.png
OWNER_ORIGINAL=public/images/products/source/сыворотка 8 в 1.png (md5 identical)
ORIGINAL=assets/product-media/original/hyaluron-8in1.png (2.21 MB)
ENHANCED=assets/product-media/enhanced/hyaluron-8in1.webp (62 KB)  → public/images/products/packshot/hyaluron-8in1.webp
CUTOUT=— (не создан, см. cutout/README.md)
EDITORIAL=assets/product-media/editorial/hyaluron-8in1-editorial.webp
RESOLUTION=1200x1600
ALPHA=no
QUALITY=bg median 248; flat-field max gain 1.104; shiftX -3 px; packshot series, labels readable
MANUAL_REVIEW=NO
NOTES=—
```

### retinal

```
SKU=retinal
NAME=Ретиналь сыворотка
SHOP_PRODUCT=inci-retinal-serum / «INCI Retinal Serum»
SOURCE_URL=https://vialabote.ru/images/products/retinal.png
OWNER_ORIGINAL=public/images/products/source/ретиналь.png (md5 identical)
ORIGINAL=assets/product-media/original/retinal.png (2.04 MB)
ENHANCED=assets/product-media/enhanced/retinal.webp (51 KB)  → public/images/products/packshot/retinal.webp
CUTOUT=— (не создан, см. cutout/README.md)
EDITORIAL=assets/product-media/editorial/retinal-editorial.webp
RESOLUTION=1200x1600
ALPHA=no
QUALITY=bg median 245; flat-field max gain 1.138; shiftX 7 px; packshot series, labels readable
MANUAL_REVIEW=YES
NOTES=Этикетка packshot — русская («РЕТИНАЛЬ сыворотка»), editorial-снимок и название в магазине — английские («INCI Retinal serum»): подтвердить актуальную версию упаковки.
```

### multi3

```
SKU=multi3
NAME=Мульти3 сыворотка анти-акне
SHOP_PRODUCT=multi3-anti-acne-serum / «Multi3 Anti-Acne Serum»
SOURCE_URL=https://vialabote.ru/images/products/multi3.png
OWNER_ORIGINAL=public/images/products/source/анти-акне.png (md5 identical)
ORIGINAL=assets/product-media/original/multi3.png (2.02 MB)
ENHANCED=assets/product-media/enhanced/multi3.webp (49 KB)  → public/images/products/packshot/multi3.webp
CUTOUT=— (не создан, см. cutout/README.md)
EDITORIAL=assets/product-media/editorial/multi3-editorial.webp
RESOLUTION=1200x1600
ALPHA=no
QUALITY=bg median 245; flat-field max gain 1.118; shiftX 6 px; packshot series, labels readable
MANUAL_REVIEW=YES
NOTES=Этикетка packshot «МУЛЬТИ3» (рус.), editorial — «multi3» (англ.): подтвердить актуальную упаковку.
```

### resveratrol-c

```
SKU=resveratrol-c
NAME=Сыворотка ресвератрол + витамин C
SHOP_PRODUCT=serum-resveratrol-vitamin-c / «Сыворотка Ресвератрол + Витамин C»
SOURCE_URL=https://vialabote.ru/images/products/resveratrol-c.png
OWNER_ORIGINAL=public/images/products/source/ресвератрол.png (md5 identical)
ORIGINAL=assets/product-media/original/resveratrol-c.png (2.15 MB)
ENHANCED=assets/product-media/enhanced/resveratrol-c.webp (66 KB)  → public/images/products/packshot/resveratrol-c.webp
CUTOUT=— (не создан, см. cutout/README.md)
EDITORIAL=assets/product-media/editorial/resveratrol-c-editorial.webp
RESOLUTION=1200x1600
ALPHA=no
QUALITY=bg median 251; flat-field max gain 1.094; shiftX 5 px; packshot series, labels readable
MANUAL_REVIEW=NO
NOTES=—
```

### hydrophilic-oil

```
SKU=hydrophilic-oil
NAME=Гидрофильное гель-масло
SHOP_PRODUCT=hydrophilic-gel-oil / «Гидрофильное гель-масло»
SOURCE_URL=https://vialabote.ru/images/products/hydrophilic-oil.png
OWNER_ORIGINAL=public/images/products/source/гель масло.png (md5 identical)
ORIGINAL=assets/product-media/original/hydrophilic-oil.png (2.00 MB)
ENHANCED=assets/product-media/enhanced/hydrophilic-oil.webp (75 KB)  → public/images/products/packshot/hydrophilic-oil.webp
CUTOUT=— (не создан, см. cutout/README.md)
EDITORIAL=assets/product-media/editorial/hydrophilic-oil-editorial.webp
RESOLUTION=1200x1600
ALPHA=no
QUALITY=bg median 251; flat-field max gain 1.071; shiftX -19 px; packshot series, labels readable
MANUAL_REVIEW=NO
NOTES=—
```

### hydrophilic-balancing-oil

```
SKU=hydrophilic-balancing-oil
NAME=Гидрофильное масло балансирующее
SHOP_PRODUCT=hydrophilic-balancing-oil (DRAFT: price=0, stock=0 — цена на сайте бренда не указана; publish без цены запрещён)
SOURCE_URL=https://vialabote.ru/images/products/hydrophilic-balancing-oil.png
OWNER_ORIGINAL=public/images/products/source/гидрофильное баланс.png (md5 identical)
ORIGINAL=assets/product-media/original/hydrophilic-balancing-oil.png (0.40 MB)
ENHANCED=assets/product-media/enhanced/hydrophilic-balancing-oil.webp (46 KB)  → public/images/products/packshot/hydrophilic-balancing-oil.webp
CUTOUT=— (не создан, см. cutout/README.md)
EDITORIAL=—
RESOLUTION=1200x1600
ALPHA=no
QUALITY=bg median 253; flat-field max gain 1.063; shiftX -17 px; packshot series, labels readable
MANUAL_REVIEW=YES
NOTES=Оригинал заметно легче остальных (398 KB против 1.6–2.2 MB) — проверить резкость этикетки на 100%.
```

### beard-oil

```
SKU=beard-oil
NAME=Масло для бороды СТЕБЛЕВ (табак)
SHOP_PRODUCT=beard-oil-steblev / «Steb.Lev Beard Oil»
SOURCE_URL=https://vialabote.ru/images/products/beard-oil.png
OWNER_ORIGINAL=public/images/products/source/масло табак.png (md5 identical)
ORIGINAL=assets/product-media/original/beard-oil.png (1.69 MB)
ENHANCED=assets/product-media/enhanced/beard-oil.webp (73 KB)  → public/images/products/packshot/beard-oil.webp
CUTOUT=— (не создан, см. cutout/README.md)
EDITORIAL=assets/product-media/editorial/beard-oil-editorial.webp
RESOLUTION=1200x1600
ALPHA=no
QUALITY=bg median 252; flat-field max gain 1.09; shiftX -7 px; packshot series, labels readable
MANUAL_REVIEW=YES
NOTES=В магазине один SKU «Steb.Lev Beard Oil», в линейке три варианта (табак / без аромата / бигмен). Для карточки выбран beard-oil (табак) — подтвердить вариант. Editorial-снимок — английская этикетка «BEARD OIL».
```

### beard-oil-unscented

```
SKU=beard-oil-unscented
NAME=Масло для бороды СТЕБЛЕВ без аромата
SHOP_PRODUCT=beard-oil-unscented (DRAFT: price=0, stock=0 — цена на сайте бренда не указана; publish без цены запрещён)
SOURCE_URL=https://vialabote.ru/images/products/beard-oil-unscented.png
OWNER_ORIGINAL=public/images/products/source/масло без аромата.png (md5 identical)
ORIGINAL=assets/product-media/original/beard-oil-unscented.png (1.94 MB)
ENHANCED=assets/product-media/enhanced/beard-oil-unscented.webp (81 KB)  → public/images/products/packshot/beard-oil-unscented.webp
CUTOUT=— (не создан, см. cutout/README.md)
EDITORIAL=—
RESOLUTION=1200x1600
ALPHA=no
QUALITY=bg median 250; flat-field max gain 1.071; shiftX 1 px; packshot series, labels readable
MANUAL_REVIEW=NO
NOTES=—
```

### beard-oil-bigman

```
SKU=beard-oil-bigman
NAME=Масло для бороды СТЕБЛЕВ «Бигмен»
SHOP_PRODUCT=beard-oil-bigman (DRAFT: price=0, stock=0 — цена на сайте бренда не указана; publish без цены запрещён)
SOURCE_URL=https://vialabote.ru/images/products/beard-oil-bigman.png
OWNER_ORIGINAL=public/images/products/source/масло бигмен.png (md5 identical)
ORIGINAL=assets/product-media/original/beard-oil-bigman.png (1.59 MB)
ENHANCED=assets/product-media/enhanced/beard-oil-bigman.webp (80 KB)  → public/images/products/packshot/beard-oil-bigman.webp
CUTOUT=— (не создан, см. cutout/README.md)
EDITORIAL=—
RESOLUTION=1200x1600
ALPHA=no
QUALITY=bg median 255; flat-field max gain 1.032; shiftX -4 px; packshot series, labels readable
MANUAL_REVIEW=NO
NOTES=—
```

### raspberry-ketone-hair-oil

```
SKU=raspberry-ketone-hair-oil
NAME=Масло для волос кетон малины СТЕБЛЕВ
SHOP_PRODUCT=raspberry-ketone-hair-oil (DRAFT: price=0, stock=0 — цена на сайте бренда не указана; publish без цены запрещён)
SOURCE_URL=https://vialabote.ru/images/products/raspberry-ketone-hair-oil.png
OWNER_ORIGINAL=public/images/products/source/масло малины.png (md5 identical)
ORIGINAL=assets/product-media/original/raspberry-ketone-hair-oil.png (1.69 MB)
ENHANCED=assets/product-media/enhanced/raspberry-ketone-hair-oil.webp (82 KB)  → public/images/products/packshot/raspberry-ketone-hair-oil.webp
CUTOUT=— (не создан, см. cutout/README.md)
EDITORIAL=—
RESOLUTION=1200x1600
ALPHA=no
QUALITY=bg median 254; flat-field max gain 1.032; shiftX 4 px; packshot series, labels readable
MANUAL_REVIEW=NO
NOTES=—
```

### rosemary-hair-oil

```
SKU=rosemary-hair-oil
NAME=Масло для волос розмарин СТЕБЛЕВ
SHOP_PRODUCT=rosemary-hair-oil (DRAFT: price=0, stock=0 — цена на сайте бренда не указана; publish без цены запрещён)
SOURCE_URL=https://vialabote.ru/images/products/rosemary-hair-oil.png
OWNER_ORIGINAL=public/images/products/source/масло розмарина.png (md5 identical)
ORIGINAL=assets/product-media/original/rosemary-hair-oil.png (1.76 MB)
ENHANCED=assets/product-media/enhanced/rosemary-hair-oil.webp (80 KB)  → public/images/products/packshot/rosemary-hair-oil.webp
CUTOUT=— (не создан, см. cutout/README.md)
EDITORIAL=—
RESOLUTION=1200x1600
ALPHA=no
QUALITY=bg median 254; flat-field max gain 1.071; shiftX 10 px; packshot series, labels readable
MANUAL_REVIEW=NO
NOTES=—
```

## Editorial / hero

| Файл | Что | Использование |
|---|---|---|
| `editorial/vialabote-hero-banner.jpg` | Исходный баннер 2001×786 с вшитым текстом и кнопками (предоставлен владельцем) | Архив; на сайте не используется |
| `editorial/vialabote-hero-beauty.jpg` | Правая часть баннера x ≥ 760 (1241×786), без текста/кнопок | Hero V2 (`public/images/hero/vialabote-hero-beauty.jpg`) |
| `editorial/*-editorial.webp` | Прежние фото карточек: реальные продукты бренда на цветных фонах (англ. этикетки) | Storytelling: блок «О бренде» (`public/images/editorial/brand-story.webp` = hydrophilic-oil) |

## Concern

| Файл | Потребность (slug) | Мотив |
|---|---|---|
| `concern/concern-acne.webp` | acne | шалфейный фон, «матрица чистоты», капля |
| `concern/concern-anti-age.webp` | anti-age | розово-песочный, эластичные контурные линии |
| `concern/concern-dryness.webp` | dryness | вода: концентрические круги, капли |
| `concern/concern-dull-tone.webp` | dull-tone | свет: тёплое свечение, каустика, капля |
| `concern/concern-men.webp` | men | navy, «шлифованная» фактура, золотая линия |

Процедурная генерация (canvas, seeded, плёночное зерно), 1200×1500 WebP. Ни одно изображение не изображает продукт или упаковку.
