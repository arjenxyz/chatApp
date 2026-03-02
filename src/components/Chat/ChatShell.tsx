"use client";

import { LogOut } from "lucide-react";
import React, { useEffect, useState } from "react";

import { ChatWindow } from "@/components/Chat/ChatWindow";
import { ConversationList } from "@/components/Chat/ConversationList";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/AuthProvider";

const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;

export function ChatShell() {
  const supabase = getSupabaseBrowserClient();
  const { user, profile, signOut, refreshProfile } = useAuth();

  const isMobile = useMediaQuery("(max-width: 767px)");
  const [mobileViewportHeight, setMobileViewportHeight] = useState<number | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [showConversationListOnMobile, setShowConversationListOnMobile] = useState(true);

  const [username, setUsername] = useState(profile?.username ?? "");
  const [savingUsername, setSavingUsername] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);

  useEffect(() => {
    setUsername(profile?.username ?? "");
  }, [profile?.username]);

  useEffect(() => {
    if (!isMobile) return;
    if (!selectedConversationId) setShowConversationListOnMobile(true);
  }, [isMobile, selectedConversationId]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const root = document.documentElement;
    const body = document.body;
    root.classList.add("chat-shell-lock");
    body.classList.add("chat-shell-lock");

    return () => {
      root.classList.remove("chat-shell-lock");
      body.classList.remove("chat-shell-lock");
    };
  }, []);

  useEffect(() => {
    if (!isMobile || typeof window === "undefined") {
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
  }, [isMobile]);

  const showUsernameSetup = Boolean(user && profile && !profile.username);

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
      className={cn("mx-auto flex w-full max-w-6xl flex-col overflow-hidden px-3 py-3 md:px-6 md:py-5", isMobile ? "h-[100dvh]" : "h-screen")}
      style={isMobile && mobileViewportHeight ? { height: `${mobileViewportHeight}px` } : undefined}
    >
      <header className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 shadow-sm backdrop-blur">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-wide text-zinc-100">Chat Workspace</p>
          <p className="truncate text-xs text-zinc-500">
            {profile?.username ? `@${profile.username}` : user?.email ?? "Hesap"}
          </p>
        </div>
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
      </header>

      {showUsernameSetup ? (
        <section className="mt-3 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
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
              disabled={savingUsername}
              onClick={() => void saveUsername()}
              type="button"
            >
              Kaydet
            </button>
          </div>
          {usernameError ? <p className="mt-2 text-xs text-red-300">{usernameError}</p> : null}
        </section>
      ) : null}

      <section className="mt-3 grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-[320px,1fr]">
        <aside
          className={cn(
            "min-h-0 rounded-2xl border border-zinc-800 bg-zinc-900/45",
            isMobile && !showConversationListOnMobile && selectedConversationId ? "hidden" : "block"
          )}
        >
          <ConversationList
            onSelectConversation={(id) => {
              setSelectedConversationId(id);
              if (isMobile) setShowConversationListOnMobile(false);
            }}
            selectedConversationId={selectedConversationId}
          />
        </aside>

        <section
          className={cn(
            "min-h-0 rounded-2xl border border-zinc-800 bg-zinc-900/45",
            isMobile && showConversationListOnMobile ? "hidden" : "block"
          )}
        >
          <ChatWindow
            conversationId={selectedConversationId}
            onBack={
              isMobile
                ? () => {
                    setShowConversationListOnMobile(true);
                    setSelectedConversationId(null);
                  }
                : undefined
            }
          />
        </section>
      </section>
    </main>
  );
}
