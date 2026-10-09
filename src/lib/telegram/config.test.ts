// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { isTelegramMutationsEnabled } from "./config";

const ORIGINAL = process.env.TELEGRAM_CMS_MUTATIONS;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.TELEGRAM_CMS_MUTATIONS;
  else process.env.TELEGRAM_CMS_MUTATIONS = ORIGINAL;
});

describe("Telegram CMS V2 — read-only by code", () => {
  it.each([undefined, "", "enabled", " enabled ", "true", "1"])("TELEGRAM_CMS_MUTATIONS=%s cannot enable mutations", (v) => {
    if (v === undefined) delete process.env.TELEGRAM_CMS_MUTATIONS;
    else process.env.TELEGRAM_CMS_MUTATIONS = v;
    expect(isTelegramMutationsEnabled()).toBe(false);
  });
});
