import { prisma } from "@/lib/prisma";
import { NewBannerForm } from "./new-banner-form";
import { BannerRowActions } from "./banner-row-actions";

export const dynamic = "force-dynamic";

export default async function AdminBannersPage() {
  const banners = await prisma.banner.findMany({
    orderBy: { createdAt: "desc" },
    include: { desktopMedia: true },
  });

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold text-brand-800">Баннеры</h1>

      <NewBannerForm />

      <div className="flex flex-col gap-4">
        {banners.length === 0 ? (
          <p className="text-brand-500">Баннеров пока нет.</p>
        ) : (
          banners.map((b) => (
            <div key={b.id} className="card flex flex-wrap items-center gap-4 p-4">
              <div className="relative h-16 w-28 overflow-hidden rounded-lg bg-brand-50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={b.desktopMedia.url} alt="" className="h-full w-full object-cover" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-brand-800">{b.name}</p>
                <p className="text-xs text-brand-500">
                  {b.placement} · статус: {b.status}
                  {b.startsAt ? ` · с ${b.startsAt.toISOString().slice(0, 10)}` : ""}
                  {b.endsAt ? ` до ${b.endsAt.toISOString().slice(0, 10)}` : ""}
                </p>
              </div>
              <BannerRowActions
                bannerId={b.id}
                status={b.status}
                version={b.version}
                startsAt={b.startsAt?.toISOString().slice(0, 10) ?? ""}
                endsAt={b.endsAt?.toISOString().slice(0, 10) ?? ""}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
