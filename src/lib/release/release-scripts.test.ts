// @vitest-environment node
// Релизная процедура ViALaBote (audit-2026-11-07: к.24/47 — «релиз не применяет миграции;
// манифеста нет»).
//
// Скрипт выкатки жил ВНЕ репозитория (/home/zero/work/deploy-shop-release.sh): в нём не было
// `prisma migrate deploy` и не было манифеста релиза. Исправленная версия лежит в репозитории:
// ops/release/deploy-shop-release.sh + ops/release/release-manifest.sh.
import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const DEPLOY_SCRIPT = path.join(REPO_ROOT, "ops", "release", "deploy-shop-release.sh");
const MANIFEST_SCRIPT = path.join(REPO_ROOT, "ops", "release", "release-manifest.sh");

const deploySrc = readFileSync(DEPLOY_SCRIPT, "utf8");
const deployLines = deploySrc.split("\n");

/** Тело bash-функции: от строки `name() {` до закрывающей `}` на нуле отступе. */
function functionBody(src: string, name: string): string {
  const lines = src.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`${name}() {`));
  expect(start, `нет функции ${name}`).toBeGreaterThan(-1);
  const end = lines.findIndex((l, i) => i > start && l === "}");
  expect(end, `не найден конец функции ${name}`).toBeGreaterThan(start);
  return lines.slice(start, end + 1).join("\n");
}

const lineIndex = (needle: string) => deployLines.findIndex((l) => l.includes(needle));

describe("релизная процедура: миграции и манифест (audit-2026-11-07: к.24/47)", () => {
  it("скрипт выкатки и генератор манифеста есть в репозитории", () => {
    expect(existsSync(DEPLOY_SCRIPT)).toBe(true);
    expect(existsSync(MANIFEST_SCRIPT)).toBe(true);
  });

  it("миграции применяются ДО переключения релиза", () => {
    const migrateCall = deployLines.findIndex((l) => l.trim() === "apply_migrations");
    const switchCall = lineIndex('switch_to "$REL_ID"');
    expect(migrateCall, "вызов apply_migrations не найден").toBeGreaterThan(-1);
    expect(switchCall, "вызов switch_to не найден").toBeGreaterThan(-1);
    expect(migrateCall).toBeLessThan(switchCall);
    // и по разделам шагов: манифест -> миграции -> переключение
    const manifestStep = lineIndex("--- 3. манифест");
    const migrateStep = lineIndex("--- 4. миграции");
    const switchStep = lineIndex("--- 5. переключение");
    expect(manifestStep).toBeGreaterThan(-1);
    expect(migrateStep).toBeGreaterThan(manifestStep);
    expect(switchStep).toBeGreaterThan(migrateStep);
  });

  it("миграция — prisma migrate deploy, и ошибка миграции останавливает выкатку (fail-closed)", () => {
    const body = functionBody(deploySrc, "apply_migrations");
    expect(body).toContain("migrate deploy");
    expect(body).toContain("prisma");
    // ошибка prisma -> die (выход с кодом 1) до переключения, а не предупреждение
    expect(body).toMatch(/\|\|\s*die\s+"prisma migrate deploy не прошёл/);
    expect(deploySrc).toContain("prisma migrate deploy");
  });

  it("URL боевой БД берётся из db.env и не печатается", () => {
    const body = functionBody(deploySrc, "migration_db_url");
    expect(body).toContain("MIGRATE_DATABASE_URL");
    expect(body).toContain("DATABASE_URL");
    // значение уходит в env процесса, а не в лог
    expect(body).not.toMatch(/log .*\$\{?url/);
  });

  it("манифест релиза проверяется до переключения", () => {
    const manifestCall = deployLines.findIndex((l) => l.trim().startsWith("check_manifest "));
    const switchCall = lineIndex('switch_to "$REL_ID"');
    expect(manifestCall).toBeGreaterThan(-1);
    expect(manifestCall).toBeLessThan(switchCall);
    expect(deploySrc).toContain("release-manifest.sh");
  });
});

describe("манифест релиза: генерация и sha256sum -c", () => {
  const dirs: string[] = [];
  const makeRelease = () => {
    const dir = mkdtempSync(path.join(tmpdir(), "vl-release-"));
    dirs.push(dir);
    mkdirSync(path.join(dir, "prisma", "migrations"), { recursive: true });
    mkdirSync(path.join(dir, "node_modules", "left-pad"), { recursive: true });
    mkdirSync(path.join(dir, ".next"), { recursive: true });
    writeFileSync(path.join(dir, ".release-commit"), "2c4fcca1dc6c63e57f32c34cd78ec6ba4f9fbc50\n");
    writeFileSync(path.join(dir, ".next", "BUILD_ID"), "build-id\n");
    writeFileSync(path.join(dir, "prisma", "migrations", "001_init.sql"), "CREATE TABLE t (id int);\n");
    writeFileSync(path.join(dir, "node_modules", "left-pad", "index.js"), "module.exports = 1;\n");
    return dir;
  };

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("манифест пишется и sha256sum -c проходит", () => {
    const dir = makeRelease();
    const out = execFileSync("bash", [MANIFEST_SCRIPT, dir, "2c4fcca"], { encoding: "utf8" });
    expect(out).toContain("manifest-2c4fcca.sha256");
    const manifest = path.join(dir, "manifest-2c4fcca.sha256");
    expect(existsSync(manifest)).toBe(true);
    // ровно формат sha256sum: проверка штатной командой проходит без ошибок
    expect(execFileSync("sha256sum", ["-c", "--quiet", "manifest-2c4fcca.sha256"], { cwd: dir }).toString()).toBe("");
    // и штатная проверка скриптом тоже проходит
    expect(() => execFileSync("bash", [MANIFEST_SCRIPT, "--check", dir, "2c4fcca"])).not.toThrow();
  });

  it("node_modules и .next/cache в манифест не попадают, package-lock.json — попадает", () => {
    const dir = makeRelease();
    writeFileSync(path.join(dir, "package-lock.json"), "{}\n");
    execFileSync("bash", [MANIFEST_SCRIPT, dir, "2c4fcca"]);
    const manifest = readFileSync(path.join(dir, "manifest-2c4fcca.sha256"), "utf8");
    expect(manifest).toContain("package-lock.json");
    expect(manifest).toContain("prisma/migrations/001_init.sql");
    expect(manifest).not.toContain("node_modules");
  });

  it("подмена файла релиза ломает проверку манифеста", () => {
    const dir = makeRelease();
    execFileSync("bash", [MANIFEST_SCRIPT, dir, "2c4fcca"]);
    writeFileSync(path.join(dir, "prisma", "migrations", "001_init.sql"), "DROP TABLE t;\n");
    expect(() => execFileSync("bash", [MANIFEST_SCRIPT, "--check", dir, "2c4fcca"], { stdio: "pipe" })).toThrow();
    expect(() =>
      execFileSync("sha256sum", ["-c", "--quiet", "manifest-2c4fcca.sha256"], { cwd: dir, stdio: "pipe" }),
    ).toThrow();
  });

  it("без манифеста проверка падает (fail-closed), а не проходит молча", () => {
    const dir = makeRelease();
    expect(() => execFileSync("bash", [MANIFEST_SCRIPT, "--check", dir, "2c4fcca"], { stdio: "pipe" })).toThrow();
  });
});
