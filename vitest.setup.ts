import "@testing-library/jest-dom/vitest";

// Node >= 22 определяет собственный глобальный `localStorage`, который без
// флага `--localstorage-file` равен undefined и перекрывает реализацию из
// jsdom. Из-за этого любой код, читающий localStorage (cart-context.tsx), и
// тесты вокруг него падают с "Cannot read properties of undefined".
// Ставим минимальный in-memory Storage только если рабочего нет.
function installMemoryStorage() {
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => void store.delete(key),
    setItem: (key: string, value: string) => void store.set(key, String(value)),
  };
  const define = (target: object) =>
    Object.defineProperty(target, "localStorage", {
      value: storage,
      configurable: true,
      writable: true,
    });
  define(globalThis);
  if (typeof window !== "undefined" && window !== (globalThis as unknown as Window)) define(window);
}

if (!globalThis.localStorage) installMemoryStorage();
