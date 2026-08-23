import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

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
      description: "Сыворотка с гиалуроновой кислотой и экстрактом белого чая. 50 мл.",
      price: 189000,
      oldPrice: null,
      imageUrl: "/images/placeholder.svg",
      stock: 20,
      categoryId: category.id,
    },
    {
      slug: "serum-resveratrol-vitamin-c",
      title: "Сыворотка Ресвератрол + Витамин C",
      description: "Антиоксидантная сыворотка для сияния кожи. 50 мл.",
      price: 179000,
      oldPrice: null,
      imageUrl: "/images/placeholder.svg",
      stock: 15,
      categoryId: category.id,
    },
    {
      slug: "inci-retinal-serum",
      title: "INCI Retinal Serum",
      description: "Сыворотка с ретиналом, витамином B5 и пробиотиками. 50 мл.",
      price: 219000,
      oldPrice: null,
      imageUrl: "/images/placeholder.svg",
      stock: 10,
      categoryId: category.id,
    },
    {
      slug: "multi3-anti-acne-serum",
      title: "Multi3 Anti-Acne Serum",
      description: "Сыворотка против акне с ниацинамидом и цинком. 50 мл.",
      price: 169000,
      oldPrice: null,
      imageUrl: "/images/placeholder.svg",
      stock: 18,
      categoryId: category.id,
    },
    {
      slug: "hydrophilic-gel-oil",
      title: "Гидрофильное гель-масло",
      description: "Балансирующее гидрофильное масло с маслом моринги. 150 мл.",
      price: 149000,
      oldPrice: null,
      imageUrl: "/images/placeholder.svg",
      stock: 25,
      categoryId: category.id,
    },
    {
      slug: "beard-oil-steblev",
      title: "Steb.Lev Beard Oil",
      description: "100% натуральное масло для бороды: укрепление, питание, рост. 50 мл.",
      price: 129000,
      oldPrice: null,
      imageUrl: "/images/placeholder.svg",
      stock: 12,
      categoryId: beardCategory.id,
    },
  ];

  for (const product of products) {
    await prisma.product.upsert({
      where: { slug: product.slug },
      update: {},
      create: product,
    });
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
