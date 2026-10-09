import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

// Procedural concern visuals for VIA LABOTE. Abstract only: water, light,
// skin-like grain, elastic contour lines, clarity matrix. No products, no
// packaging, no faces. Deterministic (seeded) so they can be regenerated.
// usage: node concern-art.mjs <outDir>
const [, , outDir] = process.argv;
fs.mkdirSync(outDir, { recursive: true });
const W = 1200, H = 1500;

const art = async (page, kind) =>
  page.evaluate(
    async ({ kind, W, H }) => {
      let seed = { acne: 11, "anti-age": 23, men: 37, dryness: 41, "dull-tone": 53 }[kind] || 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const c = new OffscreenCanvas(W, H);
      const x = c.getContext("2d");
      const lin = (stops, x0, y0, x1, y1) => {
        const g = x.createLinearGradient(x0, y0, x1, y1);
        stops.forEach(([o, col]) => g.addColorStop(o, col));
        return g;
      };
      const rad = (stops, cx, cy, r) => {
        const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
        stops.forEach(([o, col]) => g.addColorStop(o, col));
        return g;
      };
      const drop = (cx, cy, r, tint) => {
        // a single liquid droplet: refraction shadow, body, specular highlight
        x.save();
        x.fillStyle = rad([[0, "rgba(0,0,0,0.10)"], [1, "rgba(0,0,0,0)"]], cx + r * 0.25, cy + r * 0.35, r * 1.25);
        x.beginPath(); x.ellipse(cx + r * 0.2, cy + r * 0.3, r * 1.15, r * 1.05, 0, 0, Math.PI * 2); x.fill();
        const body = x.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
        body.addColorStop(0, "rgba(255,255,255,0.75)");
        body.addColorStop(0.45, tint);
        body.addColorStop(1, "rgba(255,255,255,0.35)");
        x.fillStyle = body;
        x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
        x.strokeStyle = "rgba(255,255,255,0.55)"; x.lineWidth = Math.max(1, r * 0.04);
        x.beginPath(); x.arc(cx, cy, r * 0.97, Math.PI * 0.9, Math.PI * 1.6); x.stroke();
        x.fillStyle = "rgba(255,255,255,0.9)";
        x.beginPath(); x.ellipse(cx - r * 0.38, cy - r * 0.42, r * 0.16, r * 0.09, -0.6, 0, Math.PI * 2); x.fill();
        x.restore();
      };

      if (kind === "dryness") {
        // water: cool ivory-blue wash, concentric ripples, droplets
        x.fillStyle = lin([[0, "#EEF2F1"], [1, "#DCE6E8"]], 0, 0, 0, H); x.fillRect(0, 0, W, H);
        const cx = W * 0.56, cy = H * 0.36;
        for (let i = 0; i < 26; i++) {
          const r = 70 + i * 42 + Math.sin(i) * 5;
          x.strokeStyle = `rgba(255,255,255,${0.95 - i * 0.03})`; x.lineWidth = 5 - i * 0.14;
          x.beginPath(); x.ellipse(cx, cy, r, r * 0.42, 0, 0, Math.PI * 2); x.stroke();
          x.strokeStyle = `rgba(70,105,122,${0.32 - i * 0.011})`; x.lineWidth = 2.4;
          x.beginPath(); x.ellipse(cx, cy + 3, r, r * 0.42, 0, 0, Math.PI * 2); x.stroke();
        }
        drop(cx, cy - 10, 150, "rgba(178,208,216,0.6)");
        for (let i = 0; i < 6; i++) drop(W * (0.1 + rnd() * 0.8), H * (0.6 + rnd() * 0.12), 22 + rnd() * 40, "rgba(190,214,222,0.55)");
      } else if (kind === "dull-tone") {
        // light: warm gold bloom with soft caustic arcs
        x.fillStyle = lin([[0, "#F6EAD6"], [1, "#E9D2AE"]], 0, 0, W, H); x.fillRect(0, 0, W, H);
        x.fillStyle = rad([[0, "rgba(255,248,232,0.95)"], [0.35, "rgba(255,236,200,0.55)"], [1, "rgba(255,236,200,0)"]], W * 0.62, H * 0.32, W * 0.75);
        x.fillRect(0, 0, W, H);
        x.globalCompositeOperation = "screen";
        for (let i = 0; i < 70; i++) {
          const y0 = H * (0.15 + rnd() * 0.8), amp = 30 + rnd() * 90, ph = rnd() * 6;
          x.strokeStyle = `rgba(255,244,214,${0.16 + rnd() * 0.3})`; x.lineWidth = 2 + rnd() * 6;
          x.beginPath();
          for (let X = -20; X <= W + 20; X += 12) {
            const Y = y0 + Math.sin(X / (140 + i * 3) + ph) * amp * 0.4 + Math.sin(X / 47 + ph * 2) * 6;
            X === -20 ? x.moveTo(X, Y) : x.lineTo(X, Y);
          }
          x.stroke();
        }
        x.globalCompositeOperation = "source-over";
        drop(W * 0.36, H * 0.4, 130, "rgba(226,178,98,0.55)");
      } else if (kind === "anti-age") {
        // elasticity: rose-sand with fine elastic contour lines
        x.fillStyle = lin([[0, "#F2E4DC"], [1, "#E4CFC3"]], 0, 0, W, H); x.fillRect(0, 0, W, H);
        x.fillStyle = rad([[0, "rgba(255,246,240,0.8)"], [1, "rgba(255,246,240,0)"]], W * 0.35, H * 0.3, W * 0.7); x.fillRect(0, 0, W, H);
        for (let i = 0; i < 46; i++) {
          const base = H * 0.08 + i * (H * 0.9 / 46);
          x.strokeStyle = `rgba(140,84,70,${0.26 + (i % 5 === 0 ? 0.16 : 0)})`; x.lineWidth = i % 5 === 0 ? 3.2 : 1.8;
          x.beginPath();
          for (let X = -10; X <= W + 10; X += 8) {
            const lift = Math.exp(-(((X - W * 0.55) / (W * 0.3)) ** 2)) * 150 * Math.sin(i / 46 * Math.PI);
            const Y = base - lift + Math.sin(X / 210 + i * 0.3) * 8;
            X === -10 ? x.moveTo(X, Y) : x.lineTo(X, Y);
          }
          x.stroke();
        }
      } else if (kind === "acne") {
        // clarity: soft sage wash, a calm cellular matrix that clears toward the light
        x.fillStyle = lin([[0, "#E7ECE3"], [1, "#D6E0D3"]], 0, 0, 0, H); x.fillRect(0, 0, W, H);
        x.fillStyle = rad([[0, "rgba(250,252,246,0.9)"], [1, "rgba(250,252,246,0)"]], W * 0.62, H * 0.38, W * 0.6); x.fillRect(0, 0, W, H);
        const step = 58;
        for (let Y = step / 2; Y < H; Y += step) for (let X = step / 2 + ((Y / step) % 2) * (step / 2); X < W; X += step) {
          const dcl = Math.hypot((X - W * 0.62) / W, (Y - H * 0.38) / H);
          const a = Math.min(0.5, Math.max(0, (dcl - 0.1) * 1.1));
          if (a <= 0.005) continue;
          x.strokeStyle = `rgba(78,104,84,${a})`; x.lineWidth = 2.2;
          x.beginPath(); x.arc(X + (rnd() - 0.5) * 3, Y + (rnd() - 0.5) * 3, step * 0.3, 0, Math.PI * 2); x.stroke();
        }
        drop(W * 0.62, H * 0.36, 150, "rgba(200,220,196,0.55)");
      } else if (kind === "men") {
        // structure: deep navy, brushed linear grain, one fine gold line
        x.fillStyle = lin([[0, "#1A2240"], [1, "#0F1428"]], 0, 0, W, H); x.fillRect(0, 0, W, H);
        x.fillStyle = rad([[0, "rgba(70,86,140,0.35)"], [1, "rgba(70,86,140,0)"]], W * 0.7, H * 0.25, W * 0.8); x.fillRect(0, 0, W, H);
        for (let i = 0; i < 900; i++) {
          const y0 = rnd() * H; const len = 80 + rnd() * 380; const x0 = rnd() * W;
          x.strokeStyle = `rgba(200,210,240,${0.04 + rnd() * 0.08})`; x.lineWidth = 0.8 + rnd() * 1.4;
          x.beginPath(); x.moveTo(x0, y0); x.lineTo(x0 + len, y0 - len * 0.18); x.stroke();
        }
        x.strokeStyle = "rgba(214,185,111,0.95)"; x.lineWidth = 5;
        x.beginPath(); x.moveTo(W * 0.06, H * 0.5); x.lineTo(W * 0.94, H * 0.5 - W * 0.88 * 0.18); x.stroke();
        x.fillStyle = rad([[0, "rgba(214,185,111,0.35)"], [1, "rgba(214,185,111,0)"]], W * 0.62, H * 0.42, W * 0.35); x.fillRect(0, 0, W, H);
      }

      // film grain for a tactile, printed feel
      const id = x.getImageData(0, 0, W, H), d = id.data;
      for (let i = 0; i < d.length; i += 4) {
        const n = (rnd() - 0.5) * 14;
        d[i] = Math.max(0, Math.min(255, d[i] + n)); d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n)); d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
      }
      x.putImageData(id, 0, 0);
      const blob = await c.convertToBlob({ type: "image/webp", quality: 0.86 });
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(bin);
    },
    { kind, W, H },
  );

const br = await chromium.launch({ channel: "chrome" });
const page = await br.newPage();
for (const kind of ["acne", "anti-age", "men", "dryness", "dull-tone"]) {
  const b64 = await art(page, kind);
  const f = path.join(outDir, `concern-${kind}.webp`);
  fs.writeFileSync(f, Buffer.from(b64, "base64"));
  console.log(f, fs.statSync(f).size);
}
await br.close();
