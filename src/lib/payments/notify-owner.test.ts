import { describe, it, expect } from "vitest";
import { notifyOwner, ownerMessage } from "./notify-owner";

const order = { number: "V-ABC123", totalAmount: 52000 };

describe("notifyOwner", () => {
  it("sends one message per owner id through the configured Bot API base, without the token in errors", async () => {
    const calls: { url: string; body: { chat_id: string; text: string } }[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init!.body)) });
      return new Response("{}", { status: 200 });
    };
    const sent = await notifyOwner(order, "PAID", {
      env: { TELEGRAM_BOT_TOKEN: "123:abc", TELEGRAM_ADMIN_IDS: "922250409, 1", TELEGRAM_API_BASE: "https://relay.test/" },
      fetchImpl,
    });
    expect(sent).toBe(2);
    expect(calls.map((c) => c.url)).toEqual(["https://relay.test/bot123:abc/sendMessage", "https://relay.test/bot123:abc/sendMessage"]);
    expect(calls[0].body).toMatchObject({ chat_id: "922250409" });
    expect(calls[0].body.text).toContain("V-ABC123");
    expect(calls[0].body.text).toContain("520");
  });
  it("does nothing without token or owners, and for outcomes that need no message", async () => {
    const fetchImpl = async () => {
      throw new Error("must not be called");
    };
    expect(await notifyOwner(order, "PAID", { env: { TELEGRAM_ADMIN_IDS: "1" }, fetchImpl })).toBe(0);
    expect(await notifyOwner(order, "PAID", { env: { TELEGRAM_BOT_TOKEN: "t" }, fetchImpl })).toBe(0);
    expect(ownerMessage(order, "WAITING")).toBeNull();
    expect(ownerMessage(order, "PAID_LATE")).toContain("проверьте наличие".replace("п", "П"));
  });
  it("a Telegram failure never throws into the payment flow", async () => {
    const fetchImpl = async () => {
      throw new Error("connect ECONNREFUSED for bot123:abc");
    };
    await expect(notifyOwner(order, "PAID", { env: { TELEGRAM_BOT_TOKEN: "123:abc", TELEGRAM_ADMIN_IDS: "1" }, fetchImpl })).resolves.toBe(0);
  });
});
