// @vitest-environment node
import { describe, it, expect } from "vitest";
import { downloadTelegramFile, TelegramDownloadError } from "./file-download";

const TOKEN = "999:not_a_real_token_for_tests";

describe("downloadTelegramFile", () => {
  it("getFile -> file/bot<token>/<path>, returns bytes", async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      return url.endsWith("/getFile")
        ? Response.json({ ok: true, result: { file_path: "photos/a.jpg", file_size: 3 } })
        : new Response(new Uint8Array([1, 2, 3]));
    };
    const bytes = await downloadTelegramFile("F", { fetchImpl, token: TOKEN, apiBase: "http://tg.test" });
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
    expect(urls).toEqual([`http://tg.test/bot${TOKEN}/getFile`, `http://tg.test/file/bot${TOKEN}/photos/a.jpg`]);
  });

  it("any failure becomes a generic error that never contains the token", async () => {
    const fetchImpl = async (url: string) => {
      throw new Error(`connect failed to ${url}`);
    };
    const err = await downloadTelegramFile("F", { fetchImpl, token: TOKEN, apiBase: "http://tg.test" }).catch((e) => e);
    expect(err).toBeInstanceOf(TelegramDownloadError);
    expect(String(err.message)).not.toContain(TOKEN);
  });

  it("refuses oversized files", async () => {
    const fetchImpl = async () => Response.json({ ok: true, result: { file_path: "x", file_size: 50 * 1024 * 1024 } });
    await expect(downloadTelegramFile("F", { fetchImpl, token: TOKEN })).rejects.toThrow("слишком большой");
  });
});
