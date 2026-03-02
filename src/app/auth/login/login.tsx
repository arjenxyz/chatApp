"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useMemo, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/AuthProvider";

export default function Login() {
  const supabase = getSupabaseBrowserClient();
  const router = useRouter();
  const { user, loading } = useAuth();

  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const origin = useMemo(() => {
    if (typeof window === "undefined") return "";
    return window.location.origin;
  }, []);

  const signInWithGoogle = async () => {
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: origin ? `${origin}/auth/callback` : undefined
        }
      });
      if (oauthError) {
        setError(oauthError.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    const trimmedEmail = email.trim().toLowerCase();
    const trimmedUsername = username.trim().toLowerCase();

    if (!trimmedEmail) {
      setError("E-posta gerekli.");
      return;
    }
    if (trimmedUsername && !/^[a-z0-9_]{3,20}$/.test(trimmedUsername)) {
      setError("Kullanıcı adı için 3-20 karakter: a-z, 0-9, _");
      return;
    }

    setSubmitting(true);
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email: trimmedEmail,
      options: {
        emailRedirectTo: origin ? `${origin}/auth/callback` : undefined,
        data: trimmedUsername ? { username: trimmedUsername } : undefined
      }
    });
    setSubmitting(false);

    if (signInError) {
      setError(signInError.message);
      return;
    }

    setNotice("Link gönderildi. E-postanı kontrol et.");
  };

  if (!loading && user) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <p className="text-sm text-zinc-200">Zaten giriş yaptın.</p>
        <div className="mt-3 flex gap-2">
          <button
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm font-medium hover:bg-zinc-800"
            onClick={() => router.push("/chat")}
            type="button"
          >
            Sohbete Git
          </button>
          <Link
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm font-medium hover:bg-zinc-800"
            href="/"
          >
            Ana Sayfa
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form className="space-y-3" onSubmit={onSubmit}>
      <div className="space-y-1">
        <label className="text-sm font-medium text-zinc-200" htmlFor="email">
          E-posta
        </label>
        <input
          className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none placeholder:text-zinc-500 focus:border-zinc-700"
          id="email"
          inputMode="email"
          onChange={(e) => setEmail(e.target.value)}
          placeholder="ornek@domain.com"
          required
          type="email"
          value={email}
        />
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium text-zinc-200" htmlFor="username">
          Kullanıcı adı (opsiyonel)
        </label>
        <input
          className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none placeholder:text-zinc-500 focus:border-zinc-700"
          id="username"
          onChange={(e) => setUsername(e.target.value)}
          placeholder="ilk girişte önerilir"
          value={username}
        />
      </div>

      {error ? (
        <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-lg border border-emerald-900/60 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-200">
          {notice}
        </div>
      ) : null}

      <button
        className={cn(
          "w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-800",
          (submitting || !origin) && "opacity-60"
        )}
        disabled={submitting || !origin}
        type="submit"
      >
        {submitting ? "Gönderiliyor..." : "Magic Link Gönder"}
      </button>

      <button
        className={cn(
          "mt-2 w-full rounded-xl border border-blue-700 bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500",
          submitting && "opacity-60"
        )}
        disabled={submitting}
        onClick={signInWithGoogle}
        type="button"
      >
        Google ile Giriş
      </button>

      <p className="text-xs text-zinc-400">
        Şifre yok. Linke tıkladıktan sonra otomatik olarak{" "}
        <span className="text-zinc-200">/chat</span> ekranına yönlendirileceksin.
      </p>
    </form>
  );
}
