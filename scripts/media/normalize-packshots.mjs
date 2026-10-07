import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

// Packshot normalization (v2: flat-field instead of a single gain) for the VIA LABOTE white-background series.
// Deliberately minimal — the series is already one photoshoot:
//   1. flat-field: divide by the smooth studio-background field (estimated
//      from product-free grid cells, diffused behind the product) so uneven
//      lighting/vignetting becomes clean white; no pixels are invented;
//   2. horizontal re-centre of the product bbox on the 1200×1600 canvas
//      (no scaling — real relative package sizes are kept, nothing redrawn);
//   3. WebP export (q=0.9).
// No inpainting, no AI, no label edits. Outputs a JSON report for the manifest.
const [, , inDir, outDir, reportPath] = process.argv;
fs.mkdirSync(outDir, { recursive: true });
const files = fs.readdirSync(inDir).filter((f) => f.endsWith(".png")).sort();
const br = await chromium.launch({ channel: "chrome" });
const p = await br.newPage();
const report = {};
for (const f of files) {
  const b64 = fs.readFileSync(path.join(inDir, f)).toString("base64");
  const r = await p.evaluate(async (b64) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const W = img.width, H = img.height;
    const src = new OffscreenCanvas(W, H);
    const sx = src.getContext("2d");
    sx.drawImage(img, 0, 0);
    const sd = sx.getImageData(0, 0, W, H);
    const d = sd.data;
    const lum = (i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    const samples = [];
    for (let Y = 0; Y < H * 0.6; Y += 8) for (const X of [10, 30, W - 30, W - 10]) samples.push(lum((Y * W + X) * 4));
    samples.sort((a, b) => a - b);
    const bg = samples[Math.floor(samples.length / 2)];
    const gain = Math.min(255 / bg, 1.06);
    // bbox for centring
    let x0 = W, x1 = 0;
    for (let Y = 0; Y < H; Y += 2) for (let X = 0; X < W; X += 2) {
      const i = (Y * W + X) * 4;
      const sat = Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
      if (bg - lum(i) > 38 || sat > 45) { if (X < x0) x0 = X; if (X > x1) x1 = X; }
    }
    const shift = Math.round(W / 2 - (x0 + x1) / 2);
    // Flat-field: background field per channel on a coarse grid. Cells covered
    // by the product are unknown and get filled from neighbours (diffusion),
    // so the product is divided by the *interpolated studio background* behind
    // it — the same correction a photographer applies for uneven lighting.
    const G = 24, gw = Math.ceil(W / G), gh = Math.ceil(H / G);
    const field = [new Float32Array(gw * gh), new Float32Array(gw * gh), new Float32Array(gw * gh)];
    const known = new Uint8Array(gw * gh);
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      const vals = [[], [], []]; let prod = 0, n = 0;
      for (let Y = gy * G; Y < Math.min(H, gy * G + G); Y += 3) for (let X = gx * G; X < Math.min(W, gx * G + G); X += 3) {
        const i = (Y * W + X) * 4; n++;
        const sat = Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
        if (bg - lum(i) > 18 || sat > 30) { prod++; continue; }
        vals[0].push(d[i]); vals[1].push(d[i + 1]); vals[2].push(d[i + 2]);
      }
      const k = gy * gw + gx;
      if (prod / n < 0.05 && vals[0].length > 4) {
        for (let c = 0; c < 3; c++) { vals[c].sort((a, b) => a - b); field[c][k] = vals[c][Math.floor(vals[c].length * 0.6)]; }
        known[k] = 1;
      }
    }
    // diffusion fill of unknown cells
    for (let c = 0; c < 3; c++) for (let k = 0; k < gw * gh; k++) if (!known[k]) field[c][k] = bg;
    for (let it = 0; it < 400; it++) for (let c = 0; c < 3; c++) {
      const f = field[c];
      for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
        const k = gy * gw + gx; if (known[k]) continue;
        let s = 0, m = 0;
        if (gx > 0) { s += f[k - 1]; m++; } if (gx < gw - 1) { s += f[k + 1]; m++; }
        if (gy > 0) { s += f[k - gw]; m++; } if (gy < gh - 1) { s += f[k + gw]; m++; }
        f[k] = s / m;
      }
    }
    const sample = (f, X, Y) => {
      const fx = Math.min(gw - 1.001, Math.max(0, X / G - 0.5)), fy = Math.min(gh - 1.001, Math.max(0, Y / G - 0.5));
      const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
      const a = f[iy * gw + ix], b = f[iy * gw + ix + 1], c2 = f[(iy + 1) * gw + ix], e = f[(iy + 1) * gw + ix + 1];
      return (a * (1 - tx) + b * tx) * (1 - ty) + (c2 * (1 - tx) + e * tx) * ty;
    };
    let maxGain = 0;
    for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
      const i = (Y * W + X) * 4;
      for (let c = 0; c < 3; c++) {
        const g = 255 / Math.max(180, sample(field[c], X, Y));
        if (g > maxGain) maxGain = g;
        let v = d[i + c] * g;
        if (v > 249) v = 255; // flush residual studio noise to clean white
        d[i + c] = Math.min(255, v);
      }
    }
    var flat = { maxGain: +maxGain.toFixed(3), knownCells: known.reduce((a, b) => a + b, 0), cells: gw * gh };
    sx.putImageData(sd, 0, 0);
    const out = new OffscreenCanvas(W, H);
    const ox = out.getContext("2d");
    ox.fillStyle = "#fff";
    ox.fillRect(0, 0, W, H);
    ox.drawImage(src, shift, 0);
    const blob = await out.convertToBlob({ type: "image/webp", quality: 0.9 });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { W, H, bg: Math.round(bg), flat, shift, bbox: [x0, x1], webp: btoa(bin) };
  }, b64);
  const name = f.replace(/\.png$/, ".webp");
  fs.writeFileSync(path.join(outDir, name), Buffer.from(r.webp, "base64"));
  report[f.replace(/\.png$/, "")] = { W: r.W, H: r.H, bg: r.bg, flatField: r.flat, shiftX: r.shift, bytes: fs.statSync(path.join(outDir, name)).size };
  console.log(name, JSON.stringify(report[f.replace(/\.png$/, "")]));
}
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
await br.close();
