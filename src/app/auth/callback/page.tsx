import { Suspense } from "react";

import AuthCallbackClient from "./AuthCallbackClient";

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-3 px-6 py-16">
          <h1 className="text-xl font-semibold">Giriş doğrulanıyor…</h1>
          <p className="text-sm text-zinc-300">Lütfen bekle.</p>
        </main>
      }
    >
      <AuthCallbackClient />
    </Suspense>
  );
}
