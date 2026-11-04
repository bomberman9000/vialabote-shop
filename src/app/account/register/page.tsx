"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    }).catch(() => null);

    if (!res?.ok) {
      // При 500 тело — не JSON: без catch кнопка навсегда оставалась в «Создаём аккаунт...».
      const data = await res?.json().catch(() => null);
      setError(data?.error || "Не удалось зарегистрироваться");
      setLoading(false);
      return;
    }

    // Аккаунт уже создан; если автоматический вход не прошёл — на форму входа, а не в кабинет.
    const login = await signIn("credentials", { email: form.email, password: form.password, redirect: false });
    setLoading(false);
    router.push(login?.ok ? "/account" : "/account/login");
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-sm">
      <form onSubmit={handleSubmit} className="card flex flex-col gap-4 p-6">
        <h1 className="text-xl font-semibold text-brand-800">Регистрация</h1>
        <input
          required
          minLength={2}
          placeholder="Имя"
          className="input"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <input
          required
          type="email"
          placeholder="Email"
          className="input"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
        <input
          required
          type="password"
          minLength={6}
          placeholder="Пароль (мин. 6 символов)"
          className="input"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <button className="btn-primary" disabled={loading}>
          {loading ? "Создаём аккаунт..." : "Зарегистрироваться"}
        </button>
        <p className="text-sm text-brand-500">
          Уже есть аккаунт?{" "}
          <Link href="/account/login" className="text-brand-700 hover:underline">
            Войти
          </Link>
        </p>
      </form>
    </div>
  );
}
