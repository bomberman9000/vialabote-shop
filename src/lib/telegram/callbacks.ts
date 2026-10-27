// Грамматика callback_data для действий панели (кроме экранов "v2:<screen>:<page>").
// Формат "a:<op>:<arg>[:<arg>]", ≤ 64 байт (лимит Telegram): product id (cuid, 25 симв.) + короткие поля.
// Чистые функции: разбор и сборка тестируются без БД. Кнопки stateless — черновик остатка
// зашит в сам callback ("a:se:<id>:<число>"), поэтому +/- не требуют хранения состояния.
import { MAX_STOCK } from "./stock";
import { isPeriod, type Period } from "./stats";
import { isVisibility, isTextField, type TextField, type Visibility } from "./card-edit";

export type PanelAction =
  | { op: "stats"; period: Period }
  | { op: "card"; productId: string }
  | { op: "stockEdit"; productId: string; draft: number }
  | { op: "stockInput"; productId: string }
  | { op: "stockApply"; productId: string; draft: number }
  | { op: "field"; productId: string; field: TextField }
  | { op: "photo"; productId: string }
  | { op: "visMenu"; productId: string }
  | { op: "vis"; productId: string; to: Visibility }
  | { op: "catMenu"; productId: string }
  | { op: "catSet"; productId: string; categoryId: string }
  | { op: "cancelInput" };

const ID = /^[A-Za-z0-9_-]{1,40}$/;

export function buildAction(a: PanelAction): string {
  switch (a.op) {
    case "stats":
      return `a:st:${a.period}`;
    case "card":
      return `a:pc:${a.productId}`;
    case "stockEdit":
      return `a:se:${a.productId}:${a.draft}`;
    case "stockInput":
      return `a:si:${a.productId}`;
    case "stockApply":
      return `a:sa:${a.productId}:${a.draft}`;
    case "field":
      return `a:ef:${a.productId}:${a.field}`;
    case "photo":
      return `a:ph:${a.productId}`;
    case "visMenu":
      return `a:vm:${a.productId}`;
    case "vis":
      return `a:vs:${a.productId}:${a.to}`;
    case "catMenu":
      return `a:cm:${a.productId}`;
    case "catSet":
      return `a:cs:${a.productId}:${a.categoryId}`;
    case "cancelInput":
      return "a:ci";
  }
}

/** Разбор callback_data; любая неожиданность -> null (кнопка «устарела»), никаких исключений. */
export function parseAction(data: string): PanelAction | null {
  if (!data.startsWith("a:") || data.length > 64) return null;
  const [, op, a, b] = data.split(":");
  const draft = () => (b !== undefined && /^\d{1,6}$/.test(b) && Number(b) <= MAX_STOCK ? Number(b) : null);
  switch (op) {
    case "st":
      return a && isPeriod(a) ? { op: "stats", period: a } : null;
    case "pc":
      return a && ID.test(a) ? { op: "card", productId: a } : null;
    case "se": {
      const d = draft();
      return a && ID.test(a) && d !== null ? { op: "stockEdit", productId: a, draft: d } : null;
    }
    case "si":
      return a && ID.test(a) ? { op: "stockInput", productId: a } : null;
    case "sa": {
      const d = draft();
      return a && ID.test(a) && d !== null ? { op: "stockApply", productId: a, draft: d } : null;
    }
    case "ef":
      return a && ID.test(a) && b && isTextField(b) ? { op: "field", productId: a, field: b } : null;
    case "ph":
      return a && ID.test(a) ? { op: "photo", productId: a } : null;
    case "vm":
      return a && ID.test(a) ? { op: "visMenu", productId: a } : null;
    case "vs":
      return a && ID.test(a) && b && isVisibility(b) ? { op: "vis", productId: a, to: b } : null;
    case "cm":
      return a && ID.test(a) ? { op: "catMenu", productId: a } : null;
    case "cs":
      return a && ID.test(a) && b && ID.test(b) ? { op: "catSet", productId: a, categoryId: b } : null;
    case "ci":
      return { op: "cancelInput" };
    default:
      return null;
  }
}
