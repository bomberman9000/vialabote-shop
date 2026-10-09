// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { metadata } from "./layout";

const PUBLIC = path.resolve(__dirname, "../../public");

function pngSize(file: string) {
  const b = fs.readFileSync(file);
  expect(b.subarray(1, 4).toString("latin1")).toBe("PNG");
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

type IconEntry = { url: string | URL; sizes?: string; type?: string };
const list = (v: unknown): IconEntry[] => (Array.isArray(v) ? v : v ? [v] : []) as IconEntry[];

describe("site icons (VIA LABOTE badge)", () => {
  const icons = metadata.icons as { icon: unknown; apple: unknown };
  const all = [...list(icons.icon), ...list(icons.apple)];

  it("declares favicon.ico, 32 px, 512 px and the 180 px apple-touch-icon", () => {
    expect(all.map((i) => `${i.url} ${i.sizes}`)).toEqual([
      "/favicon.ico 16x16 32x32 48x48",
      "/icons/icon-32.png 32x32",
      "/icons/icon-512.png 512x512",
      "/icons/apple-touch-icon.png 180x180",
    ]);
  });

  it("every PNG exists with the declared size", () => {
    for (const i of all.filter((x) => String(x.url).endsWith(".png"))) {
      const [w, h] = String(i.sizes).split("x").map(Number);
      expect(pngSize(path.join(PUBLIC, String(i.url)))).toEqual({ w, h });
    }
  });

  it("favicon.ico holds 16, 32 and 48 px PNG images", () => {
    const b = fs.readFileSync(path.join(PUBLIC, "favicon.ico"));
    expect(b.readUInt16LE(2)).toBe(1); // type: icon
    const n = b.readUInt16LE(4);
    const sizes = [];
    for (let i = 0; i < n; i++) {
      const e = 6 + 16 * i;
      const off = b.readUInt32LE(e + 12);
      expect(b.subarray(off + 1, off + 4).toString("latin1")).toBe("PNG");
      sizes.push(b.readUInt8(e));
    }
    expect(sizes).toEqual([16, 32, 48]);
  });

  it("no competing default favicon in the app directory", () => {
    for (const f of ["favicon.ico", "icon.png", "icon.ico", "apple-icon.png"]) {
      expect(fs.existsSync(path.join(__dirname, f))).toBe(false);
    }
  });
});
