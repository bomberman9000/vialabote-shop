// @vitest-environment node
import { describe, it, expect } from "vitest";
import { buildAction, parseAction, type PanelAction } from "./callbacks";

const PID = "clxk2abcdefghijklmnopqrst"; // 25 символов, как cuid

describe("panel action callback_data", () => {
  const all: PanelAction[] = [
    { op: "stats", period: "day" },
    { op: "stats", period: "week" },
    { op: "stats", period: "month" },
    { op: "card", productId: PID },
    { op: "stockEdit", productId: PID, draft: 0 },
    { op: "stockEdit", productId: PID, draft: 100000 },
    { op: "stockInput", productId: PID },
    { op: "stockApply", productId: PID, draft: 42 },
    { op: "field", productId: PID, field: "title" },
    { op: "field", productId: PID, field: "price" },
    { op: "field", productId: PID, field: "desc" },
    { op: "field", productId: PID, field: "inci" },
    { op: "photo", productId: PID },
    { op: "visMenu", productId: PID },
    { op: "vis", productId: PID, to: "published" },
    { op: "vis", productId: PID, to: "draft" },
    { op: "vis", productId: PID, to: "archived" },
    { op: "field", productId: PID, field: "howto" },
    { op: "field", productId: PID, field: "warn" },
    { op: "field", productId: PID, field: "shelf" },
    { op: "field", productId: PID, field: "maker" },
    { op: "catMenu", productId: PID },
    { op: "catSet", productId: PID, categoryId: "clxcat00000000000000000001" },
    { op: "cancelInput" },
  ];
  it.each(all)("round-trips %o within Telegram's 64 bytes", (a) => {
    const data = buildAction(a);
    expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
    expect(parseAction(data)).toEqual(a);
  });

  it.each([
    "",
    "a:",
    "a:zz:x",
    "a:st:year",
    "a:se:" + PID,
    "a:se:" + PID + ":-1",
    "a:se:" + PID + ":100001",
    "a:se:" + PID + ":1.5",
    "a:ef:" + PID + ":status",
    "a:vs:" + PID + ":deleted",
    "a:pc:bad id",
    "a:pc:../../etc",
    "v2:menu:0",
    "confirm:abc",
    "a:pc:" + "x".repeat(70),
    "a:cs:" + PID,
    "a:cs:" + PID + ":bad id",
  ])("rejects %j", (data) => {
    expect(parseAction(data)).toBeNull();
  });
});
