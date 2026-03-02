"use client";

import { useEffect, useState } from "react";
import { Check, X, AlertCircle, Loader } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { useAuth } from "@/providers/AuthProvider";
import { cn } from "@/lib/utils";

type PendingSticker = {
  id: string;
  name: string;
  image_url: string;
  created_by: string;
  created_at: string;
  creator_username?: string;
};

export default function StickerModerationPage() {
  const supabase = getSupabaseBrowserClient();
  const { user } = useAuth();

  const [pendingStickers, setPendingStickers] = useState<PendingSticker[]>([]);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [rejectionReason, setRejectionReason] = useState<{ [key: string]: string }>({});

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    checkAdminAccess();
  }, [user, supabase]);

  const checkAdminAccess = async () => {
    if (!user) {
      setIsAdmin(false);
      setLoading(false);
      return;
    }

    try {
      const { data, error: err } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("id", user.id)
        .single();

      console.log("[admin-check] User ID:", user.id);
      console.log("[admin-check] Query error:", err);
      console.log("[admin-check] Query data:", data);
      console.log("[admin-check] is_admin value:", data?.is_admin);
      console.log("[admin-check] is_admin type:", typeof data?.is_admin);

      if (err) {
        console.error("[admin-check] Database error:", err.message);
        setError(`Hata: ${err.message}`);
        setIsAdmin(false);
        setLoading(false);
        return;
      }

      if (!data) {
        console.error("[admin-check] Profil bulunamadı");
        setError("Profil bulunamadı");
        setIsAdmin(false);
        setLoading(false);
        return;
      }

      // is_admin boolean true olmalı
      const adminStatus = data.is_admin === true || data.is_admin === "true" || data.is_admin === 1;
      console.log("[admin-check] Admin status:", adminStatus);

      if (!adminStatus) {
        setIsAdmin(false);
        setLoading(false);
        return;
      }

      setIsAdmin(true);
      await loadPendingStickers();
    } catch (e) {
      console.error("[admin-check] Exception:", e);
      setError(e instanceof Error ? e.message : "Bilinmeyen hata");
      setIsAdmin(false);
      setLoading(false);
    }
  }

  const loadPendingStickers = async () => {
    try {
      setLoading(true);
      const { data, error: err } = await supabase
        .from("stickers")
        .select(
          `
          id,
          name,
          image_url,
          created_by,
          created_at,
          creator:profiles(username)
        `
        )
        .eq("approved", false)
        .order("created_at", { ascending: true });

      if (err) throw err;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const formatted = (data ?? []).map((s: any) => ({
        id: s.id,
        name: s.name,
        image_url: s.image_url,
        created_by: s.created_by,
        created_at: s.created_at,
        creator_username: s.creator?.[0]?.username || "Bilinmeyen Kullanıcı"
      }));

      setPendingStickers(formatted);
    } catch (err) {
      console.error("Sticker yükleme hatası:", err);
      setError("Stickerlar yüklenirken bir hata oluştu");
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (stickerId: string) => {
    try {
      setApproving(stickerId);
      const { error: err } = await supabase
        .from("stickers")
        .update({ approved: true, rejection_reason: null })
        .eq("id", stickerId);

      if (err) throw err;

      setPendingStickers((prev) => prev.filter((s) => s.id !== stickerId));
    } catch (err) {
      console.error("Onaylama hatası:", err);
      setError("Sticker onaylanırken bir hata oluştu");
    } finally {
      setApproving(null);
    }
  };

  const handleReject = async (stickerId: string) => {
    try {
      setRejecting(stickerId);
      const reason = rejectionReason[stickerId] || "İçerik politikamızı ihlal ediyor";
      
      const { error: err } = await supabase
        .from("stickers")
        .update({ rejection_reason: reason })
        .eq("id", stickerId);

      if (err) throw err;

      setPendingStickers((prev) => prev.filter((s) => s.id !== stickerId));
      setRejectionReason((prev) => {
        const newReasons = { ...prev };
        delete newReasons[stickerId];
        return newReasons;
      });
    } catch (err) {
      console.error("Reddetme hatası:", err);
      setError("Sticker reddedilirken bir hata oluştu");
    } finally {
      setRejecting(null);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-zinc-950 p-6 text-zinc-300">
        <div className="rounded-lg border border-red-900/50 bg-red-900/20 p-4">
          <p>Giriş yapmanız gerekiyor</p>
        </div>
      </div>
    );
  }

  if (isAdmin === null) {
    return (
      <div className="min-h-screen bg-zinc-950 p-6 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader className="h-8 w-8 animate-spin text-zinc-400" />
          <p className="text-sm text-zinc-400">Kontrol ediliyor...</p>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-zinc-950 p-6 text-zinc-300">
        <div className="flex items-center justify-center h-screen">
          <div className="rounded-lg border border-red-900/50 bg-red-900/20 p-6 max-w-md text-center">
            <AlertCircle className="h-12 w-12 text-red-300 mx-auto mb-4" />
            <h1 className="text-xl font-semibold text-red-300 mb-2">Yetkisiz Erişim</h1>
            <p className="text-sm text-red-200 mb-4">
              Bu sayfaya erişmek için admin yetkisine sahip olmanız gerekiyor.
            </p>
            {error && (
              <div className="mt-4 p-3 bg-red-900/30 rounded border border-red-800 text-xs text-red-300 text-left">
                <p className="font-mono">{error}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-zinc-100">Sticker Moderasyon</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Onay bekleyen stickerları inceleyin ve onaylayın veya reddedin
          </p>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-red-900/50 bg-red-900/20 p-4 text-red-300 flex items-center gap-2">
            <AlertCircle className="h-5 w-5 shrink-0" />
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="flex flex-col items-center gap-4">
              <Loader className="h-8 w-8 animate-spin text-zinc-400" />
              <p className="text-sm text-zinc-400">Yükleniyor...</p>
            </div>
          </div>
        ) : pendingStickers.length === 0 ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-8 text-center">
            <p className="text-lg font-semibold text-zinc-300">Onay bekleyen sticker yok</p>
            <p className="mt-2 text-sm text-zinc-500">Tüm stickerlar onaylanmış durumda</p>
          </div>
        ) : (
          <div className="grid gap-6">
            {pendingStickers.map((sticker) => (
              <div
                key={sticker.id}
                className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6"
              >
                <div className="flex gap-6">
                  {/* Sticker Preview */}
                  <div className="shrink-0">
                    <div className="h-32 w-32 rounded-lg border border-zinc-700 bg-zinc-900 p-2">
                      <img
                        alt={sticker.name}
                        className="h-full w-full rounded object-contain"
                        src={sticker.image_url}
                      />
                    </div>
                  </div>

                  {/* Sticker Info */}
                  <div className="flex-1">
                    <div className="mb-4">
                      <h3 className="text-lg font-semibold text-zinc-100">{sticker.name}</h3>
                      <p className="mt-1 text-sm text-zinc-400">
                        Yükleyen: <span className="text-zinc-300">{sticker.creator_username}</span>
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        ID: {sticker.id}
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        Tarih: {new Date(sticker.created_at).toLocaleString("tr-TR")}
                      </p>
                    </div>

                    {/* Rejection Reason Input */}
                    {rejecting === sticker.id && (
                      <div className="mb-4">
                        <label className="mb-2 block text-xs font-semibold text-zinc-400">
                          Reddetme Sebebi (Opsiyonel)
                        </label>
                        <textarea
                          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600 outline-none"
                          onChange={(e) =>
                            setRejectionReason((prev) => ({
                              ...prev,
                              [sticker.id]: e.target.value
                            }))
                          }
                          placeholder="Örn: Uygunsuz içerik, Telif hakkı ihlali, vb."
                          rows={2}
                          value={rejectionReason[sticker.id] || ""}
                        />
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex gap-3">
                      <button
                        className={cn(
                          "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                          approving === sticker.id
                            ? "border border-emerald-700/60 bg-emerald-600/20 text-emerald-300"
                            : "border border-emerald-700/60 bg-emerald-600/30 text-emerald-300 hover:bg-emerald-600/40"
                        )}
                        disabled={approving === sticker.id || rejecting === sticker.id}
                        onClick={() => handleApprove(sticker.id)}
                        type="button"
                      >
                        {approving === sticker.id ? (
                          <>
                            <Loader className="h-4 w-4 animate-spin" />
                            Onaylanıyor...
                          </>
                        ) : (
                          <>
                            <Check className="h-4 w-4" />
                            Onayla
                          </>
                        )}
                      </button>

                      <button
                        className={cn(
                          "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                          rejecting === sticker.id
                            ? "border border-red-700/60 bg-red-600/20 text-red-300"
                            : "border border-red-700/60 bg-red-600/20 text-red-300 hover:bg-red-600/30"
                        )}
                        disabled={approving === sticker.id || rejecting === sticker.id}
                        onClick={() =>
                          setRejecting(
                            rejecting === sticker.id ? null : sticker.id
                          )
                        }
                        type="button"
                      >
                        {rejecting === sticker.id ? (
                          <>
                            <X className="h-4 w-4" />
                            İptal
                          </>
                        ) : (
                          <>
                            <X className="h-4 w-4" />
                            Reddet
                          </>
                        )}
                      </button>

                      {rejecting === sticker.id && (
                        <button
                          className="inline-flex items-center gap-2 rounded-lg border border-red-700/60 bg-red-600/30 px-4 py-2 text-sm font-medium text-red-300 transition-colors hover:bg-red-600/40"
                          onClick={() => handleReject(sticker.id)}
                          type="button"
                        >
                          Reddet (Onayla)
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
