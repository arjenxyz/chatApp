"use client";

import { BellRing, CloudOff, MessageCircle, Settings as SettingsIcon, UserRoundPlus, Users, X, Film } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import React, { useCallback, useEffect, useRef, useState } from "react";

import { ChatWindow } from "@/components/Chat/ChatWindow";
import { ConversationList } from "@/components/Chat/ConversationList";
import { FriendsPanel } from "@/components/Chat/FriendsPanel";
import { BottomTabNavigation } from "@/components/Chat/BottomTabNavigation";
import { SettingsPanel } from "@/components/Chat/SettingsPanel";
import { GroupsPanel } from "@/components/Chat/GroupsPanel";
import { WatchParty } from "./WatchParty";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/AuthProvider";
import type { WatchPartyVideoMeta } from "@/lib/watchParty";

type Tab = "conversations" | "friends" | "groups" | "watch-party" | "settings";

const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;
const BOT_MESSAGE_PREFIX = "[[BOT]]";
const INSTALL_CTA_MARKER = "[[INSTALL_CTA]]";
const SYSTEM_BOT_CONVERSATION_NAME = "Sistem Botu";
const LEGACY_SYSTEM_CONVERSATION_NAME = "Sistem Bildirimleri";
const INSTALL_NOTICE_COOLDOWN_MS = 12 * 60 * 60 * 1000;
const DESKTOP_TABS: Array<{
  id: Tab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: "conversations", label: "Sohbetler", icon: MessageCircle },
  { id: "friends", label: "Arkadaşlar", icon: UserRoundPlus },
  { id: "groups", label: "Gruplar", icon: Users },
  { id: "watch-party", label: "Watch Party", icon: Film },
  { id: "settings", label: "Ayarlar", icon: SettingsIcon }
];

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
  const { user, profile, refreshProfile } = useAuth();

  const isMobile = useMediaQuery("(max-width: 767px)");
  const [mobileViewportHeight, setMobileViewportHeight] = useState<number | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [isPWA, setIsPWA] = useState(false);
  const [isNetworkOnline, setIsNetworkOnline] = useState(true);
  const [installPromptEvent, setInstallPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("conversations");
  const [watchPartyWidth, setWatchPartyWidth] = useState(420);
  const [watchPartyMobilePane, setWatchPartyMobilePane] = useState<"video" | "chat">("video");
  const watchPartyDragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [nowPlayingVideo, setNowPlayingVideo] = useState<{ video: WatchPartyVideoMeta; startedAt: string } | null>(null);
  const [wpBannerDismissed, setWpBannerDismissed] = useState(false);
  const [wpJoining, setWpJoining] = useState(false);
  const [wpJoinError, setWpJoinError] = useState<string | null>(null);
  const [wpRoomCreating, setWpRoomCreating] = useState(false);
  const [watchPartyPickMode, setWatchPartyPickMode] = useState(false);

  const createWatchPartyRoom = useCallback(async () => {
    if (!user) return;
    setWpRoomCreating(true);
    try {
      const conversationId = crypto.randomUUID();
      const roomName = `Watch Party — ${new Date().toLocaleDateString("tr-TR", { day: "2-digit", month: "short", year: "numeric" })}`;
      const { error: convError } = await supabase.from("conversations").insert({
        id: conversationId,
        name: roomName,
        is_group: true,
        owner_id: user.id,
      });
      if (convError) throw convError;
      const { error: partError } = await supabase.from("participants").insert({
        conversation_id: conversationId,
        user_id: user.id,
      });
      if (partError) throw partError;
      setSelectedConversationId(conversationId);
    } catch (err) {
      console.error("[wp] oda oluşturulamadı:", err);
    } finally {
      setWpRoomCreating(false);
    }
  }, [supabase, user]);

  const handleNowPlayingChange = useCallback((video: WatchPartyVideoMeta | null, startedAt: string | null) => {
    setNowPlayingVideo(video && startedAt ? { video, startedAt } : null);
  }, []);

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
  const urlWpId = searchParams.get("wp");

  useEffect(() => {
    setUsername(profile?.username ?? "");
  }, [profile?.username]);

  const getPushPromptDismissStorageKey = useCallback(() => {
    if (!user) return null;
    return `chat.pushPromptDismissed.${user.id}`;
  }, [user]);

  const getInstallNoticeStorageKey = useCallback(() => {
    if (!user) return null;
    return `chat.installNotice.${user.id}`;
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
    if (!urlWpId && activeTab !== "watch-party") {
      setActiveTab("conversations");
    }
  }, [activeTab, urlConversationId, urlWpId]);

  // Reset the WP invite banner whenever the ?wp= param changes
  useEffect(() => {
    if (urlWpId) setWpBannerDismissed(false);
  }, [urlWpId]);

  useEffect(() => {
    if (activeTab !== "groups" && activeTab !== "watch-party" && watchPartyPickMode) {
      setWatchPartyPickMode(false);
    }
  }, [activeTab, watchPartyPickMode]);

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

  const joinWatchPartyViaInvite = useCallback(
    async (conversationId: string): Promise<{ ok: true } | { ok: false; message: string }> => {
      const { data: authData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        return { ok: false, message: sessionError.message };
      }

      const token = authData.session?.access_token;
      if (!token) {
        return { ok: false, message: "Oturum doğrulanamadı. Lütfen tekrar giriş yap." };
      }

      const response = await fetch("/api/watch-party/join", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ conversationId })
      });

      if (!response.ok) {
        let message = "Watch Party odasına katılınamadı.";
        try {
          const body = (await response.json()) as { error?: string };
          if (body?.error) message = body.error;
        } catch {
          // fallback to default message
        }
        return { ok: false, message };
      }

      return { ok: true };
    },
    [supabase]
  );

  const finalizeWatchPartyJoin = useCallback((conversationId: string) => {
    setSelectedConversationId(conversationId);
    setActiveTab("watch-party");
    setWpBannerDismissed(true);
    setWpJoinError(null);
    setWpJoining(false);
    router.replace(`/chat?conversation=${conversationId}`, { scroll: false });
  }, [router]);

  useEffect(() => {
    if (!user || !urlWpId) return;

    let cancelled = false;
    setWpJoinError(null);
    setWpJoining(true);

    void (async () => {
      const result = await joinWatchPartyViaInvite(urlWpId);

      if (cancelled) return;

      if (!result.ok) {
        setWpJoinError(result.message);
        setWpJoining(false);
        return;
      }

      finalizeWatchPartyJoin(urlWpId);
    })();

    return () => {
      cancelled = true;
    };
  }, [finalizeWatchPartyJoin, joinWatchPartyViaInvite, urlWpId, user]);

  const ensureSystemConversation = useCallback(async (): Promise<string> => {
    if (!user) throw new Error("Oturum bulunamadı.");

    const { data: membershipRows, error: membershipError } = await supabase
      .from("participants")
      .select("conversation_id")
      .eq("user_id", user.id);
    if (membershipError) throw new Error(membershipError.message);

    const conversationIds = (membershipRows ?? []).map((row) => row.conversation_id);
    if (conversationIds.length > 0) {
      const { data: existing, error: existingError } = await supabase
        .from("conversations")
        .select("id, name, created_at")
        .in("id", conversationIds)
        .eq("is_group", true)
        .in("name", [SYSTEM_BOT_CONVERSATION_NAME, LEGACY_SYSTEM_CONVERSATION_NAME])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingError) throw new Error(existingError.message);
      if (existing?.id) {
        if (existing.name !== SYSTEM_BOT_CONVERSATION_NAME) {
          const { error: renameError } = await supabase
            .from("conversations")
            .update({ name: SYSTEM_BOT_CONVERSATION_NAME })
            .eq("id", existing.id);
          if (renameError) {
            console.warn("[system-bot] sohbet adı güncellenemedi:", renameError.message);
          }
        }
        return existing.id;
      }
    }

    const conversationId = crypto.randomUUID();
    const { error: conversationError } = await supabase.from("conversations").insert({
      id: conversationId,
      name: SYSTEM_BOT_CONVERSATION_NAME,
      is_group: true,
      owner_id: user.id
    });
    if (conversationError) throw new Error(conversationError.message);

    const { error: joinError } = await supabase.from("participants").insert({
      conversation_id: conversationId,
      user_id: user.id
    });
    if (joinError) throw new Error(joinError.message);

    return conversationId;
  }, [supabase, user]);

  const sendInstallNoticeAsSystemDm = useCallback(async () => {
    if (!user || !installPromptEvent || !isNetworkOnline || typeof window === "undefined") return;

    const storageKey = getInstallNoticeStorageKey();
    if (!storageKey) return;

    const now = Date.now();
    const lastSent = Number(window.localStorage.getItem(storageKey) ?? "0");
    if (Number.isFinite(lastSent) && now - lastSent < INSTALL_NOTICE_COOLDOWN_MS) return;

    try {
      const conversationId = await ensureSystemConversation();
      const message = `${BOT_MESSAGE_PREFIX}${INSTALL_CTA_MARKER}Uygulama kurulum için hazır. Aşağıdaki "Tek Tıkla Kur" butonuna dokunarak devam edebilirsin.`;
      const { error: messageError } = await supabase.from("messages").insert({
        conversation_id: conversationId,
        sender_id: user.id,
        content: message,
        type: "text"
      });
      if (messageError) throw new Error(messageError.message);

      window.localStorage.setItem(storageKey, String(now));
    } catch (noticeError) {
      console.warn("[install-notice] system dm gönderilemedi:", noticeError);
    }
  }, [ensureSystemConversation, getInstallNoticeStorageKey, installPromptEvent, isNetworkOnline, supabase, user]);

  const sendBotSystemMessage = useCallback(
    async (conversationId: string, text: string) => {
      if (!user) return;
      const { error } = await supabase.from("messages").insert({
        conversation_id: conversationId,
        sender_id: user.id,
        content: `${BOT_MESSAGE_PREFIX}${text}`,
        type: "text"
      });
      if (error) throw new Error(error.message);
    },
    [supabase, user]
  );

  const handleInlineInstallFromDm = useCallback(
    async (conversationId: string) => {
      if (!installPromptEvent) {
        await sendBotSystemMessage(
          conversationId,
          "Kurulum isteği şu an hazır değil. Tarayıcı menüsünden 'Uygulamayı Yükle' seçeneğini deneyebilirsin."
        );
        return;
      }

      try {
        await installPromptEvent.prompt();
        const choice = await installPromptEvent.userChoice;
        setInstallPromptEvent(null);

        if (choice.outcome === "accepted") {
          await sendBotSystemMessage(conversationId, "Kurulum başlatıldı. Uygulamayı ana ekranda görebilirsin.");
          return;
        }

        await sendBotSystemMessage(conversationId, "Kurulum kapatıldı. İstersen tekrar 'Tek Tıkla Kur' butonuna bas.");
      } catch (installError) {
        await sendBotSystemMessage(
          conversationId,
          "Kurulum başlatılırken bir hata oluştu. Tarayıcı menüsünden manuel kurulum deneyebilirsin."
        );
        console.warn("[install] inline install error:", installError);
      }
    },
    [installPromptEvent, sendBotSystemMessage]
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

  useEffect(() => {
    if (!installPromptEvent) return;
    void sendInstallNoticeAsSystemDm();
  }, [installPromptEvent, sendInstallNoticeAsSystemDm]);

  const showUsernameSetup = Boolean(user && profile && !profile.username);
  const showPushPrompt =
    isMobile &&
    pushSupported &&
    user &&
    !pushPromptDismissed &&
    (pushPermission !== "granted" || !pushEnabled || Boolean(pushError));
  const isMobileConversationView = isMobile && activeTab === "conversations" && Boolean(selectedConversationId);
  const shouldShowMobileTabs = isMobile && !isMobileConversationView;

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
    <>
    <main
      className={cn(
        "flex w-full max-w-none flex-col overflow-hidden",
        isPWA ? "px-0 py-0" : isMobile ? "px-3 py-3" : "px-4 py-4",
        isMobile || isPWA ? "h-[100dvh]" : "h-screen"
      )}
      style={mobileViewportHeight ? { height: `${mobileViewportHeight}px` } : undefined}
    >
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

      {isMobile ? <BottomTabNavigation activeTab={activeTab} mobileHidden={!shouldShowMobileTabs} onTabChange={setActiveTab} /> : null}

      <section
        className={cn(
          "relative min-h-0 flex-1",
          isMobile
            ? isPWA
              ? "grid grid-cols-1 gap-0"
              : "mt-3 grid grid-cols-1 gap-3"
            : isPWA
              ? "grid grid-cols-[88px,360px,minmax(0,1fr)] gap-3"
              : "mt-3 grid grid-cols-[88px,360px,minmax(0,1fr)] gap-3",
          shouldShowMobileTabs ? "pb-[calc(4.25rem+env(safe-area-inset-bottom))]" : "pb-0"
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

        {!isMobile && (
          <>
            <aside
              className={cn(
                "min-h-0 overflow-hidden",
                isPWA ? "border-r border-zinc-800/80 bg-zinc-950" : "rounded-2xl border border-zinc-800 bg-zinc-900/45"
              )}
            >
              <div className={cn("flex h-full flex-col gap-2", isPWA ? "p-2" : "p-2")}>
                <div className="grid h-14 place-items-center rounded-xl border border-zinc-800 bg-zinc-900/70 text-zinc-100">
                  {profile?.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img alt="Profil" className="h-9 w-9 rounded-full object-cover" src={profile.avatar_url} />
                  ) : (
                    <span className="text-xs font-semibold">{(profile?.username ?? user?.email ?? "U").slice(0, 1).toUpperCase()}</span>
                  )}
                </div>

                <nav className="flex flex-1 flex-col gap-1.5">
                  {DESKTOP_TABS.map((tab) => {
                    const Icon = tab.icon;
                    const active = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        className={cn(
                          "flex flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2 text-[11px] font-medium transition-colors",
                          active
                            ? "border-blue-600/70 bg-blue-600 text-white shadow-sm shadow-blue-950/50"
                            : "border-zinc-800 bg-zinc-900/70 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                        )}
                        onClick={() => setActiveTab(tab.id)}
                        type="button"
                      >
                        <Icon className="h-4 w-4" />
                        <span className="leading-none">{tab.label}</span>
                      </button>
                    );
                  })}
                </nav>
              </div>
            </aside>

            <aside
              className={cn(
                "min-h-0 overflow-hidden",
                activeTab === "watch-party" ? "hidden" : "",
                isPWA ? "border-r border-zinc-800/80 bg-zinc-950" : "rounded-2xl border border-zinc-800 bg-zinc-900/45"
              )}
            >
              <ConversationList
                onSelectConversation={(conversationId) => {
                  setSelectedConversationId(conversationId);
                  syncConversationInUrl(conversationId);
                  setActiveTab("conversations");
                }}
                selectedConversationId={selectedConversationId}
              />
            </aside>

            <section
              className={cn(
                "min-h-0 overflow-hidden",
                activeTab === "watch-party" && "col-start-2 col-span-2",
                activeTab === "conversations" &&
                  (isPWA ? "border-l border-zinc-800/80 bg-zinc-950" : "rounded-2xl border border-zinc-800 bg-zinc-900/45")
              )}
            >
              {/* ALWAYS-MOUNTED: WatchParty stays alive so the iframe/video never stops.
                  Parent hides it with display:none when not on the tab — iframe keeps running. */}
              {selectedConversationId && (
                <div className={cn("flex h-full overflow-hidden", activeTab !== "watch-party" && "hidden")}>
                  {/* Left: WatchParty panel */}
                  <div
                    className={cn(
                      "flex h-full shrink-0 flex-col overflow-hidden",
                      isPWA ? "border-r border-zinc-800/80" : "rounded-l-2xl border border-zinc-800"
                    )}
                    style={{ width: watchPartyWidth }}
                  >
                    <WatchParty
                      conversationId={selectedConversationId}
                      isGroupConversation={true}
                      onNowPlayingChange={handleNowPlayingChange}
                    />
                  </div>

                  {/* Drag handle */}
                  <div
                    className="group relative z-10 w-1.5 shrink-0 cursor-col-resize bg-zinc-800 transition-colors hover:bg-cyan-600/50 active:bg-cyan-600"
                    onMouseDown={(e) => {
                      watchPartyDragRef.current = { startX: e.clientX, startWidth: watchPartyWidth };
                      const onMove = (me: MouseEvent) => {
                        if (!watchPartyDragRef.current) return;
                        const delta = me.clientX - watchPartyDragRef.current.startX;
                        setWatchPartyWidth(Math.max(280, Math.min(720, watchPartyDragRef.current.startWidth + delta)));
                      };
                      const onUp = () => {
                        watchPartyDragRef.current = null;
                        window.removeEventListener("mousemove", onMove);
                        window.removeEventListener("mouseup", onUp);
                      };
                      window.addEventListener("mousemove", onMove);
                      window.addEventListener("mouseup", onUp);
                    }}
                  >
                    <div className="absolute inset-y-0 left-0 right-0 flex flex-col items-center justify-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <span className="h-1 w-1 rounded-full bg-cyan-400" />
                      <span className="h-1 w-1 rounded-full bg-cyan-400" />
                      <span className="h-1 w-1 rounded-full bg-cyan-400" />
                    </div>
                  </div>

                  {/* Right: ChatWindow — only mount when on watch-party tab (no duplicate subscriptions) */}
                  {activeTab === "watch-party" && (
                    <div
                      className={cn(
                        "min-w-0 flex-1 overflow-hidden",
                        isPWA ? "bg-zinc-950" : "rounded-r-2xl border-y border-r border-zinc-800 bg-zinc-900/45"
                      )}
                    >
                      <ChatWindow
                        conversationId={selectedConversationId}
                        networkOnline={isNetworkOnline}
                        canInlineInstall={Boolean(installPromptEvent)}
                        watchPartyMode
                        onInlineInstall={handleInlineInstallFromDm}
                        onLeaveConversation={() => {
                          setSelectedConversationId(null);
                          syncConversationInUrl(null);
                          setActiveTab("conversations");
                        }}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Watch-party empty state */}
              {activeTab === "watch-party" && !selectedConversationId && (
                <div className="flex h-full flex-col items-center justify-center gap-5 px-8 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900">
                    <Film className="h-7 w-7 text-zinc-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-zinc-200">Watch Party Odası Yok</p>
                    <p className="mt-1 text-xs text-zinc-500">Özel bir oda oluştur veya mevcut bir grup sohbeti seç.</p>
                  </div>
                  <button
                    className="inline-flex items-center gap-2 rounded-xl border border-cyan-700/60 bg-cyan-600/20 px-5 py-2.5 text-sm font-semibold text-cyan-100 transition-colors hover:bg-cyan-600/30 disabled:opacity-50"
                    disabled={wpRoomCreating}
                    onClick={() => void createWatchPartyRoom()}
                    type="button"
                  >
                    <Film className="h-4 w-4" />
                    {wpRoomCreating ? "Oluşturuluyor..." : "Oda Oluştur"}
                  </button>
                  <button
                    className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-300"
                    onClick={() => {
                      setWatchPartyPickMode(true);
                      setActiveTab("groups");
                    }}
                    type="button"
                  >
                    Mevcut grup sohbeti seç
                  </button>
                </div>
              )}

              {/* Other tabs */}
              {activeTab === "conversations" ? (
                <ChatWindow
                  conversationId={selectedConversationId}
                  networkOnline={isNetworkOnline}
                  canInlineInstall={Boolean(installPromptEvent)}
                  onInlineInstall={handleInlineInstallFromDm}
                  onLeaveConversation={() => {
                    setSelectedConversationId(null);
                    syncConversationInUrl(null);
                    setActiveTab("conversations");
                  }}
                />
              ) : activeTab === "friends" ? (
                <FriendsPanel
                  onOpenConversation={(conversationId) => {
                    setSelectedConversationId(conversationId);
                    syncConversationInUrl(conversationId);
                    setActiveTab("conversations");
                  }}
                />
              ) : activeTab === "groups" ? (
                <GroupsPanel
                  onOpenConversation={(conversationId) => {
                    setSelectedConversationId(conversationId);
                    syncConversationInUrl(conversationId);
                    if (watchPartyPickMode) {
                      setWatchPartyPickMode(false);
                      setActiveTab("watch-party");
                      return;
                    }
                    setActiveTab("conversations");
                  }}
                />
              ) : activeTab === "settings" ? (
                <SettingsPanel />
              ) : null}
            </section>
          </>
        )}

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
                  canInlineInstall={Boolean(installPromptEvent)}
                  onInlineInstall={handleInlineInstallFromDm}
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
                  if (watchPartyPickMode) {
                    setWatchPartyPickMode(false);
                    setActiveTab("watch-party");
                    return;
                  }
                  setActiveTab("conversations");
                }}
              />
            )}

            {activeTab === "friends" && (
              <FriendsPanel
                onOpenConversation={(conversationId) => {
                  setSelectedConversationId(conversationId);
                  syncConversationInUrl(conversationId);
                  setActiveTab("conversations");
                }}
              />
            )}

            {activeTab === "settings" && <SettingsPanel />}

            {/* Mobile Watch Party */}
            {activeTab === "watch-party" && (
              selectedConversationId ? (
                <section
                  className={cn(
                    "flex min-h-0 flex-col overflow-hidden",
                    isPWA ? "bg-zinc-950" : "rounded-2xl border border-zinc-800 bg-zinc-900/45"
                  )}
                >
                  {/* Toggle bar */}
                  <div className="flex shrink-0 border-b border-zinc-800 bg-zinc-950">
                    <button
                      className={cn(
                        "flex-1 py-2.5 text-xs font-semibold transition-colors",
                        watchPartyMobilePane === "video"
                          ? "border-b-2 border-cyan-500 text-cyan-300"
                          : "text-zinc-400 hover:text-zinc-200"
                      )}
                      onClick={() => setWatchPartyMobilePane("video")}
                      type="button"
                    >
                      Video
                    </button>
                    <button
                      className={cn(
                        "flex-1 py-2.5 text-xs font-semibold transition-colors",
                        watchPartyMobilePane === "chat"
                          ? "border-b-2 border-cyan-500 text-cyan-300"
                          : "text-zinc-400 hover:text-zinc-200"
                      )}
                      onClick={() => setWatchPartyMobilePane("chat")}
                      type="button"
                    >
                      Sohbet
                    </button>
                  </div>

                  <div className="min-h-0 flex-1 overflow-hidden">
                    {/* Always-mounted WatchParty — hidden (not unmounted) when on chat pane */}
                    <div className={cn("h-full", watchPartyMobilePane !== "video" && "hidden")}>
                      <WatchParty
                        conversationId={selectedConversationId}
                        isGroupConversation={true}
                        onNowPlayingChange={handleNowPlayingChange}
                      />
                    </div>
                    {watchPartyMobilePane === "chat" && (
                      <ChatWindow
                        conversationId={selectedConversationId}
                        networkOnline={isNetworkOnline}
                        canInlineInstall={Boolean(installPromptEvent)}
                        watchPartyMode
                        onInlineInstall={handleInlineInstallFromDm}
                        onBack={() => setWatchPartyMobilePane("video")}
                        onLeaveConversation={() => {
                          setSelectedConversationId(null);
                          syncConversationInUrl(null);
                          setActiveTab("conversations");
                        }}
                      />
                    )}
                  </div>
                </section>
              ) : (
                <div className="flex min-h-0 flex-col items-center justify-center gap-5 px-8 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900">
                    <Film className="h-7 w-7 text-zinc-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-zinc-200">Watch Party Odası Yok</p>
                    <p className="mt-1 text-xs text-zinc-500">Özel bir oda oluştur veya mevcut bir grup sohbeti seç.</p>
                  </div>
                  <button
                    className="inline-flex items-center gap-2 rounded-xl border border-cyan-700/60 bg-cyan-600/20 px-5 py-2.5 text-sm font-semibold text-cyan-100 transition-colors hover:bg-cyan-600/30 disabled:opacity-50"
                    disabled={wpRoomCreating}
                    onClick={() => void createWatchPartyRoom()}
                    type="button"
                  >
                    <Film className="h-4 w-4" />
                    {wpRoomCreating ? "Oluşturuluyor..." : "Oda Oluştur"}
                  </button>
                  <button
                    className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-300"
                    onClick={() => {
                      setWatchPartyPickMode(true);
                      setActiveTab("groups");
                    }}
                    type="button"
                  >
                    Mevcut grup sohbeti seç
                  </button>
                </div>
              )
            )}
          </>
        )}
      </section>
    </main>

    {/* ── Floating PiP Now Playing bar ─────────────────────────────────────────
         Shows when a video is playing but the user has navigated away from the
         Watch Party tab. The actual WatchParty iframe is still mounted (hidden),
         so video/audio continues uninterrupted. This bar is just the indicator.
    ────────────────────────────────────────────────────────────────────────── */}
    {/* ── Watch Party invite banner (?wp= URL param) ────────────────────── */}
    {urlWpId && !wpBannerDismissed && (
      <div className="fixed bottom-4 left-1/2 z-[65] w-80 -translate-x-1/2 overflow-hidden rounded-2xl border border-cyan-700/60 bg-zinc-950/95 shadow-2xl backdrop-blur-md">
        <div className="flex items-center gap-3 px-4 py-3">
          <Film className="h-5 w-5 shrink-0 text-cyan-400" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-zinc-100">Watch Party daveti!</p>
            <p className="mt-0.5 truncate text-[11px] text-zinc-400">Bir Watch Party&#39;ye davet edildiniz.</p>
          </div>
          <button
            aria-label="Daveti kapat"
            className="shrink-0 rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            onClick={() => setWpBannerDismissed(true)}
            type="button"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <button
          className="flex w-full items-center justify-center gap-2 border-t border-zinc-800 bg-cyan-600/20 py-2.5 text-xs font-semibold text-cyan-200 transition-colors hover:bg-cyan-600/30 disabled:opacity-60"
          disabled={wpJoining}
          onClick={() => {
            if (!urlWpId) return;
            setWpJoining(true);
            setWpJoinError(null);
            void (async () => {
              const result = await joinWatchPartyViaInvite(urlWpId);
              if (!result.ok) {
                setWpJoinError(result.message);
                setWpJoining(false);
                return;
              }

              finalizeWatchPartyJoin(urlWpId);
            })();
          }}
          type="button"
        >
          <Film className="h-3.5 w-3.5" />
          {wpJoining ? "Katılınıyor..." : "Watch Party\u0027ye Katıl"}
        </button>
        {wpJoinError ? (
          <p className="border-t border-zinc-800 px-3 py-2 text-[11px] text-red-300">{wpJoinError}</p>
        ) : null}
      </div>
    )}

    {nowPlayingVideo && activeTab !== "watch-party" && (
      <div
        className="fixed bottom-4 right-4 z-[60] w-72 overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-950/95 shadow-2xl backdrop-blur-md"
      >
        {/* Video thumbnail + info */}
        <div className="flex items-center gap-2 px-3 py-2.5">
          <div className="relative h-10 w-[4.5rem] shrink-0 overflow-hidden rounded">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt={nowPlayingVideo.video.title}
              className="h-full w-full object-cover"
              src={nowPlayingVideo.video.thumbnailUrl}
            />
            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
              <Film className="h-4 w-4 text-white" />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-zinc-100">{nowPlayingVideo.video.title}</p>
            <p className="truncate text-[11px] text-zinc-400">{nowPlayingVideo.video.channelTitle}</p>
          </div>
          <button
            aria-label="Now Playing çubuğunu kapat"
            className="shrink-0 rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            onClick={() => setNowPlayingVideo(null)}
            type="button"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {/* Return button */}
        <button
          className="flex w-full items-center justify-center gap-1.5 border-t border-zinc-800 bg-zinc-900/80 py-2 text-xs font-semibold text-cyan-300 transition-colors hover:bg-zinc-800 hover:text-cyan-200"
          onClick={() => setActiveTab("watch-party")}
          type="button"
        >
          <Film className="h-3.5 w-3.5" />
          Watch Party&#39;ye dön
        </button>
      </div>
    )}
    </>
  );
}
