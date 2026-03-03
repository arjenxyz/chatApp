"use client";

import { BellRing, CloudOff, LogOut, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import React, { useCallback, useEffect, useState } from "react";

import { ChatWindow } from "@/components/Chat/ChatWindow";
import { ConversationList } from "@/components/Chat/ConversationList";
import { BottomTabNavigation } from "@/components/Chat/BottomTabNavigation";
import { SettingsPanel } from "@/components/Chat/SettingsPanel";
import { GroupsPanel } from "@/components/Chat/GroupsPanel";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/AuthProvider";

type Tab = "conversations" | "groups" | "settings";

const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;

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

export function ChatShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = getSupabaseBrowserClient();
  const { user, profile, signOut, refreshProfile } = useAuth();

  const isMobile = useMediaQuery("(max-width: 767px)");
  const [mobileViewportHeight, setMobileViewportHeight] = useState<number | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [isPWA, setIsPWA] = useState(false);
  const [isNetworkOnline, setIsNetworkOnline] = useState(true);
  const [installPromptEvent, setInstallPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("conversations");

  const [username, setUsername] = useState(profile?.username ?? "");
  const [savingUsername, setSavingUsername] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);

  const [pushSupported, setPushSupported] = useState(false);
  const [pushPermission, setPushPermission] = useState<NotificationPermission>("default");
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [pushPromptDismissed, setPushPromptDismissed] = useState(false);

  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const urlConversationId = searchParams.get("conversation");

  useEffect(() => {
    setUsername(profile?.username ?? "");
  }, [profile?.username]);

  const getPushPromptDismissStorageKey = useCallback(() => {
    if (!user) return null;
    return `chat.pushPromptDismissed.${user.id}`;
  }, [user]);

  const persistPushPromptDismissed = useCallback(
    (dismissed: boolean) => {
      setPushPromptDismissed(dismissed);
      if (typeof window === "undefined") return;

      const key = getPushPromptDismissStorageKey();
      if (!key) return;

      if (dismissed) {
        window.localStorage.setItem(key, "1");
        return;
      }

      window.localStorage.removeItem(key);
    },
    [getPushPromptDismissStorageKey]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const key = getPushPromptDismissStorageKey();
    if (!key) {
      setPushPromptDismissed(false);
      return;
    }

    setPushPromptDismissed(window.localStorage.getItem(key) === "1");
  }, [getPushPromptDismissStorageKey]);

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

    if (process.env.NODE_ENV !== "production") {
      setPushSupported(false);
      setPushEnabled(false);
      setPushPermission("default");
      setPushError(null);
      return;
    }

    if (!isMobile) {
      setPushSupported(false);
      setPushEnabled(false);
      return;
    }

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
  }, [isMobile]);

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
    if (!urlConversationId) return;
    setSelectedConversationId(urlConversationId);
    setActiveTab("conversations");
  }, [urlConversationId]);

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

  const waitForActiveServiceWorker = useCallback(
    async (registration: ServiceWorkerRegistration): Promise<ServiceWorkerRegistration> => {
      if (registration.active) return registration;

      const worker = registration.installing ?? registration.waiting;
      if (worker) {
        await new Promise<void>((resolve, reject) => {
          const onStateChange = () => {
            if (worker.state === "activated") {
              worker.removeEventListener("statechange", onStateChange);
              resolve();
              return;
            }

            if (worker.state === "redundant") {
              worker.removeEventListener("statechange", onStateChange);
              reject(new Error("Service Worker kurulumunda hata oluştu."));
            }
          };

          worker.addEventListener("statechange", onStateChange);
          onStateChange();
        });
      }

      if (registration.active) return registration;

      const readyRegistration = await navigator.serviceWorker.ready;
      if (readyRegistration.active) return readyRegistration;

      throw new Error("Service Worker aktif değil. Sayfayı yenileyip tekrar dene.");
    },
    []
  );

  const resetServiceWorkersForPush = useCallback(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));

    if (!("caches" in window)) return;
    const cacheKeys = await caches.keys();
    await Promise.all(
      cacheKeys
        .filter((key) => key.startsWith("workbox-"))
        .map((key) => caches.delete(key))
    );
  }, []);

  const registerPushServiceWorker = useCallback(async (): Promise<ServiceWorkerRegistration> => {
    const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    return waitForActiveServiceWorker(registration);
  }, [waitForActiveServiceWorker]);

  const getPushRegistration = useCallback(async (): Promise<ServiceWorkerRegistration> => {
    if (process.env.NODE_ENV !== "production") {
      throw new Error("Push bildirimleri local development ortamında kapalı.");
    }
    if (!("serviceWorker" in navigator)) {
      throw new Error("Service Worker desteklenmiyor.");
    }
    if (!window.isSecureContext) {
      throw new Error("Push sadece HTTPS güvenli bağlamda çalışır.");
    }

    const resolveRegistration = async (): Promise<ServiceWorkerRegistration> => {
      const existing =
        (await navigator.serviceWorker.getRegistration("/")) ??
        (await navigator.serviceWorker.getRegistration());

      if (!existing) {
        return registerPushServiceWorker();
      }

      try {
        await existing.update();
      } catch {
        // no-op
      }

      return waitForActiveServiceWorker(existing);
    };

    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await resolveRegistration();
      } catch (error) {
        lastError = error;

        if (attempt === 0) {
          try {
            await resetServiceWorkersForPush();
          } catch (resetError) {
            console.warn("[push] service worker reset failed:", resetError);
          }
        }
      }
    }

    console.error("[push] service worker register failed:", lastError);
    const message = lastError instanceof Error ? lastError.message : "";
    if (message.toLowerCase().includes("scope")) {
      throw new Error("Service Worker scope hatası. Farklı domain/alt yol kontrol et.");
    }
    throw new Error(
      message
        ? `Push altyapısı hazır değil: ${message}`
        : "Push altyapısı hazır değil. Production/PWA üzerinde tekrar dene."
    );
  }, [registerPushServiceWorker, resetServiceWorkersForPush, waitForActiveServiceWorker]);

  const syncPushSubscription = useCallback(async () => {
    if (!isMobile || !pushSupported || pushPermission !== "granted" || !user) {
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
  }, [getPushRegistration, isMobile, pushPermission, pushSupported, savePushSubscription, user]);

  const enablePushNotifications = useCallback(async () => {
    if (!isMobile || !pushSupported || !user) return;

    setPushError(null);
    setPushBusy(true);

    try {
      const permission = await Notification.requestPermission();
      setPushPermission(permission);

      if (permission !== "granted") {
        setPushEnabled(false);
        return;
      }

      const userAgent = navigator.userAgent.toLowerCase();
      const isAppleMobile = /iphone|ipad|ipod/.test(userAgent);
      if (isAppleMobile && !isPWA) {
        setPushEnabled(false);
        setPushError("iPhone/iPad için uygulamayı Ana Ekran'a ekleyip oradan aç.");
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
      persistPushPromptDismissed(true);
    } catch (error) {
      setPushEnabled(false);
      setPushError(error instanceof Error ? error.message : "Push aktivasyonu başarısız.");
    } finally {
      setPushBusy(false);
    }
  }, [getPushRegistration, isMobile, isPWA, persistPushPromptDismissed, pushSupported, savePushSubscription, user, vapidPublicKey]);

  useEffect(() => {
    void syncPushSubscription();
  }, [syncPushSubscription]);

  const showUsernameSetup = Boolean(user && profile && !profile.username);
  const showPushPrompt =
    isMobile &&
    pushSupported &&
    user &&
    !pushPromptDismissed &&
    (pushPermission !== "granted" || !pushEnabled || Boolean(pushError));
  const isMobileConversationView = isMobile && activeTab === "conversations" && Boolean(selectedConversationId);
  const shouldShowMobileTabs = isMobile && !isMobileConversationView;

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
          "relative grid min-h-0 flex-1 grid-cols-1",
          isPWA ? "gap-0 md:pb-0" : "mt-3 gap-3 md:pb-0 md:grid-cols-[320px,1fr]",
          shouldShowMobileTabs ? "pb-[calc(4.25rem+env(safe-area-inset-bottom))]" : "pb-0",
          isPWA && !isMobile && "md:grid-cols-[320px,1fr]"
        )}
      >
        {showPushPrompt ? (
          <section className="pointer-events-none absolute inset-x-0 top-2 z-30 px-3">
            <div className="pointer-events-auto mx-auto w-full max-w-md rounded-2xl border border-blue-800/70 bg-zinc-950/95 p-3 shadow-2xl backdrop-blur">
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
                    <p className="mt-1 text-xs text-amber-200">
                      Bildirim izni engelli. Cihaz ayarından tekrar izin ver.
                    </p>
                  ) : null}
                  {pushError ? <p className="mt-1 text-xs text-red-200">{pushError}</p> : null}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <button
                    className={cn(
                      "rounded-xl border border-blue-700 bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500",
                      pushBusy && "opacity-60"
                    )}
                    disabled={pushBusy || !isNetworkOnline}
                    onClick={() => void enablePushNotifications()}
                    type="button"
                  >
                    {pushBusy ? "Açılıyor..." : "Aktifleştir"}
                  </button>
                  <button
                    aria-label="Bildirim kutusunu kapat"
                    className="rounded-lg border border-zinc-700 bg-zinc-900/80 p-2 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
                    onClick={() => persistPushPromptDismissed(true)}
                    type="button"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {/* Desktop: Conversations */}
        {!isMobile && activeTab === "conversations" && (
          <>
            <aside
              className={cn(
                "min-h-0",
                isPWA ? "rounded-none border-0 bg-zinc-950" : "rounded-2xl border border-zinc-800 bg-zinc-900/45"
              )}
            >
              <ConversationList
                onSelectConversation={(conversationId) => {
                  setSelectedConversationId(conversationId);
                  syncConversationInUrl(conversationId);
                }}
                selectedConversationId={selectedConversationId}
              />
            </aside>

            <section
              className={cn(
                "min-h-0",
                isPWA ? "rounded-none border-0 bg-zinc-950" : "rounded-2xl border border-zinc-800 bg-zinc-900/45"
              )}
            >
              <ChatWindow
                conversationId={selectedConversationId}
                networkOnline={isNetworkOnline}
                onLeaveConversation={() => {
                  setSelectedConversationId(null);
                  syncConversationInUrl(null);
                  setActiveTab("conversations");
                }}
              />
            </section>
          </>
        )}

        {!isMobile && activeTab === "groups" && (
          <GroupsPanel
            onOpenConversation={(conversationId) => {
              setSelectedConversationId(conversationId);
              syncConversationInUrl(conversationId);
              setActiveTab("conversations");
            }}
          />
        )}

        {!isMobile && activeTab === "settings" && <SettingsPanel />}

        {/* Mobile: Tab-based layout */}
        {isMobile && (
          <>
            {activeTab === "conversations" && !selectedConversationId && (
              <aside
                className={cn(
                  "min-h-0",
                  isPWA ? "rounded-none border-0 bg-zinc-950" : "rounded-2xl border border-zinc-800 bg-zinc-900/45"
                )}
              >
                <ConversationList
                  onSelectConversation={(conversationId) => {
                    setSelectedConversationId(conversationId);
                    syncConversationInUrl(conversationId);
                  }}
                  selectedConversationId={selectedConversationId}
                />
              </aside>
            )}

            {activeTab === "conversations" && selectedConversationId && (
              <section
                className={cn(
                  "min-h-0",
                  isPWA ? "rounded-none border-0 bg-zinc-950" : "rounded-2xl border border-zinc-800 bg-zinc-900/45"
                )}
              >
                <ChatWindow
                  conversationId={selectedConversationId}
                  networkOnline={isNetworkOnline}
                  onBack={() => {
                    setSelectedConversationId(null);
                    syncConversationInUrl(null);
                  }}
                  onLeaveConversation={() => {
                    setSelectedConversationId(null);
                    syncConversationInUrl(null);
                    setActiveTab("conversations");
                  }}
                />
              </section>
            )}

            {activeTab === "groups" && (
              <GroupsPanel
                onOpenConversation={(conversationId) => {
                  setSelectedConversationId(conversationId);
                  syncConversationInUrl(conversationId);
                  setActiveTab("conversations");
                }}
              />
            )}

            {activeTab === "settings" && <SettingsPanel />}
          </>
        )}
      </section>

      {/* Bottom Tab Navigation (Mobile only) */}
      <BottomTabNavigation activeTab={activeTab} mobileHidden={!shouldShowMobileTabs} onTabChange={setActiveTab} />
    </main>
  );
}
