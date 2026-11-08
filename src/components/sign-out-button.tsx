"use client";

import { useState } from "react";
import { signOutToHome } from "@/lib/sign-out";

export function SignOutButton({ className }: { className?: string }) {
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        setPending(true);
        signOutToHome().catch(() => setPending(false));
      }}
      className={className}
    >
      Выйти
    </button>
  );
}
