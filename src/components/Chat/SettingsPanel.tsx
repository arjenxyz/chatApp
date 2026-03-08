"use client";

import {
  Check,
  Copy,
  ImagePlus,
  Loader2,
  LogOut,
  RefreshCcw,
  RotateCcw,
  Save,
  ShieldCheck,
  Trash2,
  UserCircle2,
  X
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
const AVATAR_BUCKET = "chat-media";
const MAX_AVATAR_SIZE = 5 * 1024 * 1024;
const ALLOWED_AVATAR_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const CHAT_LOCAL_STORAGE_PREFIXES = ["chat.pinned.", "chat.draft.", "chat.preferences.", "chat.installNotice.", "chat.pushPromptDismissed."];

type ProfileForm = {
  username: string;
  fullName: string;
  avatarUrl: string;
};

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function SettingsPanel() {
  const supabase = getSupabaseBrowserClient();
  const { user, profile, signOut, refreshProfile } = useAuth();

  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [form, setForm] = useState<ProfileForm>({ username: "", fullName: "", avatarUrl: "" });
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [refreshingProfile, setRefreshingProfile] = useState(false);
  const [resettingPreferences, setResettingPreferences] = useState(false);
  const [clearingLocalData, setClearingLocalData] = useState(false);
  const [preferences, setPreferences] = useState<UserPreferences>(getDefaultUserPreferences());
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

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

  const profileCompletionRate = useMemo(() => {
    const checks = [Boolean(form.username.trim()), Boolean(form.fullName.trim()), Boolean(form.avatarUrl.trim())];
    const completed = checks.filter(Boolean).length;
    return Math.round((completed / checks.length) * 100);
  }, [form.avatarUrl, form.fullName, form.username]);

  const uploadAvatarFromFile = useCallback(
    async (file: File) => {
      if (!user) return;

      setProfileError(null);
      setProfileSuccess(null);

      if (!ALLOWED_AVATAR_MIME_TYPES.includes(file.type)) {
        setProfileError("Desteklenen avatar formatları: PNG, JPG, WEBP, GIF.");
        return;
      }

      if (file.size > MAX_AVATAR_SIZE) {
        setProfileError(`Avatar dosyası en fazla ${formatFileSize(MAX_AVATAR_SIZE)} olabilir.`);
        return;
      }

      setAvatarUploading(true);
      try {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `avatars/${user.id}/${Date.now()}-${safeName}`;

        const { error: uploadError } = await supabase.storage.from(AVATAR_BUCKET).upload(path, file, {
          cacheControl: "3600",
          upsert: false
        });
        if (uploadError) {
          setProfileError(uploadError.message);
          return;
        }

        const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
        setForm((prev) => ({ ...prev, avatarUrl: data.publicUrl }));
        setProfileSuccess("Profil fotoğrafı yüklendi. Kaydetmeyi unutma.");
      } finally {
        setAvatarUploading(false);
      }
    },
    [supabase, user]
  );

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
      window.setTimeout(() => setProfileSuccess(null), 2200);
    } finally {
      setSavingProfile(false);
    }
  }, [form.avatarUrl, form.fullName, form.username, refreshProfile, supabase, user]);

  const resetPreferences = useCallback(() => {
    if (!user) return;
    setResettingPreferences(true);
    setProfileError(null);
    setProfileSuccess(null);

    try {
      const defaults = getDefaultUserPreferences();
      const next = saveUserPreferences(user.id, defaults);
      setPreferences(next);
      setProfileSuccess("Sohbet tercihleri varsayılanlara döndürüldü.");
    } finally {
      setResettingPreferences(false);
    }
  }, [user]);

  const clearLocalChatData = useCallback(() => {
    if (!user || typeof window === "undefined") return;

    setClearingLocalData(true);
    setProfileError(null);
    setProfileSuccess(null);

    try {
      const keysToDelete: string[] = [];
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (!key) continue;

        const relatedToUser = key.includes(user.id);
        const isChatKey = CHAT_LOCAL_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix));
        if (isChatKey && relatedToUser) {
          keysToDelete.push(key);
        }
      }

      keysToDelete.forEach((key) => window.localStorage.removeItem(key));
      setPreferences(getDefaultUserPreferences());
      setProfileSuccess("Yerel sohbet verileri temizlendi (taslaklar, pinler, tercihler).");
    } finally {
      setClearingLocalData(false);
    }
  }, [user]);

  return (
    <div className="h-full min-h-0 overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-900/45 p-4 md:p-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr),minmax(320px,0.9fr)]">
        <div className="space-y-6">
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4 md:p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                {form.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img alt="Avatar" className="h-16 w-16 rounded-full border border-zinc-700 object-cover" src={form.avatarUrl} />
                ) : (
                  <div className="grid h-16 w-16 place-items-center rounded-full border border-zinc-700 bg-zinc-800 text-lg font-semibold text-zinc-300">
                    {(form.username || "?").slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-zinc-100">{form.fullName || `@${form.username || "kullanici"}`}</p>
                  <p className="text-xs text-zinc-500">{statusLabel}</p>
                  <p className="mt-1 text-[11px] text-zinc-400">Profil tamamlanma: %{profileCompletionRate}</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={avatarInputRef}
                  accept={ALLOWED_AVATAR_MIME_TYPES.join(",")}
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) return;
                    void uploadAvatarFromFile(file);
                  }}
                  type="file"
                />
                <button
                  className={cn(
                    "inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                    avatarUploading
                      ? "border-zinc-700 bg-zinc-800 text-zinc-400"
                      : "border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
                  )}
                  disabled={avatarUploading}
                  onClick={() => avatarInputRef.current?.click()}
                  type="button"
                >
                  {avatarUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
                  Fotoğraf Yükle
                </button>
                {form.avatarUrl ? (
                  <button
                    className="inline-flex items-center gap-2 rounded-lg border border-red-800/70 bg-red-950/30 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-950/50"
                    onClick={() => {
                      setForm((prev) => ({ ...prev, avatarUrl: "" }));
                      setProfileSuccess("Profil fotoğrafı kaldırıldı. Kaydetmek için profili güncelle.");
                    }}
                    type="button"
                  >
                    <X className="h-3.5 w-3.5" />
                    Fotoğrafı Kaldır
                  </button>
                ) : null}
              </div>
            </div>

            <div className="mt-4 h-2 rounded-full bg-zinc-800">
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${profileCompletionRate}%` }} />
            </div>
            <p className="mt-2 text-[11px] text-zinc-500">
              Maksimum dosya boyutu: {formatFileSize(MAX_AVATAR_SIZE)}. Desteklenen formatlar: PNG, JPG, WEBP, GIF.
            </p>
          </section>

          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4 md:p-5">
            <h3 className="mb-3 text-sm font-semibold text-zinc-100">Profil Ayarları</h3>
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

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                className={cn(
                  "inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition-colors",
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

              {form.username ? (
                <button
                  className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800"
                  onClick={() => copyToClipboard(form.username, "username")}
                  type="button"
                >
                  {copiedField === "username" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedField === "username" ? "Kopyalandı" : "Kullanıcı adını kopyala"}
                </button>
              ) : null}
            </div>

            {profileError ? <p className="mt-2 text-xs text-red-300">{profileError}</p> : null}
            {profileSuccess ? <p className="mt-2 text-xs text-emerald-300">{profileSuccess}</p> : null}
          </section>

          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4 md:p-5">
            <h3 className="mb-3 text-sm font-semibold text-zinc-100">Sohbet Tercihleri</h3>
            <div className="space-y-2">
              <label className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2">
                <div>
                  <p className="text-sm text-zinc-200">Yazıyor bilgisini göster</p>
                  <p className="text-[11px] text-zinc-500">Karşı tarafın yazdığını görebilirsin.</p>
                </div>
                <input
                  checked={preferences.showTypingIndicator}
                  className="h-4 w-4 rounded"
                  onChange={(event) => updatePreference("showTypingIndicator", event.target.checked)}
                  type="checkbox"
                />
              </label>
              <label className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2">
                <div>
                  <p className="text-sm text-zinc-200">Okundu bilgisi gönder</p>
                  <p className="text-[11px] text-zinc-500">Mesajların okundu durumunu iletir.</p>
                </div>
                <input
                  checked={preferences.sendReadReceipts}
                  className="h-4 w-4 rounded"
                  onChange={(event) => updatePreference("sendReadReceipts", event.target.checked)}
                  type="checkbox"
                />
              </label>
              <label className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2">
                <div>
                  <p className="text-sm text-zinc-200">Yeni mesajda sesli uyarı</p>
                  <p className="text-[11px] text-zinc-500">Desteklenen cihazlarda bildirim sesi çalar.</p>
                </div>
                <input
                  checked={preferences.soundNotifications}
                  className="h-4 w-4 rounded"
                  onChange={(event) => updatePreference("soundNotifications", event.target.checked)}
                  type="checkbox"
                />
              </label>
              <label className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2">
                <div>
                  <p className="text-sm text-zinc-200">Enter ile gönder</p>
                  <p className="text-[11px] text-zinc-500">Shift+Enter ile yeni satır eklenir.</p>
                </div>
                <input
                  checked={preferences.enterToSend}
                  className="h-4 w-4 rounded"
                  onChange={(event) => updatePreference("enterToSend", event.target.checked)}
                  type="checkbox"
                />
              </label>
            </div>
          </section>
        </div>

        <div className="space-y-6">
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4 md:p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <ShieldCheck className="h-4 w-4 text-zinc-300" />
              Bakım ve Güvenlik
            </h3>
            <div className="space-y-2">
              <button
                className={cn(
                  "inline-flex w-full items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800",
                  resettingPreferences && "opacity-70"
                )}
                disabled={resettingPreferences}
                onClick={resetPreferences}
                type="button"
              >
                <span className="inline-flex items-center gap-2">
                  {resettingPreferences ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                  Tercihleri Varsayılana Al
                </span>
                <span className="text-[11px] text-zinc-500">Local</span>
              </button>

              <button
                className={cn(
                  "inline-flex w-full items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800",
                  clearingLocalData && "opacity-70"
                )}
                disabled={clearingLocalData}
                onClick={clearLocalChatData}
                type="button"
              >
                <span className="inline-flex items-center gap-2">
                  {clearingLocalData ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  Yerel Sohbet Verisini Temizle
                </span>
                <span className="text-[11px] text-zinc-500">Taslak/Pin</span>
              </button>

              <button
                className={cn(
                  "inline-flex w-full items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800",
                  refreshingProfile && "opacity-70"
                )}
                disabled={refreshingProfile}
                onClick={async () => {
                  setRefreshingProfile(true);
                  try {
                    await refreshProfile();
                    setProfileSuccess("Profil sunucudan yenilendi.");
                  } finally {
                    setRefreshingProfile(false);
                  }
                }}
                type="button"
              >
                <span className="inline-flex items-center gap-2">
                  {refreshingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                  Profili Yeniden Yükle
                </span>
                <span className="text-[11px] text-zinc-500">Sunucu</span>
              </button>
            </div>
          </section>

          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4 md:p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <UserCircle2 className="h-4 w-4 text-zinc-300" />
              Hesap Bilgileri
            </h3>
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
          </section>

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
    </div>
  );
}
