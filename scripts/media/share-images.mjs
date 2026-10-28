import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

// Link previews (Open Graph, 1200×630 JPEG) for messengers — Telegram, WhatsApp, VK.
// Deterministic, no AI: HTML rendered in the installed Chrome with the site font (Manrope).
//   og/vialabote-share.jpg       shop banner: hero photo + badge + tagline
//   og/products/<packshot>.jpg   one per packshot: badge on cream + product on white
// The WebP packshots are not used as og:image directly: WhatsApp does not show WebP previews reliably.
// Prints a JSON report (file, bytes).
//
// usage: node scripts/media/share-images.mjs public
const [, , pub] = process.argv;
if (!pub) throw new Error("usage: share-images.mjs <public dir>");

const W = 1200;
const H = 630;
const CREAM = "#f6f1e7";
const dataUrl = (file, type) => `data:${type};base64,${fs.readFileSync(file).toString("base64")}`;
const badge = dataUrl(path.join(pub, "images/logo-footer.png"), "image/png");
const font = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;800&display=swap">`;
const base = `*{margin:0;box-sizing:border-box}body{width:${W}px;height:${H}px;overflow:hidden;position:relative;
  font-family:Manrope,"Noto Sans",sans-serif;background:${CREAM}}`;

const banner = `<!doctype html><html><head><meta charset="utf-8">${font}<style>${base}
  .photo{position:absolute;right:0;top:0;width:760px;height:${H}px;
    background:url(${dataUrl(path.join(pub, "images/hero/vialabote-hero-beauty.jpg"), "image/jpeg")}) 22% 30%/cover}
  .fade{position:absolute;left:440px;top:0;width:330px;height:${H}px;background:linear-gradient(90deg,${CREAM},rgba(246,241,231,0))}
  .text{position:absolute;left:64px;top:52px;width:440px}
  .badge{display:block;height:212px}
  h1{margin-top:30px;font-size:46px;line-height:1.08;font-weight:800;color:#181f40}
  .sub{margin-top:12px;font-size:27px;font-weight:500;color:#333f6e}
  .tag{margin-top:24px;font-size:16px;letter-spacing:.24em;font-weight:600;color:#96702f}
  .url{position:absolute;left:64px;bottom:42px;font-size:22px;font-weight:600;color:#4f5c8f}
</style></head><body><div class="photo"></div><div class="fade"></div>
  <div class="text"><img class="badge" src="${badge}"><h1>Уход и косметика</h1>
  <div class="sub">с доставкой по России</div><div class="tag">НАУКА. ПРИРОДА. ГАРМОНИЯ.</div></div>
  <div class="url">shop.vialabote.ru</div></body></html>`;

const product = (packshot) => `<!doctype html><html><head><meta charset="utf-8">${font}<style>${base}
  .left{position:absolute;left:0;top:0;width:500px;height:${H}px;display:flex;flex-direction:column;align-items:center;justify-content:center}
  .badge{height:300px}
  .url{margin-top:34px;font-size:22px;font-weight:600;color:#4f5c8f}
  .right{position:absolute;left:500px;top:0;width:700px;height:${H}px;background:#fff;
    background:url(${packshot}) center/contain no-repeat #fff}
</style></head><body><div class="left"><img class="badge" src="${badge}"><div class="url">shop.vialabote.ru</div></div>
  <div class="right"></div></body></html>`;

const outDir = path.join(pub, "og");
fs.mkdirSync(path.join(outDir, "products"), { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const report = [];
async function shot(html, file) {
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  // Сколько начертаний Manrope реально загружено (0 — текст ушёл в запасной шрифт).
  const manrope = await page.evaluate(() => [...document.fonts].filter((f) => /Manrope/.test(f.family) && f.status === "loaded").length);
  await page.screenshot({ path: file, type: "jpeg", quality: 86 });
  report.push({ file: path.relative(pub, file), bytes: fs.statSync(file).size, manrope });
}
await shot(banner, path.join(outDir, "vialabote-share.jpg"));
const packDir = path.join(pub, "images/products/packshot");
for (const f of fs.readdirSync(packDir).filter((n) => n.endsWith(".webp")).sort()) {
  await shot(product(dataUrl(path.join(packDir, f), "image/webp")), path.join(outDir, "products", f.replace(/\.webp$/, ".jpg")));
}
await browser.close();
console.log(JSON.stringify(report, null, 1));
