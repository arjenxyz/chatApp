"use client";

import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function AuthCallbackClient() {
  const supabase = getSupabaseBrowserClient();
  const router = useRouter();

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // `auth.initialize()` will parse the current URL (both search & hash)
    // and set the session accordingly. It's the same helper used internally
    // by the SDK, and unlike `getSessionFromUrl` it actually exists on our
    // version of the library.
    (async () => {
      try {
        const res = await supabase.auth.initialize();
        // `initialize()` returns an object that may have an `error` property
        // but not necessarily a `data` field in the current SDK.
        if (res.error) {
          setError(res.error.message);
          return;
        }
        // session is now stored in the client automatically
        router.replace("/chat");
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Bilinmeyen hata");
      }
    })();
  }, [router, supabase.auth]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-3 px-6 py-16">
      <h1 className="text-xl font-semibold">Giriş doğrulanıyor…</h1>
      {error ? (
        <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      ) : (
        <p className="text-sm text-zinc-300">Lütfen bekle.</p>
      )}
    </main>
  );
}

