"use client";

import { Film, ShieldAlert } from "lucide-react";
import React, { useEffect, useState } from "react";

const TERMS_STORAGE_KEY = "wp_terms_accepted_v1";

export function loadTermsAccepted(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(TERMS_STORAGE_KEY) === "true";
}

export function saveTermsAccepted(): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TERMS_STORAGE_KEY, "true");
}

const RULES = [
  "Watch Party yalnızca grup konuşmalarında kullanılabilir.",
  "Paylaştığın her içerikten hukuki ve etik olarak kendin sorumlusun.",
  "Telif hakkı korumalı içerikleri platform kurallarına aykırı şekilde paylaşma.",
  "Sıraya eklenen videolar oturumdaki tüm üyeler tarafından görülebilir.",
  "Zararlı, müstehcen veya yasadışı içerik paylaşmak yasaktır.",
  "Kural ihlalleri bildirilip hesabın kısıtlanabilir.",
];

interface WatchPartyTermsProps {
  onAccepted: () => void;
}

export function WatchPartyTerms({ onAccepted }: WatchPartyTermsProps) {
  const [neverAgain, setNeverAgain] = useState(false);

  const handleAccept = () => {
    if (neverAgain) saveTermsAccepted();
    onAccepted();
  };

  return (
    <div className="flex h-full flex-col items-center justify-center px-5 py-8 bg-zinc-950">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900/80 p-6 shadow-2xl">
        {/* Header */}
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cyan-800/60 bg-cyan-900/30">
            <Film className="h-5 w-5 text-cyan-400" />
          </div>
          <div>
            <p className="text-sm font-bold text-zinc-100">Watch Party</p>
            <p className="text-[11px] text-zinc-400">Kullanıma devam etmeden önce oku</p>
          </div>
        </div>

        {/* Rules */}
        <ul className="mb-5 space-y-2.5 rounded-xl border border-zinc-800 bg-zinc-950/70 px-4 py-3">
          {RULES.map((rule, i) => (
            <li key={i} className="flex items-start gap-2">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
              <span className="text-[12px] leading-snug text-zinc-300">{rule}</span>
            </li>
          ))}
        </ul>

        {/* Don't show again */}
        <label className="mb-4 flex cursor-pointer items-center gap-2 select-none">
          <input
            checked={neverAgain}
            className="h-3.5 w-3.5 accent-cyan-500 cursor-pointer"
            onChange={(e) => setNeverAgain(e.target.checked)}
            type="checkbox"
          />
          <span className="text-xs text-zinc-400">Bir daha gösterme</span>
        </label>

        <button
          className="w-full rounded-xl bg-cyan-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-cyan-500 active:bg-cyan-700"
          onClick={handleAccept}
          type="button"
        >
          Anladım, Devam Et
        </button>
      </div>
    </div>
  );
}

/** Hook: returns whether terms are accepted (persistent across sessions if user chose "don't show again") */
export function useWatchPartyTerms() {
  const [accepted, setAccepted] = useState<boolean | null>(null);

  useEffect(() => {
    setAccepted(loadTermsAccepted());
  }, []);

  return { accepted, accept: () => setAccepted(true) };
}
