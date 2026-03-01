"use client";

import { LogOut } from "lucide-react";
import React, { useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/AuthProvider";

import { ChatWindow } from "./ChatWindow";
import { ConversationList } from "./ConversationList";

export function ChatShell() {
  const supabase = getSupabaseBrowserClient();
  const { user, profile, signOut, refreshProfile } = useAuth();
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [savingUsername, setSavingUsername] = useState(false);
  const [username, setUsername] = useState(profile?.username ?? "");
  const [usernameError, setUsernameError] = useState<string | null>(null);

  const showUsernameSetup = Boolean(user && profile && !profile.username);

  return (
    <main className="mx-auto flex h-screen max-w-5xl flex-col px-4 py-6 md:px-6">
      <header className="flex items-center justify-between gap-3 rounded-lg border bg-zinc-900/40 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">Chat</p>
          <p className="truncate text-xs text-zinc-400">{user?.email ?? user?.id}</p>
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