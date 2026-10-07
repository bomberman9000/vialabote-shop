import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { ROUTINE_TAGS } from "../src/lib/routine-data";
import { CONCERNS, SKIN_TYPES } from "../src/lib/routine-engine";
import { buildLifecycleFields } from "../src/lib/admin/product-lifecycle";

const prisma = new PrismaClient();

async function main() {
  // Категории — как в каталоге бренда vialabote.ru/products (2026-10-07):
  // фильтры Сыворотки · Очищение · Для бороды · Для волос. Старая
  // «Уход за лицом» не удаляется (на неё могут ссылаться товары из
  // админки/Telegram) — пустая категория просто не попадает в фильтры.
  const category = async (slug: string, name: string) =>
    prisma.category.upsert({ where: { slug }, update: { name }, create: { slug, name } });
  const serums = await category("syvorotki", "Сыворотки");
  const cleansing = await category("ochishchenie", "Очищение");
  const men = await category("dlya-muzhchin", "Для бороды");
  const hair = await category("uhod-za-volosami", "Для волос");
  const toners = await category("toniki", "Тоники");

  // КАТАЛОГ = 11 товаров линейки бренда, сверены с vialabote.ru/products
  // (название, категория, объём, описание, активные компоненты, способ
  // применения, packshot — тот же файл, что на сайте бренда). Тексты — с
  // сайта бренда без добавлений; subtitle — короткая выжимка его же
  // формулировок. Где на сайте бренда нет состава/применения, поле пустое.
  //
  // Цена: owner-confirmed цены собственного магазина (2026-10-07) — source of
  // truth для Vialabote Shop. Цены/скидки Wildberries в магазин не переносятся.
  // Остаток — отдельное поле: у SKU без подтверждённого остатка stock=0
  // («Нет в наличии»), пока владелец не задаст его в админке/Telegram.
  // Контентные поля и цену сид обновляет у всех SKU; остаток и статус —
  // только при создании (их меняет владелец).
  type CatalogEntry = {
    slug: string;
    title: string;
    subtitle: string;
    description: string;
    activeIngredients: string | null;
    howToUse: string | null;
    volume: string;
    imageUrl: string;
    categoryId: string;
    // PDP-галерея: исходные фото владельца (без изменений), идут после
    // карточного packshot. width/height/sizeBytes — реальные параметры файла.
    gallery?: { url: string; storageKey: string; width: number; height: number; sizeBytes: number }[];
  } & ({ lifecycle: "published"; price: number; stock: number } | { lifecycle: "draft" });

  const catalog: CatalogEntry[] = [
    {
      slug: "serum-8-in-1-white-tea", // vialabote.ru: hyaluron-8in1
      title: "Увлажняющая сыворотка для лица с гиалуроновой кислотой 8 в 1",
      subtitle: "Увлажнение при сухости, шелушении и тусклости",
      description:
        "Увлажняющая сыворотка содержит высоко- и низкомолекулярную гиалуроновую кислоту, пантенол, экстракты белого чая и ромашки. В каталоге она предназначена для ухода при сухости, шелушении, тусклости и морщинах.",
      activeIngredients:
        "Гиалуроновая кислота высокомолекулярная\nГиалуроновая кислота низкомолекулярная\nЭкстракт белого чая\nЭкстракт ромашки\nПантенол",
      howToUse:
        "Лёгкую текстуру можно наносить на лицо, шею и декольте перед кремом.\nПереносимость косметики индивидуальна: перед первым применением проверьте актуальный состав на упаковке и протестируйте средство на небольшом участке кожи.",
      volume: "50 мл",
      imageUrl: "/images/products/packshot/hyaluron-8in1.webp",
      categoryId: serums.id,
      lifecycle: "published",
      price: 51000,
      stock: 20,
    },
    {
      slug: "inci-retinal-serum", // vialabote.ru: retinal
      title: "Сыворотка для лица с РЕТИНАЛЕМ",
      subtitle: "Вечерний уход при неровном тоне, постакне и морщинах",
      description:
        "В составе продукта указаны ретинальдегид, лизат лактобактерий, витамин A и пантенол. Сыворотка предназначена для вечернего косметического ухода при неровном тоне, постакне, тусклости и морщинах.",
      activeIngredients:
        "Ретинальдегид (ретиналь)\nЛизат лактобактерий\nВитамин A\nВитамин B5 (пантенол)\nПробиотики",
      howToUse:
        "Нанесите небольшое количество на чистую кожу, избегая области вокруг глаз, и следуйте инструкции на актуальной упаковке.\nВводите средство постепенно, учитывайте индивидуальную переносимость и используйте подходящую дневную защиту от солнца.\nПри беременности, грудном вскармливании или терапии согласуйте использование ретиноидов с врачом.",
      volume: "50 мл",
      imageUrl: "/images/products/packshot/retinal.webp",
      categoryId: serums.id,
      lifecycle: "published",
      price: 59000,
      stock: 10,
    },
    {
      slug: "multi3-anti-acne-serum", // vialabote.ru: multi3
      title: "Сыворотка для лица от прыщей анти акне с ниацинамидом",
      subtitle: "MULTI 3: жирный блеск, черные точки, высыпания",
      description:
        "MULTI 3 — сыворотка для косметического ухода за кожей с высыпаниями, черными точками и жирным блеском. В карточке продукта указаны ниацинамид, салициловая кислота, пробиотический комплекс и растительные экстракты.",
      activeIngredients:
        "Ниацинамид\nСалициловая кислота\nКомплекс пробиотиков\nКомплексы растительных экстрактов",
      howToUse:
        "Лёгкая текстура рассчитана на нанесение небольшого количества средства.\nВводите продукт постепенно и проверяйте актуальный состав на упаковке.\nКосметическое средство не предназначено для диагностики или медицинской терапии; при болезненных или устойчивых высыпаниях обратитесь к врачу.",
      volume: "50 мл",
      imageUrl: "/images/products/packshot/multi3.webp",
      categoryId: serums.id,
      lifecycle: "published",
      price: 57000,
      stock: 18,
    },
    {
      slug: "serum-resveratrol-vitamin-c", // vialabote.ru: resveratrol-c
      title: "Сыворотка для лица осветляющая с ресвератролом",
      subtitle: "Ресвератрол и витамин C при тусклости и неровном тоне",
      description:
        "Сыворотка содержит ресвератрол, аскорбилфосфат натрия — стабильную форму витамина C — и комплекс растительных экстрактов. В каталоге продукт относится к уходу при тусклости, неровном тоне, пигментации, постакне и возрастных изменениях.",
      activeIngredients:
        "Ресвератрол\nВитамин C (аскорбилфосфат натрия)\nЭкстракт мучели\nКомплекс растительных экстрактов",
      howToUse:
        "Наносите небольшое количество на очищенную кожу перед кремом согласно инструкции на актуальной упаковке.\nДнём используйте подходящую защиту от солнца.\nПереносимость активных компонентов индивидуальна.",
      volume: "50 мл",
      imageUrl: "/images/products/packshot/resveratrol-c.webp",
      categoryId: serums.id,
      lifecycle: "published",
      price: 63000,
      stock: 15,
    },
    {
      slug: "hydrophilic-gel-oil", // vialabote.ru: hydrophilic-oil
      title: "Гидрофильное гель-масло для умывания лица",
      subtitle: "Первый этап очищения: стойкий макияж, SPF, BB- и CC-крем",
      description:
        "Гидрофильное гель-масло предназначено для первого этапа очищения: удаления стойкого макияжа, SPF, BB- и CC-крема. В карточке продукта указаны масла миндаля, виноградной косточки, шиповника, семян моркови и киви.",
      activeIngredients:
        "Масло миндаля\nМасло виноградной косточки\nМасло шиповника\nМасло семян моркови\nМасло семян киви",
      howToUse:
        "Нанесите небольшое количество на сухую кожу, аккуратно распределите, добавьте воду для эмульгирования и тщательно смойте.\nПри необходимости завершите очищение привычным мягким средством.\nУчитывайте индивидуальную переносимость масел и сверяйте актуальный состав с упаковкой.",
      volume: "150 мл",
      imageUrl: "/images/products/packshot/hydrophilic-oil.webp",
      categoryId: cleansing.id,
      lifecycle: "published",
      price: 50000,
      stock: 25,
    },
    {
      slug: "beard-oil-steblev", // vialabote.ru: beard-oil
      title: "Масло для бороды с ароматом табака и амбры",
      subtitle: "Несмываемое · аромат табака, ванили и амбры · СТЕБЛЕВ",
      description:
        "Несмываемое масло для бороды с ароматом табака, ванили и амбры. В карточке продукта указаны масла оливы, миндаля, жожоба, подсолнечника и арганы, касторовое масло и витамин E.",
      activeIngredients:
        "Масло оливы\nМасло миндаля\nМасло жожоба\nМасло подсолнечника\nВитамин E\nКасторовое масло\nМасло арганы",
      howToUse:
        "Небольшое количество масла разотрите в ладонях и распределите по чистой сухой бороде и коже под ней.\nКоличество средства зависит от длины бороды; следуйте инструкции на актуальной упаковке и учитывайте индивидуальную переносимость компонентов.",
      volume: "50 мл",
      imageUrl: "/images/products/packshot/beard-oil.webp",
      categoryId: men.id,
      lifecycle: "published",
      price: 55000,
      stock: 12,
    },
    {
      slug: "hydrophilic-balancing-oil",
      title: "Масло гидрофильное балансирующее для умывания лица",
      subtitle: "Масло моринги и экстракт центеллы азиатской",
      description: "Гидрофильное балансирующее масло с маслом моринги и экстрактом центеллы азиатской.",
      activeIngredients: "Масло моринги\nЭкстракт центеллы азиатской",
      howToUse: null,
      volume: "150 мл",
      imageUrl: "/images/products/packshot/hydrophilic-balancing-oil.webp",
      categoryId: cleansing.id,
      lifecycle: "published",
      price: 60000,
      stock: 0, // остаток не подтверждён — владелец задаёт в админке/Telegram
    },
    {
      slug: "beard-oil-unscented",
      title: "Масло для бороды без аромата",
      subtitle: "Без аромата · СТЕБЛЕВ",
      description: "Масло для бороды без аромата, 50 мл, линейка СТЕБЛЕВ.",
      activeIngredients: null,
      howToUse: null,
      volume: "50 мл",
      imageUrl: "/images/products/packshot/beard-oil-unscented.webp",
      categoryId: men.id,
      lifecycle: "published",
      price: 59000,
      stock: 0, // остаток не подтверждён — владелец задаёт в админке/Telegram
    },
    {
      slug: "beard-oil-bigman",
      title: "Масло для бороды с ароматом Бигмен",
      subtitle: "Аромат Бигмен · СТЕБЛЕВ",
      description: "Масло для бороды с ароматом Бигмен, 50 мл, линейка СТЕБЛЕВ.",
      activeIngredients: null,
      howToUse: null,
      volume: "50 мл",
      imageUrl: "/images/products/packshot/beard-oil-bigman.webp",
      categoryId: men.id,
      lifecycle: "published",
      price: 50000,
      stock: 0, // остаток не подтверждён — владелец задаёт в админке/Telegram
    },
    {
      slug: "raspberry-ketone-hair-oil",
      title: "Масло для роста волос с кетоном малины",
      subtitle: "Кетон малины и экстракт шёлка · СТЕБЛЕВ Космецевтика",
      description: "Масло для волос с кетоном малины, экстрактом шёлка и растительными экстрактами.",
      activeIngredients: "Кетон малины\nЭкстракт шёлка\nРастительные экстракты",
      howToUse: null,
      volume: "50 мл",
      imageUrl: "/images/products/packshot/raspberry-ketone-hair-oil.webp",
      categoryId: hair.id,
      lifecycle: "published",
      price: 48000,
      stock: 0, // остаток не подтверждён — владелец задаёт в админке/Telegram
    },
    {
      slug: "rosemary-hair-oil",
      title: "Масло для роста волос с розмарином",
      subtitle: "Розмарин и биокомплекс · СТЕБЛЕВ Космецевтика",
      description: "Масло для волос с розмарином и биокомплексом, 50 мл.",
      activeIngredients: "Масло розмарина\nБиокомплекс",
      howToUse: null,
      volume: "50 мл",
      imageUrl: "/images/products/packshot/rosemary-hair-oil.webp",
      categoryId: hair.id,
      lifecycle: "published",
      price: 45000,
      stock: 0, // остаток не подтверждён — владелец задаёт в админке/Telegram
    },
    // Тоники — новые SKU (2026-10-07): на vialabote.ru их нет, источник —
    // оригинальные фото владельца (assets/product-media/original/toner-*).
    // Тексты — только то, что читается на этикетке; цена подтверждена
    // владельцем; остаток не подтверждён. Карточное фото — студийный packshot,
    // вырезанный из оригинала без AI (scripts/media/tonic-cutout.py).
    {
      slug: "toner-serum-ph6",
      title: "Тоник-сыворотка pH 6.0",
      subtitle: "Увлажняющая эссенция с минеральной солью и экстрактом жемчуга",
      description:
        "Увлажняющая эссенция с минеральной солью реликтового озера и экстрактом жемчуга. Рекомендован для всех типов кожи.\nМинеральное восстановление. Увлажнение и сияние. Упругость и эластичность.",
      activeIngredients: "Минеральная соль реликтового озера\nЭкстракт жемчуга",
      howToUse: null,
      volume: "200 мл",
      imageUrl: "/images/products/packshot/toner-serum-ph6.webp",
      categoryId: toners.id,
      gallery: [
        { url: "/images/products/gallery/toner-serum-ph6.jpg", storageKey: "seed/toner-serum-ph6-original", width: 1152, height: 1536, sizeBytes: 330578 },
      ],
      lifecycle: "published",
      price: 52000,
      stock: 0, // остаток не подтверждён — владелец задаёт в админке/Telegram
    },
    {
      slug: "toner-serum-ph55",
      title: "Тоник-сыворотка для лица мультиактивный pH 5.5",
      subtitle: "Для жирной, комбинированной и проблемной кожи",
      description:
        "Интеллектуальный коктейль для жирной, комбинированной и проблемной кожи.\nТройной кислотный комплекс. Пробиотики. Эко-увлажнение. Аминокислоты.",
      activeIngredients: "Тройной кислотный комплекс\nПробиотики\nАминокислоты",
      howToUse: null,
      volume: "200 мл",
      imageUrl: "/images/products/packshot/toner-serum-ph55.webp",
      categoryId: toners.id,
      gallery: [
        { url: "/images/products/gallery/toner-serum-ph55.jpg", storageKey: "seed/toner-serum-ph55-original", width: 1440, height: 900, sizeBytes: 321307 },
      ],
      lifecycle: "published",
      price: 55000,
      stock: 0, // остаток не подтверждён — владелец задаёт в админке/Telegram
    },
  ];

  for (const { lifecycle, gallery, ...entry } of catalog) {
    const content = {
      title: entry.title,
      subtitle: entry.subtitle,
      description: entry.description,
      activeIngredients: entry.activeIngredients,
      howToUse: entry.howToUse,
      volume: entry.volume,
      imageUrl: entry.imageUrl,
      categoryId: entry.categoryId,
    };
    if (lifecycle === "published" && "price" in entry) {
      await prisma.product.upsert({
        where: { slug: entry.slug },
        update: { ...content, price: entry.price },
        // Сид создаёт товары витрины СРАЗУ опубликованными: schema-дефолты —
        // status "draft"/isActive false. Пара status+isActive строится только
        // через buildLifecycleFields — единая точка инварианта
        // isActive === deriveIsActive(status), как и во всех write-путях.
        create: { slug: entry.slug, ...content, price: entry.price, stock: entry.stock, ...buildLifecycleFields("published") },
      });
    } else {
      await prisma.product.upsert({
        where: { slug: entry.slug },
        update: content,
        create: { slug: entry.slug, ...content, price: 0, stock: 0, ...buildLifecycleFields("draft") },
      });
    }

    for (const [order, media] of (gallery ?? []).entries()) {
      const product = await prisma.product.findUnique({ where: { slug: entry.slug } });
      if (!product) continue;
      const row = {
        purpose: "PRODUCT_GALLERY",
        url: media.url,
        width: media.width,
        height: media.height,
        mimeType: "image/jpeg",
        sizeBytes: media.sizeBytes,
        validationState: "valid",
        order,
        productId: product.id,
      };
      await prisma.mediaAsset.upsert({
        where: { storageKey: media.storageKey },
        update: row,
        create: { ...row, storageKey: media.storageKey, createdBy: "seed" },
      });
    }
  }

  // Справочники Routine Finder
  const concernBySlug = new Map<string, string>();
  for (const c of CONCERNS) {
    const row = await prisma.concern.upsert({
      where: { slug: c.slug },
      update: { name: c.name },
      create: { slug: c.slug, name: c.name },
    });
    concernBySlug.set(c.slug, row.id);
  }

  const skinTypeBySlug = new Map<string, string>();
  for (const s of SKIN_TYPES) {
    const row = await prisma.skinType.upsert({
      where: { slug: s.slug },
      update: { name: s.name },
      create: { slug: s.slug, name: s.name },
    });
    skinTypeBySlug.set(s.slug, row.id);
  }

  // Теги по каждому SKU: routineStep/routineRole + связи concern/skinType
  for (const tag of ROUTINE_TAGS) {
    const productRow = await prisma.product.findUnique({ where: { slug: tag.slug } });
    if (!productRow) continue;

    await prisma.product.update({
      where: { id: productRow.id },
      data: { routineStep: tag.routineStep, routineRole: tag.routineRole },
    });

    await prisma.productConcern.deleteMany({ where: { productId: productRow.id } });
    for (const concernSlug of tag.concernSlugs) {
      const concernId = concernBySlug.get(concernSlug);
      if (!concernId) continue;
      await prisma.productConcern.create({
        data: { productId: productRow.id, concernId },
      });
    }

    await prisma.productSkinType.deleteMany({ where: { productId: productRow.id } });
    for (const skinTypeSlug of tag.skinTypeSlugs) {
      const skinTypeId = skinTypeBySlug.get(skinTypeSlug);
      if (!skinTypeId) continue;
      await prisma.productSkinType.create({
        data: { productId: productRow.id, skinTypeId },
      });
    }
  }

  const adminEmail = process.env.SEED_ADMIN_EMAIL || "admin@vialabote.ru";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || "admin12345";
  const passwordHash = await bcrypt.hash(adminPassword, 10);

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      name: "Администратор",
      passwordHash,
      role: "ADMIN",
    },
  });

  console.log(`Готово. Админ: ${adminEmail} / ${adminPassword}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
