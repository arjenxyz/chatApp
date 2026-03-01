"use client";

import { LogOut } from "lucide-react";
import React, { useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { useAuth } from "@/providers/AuthProvider";

import { ChatWindow } from "./ChatWindow";
import { ConversationList } from "./ConversationList";

export function ChatShell() {
  const supabase = getSupabaseBrowserClient();
  const { user, profile, signOut, refreshProfile } = useAuth();
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  // mobile-only flag which toggles showing the list when a chat is open
  const [showList, setShowList] = useState(true);

  const isMobile = useMediaQuery("(max-width: 767px)");
  const [savingUsername, setSavingUsername] = useState(false);
  const [username, setUsername] = useState(profile?.username ?? "");
  const [usernameError, setUsernameError] = useState<string | null>(null);

  const showUsernameSetup = Boolean(user && profile && !profile.username);

  // split mobile/desktop markup for easier styling
  if (isMobile) {
    return (
      <main className="flex h-screen w-screen flex-col bg-zinc-950">
        {/* header only when not inside a conversation */}
        {!selectedConversationId && (
          <header className="flex items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-900/40 px-4 py-3">
            <p className="text-sm font-medium">Sohbetler</p>
            <button
              className="inline-flex items-center justify-center rounded-lg p-1 hover:bg-zinc-800/50"
              onClick={async () => await signOut()}
              type="button"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </header>
        )}

        <div className="relative flex-1 overflow-hidden">
          {/* conversation list either full-screen or hidden when a chat is open and
              showList is false. */}
          {(showList || !selectedConversationId) && (
            <div className="absolute inset-0 bg-zinc-950">
                  <ConversationList
                onSelectConversation={(id) => {
                  setSelectedConversationId(id);
                  setShowList(false);
                }}
                selectedConversationId={selectedConversationId}
              />
            </div>
          )}

          {selectedConversationId && (
            <div className="absolute inset-0">
              <ChatWindow
                conversationId={selectedConversationId}
                onBack={() => {
                  setSelectedConversationId(null);
                  setShowList(true);
                }}
              />
            </div>
          )}
        </div>
        {/* bottom navigation bar for mobile, hide when inside chat */}
        {!selectedConversationId && (
          <footer className="flex justify-around border-t border-zinc-800 bg-zinc-900/40 p-2">
          <button
            className="flex flex-col items-center text-xs"
            onClick={() => {
              setSelectedConversationId(null);
              setShowList(true);
            }}
            type="button"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8s-9-3.582-9-8 4.03-8 9-8 9 3.582 9 8z" />
            </svg>
            Sohbetler
          </button>
          <button
            className="flex flex-col items-center text-xs"
            onClick={async () => await signOut()}
            type="button"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7" />
            </svg>
            Çıkış
          </button>
        </footer>
        )}
      </main>
    );
  }

  return (
    <main className="mx-auto flex h-screen max-w-5xl flex-col px-4 py-6 md:px-6">
      <header className="flex items-center justify-between gap-3 rounded-lg border bg-zinc-900/40 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">Chat</p>
          {/* only show a short identifier that isn’t the user’s email; prefer username */}
          {profile?.username ? (
            <p className="truncate text-xs text-zinc-400">@{profile.username}</p>
          ) : (
            // if no username yet, don’t render the email at all – keeps mobile header clean
            <p className="truncate text-xs text-zinc-400">&nbsp;</p>
          )}
        </div>
        <button
          className="inline-flex items-center gap-2 rounded-lg border bg-zinc-900 px-3 py-2 text-sm font-medium hover:bg-zinc-800"
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
        <section className="mt-4 rounded-lg border bg-zinc-900/40 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="flex-1 space-y-1">
              <p className="text-sm font-medium">Kullanıcı adını belirle</p>
              <p className="text-xs text-zinc-400">
                Direkt mesaj başlatmak için kullanıcı adı gerekiyor.
              </p>
              <input
                className="w-full rounded-lg border bg-zinc-900 px-3 py-2 text-sm outline-none placeholder:text-zinc-500 focus:ring-2 focus:ring-zinc-700"
                onChange={(e) => setUsername(e.target.value)}
                placeholder="ornek: ali"
                value={username}
              />
              {usernameError ? (
                <p className="text-xs text-red-300">{usernameError}</p>
              ) : (
                <p className="text-xs text-zinc-500">Sadece harf/rakam/altçizgi önerilir.</p>
              )}
            </div>
            <button
              className={cn(
                "rounded-lg border bg-zinc-900 px-3 py-2 text-sm font-medium hover:bg-zinc-800",
                savingUsername && "opacity-60"
              )}
              disabled={savingUsername}
              onClick={async () => {
                if (!user) return;
                setUsernameError(null);

                const next = username.trim().toLowerCase();
                if (!next) {
                  setUsernameError("Kullanıcı adı gerekli.");
                  return;
                }
                if (!/^[a-z0-9_]{3,20}$/.test(next)) {
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
              }}
              type="button"
            >
              Kaydet
            </button>
          </div>
        </section>
      ) : null}

      <section className="mt-4 flex min-h-0 flex-1 flex-col gap-4 md:flex-row">
        <aside
          className={cn(
            "h-full w-full flex-1 rounded-lg border bg-zinc-900/30 md:w-80 md:flex-none",
            selectedConversationId ? "hidden md:block" : "block"
          )}
        >
          <ConversationList
            onSelectConversation={(id) => setSelectedConversationId(id)}
            selectedConversationId={selectedConversationId}
          />
        </aside>

        <section
          className={cn(
            "h-full flex-1 rounded-lg border bg-zinc-900/30",
            selectedConversationId ? "block" : "hidden md:block"
          )}
        >
          <ChatWindow conversationId={selectedConversationId} onBack={() => setSelectedConversationId(null)} />
        </section>
      </section>
    </main>
  );
}