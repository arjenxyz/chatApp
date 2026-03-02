"use client";

import { BellRing, CloudOff, LogOut } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import React, { useCallback, useEffect, useState } from "react";

import { ChatWindow } from "@/components/Chat/ChatWindow";
import { ConversationList } from "@/components/Chat/ConversationList";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/AuthProvider";

const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;
const SW_READY_TIMEOUT_MS = 10000;

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function base64UrlToArrayBuffer(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = atob(padded);
  const output = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    output[index] = binary.charCodeAt(index);
  }

  return output.buffer;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise
      .then((value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timeoutId);
        reject(error);
      });
  });
}

async function ensureActiveServiceWorker(
  registration: ServiceWorkerRegistration,
  timeoutMessage: string
): Promise<ServiceWorkerRegistration> {
  if (registration.active) return registration;

  try {
    await registration.update();
  } catch {
    // no-op
  }

  if (registration.active) return registration;

  try {
    const readyRegistration = await withTimeout(navigator.serviceWorker.ready, SW_READY_TIMEOUT_MS, timeoutMessage);
    if (readyRegistration.active) return readyRegistration;
  } catch {
    // fall through to final checks
  }

  const refreshed = await navigator.serviceWorker.getRegistration();
  if (refreshed?.active) return refreshed;

  throw new Error(timeoutMessage);
}

export function ChatShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = getSupabaseBrowserClient();
  const { user, profile, signOut, refreshProfile } = useAuth();

  const isMobile = useMediaQuery("(max-width: 767px)");
  const [mobileViewportHeight, setMobileViewportHeight] = useState<number | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [showConversationListOnMobile, setShowConversationListOnMobile] = useState(true);
  const [isPWA, setIsPWA] = useState(false);
  const [isNetworkOnline, setIsNetworkOnline] = useState(true);
  const [installPromptEvent, setInstallPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);

  const [username, setUsername] = useState(profile?.username ?? "");
  const [savingUsername, setSavingUsername] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);

  const [pushSupported, setPushSupported] = useState(false);
  const [pushPermission, setPushPermission] = useState<NotificationPermission>("default");
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);

  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const deepLinkConversationId = searchParams.get("conversation");

  useEffect(() => {
    setUsername(profile?.username ?? "");
  }, [profile?.username]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const media = window.matchMedia("(display-mode: standalone)");
    const checkStandalone = () => {
      const nav = window.navigator as Navigator & { standalone?: boolean };
      const standalone = media.matches || nav.standalone;
      setIsPWA(Boolean(standalone));
    };

    checkStandalone();
    media.addEventListener("change", checkStandalone);

    return () => {
      media.removeEventListener("change", checkStandalone);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPromptEvent(event as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      setInstallPromptEvent(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt as EventListener);
    window.addEventListener("appinstalled", onAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt as EventListener);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    setIsNetworkOnline(navigator.onLine);
    const markOnline = () => setIsNetworkOnline(true);
    const markOffline = () => setIsNetworkOnline(false);

    window.addEventListener("online", markOnline);
    window.addEventListener("offline", markOffline);

    return () => {
      window.removeEventListener("online", markOnline);
      window.removeEventListener("offline", markOffline);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const isTopLevel = window.self === window.top;
    const supported =
      isTopLevel &&
      "Notification" in window &&
      "serviceWorker" in navigator &&
      "PushManager" in window;

    setPushSupported(supported);
    if (supported) {
      setPushPermission(Notification.permission);
    } else if (!isTopLevel) {
      setPushError("Bildirim izni iframe içinde çalışmaz. Uygulamayı doğrudan aç.");
    }
  }, []);

  useEffect(() => {
    if (!isMobile) return;
    if (!selectedConversationId) setShowConversationListOnMobile(true);
  }, [isMobile, selectedConversationId]);

  useEffect(() => {
    if (!deepLinkConversationId) return;
    setSelectedConversationId(deepLinkConversationId);
    if (isMobile) {
      setShowConversationListOnMobile(false);
    }
  }, [deepLinkConversationId, isMobile]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isMobile && !isPWA) return;

    const root = document.documentElement;
    const body = document.body;
    root.classList.add("chat-shell-lock");
    body.classList.add("chat-shell-lock");

    return () => {
      root.classList.remove("chat-shell-lock");
      body.classList.remove("chat-shell-lock");
    };
  }, [isMobile, isPWA]);

  useEffect(() => {
    if ((!isMobile && !isPWA) || typeof window === "undefined") {
      setMobileViewportHeight(null);
      return;
    }

    const vv = window.visualViewport;

    const updateHeight = () => {
      const viewportHeight = Math.round(vv?.height ?? window.innerHeight);
      setMobileViewportHeight(viewportHeight);
    };

    updateHeight();

    vv?.addEventListener("resize", updateHeight);
    vv?.addEventListener("scroll", updateHeight);
    window.addEventListener("resize", updateHeight);
    window.addEventListener("orientationchange", updateHeight);

    return () => {
      vv?.removeEventListener("resize", updateHeight);
      vv?.removeEventListener("scroll", updateHeight);
      window.removeEventListener("resize", updateHeight);
      window.removeEventListener("orientationchange", updateHeight);
    };
  }, [isMobile, isPWA]);

  const syncConversationInUrl = useCallback(
    (nextConversationId: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (nextConversationId) {
        params.set("conversation", nextConversationId);
      } else {
        params.delete("conversation");
      }

      const query = params.toString();
      router.replace(query ? `/chat?${query}` : "/chat", { scroll: false });
    },
    [router, searchParams]
  );

  const savePushSubscription = useCallback(
    async (subscription: PushSubscription) => {
      if (!user) return;

      const payload = subscription.toJSON();
      const endpoint = payload.endpoint;
      const p256dh = payload.keys?.p256dh;
      const auth = payload.keys?.auth;

      if (!endpoint || !p256dh || !auth) {
        throw new Error("Push subscription anahtarları eksik.");
      }

      const { error } = await supabase.from("push_subscriptions").upsert(
        {
          user_id: user.id,
          endpoint,
          p256dh,
          auth,
          user_agent: navigator.userAgent,
          updated_at: new Date().toISOString()
        },
        { onConflict: "endpoint" }
      );

      if (error) throw error;
    },
    [supabase, user]
  );

  const getPushRegistration = useCallback(async (): Promise<ServiceWorkerRegistration> => {
    if (!("serviceWorker" in navigator)) {
      throw new Error("Service Worker desteklenmiyor.");
    }

    const existing = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.getRegistration("/"));
    if (existing) {
      return await ensureActiveServiceWorker(
        existing,
        "Service Worker hazır hale gelmedi. Sayfayı yenileyip tekrar dene."
      );
    }

    try {
      const registered = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      return await ensureActiveServiceWorker(
        registered,
        "Service Worker zaman aşımına uğradı. Sayfayı yenileyip tekrar dene."
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.toLowerCase().includes("scope")) {
        throw new Error("Service Worker scope hatası. Farklı domain/alt yol kontrol et.");
      }
      throw new Error("Push altyapısı hazır değil. Production/PWA üzerinde tekrar dene.");
    }
  }, []);

  const syncPushSubscription = useCallback(async () => {
    if (!pushSupported || pushPermission !== "granted" || !user) {
      setPushEnabled(false);
      return;
    }

    try {
      const registration = await getPushRegistration();
      const existing = await registration.pushManager.getSubscription();

      if (!existing) {
        setPushEnabled(false);
        return;
      }

      await savePushSubscription(existing);
      setPushEnabled(true);
      setPushError(null);
    } catch (error) {
      setPushEnabled(false);
      setPushError(error instanceof Error ? error.message : "Push senkronizasyonu başarısız.");
    }
  }, [getPushRegistration, pushPermission, pushSupported, savePushSubscription, user]);

  const enablePushNotifications = useCallback(async () => {
    if (!pushSupported || !user) return;

    setPushError(null);
    setPushBusy(true);

    try {
      const permission = await Notification.requestPermission();
      setPushPermission(permission);

      if (permission !== "granted") {
        setPushEnabled(false);
        return;
      }

      if (!vapidPublicKey) {
        setPushError("NEXT_PUBLIC_VAPID_PUBLIC_KEY tanımlı değil.");
        return;
      }

      const registration = await getPushRegistration();
      let subscription = await registration.pushManager.getSubscription();

      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToArrayBuffer(vapidPublicKey)
        });
      }

      await savePushSubscription(subscription);
      setPushEnabled(true);
      setPushError(null);
    } catch (error) {
      setPushEnabled(false);
      setPushError(error instanceof Error ? error.message : "Push aktivasyonu başarısız.");
    } finally {
      setPushBusy(false);
    }
  }, [getPushRegistration, pushSupported, savePushSubscription, user, vapidPublicKey]);

  useEffect(() => {
    void syncPushSubscription();
  }, [syncPushSubscription]);

  const showUsernameSetup = Boolean(user && profile && !profile.username);
  const showPushPrompt = pushSupported && user && (pushPermission !== "granted" || !pushEnabled || Boolean(pushError));

  const promptInstall = useCallback(async () => {
    if (!installPromptEvent) return;
    await installPromptEvent.prompt();
    await installPromptEvent.userChoice;
    setInstallPromptEvent(null);
  }, [installPromptEvent]);

  const saveUsername = async () => {
    if (!user) return;

    setUsernameError(null);
    const next = username.trim().toLowerCase();

    if (!next) {
      setUsernameError("Kullanıcı adı gerekli.");
      return;
    }
    if (!USERNAME_REGEX.test(next)) {
      setUsernameError("3-20 karakter: a-z, 0-9, _");
      return;
    }

    setSavingUsername(true);
    try {
      const { error } = await supabase.from("profiles").update({ username: next }).eq("id", user.id);
      if (error) {
        setUsernameError(error.message);
        return;
      }
      await refreshProfile();
    } finally {
      setSavingUsername(false);
    }
  };

  return (
    <main
      className={cn(
        "mx-auto flex w-full flex-col overflow-hidden",
        isPWA ? "max-w-none px-0 py-0" : "max-w-6xl px-3 py-3 md:px-6 md:py-5",
        isMobile || isPWA ? "h-[100dvh]" : "h-screen"
      )}
      style={mobileViewportHeight ? { height: `${mobileViewportHeight}px` } : undefined}
    >
      {!isPWA ? (
        <header className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 shadow-sm backdrop-blur">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-wide text-zinc-100">Chat Workspace</p>
            <p className="truncate text-xs text-zinc-500">
              {profile?.username ? `@${profile.username}` : user?.email ?? "Hesap"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {installPromptEvent ? (
              <button
                className="inline-flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-800"
                onClick={() => void promptInstall()}
                type="button"
              >
                Kur
              </button>
            ) : null}
            <button
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-800"
              onClick={async () => {
                await signOut();
              }}
              type="button"
            >
              <LogOut className="h-4 w-4" />
              Çıkış
            </button>
          </div>
        </header>
      ) : null}

      {!isNetworkOnline ? (
        <section
          className={cn(
            "rounded-xl border border-amber-900/70 bg-amber-950/50 px-3 py-2 text-xs text-amber-200",
            isPWA ? "m-3 mb-0" : "mt-3"
          )}
        >
          <p className="flex items-center gap-2">
            <CloudOff className="h-3.5 w-3.5" />
            Bağlantı yok. Mesaj gönderme ve senkronizasyon geçici olarak durabilir.
          </p>
        </section>
      ) : null}

      {showPushPrompt ? (
        <section
          className={cn(
            "rounded-2xl border border-blue-900/60 bg-blue-950/30 p-3",
            isPWA ? "m-3 mb-0" : "mt-3"
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium text-blue-200">
                <BellRing className="h-4 w-4 shrink-0" />
                Mobil bildirimleri aç
              </p>
              <p className="mt-1 text-xs text-blue-100/80">
                Uygulama kapalıyken yeni mesajlardan anında haberdar olursun.
              </p>
              {pushPermission === "denied" ? (
                <p className="mt-1 text-xs text-amber-200">Bildirim izni engelli. Cihaz ayarından tekrar izin ver.</p>
              ) : null}
              {pushError ? <p className="mt-1 text-xs text-red-200">{pushError}</p> : null}
            </div>

            <button
              className={cn(
                "shrink-0 rounded-xl border border-blue-700 bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500",
                pushBusy && "opacity-60"
              )}
              disabled={pushBusy || !isNetworkOnline}
              onClick={() => void enablePushNotifications()}
              type="button"
            >
              {pushBusy ? "Açılıyor..." : "Aktifleştir"}
            </button>
          </div>
        </section>
      ) : null}

      {showUsernameSetup ? (
        <section className={cn("rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4", isPWA ? "m-3 mb-0" : "mt-3")}>
          <p className="text-sm font-semibold text-zinc-100">Kullanıcı adını belirle</p>
          <p className="mt-1 text-xs text-zinc-500">Direkt mesaj başlatmak için kullanıcı adı gerekli.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-zinc-700"
              onChange={(event) => setUsername(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                event.preventDefault();
                void saveUsername();
              }}
              placeholder="ornek: ali"
              value={username}
            />
            <button
              className={cn(
                "rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-800",
                savingUsername && "opacity-60"
              )}
              disabled={savingUsername || !isNetworkOnline}
              onClick={() => void saveUsername()}
              type="button"
            >
              Kaydet
            </button>
          </div>
          {usernameError ? <p className="mt-2 text-xs text-red-300">{usernameError}</p> : null}
        </section>
      ) : null}

      <section
        className={cn(
          "grid min-h-0 flex-1 grid-cols-1",
          isPWA ? "gap-0" : "mt-3 gap-3 md:grid-cols-[320px,1fr]",
          isPWA && !isMobile && "md:grid-cols-[320px,1fr]"
        )}
      >
        <aside
          className={cn(
            "min-h-0",
            isPWA ? "rounded-none border-0 bg-zinc-950" : "rounded-2xl border border-zinc-800 bg-zinc-900/45",
            isMobile && !showConversationListOnMobile && selectedConversationId ? "hidden" : "block"
          )}
        >
          <ConversationList
            onSelectConversation={(conversationId) => {
              setSelectedConversationId(conversationId);
              syncConversationInUrl(conversationId);
              if (isMobile) setShowConversationListOnMobile(false);
            }}
            selectedConversationId={selectedConversationId}
          />
        </aside>

        <section
          className={cn(
            "min-h-0",
            isPWA ? "rounded-none border-0 bg-zinc-950" : "rounded-2xl border border-zinc-800 bg-zinc-900/45",
            isMobile && showConversationListOnMobile ? "hidden" : "block"
          )}
        >
          <ChatWindow
            conversationId={selectedConversationId}
            networkOnline={isNetworkOnline}
            onBack={
              isMobile
                ? () => {
                    setShowConversationListOnMobile(true);
                    setSelectedConversationId(null);
                    syncConversationInUrl(null);
                  }
                : undefined
            }
          />
        </section>
      </section>
    </main>
  );
}
