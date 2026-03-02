import { Suspense } from "react";

import AuthCallbackClient from "./AuthCallbackClient";

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/55 p-6 text-center">
            <h1 className="text-xl font-semibold text-zinc-100">Giriş doğrulanıyor...</h1>
            <p className="mt-2 text-sm text-zinc-400">Lütfen bekle.</p>
          </div>
        </main>
      }
    >
      <AuthCallbackClient />
    </Suspense>
  );
}
