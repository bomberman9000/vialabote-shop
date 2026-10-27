// @vitest-environment node
import { describe, it, expect } from "vitest";
import { decideReadAccess, decideWriteAccess, isInAdminList, parseAdminIds } from "./access";

const OWNER = "111222333";
const env = { TELEGRAM_ADMIN_IDS: ` ${OWNER}, 444555666 ;777` };

describe("TELEGRAM_ADMIN_IDS parsing", () => {
  it("splits by comma/space/semicolon, drops junk and duplicates", () => {
    expect(parseAdminIds("1, 2 3;4,,2, abc, @user, -5, 1.5")).toEqual(["1", "2", "3", "4"]);
    expect(parseAdminIds(undefined)).toEqual([]);
    expect(parseAdminIds("")).toEqual([]);
  });
  it("matches numeric ids exactly (no prefix / username tricks)", () => {
    expect(isInAdminList(OWNER, env)).toBe(true);
    expect(isInAdminList(Number(OWNER), env)).toBe(true);
    expect(isInAdminList("11122233", env)).toBe(false);
    expect(isInAdminList("1112223330", env)).toBe(false);
    expect(isInAdminList("777", env)).toBe(true);
  });
});

describe("read access", () => {
  it("list configured: only listed ids, DB role does not matter", () => {
    expect(decideReadAccess(OWNER, false, env)).toBe(true);
    expect(decideReadAccess("999", true, env)).toBe(false); // ADMIN in DB but not the owner
  });
  it("list empty: falls back to V2 rule (ADMIN in DB)", () => {
    expect(decideReadAccess("999", true, {})).toBe(true);
    expect(decideReadAccess("999", false, {})).toBe(false);
  });
});

describe("write access", () => {
  it("needs list + id in list + ADMIN binding in DB", () => {
    expect(decideWriteAccess(OWNER, true, env)).toBe(true);
    expect(decideWriteAccess(OWNER, false, env)).toBe(false);
    expect(decideWriteAccess("999", true, env)).toBe(false);
  });
  it("empty list: writes are off for everyone, even DB ADMIN", () => {
    expect(decideWriteAccess(OWNER, true, {})).toBe(false);
    expect(decideWriteAccess(OWNER, true, { TELEGRAM_ADMIN_IDS: " , " })).toBe(false);
  });
});
