import { chromium } from "playwright";
import fs from "node:fs";

// Crops the text-free beauty part of the brand banner (x >= 760; drawn CTAs end
// at x=729, headline at x=638) and samples the cream tone of the left side.
const [, , src, out, x0Arg] = process.argv;
const X0 = Number(x0Arg || 760);
const b64 = fs.readFileSync(src).toString("base64");
const br = await chromium.launch({ channel: "chrome" });
const p = await br.newPage();
const r = await p.evaluate(
  async ({ b64, X0 }) => {
    const img = new Image();
    img.src = "data:image/jpeg;base64," + b64;
    await img.decode();
    const W = img.width, H = img.height;
    const full = new OffscreenCanvas(W, H);
    const fx = full.getContext("2d");
    fx.drawImage(img, 0, 0);
    // cream sample: median of a band at x 40..120 (left edge, no text)
    const d = fx.getImageData(40, 120, 80, 600).data;
    const ch = [[], [], []];
    for (let i = 0; i < d.length; i += 4) { ch[0].push(d[i]); ch[1].push(d[i + 1]); ch[2].push(d[i + 2]); }
    const med = ch.map((a) => a.sort((m, n) => m - n)[a.length >> 1]);
    // right-edge-of-crop-left sample (what the gradient must blend into)
    const e = fx.getImageData(X0, 0, 20, H).data;
    const ce = [[], [], []];
    for (let i = 0; i < e.length; i += 4) { ce[0].push(e[i]); ce[1].push(e[i + 1]); ce[2].push(e[i + 2]); }
    const medE = ce.map((a) => a.sort((m, n) => m - n)[a.length >> 1]);
    const c = new OffscreenCanvas(W - X0, H);
    c.getContext("2d").drawImage(full, X0, 0, W - X0, H, 0, 0, W - X0, H);
    const blob = await c.convertToBlob({ type: "image/jpeg", quality: 0.9 });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { W: W - X0, H, cream: med, edge: medE, jpg: btoa(bin) };
  },
  { b64, X0 },
);
fs.writeFileSync(out, Buffer.from(r.jpg, "base64"));
const hex = (a) => "#" + a.map((v) => v.toString(16).padStart(2, "0")).join("");
console.log(JSON.stringify({ out, size: [r.W, r.H], cream: hex(r.cream), cropLeftEdge: hex(r.edge), bytes: fs.statSync(out).size }));
await br.close();
