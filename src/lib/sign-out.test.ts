import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

const signOut = vi.fn();
vi.mock("next-auth/react", () => ({ signOut: (...args: unknown[]) => signOut(...args) }));

const { signOutToHome } = await import("./sign-out");

const SRC = path.resolve(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

describe("signOutToHome", () => {
  beforeEach(() => {
    signOut.mockReset();
  });

  it("гасит сессию без серверного редиректа и уходит на / относительным путём", async () => {
    const calls: string[] = [];
    signOut.mockImplementation(async () => void calls.push("signOut"));

    await signOutToHome((p) => calls.push(`go ${p}`));

    expect(signOut).toHaveBeenCalledWith({ redirect: false });
    expect(calls).toEqual(["signOut", "go /"]);
  });

  it("не уходит со страницы, если выход не удался", async () => {
    signOut.mockRejectedValue(new Error("network"));
    const go = vi.fn();

    await expect(signOutToHome(go)).rejects.toThrow("network");
    expect(go).not.toHaveBeenCalled();
  });

  // Регрессия: signOut({ callbackUrl }) при NEXTAUTH_URL=http://127.0.0.1:3002
  // уводил покупателя на внутренний адрес. Весь выход — только через хелпер.
  it("в коде нет других вызовов signOut из next-auth", () => {
    const offenders = sourceFiles(SRC)
      .filter((f) => f !== path.join(SRC, "lib/sign-out.ts"))
      .filter((f) => /\bsignOut\s*\(/.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});
