"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCart } from "@/lib/cart-context";
import { formatPrice } from "@/lib/money";
import { formatDeliveryDate } from "@/lib/delivery/format";
import { normalizeRuPhone } from "@/lib/delivery/ozon";
import { formatRuPhone, nextPhoneValue } from "@/lib/phone";
import { customerDeliveryPrice, FREE_DELIVERY_FROM_KOPECKS } from "@/lib/delivery/free-delivery";
import type { CheckoutProfile } from "@/lib/checkout-profile";
import type { MapTiles } from "@/lib/delivery/map-tiles";
import { OzonDelivery, type OzonSelection } from "./ozon-delivery";

/** Пункт последнего заказа в этом браузере — для гостя; у зарегистрированного он ещё и в профиле. */
const LAST_POINT_KEY = "vialabote-ozon-point";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Person {
  lastName: string;
  firstName: string;
  middleName: string;
  phone: string;
}

type Field = "lastName" | "firstName" | "email" | "phone";
type Errors = Partial<Record<Field, string>>;

/** Проверка при вводе. Для Ozon телефон — мобильный РФ: заказ выдают по аккаунту Ozon этого номера. */
function check(p: Person & { email?: string }, mobile: boolean): Errors {
  const e: Errors = {};
  if (!p.lastName.trim()) e.lastName = "Укажите фамилию";
  if (!p.firstName.trim()) e.firstName = "Укажите имя";
  if (p.email !== undefined && !EMAIL.test(p.email.trim())) e.email = "Проверьте email";
  if (mobile ? !normalizeRuPhone(p.phone) : p.phone.replace(/\D/g, "").length !== 11) {
    e.phone = mobile ? "Нужен мобильный номер РФ: +7 9XX XXX-XX-XX" : "Проверьте номер телефона";
  }
  return e;
}

const nameOf = (p: Person) => ({
  lastName: p.lastName.trim(),
  firstName: p.firstName.trim(),
  ...(p.middleName.trim() ? { middleName: p.middleName.trim() } : {}),
});

function goods(n: number) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "товар";
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "товара";
  return "товаров";
}

function Input({ error, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { error?: string }) {
  return (
    <span className="flex flex-col gap-1">
      <input
        {...props}
        aria-label={props.placeholder}
        aria-invalid={error ? true : undefined}
        className={`input ${error ? "border-red-400" : ""}`}
      />
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </span>
  );
}

/** Фамилия, имя, отчество и телефон — одним блоком для покупателя и для другого получателя. */
function PersonFields({
  id,
  value,
  onChange,
  errors,
  onBlur,
  only,
  email,
}: {
  id: string;
  value: Person;
  onChange: (p: Person) => void;
  errors: Errors;
  onBlur: (f: Field) => void;
  /** показать только эти поля (остальные уже есть в профиле) */
  only?: Field[];
  email?: { value: string; onChange: (v: string) => void };
}) {
  const show = (f: Field | "middleName") => !only || only.includes(f === "middleName" ? "lastName" : f);
  const auto = (a: string) => (id === "buyer" ? a : `section-${id} ${a}`);
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {show("lastName") ? (
        <Input
          id={`${id}-last`}
          placeholder="Фамилия"
          autoComplete={auto("family-name")}
          value={value.lastName}
          onChange={(e) => onChange({ ...value, lastName: e.target.value })}
          onBlur={() => onBlur("lastName")}
          error={errors.lastName}
        />
      ) : null}
      {show("firstName") ? (
        <Input
          id={`${id}-first`}
          placeholder="Имя"
          autoComplete={auto("given-name")}
          value={value.firstName}
          onChange={(e) => onChange({ ...value, firstName: e.target.value })}
          onBlur={() => onBlur("firstName")}
          error={errors.firstName}
        />
      ) : null}
      {show("middleName") ? (
        <Input
          id={`${id}-middle`}
          placeholder="Отчество (необязательно)"
          autoComplete={auto("additional-name")}
          value={value.middleName}
          onChange={(e) => onChange({ ...value, middleName: e.target.value })}
        />
      ) : null}
      {show("phone") ? (
        <Input
          id={`${id}-phone`}
          type="tel"
          inputMode="tel"
          placeholder="Телефон +7 (999) 123-45-67"
          autoComplete={auto("tel")}
          value={value.phone}
          onChange={(e) => onChange({ ...value, phone: nextPhoneValue(value.phone, e.target.value) })}
          onBlur={() => onBlur("phone")}
          error={errors.phone}
        />
      ) : null}
      {email && show("email") ? (
        <Input
          id={`${id}-email`}
          type="email"
          inputMode="email"
          placeholder="Email"
          autoComplete="email"
          value={email.value}
          onChange={(e) => email.onChange(e.target.value)}
          onBlur={() => onBlur("email")}
          error={errors.email}
        />
      ) : null}
    </div>
  );
}

export function CheckoutForm({ profile }: { profile: CheckoutProfile | null }) {
  const { items, totalAmount, clear } = useCart();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Покупатель. Зарегистрированному — из профиля: карточка «Получатель … · Изменить», поля раскрываются
  // по «Изменить»; сразу спрашиваем только то, чего в профиле нет (обычно телефон после регистрации).
  const [buyer, setBuyer] = useState<Person>(() => ({
    lastName: profile?.lastName ?? "",
    firstName: profile?.firstName ?? "",
    middleName: profile?.middleName ?? "",
    phone: formatRuPhone(profile?.phone ?? ""),
  }));
  const [email, setEmail] = useState(profile?.email ?? "");
  const [missing] = useState<Field[]>(() => (profile ? (Object.keys(check({ ...buyer, email }, true)) as Field[]) : []));
  const [editing, setEditing] = useState(false);
  const card = profile !== null && !editing;

  // Получатель — другой человек (только Ozon: заказ выдают по его телефону).
  const [other, setOther] = useState(false);
  const [recipient, setRecipient] = useState<Person>({ lastName: "", firstName: "", middleName: "", phone: "" });

  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const touch = (key: string) => setTouched((t) => (t.has(key) ? t : new Set(t).add(key)));

  const [manual, setManual] = useState({ city: "", address: "" });
  const [comment, setComment] = useState("");

  const [offer, setOffer] = useState(false);
  const [pdn, setPdn] = useState(false);
  const [ads, setAds] = useState(false);

  // Доставка Ozon показывается, только если она включена на сервере; иначе форма как раньше.
  const [ozonEnabled, setOzonEnabled] = useState(false);
  const [ozonMap, setOzonMap] = useState<MapTiles | null>(null);
  const [mode, setMode] = useState<"OZON_PVZ" | "MANUAL">("OZON_PVZ");
  const [ozon, setOzon] = useState<OzonSelection | null>(null);
  const [lastPointId, setLastPointId] = useState<string | null>(profile?.ozonPointId ?? null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  useEffect(() => {
    fetch("/api/delivery/ozon")
      .then((r) => r.json())
      .then((d) => {
        setOzonEnabled(d.enabled === true);
        setOzonMap(d.map ?? null);
      })
      .catch(() => setOzonEnabled(false));
    if (!profile?.ozonPointId) {
      try {
        const id = localStorage.getItem(LAST_POINT_KEY);
        if (id && /^\d{1,19}$/.test(id)) setLastPointId(id);
      } catch {
        // приватный режим без localStorage — просто без прошлого пункта
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const useOzon = ozonEnabled && mode === "OZON_PVZ";
  // От порога бесплатной доставки покупатель за неё не платит (сервер считает так же — и сумму решает он).
  const freeDelivery = totalAmount >= FREE_DELIVERY_FROM_KOPECKS;
  const deliveryPrice = useOzon && ozon ? customerDeliveryPrice(totalAmount, ozon.quote.priceKopecks) : 0;
  const deliveryText = (kopecks: number) => (kopecks === 0 ? "бесплатно" : formatPrice(kopecks));
  const total = totalAmount + deliveryPrice;

  const buyerErrors = check({ ...buyer, email }, useOzon && !other);
  const recipientErrors = useOzon && other ? check(recipient, true) : {};
  const shown = (errors: Errors, prefix: string): Errors =>
    Object.fromEntries(Object.entries(errors).filter(([f]) => submitted || touched.has(`${prefix}.${f}`)));

  const blocker = !offer ? "Отметьте согласие с офертой" : useOzon && !ozon ? "Выберите пункт выдачи" : null;

  if (items.length === 0) {
    return <p className="text-brand-600">Корзина пуста. Добавьте товары в каталоге.</p>;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (Object.keys(buyerErrors).length > 0 || Object.keys(recipientErrors).length > 0) {
      // Ошибка в поле, скрытом в карточке, — раскрываем поля, чтобы её было видно.
      if (card && Object.keys(buyerErrors).some((f) => !missing.includes(f as Field))) setEditing(true);
      setError("Проверьте отмеченные поля");
      return;
    }
    setLoading(true);
    setError(null);

    const name = nameOf(buyer);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: `${name.firstName} ${name.lastName}`,
          customerNameParts: name,
          customerEmail: email.trim(),
          customerPhone: buyer.phone,
          deliveryCity: manual.city,
          deliveryAddress: manual.address,
          comment,
          ...(useOzon && ozon
            ? {
                deliveryCity: ozon.point.city ?? "—",
                deliveryAddress: `Пункт выдачи Ozon: ${ozon.point.address ?? ozon.point.id}`,
                delivery: {
                  provider: "OZON",
                  destination: { type: "PVZ", mapPointId: ozon.point.id },
                  recipient: other ? { ...nameOf(recipient), phone: recipient.phone } : name,
                },
              }
            : {}),
          offerAccepted: offer,
          pdnConsent: pdn,
          adsConsent: ads,
          items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
        }),
      });
      const data = await res.json();

      if (data.paymentError) {
        // Банк не открыл оплату: заказ отменён, резерв снят — корзину не трогаем, можно повторить.
        setError("Не удалось открыть оплату. Попробуйте ещё раз через минуту.");
        setLoading(false);
        return;
      }

      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Не удалось оформить заказ. Проверьте данные и попробуйте снова.");
        setLoading(false);
        return;
      }

      if (useOzon && ozon) {
        try {
          localStorage.setItem(LAST_POINT_KEY, ozon.point.id);
        } catch {
          // без localStorage пункт просто не запомнится в этом браузере
        }
      }

      // Онлайн-оплата: страница с таймером 10 минут. Корзину очистит она — после подтверждения банком.
      if (data.payPage) {
        router.push(data.payPage);
        return;
      }

      if (data.paymentUrl) {
        // Корзина очищается на странице успеха только после подтверждения оплаты.
        window.location.href = data.paymentUrl;
      } else {
        clear();
        router.push(`/checkout/success?order=${data.orderNumber}`);
      }
    } catch {
      setError("Ошибка сети. Попробуйте ещё раз.");
      setLoading(false);
    }
  }

  const count = items.reduce((s, i) => s + i.quantity, 0);
  const deliveryRow = useOzon ? (
    <div className="flex justify-between gap-3 text-sm text-brand-600">
      <span>{ozon ? `Доставка Ozon, получение до ${formatDeliveryDate(ozon.quote.maxDate)}` : "Доставка Ozon — выберите пункт"}</span>
      <span className="shrink-0">{ozon ? deliveryText(deliveryPrice) : "—"}</span>
    </div>
  ) : ozonEnabled ? (
    <div className="flex justify-between gap-3 text-sm text-brand-600">
      <span>Доставку согласует менеджер</span>
      <span className="shrink-0">—</span>
    </div>
  ) : null;
  const freeHint =
    useOzon && !freeDelivery ? (
      <p className="text-xs text-brand-500">
        До бесплатной доставки — {formatPrice(FREE_DELIVERY_FROM_KOPECKS - totalAmount)}
      </p>
    ) : null;
  const lines = (
    <ul className="flex flex-col gap-2 text-sm">
      {items.map((i) => (
        <li key={i.productId} className="flex justify-between gap-3">
          <span>
            {i.title} × {i.quantity}
          </span>
          <span className="shrink-0">{formatPrice(i.price * i.quantity)}</span>
        </li>
      ))}
    </ul>
  );
  const disabled = loading || !offer || (useOzon && !ozon);

  return (
    <div className="grid gap-8 md:grid-cols-[1.5fr_1fr]">
      <form id="checkout-form" onSubmit={handleSubmit} className="card flex flex-col gap-4 p-6">
        <h1 className="text-xl font-semibold text-brand-800">Оформление заказа</h1>

        {card ? (
          <div className="flex flex-col gap-3 rounded-lg border border-brand-100 bg-brand-50/40 p-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 text-brand-700">
                <span className="text-brand-500">{other && useOzon ? "Заказчик" : "Получатель"}: </span>
                <span className="font-medium text-brand-800">
                  {[buyer.firstName, buyer.lastName ? `${buyer.lastName[0]}.` : ""].filter(Boolean).join(" ") || "—"}
                </span>
                {!missing.includes("phone") && buyer.phone ? (
                  <>
                    , <span className="whitespace-nowrap">{buyer.phone}</span>
                  </>
                ) : null}
                {!missing.includes("email") && email ? (
                  <>
                    , <span className="break-words">{email}</span>
                  </>
                ) : null}
              </p>
              <button type="button" className="shrink-0 text-brand-700 underline" onClick={() => setEditing(true)}>
                Изменить
              </button>
            </div>
            {missing.length > 0 ? (
              <PersonFields
                id="buyer"
                value={buyer}
                onChange={setBuyer}
                errors={shown(buyerErrors, "buyer")}
                onBlur={(f) => touch(`buyer.${f}`)}
                only={missing}
                email={{ value: email, onChange: setEmail }}
              />
            ) : null}
          </div>
        ) : (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium text-brand-800">{other && useOzon ? "Заказчик" : "Получатель"}</legend>
            <PersonFields
              id="buyer"
              value={buyer}
              onChange={setBuyer}
              errors={shown(buyerErrors, "buyer")}
              onBlur={(f) => touch(`buyer.${f}`)}
              email={{ value: email, onChange: setEmail }}
            />
            {profile === null ? (
              <p className="text-xs text-brand-500">
                Есть аккаунт?{" "}
                <Link href="/account/login?next=/checkout" className="underline">
                  Войдите
                </Link>{" "}
                — данные подставятся сами.
              </p>
            ) : null}
          </fieldset>
        )}

        {useOzon ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={other} onChange={(e) => setOther(e.target.checked)} />
            Получатель — другой человек
          </label>
        ) : null}
        {useOzon && other ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium text-brand-800">Получатель</legend>
            <PersonFields
              id="recipient"
              value={recipient}
              onChange={setRecipient}
              errors={shown(recipientErrors, "recipient")}
              onBlur={(f) => touch(`recipient.${f}`)}
            />
            <p className="text-xs text-brand-500">Заказ выдадут по штрихкоду в приложении Ozon на этом номере.</p>
          </fieldset>
        ) : null}

        {ozonEnabled ? (
          <fieldset className="flex flex-col gap-2 text-sm">
            <legend className="mb-1 font-medium text-brand-800">Доставка</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="delivery-mode" checked={mode === "OZON_PVZ"} onChange={() => setMode("OZON_PVZ")} />
              Ozon — пункт выдачи
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="delivery-mode" checked={mode === "MANUAL"} onChange={() => setMode("MANUAL")} />
              Согласовать доставку с менеджером
            </label>
          </fieldset>
        ) : null}

        {useOzon ? (
          <OzonDelivery
            items={items.map((i) => ({ productId: i.productId, quantity: i.quantity }))}
            onChange={setOzon}
            map={ozonMap}
            initialPointId={lastPointId}
            freeDelivery={freeDelivery}
          />
        ) : (
          <>
            <input
              required
              placeholder="Город"
              aria-label="Город"
              className="input"
              autoComplete="address-level2"
              value={manual.city}
              onChange={(e) => setManual({ ...manual, city: e.target.value })}
            />
            <input
              required
              placeholder="Адрес доставки"
              aria-label="Адрес доставки"
              className="input"
              autoComplete="street-address"
              value={manual.address}
              onChange={(e) => setManual({ ...manual, address: e.target.value })}
            />
          </>
        )}
        <textarea
          placeholder="Комментарий к заказу (необязательно)"
          aria-label="Комментарий к заказу"
          className="input"
          rows={3}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />

        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={offer} onChange={(e) => setOffer(e.target.checked)} className="mt-1" />
          <span>
            Я ознакомился(-ась) с <Link href="/offer" target="_blank" className="underline">публичной офертой</Link> и{" "}
            <Link href="/returns" target="_blank" className="underline">условиями доставки и возврата</Link>
          </span>
        </label>
        <p className="text-xs text-brand-500">
          Данные для заказа обрабатываются по{" "}
          <Link href="/privacy" target="_blank" className="underline">Политике обработки персональных данных</Link>.
          Дополнительные согласия ниже необязательны и не влияют на оформление заказа.
        </p>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={pdn} onChange={(e) => setPdn(e.target.checked)} className="mt-1" />
          <span>Даю согласие на обработку персональных данных, как описано в Политике (необязательно)</span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={ads} onChange={(e) => setAds(e.target.checked)} className="mt-1" />
          <span>Согласен(-на) получать рекламные предложения VIA LABOTE по e-mail. Отписаться можно в любой момент; не является условием покупки.</span>
        </label>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <div className="hidden flex-col gap-1 md:flex">
          <button type="submit" className="btn-primary" disabled={disabled}>
            {loading ? "Оформляем..." : "Оплатить онлайн"}
          </button>
          {blocker && !loading ? <p className="text-center text-xs text-brand-500">{blocker}</p> : null}
        </div>
      </form>

      <div className="card hidden h-fit p-6 md:block">
        <h2 className="mb-4 font-semibold text-brand-800">Ваш заказ</h2>
        {lines}
        {deliveryRow ? <div className="mt-2 flex flex-col gap-1">{deliveryRow}{freeHint}</div> : null}
        <div className="mt-4 flex justify-between border-t border-brand-100 pt-4 font-semibold text-brand-800">
          <span>Итого</span>
          <span>{formatPrice(total)}</span>
        </div>
      </div>

      {/* Мобильный: «Ваш заказ» — компактная панель внизу экрана с итогом и кнопкой; состав — по нажатию. */}
      <div className="sticky bottom-0 z-40 -mx-4 border-t border-brand-100 bg-white px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] md:hidden">
        {summaryOpen ? (
          <div className="mb-3 flex max-h-[45vh] flex-col gap-2 overflow-y-auto border-b border-brand-100 pb-3">
            {lines}
            {deliveryRow}
            {freeHint}
          </div>
        ) : null}
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="min-w-0 flex-1 text-left"
            aria-expanded={summaryOpen}
            onClick={() => setSummaryOpen((o) => !o)}
          >
            <span className="block font-semibold text-brand-800">Итого {formatPrice(total)}</span>
            <span className="block truncate text-xs text-brand-500">
              {count} {goods(count)}
              {useOzon ? (ozon ? ` · доставка ${deliveryText(deliveryPrice)}` : " · без доставки") : ""} · {summaryOpen ? "свернуть" : "состав"}
            </span>
          </button>
          <button type="submit" form="checkout-form" className="btn-primary shrink-0" disabled={disabled}>
            {loading ? "Оформляем..." : "Оплатить"}
          </button>
        </div>
        {error || (blocker && !loading) ? (
          <p className={`mt-1 text-xs ${error ? "text-red-600" : "text-brand-500"}`}>{error ?? blocker}</p>
        ) : null}
      </div>
    </div>
  );
}
