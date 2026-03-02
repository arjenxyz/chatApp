"use client";

import { useRouter, useSearchParams } from "next/navigation";
import React, { useEffect, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function AuthCallbackClient() {
  const supabase = getSupabaseBrowserClient();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const completeAuth = async () => {
      try {
        const providerError = searchParams.get("error_description") || searchParams.get("error");
        if (providerError) {
          if (!cancelled) setError(providerError);
          return;
        }

        const code = searchParams.get("code");
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) {
            if (!cancelled) setError(exchangeError.message);
            return;
          }
          if (!cancelled) router.replace("/chat");
          return;
        }

        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) {
          if (!cancelled) setError(sessionError.message);
          return;
        }

        if (data.session) {
          if (!cancelled) router.replace("/chat");
          return;
        }

        if (!cancelled) setError("Geçersiz dönüş bağlantısı.");
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Bilinmeyen hata");
      }
    };

    void completeAuth();

    return () => {
      cancelled = true;
    };
  }, [router, searchParams, supabase.auth]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/55 p-6 text-center">
        <h1 className="text-xl font-semibold text-zinc-100">Giriş doğrulanıyor...</h1>
        {error ? (
          <div className="mt-3 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        ) : (
          <p className="mt-2 text-sm text-zinc-400">Lütfen bekle.</p>
        )}
      </div>
    </main>
  );
}
