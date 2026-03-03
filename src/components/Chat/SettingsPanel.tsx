"use client";

import { Check, Copy, Loader2, LogOut, Save } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  getDefaultUserPreferences,
  loadUserPreferences,
  saveUserPreferences,
  type UserPreferences
} from "@/lib/userPreferences";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/AuthProvider";

const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;

type ProfileForm = {
  username: string;
  fullName: string;
  avatarUrl: string;
};

export function SettingsPanel() {
  const supabase = getSupabaseBrowserClient();
  const { user, profile, signOut, refreshProfile } = useAuth();

  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [form, setForm] = useState<ProfileForm>({ username: "", fullName: "", avatarUrl: "" });
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<UserPreferences>(getDefaultUserPreferences());

  useEffect(() => {
    setForm({
      username: profile?.username ?? "",
      fullName: profile?.full_name ?? "",
      avatarUrl: profile?.avatar_url ?? ""
    });
  }, [profile?.avatar_url, profile?.full_name, profile?.username]);

  useEffect(() => {
    if (!user) {
      setPreferences(getDefaultUserPreferences());
      return;
    }

    setPreferences(loadUserPreferences(user.id));
  }, [user]);

  const copyToClipboard = useCallback((text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    window.setTimeout(() => setCopiedField(null), 1800);
  }, []);

  const updatePreference = useCallback(
    <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => {
      if (!user) return;
      const next = saveUserPreferences(user.id, { [key]: value });
      setPreferences(next);
    },
    [user]
  );

  const statusLabel = useMemo(() => {
    if (profile?.status === "online") return "Çevrim içi";
    if (profile?.status === "offline") return "Çevrim dışı";
    return "Bilinmiyor";
  }, [profile?.status]);

  const saveProfile = useCallback(async () => {
    if (!user) return;
    setProfileError(null);
    setProfileSuccess(null);

    const nextUsername = form.username.trim().toLowerCase();
    const nextFullName = form.fullName.trim();
    const nextAvatarUrl = form.avatarUrl.trim();

    if (!nextUsername) {
      setProfileError("Kullanıcı adı gerekli.");
      return;
    }

    if (!USERNAME_REGEX.test(nextUsername)) {
      setProfileError("Kullanıcı adı 3-20 karakter olmalı ve sadece a-z, 0-9, _ içermeli.");
      return;
    }

    if (nextAvatarUrl && !/^https?:\/\//i.test(nextAvatarUrl)) {
      setProfileError("Avatar URL http:// veya https:// ile başlamalı.");
      return;
    }

    setSavingProfile(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          username: nextUsername,
          full_name: nextFullName || null,
          avatar_url: nextAvatarUrl || null
        })
        .eq("id", user.id);

      if (error) {
        setProfileError(error.message);
        return;
      }

      await refreshProfile();
      setProfileSuccess("Profil güncellendi.");
      window.setTimeout(() => setProfileSuccess(null), 2000);
    } finally {
      setSavingProfile(false);
    }
  }, [form.avatarUrl, form.fullName, form.username, refreshProfile, supabase, user]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-900/45 p-4 md:rounded-2xl md:p-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4 md:p-5">
          <div className="mb-4 flex items-center gap-3">
            {form.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="Avatar" className="h-14 w-14 rounded-full border border-zinc-700 object-cover" src={form.avatarUrl} />
            ) : (
              <div className="grid h-14 w-14 place-items-center rounded-full border border-zinc-700 bg-zinc-800 text-sm font-semibold text-zinc-300">
                {(form.username || "?").slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-zinc-100">{form.fullName || `@${form.username || "kullanici"}`}</p>
              <p className="text-xs text-zinc-500">{statusLabel}</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs text-zinc-400">Kullanıcı adı</span>
              <input
                className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-zinc-700"
                onChange={(event) => setForm((prev) => ({ ...prev, username: event.target.value }))}
                placeholder="ornek_kullanici"
                value={form.username}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-zinc-400">Ad Soyad</span>
              <input
                className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-zinc-700"
                onChange={(event) => setForm((prev) => ({ ...prev, fullName: event.target.value }))}
                placeholder="Ad Soyad"
                value={form.fullName}
              />
            </label>
          </div>

          <label className="mt-3 block space-y-1">
            <span className="text-xs text-zinc-400">Avatar URL</span>
            <input
              className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-zinc-700"
              onChange={(event) => setForm((prev) => ({ ...prev, avatarUrl: event.target.value }))}
              placeholder="https://..."
              value={form.avatarUrl}
            />
          </label>

          {profileError ? <p className="mt-2 text-xs text-red-300">{profileError}</p> : null}
          {profileSuccess ? <p className="mt-2 text-xs text-emerald-300">{profileSuccess}</p> : null}

          <button
            className={cn(
              "mt-4 inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition-colors",
              savingProfile
                ? "border-zinc-700 bg-zinc-800 text-zinc-400"
                : "border-blue-700 bg-blue-600 text-white hover:bg-blue-500"
            )}
            disabled={savingProfile}
            onClick={() => void saveProfile()}
            type="button"
          >
            {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Profili Kaydet
          </button>
        </div>

        <div className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4 md:p-5">
          <h3 className="mb-3 text-sm font-semibold text-zinc-100">Sohbet Tercihleri</h3>
          <div className="space-y-2">
            <label className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2">
              <span className="text-sm text-zinc-200">Yazıyor bilgisini göster/gönder</span>
              <input
                checked={preferences.showTypingIndicator}
                className="h-4 w-4 rounded"
                onChange={(event) => updatePreference("showTypingIndicator", event.target.checked)}
                type="checkbox"
              />
            </label>
            <label className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2">
              <span className="text-sm text-zinc-200">Okundu bilgisi gönder</span>
              <input
                checked={preferences.sendReadReceipts}
                className="h-4 w-4 rounded"
                onChange={(event) => updatePreference("sendReadReceipts", event.target.checked)}
                type="checkbox"
              />
            </label>
            <label className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2">
              <span className="text-sm text-zinc-200">Yeni mesajda sesli uyarı</span>
              <input
                checked={preferences.soundNotifications}
                className="h-4 w-4 rounded"
                onChange={(event) => updatePreference("soundNotifications", event.target.checked)}
                type="checkbox"
              />
            </label>
            <label className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2">
              <span className="text-sm text-zinc-200">Enter ile gönder (Shift+Enter satır)</span>
              <input
                checked={preferences.enterToSend}
                className="h-4 w-4 rounded"
                onChange={(event) => updatePreference("enterToSend", event.target.checked)}
                type="checkbox"
              />
            </label>
          </div>
        </div>

        <div className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4 md:p-5">
          <h3 className="mb-3 text-sm font-semibold text-zinc-100">Hesap Bilgileri</h3>
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2">
              <div className="min-w-0">
                <p className="text-xs text-zinc-500">User ID</p>
                <p className="truncate text-xs font-mono text-zinc-300">{user?.id ?? "-"}</p>
              </div>
              {user?.id ? (
                <button
                  className="ml-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                  onClick={() => copyToClipboard(user.id, "userId")}
                  type="button"
                >
                  {copiedField === "userId" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedField === "userId" ? "Kopyalandı" : "Kopyala"}
                </button>
              ) : null}
            </div>

            <div className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2">
              <div className="min-w-0">
                <p className="text-xs text-zinc-500">E-posta</p>
                <p className="truncate text-sm text-zinc-300">{user?.email ?? "-"}</p>
              </div>
              {user?.email ? (
                <button
                  className="ml-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                  onClick={() => {
                    if (!user?.email) return;
                    copyToClipboard(user.email, "email");
                  }}
                  type="button"
                >
                  {copiedField === "email" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedField === "email" ? "Kopyalandı" : "Kopyala"}
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <button
          className={cn(
            "inline-flex w-full items-center justify-center gap-2 rounded-xl border border-red-900/50 bg-red-900/20 px-4 py-3 text-sm font-semibold text-red-300 transition-colors hover:bg-red-900/40"
          )}
          onClick={() => void signOut()}
          type="button"
        >
          <LogOut className="h-4 w-4" />
          Çıkış Yap
        </button>
      </div>
    </div>
  );
}
