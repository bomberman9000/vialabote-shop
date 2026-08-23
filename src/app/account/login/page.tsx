"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);

    if (res?.error) {
      setError("Неверный email или пароль");
      return;
    }
    router.push("/account");
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-sm">
      <form onSubmit={handleSubmit} className="card flex flex-col gap-4 p-6">
        <h1 className="text-xl font-semibold text-brand-800">Вход в личный кабинет</h1>
        <input
          required
          type="email"
          placeholder="Email"
          className="input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          required
          type="password"
          placeholder="Пароль"
          className="input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <button className="btn-primary" disabled={loading}>
          {loading ? "Входим..." : "Войти"}
        </button>
        <p className="text-sm text-brand-500">
          Нет аккаунта?{" "}
          <Link href="/account/register" className="text-brand-700 hover:underline">
            Зарегистрироваться
          </Link>
        </p>
      </form>
    </div>
  );
}
