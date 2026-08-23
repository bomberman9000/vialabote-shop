import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { ROUTINE_TAGS } from "../src/lib/routine-data";
import { CONCERNS, SKIN_TYPES } from "../src/lib/routine-engine";

const prisma = new PrismaClient();

async function main() {
  const category = await prisma.category.upsert({
    where: { slug: "uhod-za-litsom" },
    update: {},
    create: { slug: "uhod-za-litsom", name: "Уход за лицом" },
  });

  const beardCategory = await prisma.category.upsert({
    where: { slug: "dlya-muzhchin" },
    update: {},
    create: { slug: "dlya-muzhchin", name: "Для мужчин" },
  });

  const products = [
    {
      slug: "serum-8-in-1-white-tea",
      title: "Сыворотка 8 in 1 White Tea",
      subtitle: "Увлажнение и тонус ежедневно",
      description: "Сыворотка с гиалуроновой кислотой и экстрактом белого чая. 50 мл.",
      activeIngredients:
        "Гиалуроновая кислота (низко- и высокомолекулярная) — увлажнение на разных уровнях кожи\nЭкстракт белого чая — антиоксидантный компонент состава",
      howToUse:
        "Нанести 2–3 капли на очищенную кожу лица утром и вечером, слегка вбить подушечками пальцев. Перед плотным кремом.",
      volume: "50 мл",
      price: 59000,
      oldPrice: null,
      imageUrl: "/images/products/8in1.webp",
      stock: 20,
      categoryId: category.id,
    },
    {
      slug: "serum-resveratrol-vitamin-c",
      title: "Сыворотка Ресвератрол + Витамин C",
      subtitle: "Антиоксидантная защита и сияние",
      description: "Антиоксидантная сыворотка для сияния кожи. 50 мл.",
      activeIngredients:
        "Ресвератрол — антиоксидантный компонент растительного происхождения\nВитамин C — компонент состава, применяемый для ухода за тоном кожи",
      howToUse: "Нанести несколько капель на очищенную кожу утром перед кремом с SPF.",
      volume: "50 мл",
      price: 55000,
      oldPrice: null,
      imageUrl: "/images/products/rastrovetrol2.webp",
      stock: 15,
      categoryId: category.id,
    },
    {
      slug: "inci-retinal-serum",
      title: "INCI Retinal Serum",
      subtitle: "Обновление и упругость кожи",
      description: "Сыворотка с ретиналом, витамином B5 и пробиотиками. 50 мл.",
      activeIngredients:
        "Ретиналь (Vitamin A) — компонент, используемый в уходе anti-age\nВитамин B5 — увлажняющий компонент\nПробиотики — поддержка баланса кожи",
      howToUse:
        "Использовать вечером на очищенную кожу. Начинать с 2–3 раз в неделю, наращивая частоту. Утром обязательно SPF.",
      volume: "50 мл",
      price: 60400,
      oldPrice: null,
      imageUrl: "/images/products/retinal23.webp",
      stock: 10,
      categoryId: category.id,
    },
    {
      slug: "multi3-anti-acne-serum",
      title: "Multi3 Anti-Acne Serum",
      subtitle: "Для проблемной и жирной кожи",
      description: "Сыворотка против акне с ниацинамидом и цинком. 50 мл.",
      activeIngredients:
        "Ниацинамид — компонент состава, применяемый для жирной/проблемной кожи\nЦинк PCA — компонент, регулирующий состав средства",
      howToUse: "Наносить точечно или по всей поверхности лица утром и вечером после очищения.",
      volume: "50 мл",
      price: 56000,
      oldPrice: null,
      imageUrl: "/images/products/antiaa2.webp",
      stock: 18,
      categoryId: category.id,
    },
    {
      slug: "hydrophilic-gel-oil",
      title: "Гидрофильное гель-масло",
      subtitle: "Для умывания и снятия макияжа",
      description: "Балансирующее гидрофильное масло с маслом моринги. 150 мл.",
      activeIngredients: "Масло моринги — базовый компонент формулы гидрофильного масла",
      howToUse:
        "Нанести на сухую кожу, помассировать, смыть тёплой водой или снять салфеткой. Первый шаг двухфазного очищения.",
      volume: "150 мл",
      price: 89000,
      oldPrice: null,
      imageUrl: "/images/products/gidrofil.webp",
      stock: 25,
      categoryId: category.id,
    },
    {
      slug: "beard-oil-steblev",
      title: "Steb.Lev Beard Oil",
      subtitle: "Масло для бороды и кожи лица",
      description: "100% натуральное масло для бороды: укрепление, питание, рост. 50 мл.",
      activeIngredients: "100% натуральная масляная основа без искусственных добавок",
      howToUse: "Несколько капель растереть в ладонях и распределить по бороде и коже под ней.",
      volume: "50 мл",
      price: 69000,
      oldPrice: null,
      imageUrl: "/images/products/maslob2.webp",
      stock: 12,
      categoryId: beardCategory.id,
    },
  ];

  for (const product of products) {
    await prisma.product.upsert({
      where: { slug: product.slug },
      update: {
        imageUrl: product.imageUrl,
        subtitle: product.subtitle,
        price: product.price,
        activeIngredients: product.activeIngredients,
        howToUse: product.howToUse,
        volume: product.volume,
      },
      create: product,
    });
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
