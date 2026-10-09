import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

// Site icons from the owner-approved VIA LABOTE badge (public/branding/vialabote-favicon.png).
// Deterministic, no AI: crop to the visible disc (alpha > 16), downscale by repeated halving
// (sharper than one big step), then:
//   favicon.ico            16 + 32 + 48 px PNG entries (ICO container, written here)
//   icons/icon-32.png      32 px, transparent
//   icons/icon-512.png     512 px, transparent
//   icons/apple-touch-icon.png  180 px on opaque white (iOS paints transparency black)
// Prints a JSON report (source size, crop box, opaque pixels outside the disc).
//
// usage: node scripts/media/favicons.mjs public/branding/vialabote-favicon.png public
const [, , src, outDir] = process.argv;
if (!src || !outDir) throw new Error("usage: favicons.mjs <source.png> <public dir>");
const b64 = fs.readFileSync(src).toString("base64");
const br = await chromium.launch({ channel: "chrome" });
const p = await br.newPage();
const r = await p.evaluate(
  async ({ b64 }) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const W = img.width, H = img.height;
    const full = new OffscreenCanvas(W, H);
    const fx = full.getContext("2d");
    fx.drawImage(img, 0, 0);
    const d = fx.getImageData(0, 0, W, H).data;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (d[(y * W + x) * 4 + 3] > 16) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    // square crop centred on the visible disc
    const side = Math.max(x1 - x0 + 1, y1 - y0 + 1);
    const cx = (x0 + x1 + 1) / 2, cy = (y0 + y1 + 1) / 2;
    const sx = Math.round(cx - side / 2), sy = Math.round(cy - side / 2);
    // opaque pixels clearly outside the disc (stray specks would show up as noise at 16 px)
    let outside = 0;
    for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
      if (d[(y * W + x) * 4 + 3] > 16 && Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > side / 2 + 2) outside++;
    }
    let cur = new OffscreenCanvas(side, side);
    cur.getContext("2d").drawImage(full, sx, sy, side, side, 0, 0, side, side);
    const scaled = (size) => {
      let c = cur;
      while (c.width / 2 >= size) {
        const n = new OffscreenCanvas(Math.round(c.width / 2), Math.round(c.height / 2));
        const nx = n.getContext("2d");
        nx.imageSmoothingQuality = "high";
        nx.drawImage(c, 0, 0, n.width, n.height);
        c = n;
      }
      const o = new OffscreenCanvas(size, size);
      const ox = o.getContext("2d");
      ox.imageSmoothingQuality = "high";
      ox.drawImage(c, 0, 0, size, size);
      return o;
    };
    const png = async (c) => {
      const blob = await c.convertToBlob({ type: "image/png" });
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = "";
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(s);
    };
    const out = {};
    for (const size of [16, 32, 48, 512]) out[size] = await png(scaled(size));
    const apple = new OffscreenCanvas(180, 180);
    const ax = apple.getContext("2d");
    ax.fillStyle = "#ffffff";
    ax.fillRect(0, 0, 180, 180);
    ax.drawImage(scaled(180), 0, 0);
    out.apple = await png(apple);
    return { W, H, crop: { sx, sy, side }, outside, out };
  },
  { b64 },
);
await br.close();

const buf = (k) => Buffer.from(r.out[k], "base64");
fs.mkdirSync(path.join(outDir, "icons"), { recursive: true });
fs.writeFileSync(path.join(outDir, "icons/icon-32.png"), buf(32));
fs.writeFileSync(path.join(outDir, "icons/icon-512.png"), buf(512));
fs.writeFileSync(path.join(outDir, "icons/apple-touch-icon.png"), buf("apple"));

// ICO: ICONDIR + one ICONDIRENTRY per image, PNG payloads (supported by every current browser)
const entries = [16, 32, 48].map((s) => ({ s, data: buf(s) }));
const head = Buffer.alloc(6 + 16 * entries.length);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(entries.length, 4);
let offset = head.length;
entries.forEach(({ s, data }, i) => {
  const e = 6 + 16 * i;
  head.writeUInt8(s, e); head.writeUInt8(s, e + 1); head.writeUInt8(0, e + 2); head.writeUInt8(0, e + 3);
  head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(data.length, e + 8); head.writeUInt32LE(offset, e + 12);
  offset += data.length;
});
fs.writeFileSync(path.join(outDir, "favicon.ico"), Buffer.concat([head, ...entries.map((e) => e.data)]));

console.log(JSON.stringify({
  source: `${r.W}x${r.H}`, crop: r.crop, opaqueOutsideDisc: r.outside,
  files: ["favicon.ico", "icons/icon-32.png", "icons/icon-512.png", "icons/apple-touch-icon.png"]
    .map((f) => `${f} ${fs.statSync(path.join(outDir, f)).size}B`),
}, null, 2));
