import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/share-image";

/** Служебные страницы (корзина, оформление, кабинет, админка, API) поисковикам не нужны. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/account", "/admin", "/api/", "/cart", "/checkout", "/ozon-oauth"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
