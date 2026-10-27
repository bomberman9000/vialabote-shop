// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { isTelegramMutationsEnabled, TELEGRAM_WRITES_ENABLED_IN_CODE } from "./config";

const ORIGINAL = { flag: process.env.TELEGRAM_CMS_MUTATIONS, ids: process.env.TELEGRAM_ADMIN_IDS };
afterEach(() => {
  for (const [k, v] of [["TELEGRAM_CMS_MUTATIONS", ORIGINAL.flag], ["TELEGRAM_ADMIN_IDS", ORIGINAL.ids]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("Telegram writes — explicit decision in code, off without an owner list", () => {
  it("the code switch is an explicit constant", () => {
    expect(TELEGRAM_WRITES_ENABLED_IN_CODE).toBe(true);
  });

  it.each([undefined, "", "enabled", " enabled ", "true", "1"])(
    "empty TELEGRAM_ADMIN_IDS: writes stay off whatever TELEGRAM_CMS_MUTATIONS=%s says",
    (v) => {
      delete process.env.TELEGRAM_ADMIN_IDS;
      if (v === undefined) delete process.env.TELEGRAM_CMS_MUTATIONS;
      else process.env.TELEGRAM_CMS_MUTATIONS = v;
      expect(isTelegramMutationsEnabled()).toBe(false);
    },
  );

  it.each(["", " ", ",,", "abc", "@owner"])("TELEGRAM_ADMIN_IDS=%j has no valid id: writes off", (ids) => {
    expect(isTelegramMutationsEnabled({ TELEGRAM_ADMIN_IDS: ids })).toBe(false);
  });

  it("a valid owner id turns writes on (per-user check is in access.ts)", () => {
    expect(isTelegramMutationsEnabled({ TELEGRAM_ADMIN_IDS: "123456789" })).toBe(true);
  });
});
