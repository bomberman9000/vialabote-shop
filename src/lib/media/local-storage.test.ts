import { describe, it, expect, afterEach } from "vitest";
import { LocalMediaStorage, extensionForMime } from "./local-storage";
import { existsSync } from "fs";
import path from "path";

const storage = new LocalMediaStorage();
const savedKeys: string[] = [];

afterEach(async () => {
  for (const key of savedKeys.splice(0)) {
    await storage.delete(key).catch(() => {});
  }
});

describe("LocalMediaStorage — server-generated filenames", () => {
  it("сохраняет файл с сервер-генерируемым именем, не связанным с пользовательским вводом", async () => {
    const result = await storage.save(Buffer.from("fake-image-bytes"), "jpg");
    savedKeys.push(result.storageKey);
    expect(result.storageKey).toMatch(/^[0-9a-f-]+\.jpg$/);
    expect(result.url).toBe(`/uploads/media/${result.storageKey}`);
  });

  it("два сохранения дают разные storageKey (не перетирают друг друга)", async () => {
    const a = await storage.save(Buffer.from("a"), "png");
    const b = await storage.save(Buffer.from("b"), "png");
    savedKeys.push(a.storageKey, b.storageKey);
    expect(a.storageKey).not.toBe(b.storageKey);
  });

  it("отклоняет недопустимое расширение (нельзя сохранить произвольный тип файла)", async () => {
    await expect(storage.save(Buffer.from("x"), "exe")).rejects.toThrow();
    await expect(storage.save(Buffer.from("x"), "svg")).rejects.toThrow();
    await expect(storage.save(Buffer.from("x"), "php")).rejects.toThrow();
  });

  it("файл реально появляется на диске внутри контролируемой директории", async () => {
    const result = await storage.save(Buffer.from("content"), "webp");
    savedKeys.push(result.storageKey);
    const filePath = path.join(process.cwd(), "public", "uploads", "media", result.storageKey);
    expect(existsSync(filePath)).toBe(true);
  });
});

describe("LocalMediaStorage — delete", () => {
  it("delete идемпотентен (повторный вызов не бросает исключение)", async () => {
    const result = await storage.save(Buffer.from("x"), "jpg");
    await storage.delete(result.storageKey);
    await expect(storage.delete(result.storageKey)).resolves.toBeUndefined();
  });

  it("отклоняет storageKey с path traversal паттернами", async () => {
    await expect(storage.delete("../../etc/passwd")).rejects.toThrow();
    await expect(storage.delete("foo/../../../secret")).rejects.toThrow();
  });
});

describe("extensionForMime", () => {
  it("маппит только 3 разрешённых MIME", () => {
    expect(extensionForMime("image/jpeg")).toBe("jpg");
    expect(extensionForMime("image/png")).toBe("png");
    expect(extensionForMime("image/webp")).toBe("webp");
  });
  it("бросает для неизвестного MIME (не подставляет дефолт)", () => {
    expect(() => extensionForMime("application/octet-stream")).toThrow();
  });
});
