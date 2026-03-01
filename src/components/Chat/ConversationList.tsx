"use client";

import { Plus, RefreshCcw } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";
import { usePresence } from "@/components/Presence/PresenceProvider";
import { useAuth } from "@/providers/AuthProvider";

type ConversationRow = {
  id: string;
  name: string | null;
  is_group: boolean;
  created_at: string;
  pinned: boolean;
};

type ParticipantRow = {
  conversation_id: string;
  user_id: string;
  profile:
    | {
        id: string;
        username: string | null;
        full_name: string | null;
        avatar_url: string | null;
        status: string | null;
      }
    | {
        id: string;
        username: string | null;
        full_name: string | null;
        avatar_url: string | null;
        status: string | null;
      }[]
    | null;
};

type ConversationItem = {
  id: string;
  title: string;
  subtitle: string | null;
  avatar_url: string | null;
  otherUserId: string | null;
  is_group: boolean;
  lastMessage?: string | null;
  pinned: boolean;
};

export function ConversationList({
  selectedConversationId,
  onSelectConversation
}: {
  selectedConversationId: string | null;
  onSelectConversation: (conversationId: string) => void;
}) {
  const supabase = getSupabaseBrowserClient();
  const { user, profile } = useAuth();
  const { isOnline } = usePresence();

  const [items, setItems] = useState<ConversationItem[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // when the user types a username in the box we may create a new DM
  // if they press Enter or hit the plus button; no separate input needed.
  const canCreate = Boolean(profile?.username);

  const refresh = useCallback(async () => {
    if (!user) return;
    setError(null);
    setLoading(true);

    const { data: myParticipantRows, error: myParticipantError } = await supabase
      .from("participants")
      .select("conversation_id")
      .eq("user_id", user.id);

    if (myParticipantError) {
      setError(myParticipantError.message);
      setLoading(false);
      return;
    }

    const conversationIds = (myParticipantRows ?? []).map((r) => r.conversation_id);
    if (conversationIds.length === 0) {
      setItems([]);
      setLoading(false);
      return;
    }

    const [{ data: conversations, error: conversationsError }, { data: participants, error: participantsError }, { data: lastMsgs }] =
      await Promise.all([
        supabase
          .from("conversations")
          .select("id, name, is_group, created_at, pinned")
          .in("id", conversationIds)
          .order("pinned", { ascending: false })
          .order("created_at", { ascending: false }),
        supabase
          .from("participants")
          .select("conversation_id, user_id, profile:profiles(id, username, full_name, avatar_url, status)")
          .in("conversation_id", conversationIds),
        supabase
          .from("messages")
          .select("conversation_id, content, sender_id, created_at")
          .in("conversation_id", conversationIds)
          .order("created_at", { ascending: false })
      ]);

    if (conversationsError || participantsError) {
      setError(conversationsError?.message ?? participantsError?.message ?? "Bilinmeyen hata");
      setLoading(false);
      return;
    }

    const participantsByConversation = new Map<string, ParticipantRow[]>();
    (participants as ParticipantRow[] | null | undefined)?.forEach((p) => {
      const list = participantsByConversation.get(p.conversation_id) ?? [];
      list.push(p);
      participantsByConversation.set(p.conversation_id, list);
    });

    const lastMap = new Map<string, { content: string; sender_id: string }>();
    (lastMsgs as {conversation_id: string; content: string; sender_id: string}[] | null | undefined)?.forEach((lm) => {
      if (!lastMap.has(lm.conversation_id)) {
        lastMap.set(lm.conversation_id, { content: lm.content, sender_id: lm.sender_id });
      }
    });
    const nextItems: ConversationItem[] = (conversations as ConversationRow[] | null | undefined)?.map((c) => {
      const participantList = participantsByConversation.get(c.id) ?? [];
      const other = participantList.find((p) => p.user_id !== user.id);

      const otherProfile = other?.profile
        ? Array.isArray(other.profile)
          ? other.profile[0] ?? null
          : other.profile
        : null;

      const title = c.is_group
        ? c.name || "Grup Sohbeti"
        : otherProfile?.username || otherProfile?.full_name || "DM";
      const subtitle = c.is_group ? null : otherProfile?.full_name ?? null;

      return {
        id: c.id,
        title,
        subtitle,
        avatar_url: otherProfile?.avatar_url ?? null,
        otherUserId: c.is_group ? null : other?.user_id ?? null,
        is_group: c.is_group,
        lastMessage: (() => {
          const last = lastMap.get(c.id);
          if (!last) return null;
          const who = last.sender_id === user.id ? "Sen: " : "";
          let txt = last.content || "";
          if (txt.length > 30) txt = txt.slice(0, 29) + "…";
          return who + txt;
        })(),
        pinned: c.pinned
      };
    }) ?? [];

    setItems(nextItems);
    setLoading(false);
  }, [supabase, user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectedItem = useMemo(
    () => items.find((i) => i.id === selectedConversationId) ?? null,
    [items, selectedConversationId]
  );

  const createDirectConversation = async (username: string) => {
    if (!user) {
      setError("Önce giriş yapmalısınız.");
      return;
    }

    const { data: sessData } = await supabase.auth.getSession();
    if (!sessData.session) {
      setError("Oturumunuz geçersiz, lütfen tekrar giriş yapın.");
      return;
    }
    if (sessData.session.access_token) {
      await supabase.auth.setSession({
        access_token: sessData.session.access_token,
        refresh_token: sessData.session.refresh_token || ""
      });
    }

    if (!profile?.username) {
      setError("Önce kullanıcı adını ayarla.");
      return;
    }

    const target = username.trim().toLowerCase();
    if (!target) {
      setError("Kullanıcı adı gerekli.");
      return;
    }

    const { data: otherUsers, error: otherError } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", target);
    if (otherError) {
      setError(otherError.message);
      return;
    }
    const other = otherUsers && otherUsers[0];
    if (!other) {
      setError("Kullanıcı bulunamadı.");
      return;
    }
    if (other.id === user.id) {
      setError("Kendinle sohbet başlatamazsın.");
      return;
    }

    const { data: conv } = await supabase
      .from("conversations")
      .insert({ is_group: false })
      .select("id")
      .single();
    const conversationId = conv?.id;

    const { error: inviteError } = await supabase
      .from("participants")
      .insert({ conversation_id: conversationId, user_id: other.id });
    if (inviteError) {
      setError(inviteError.message);
      return;
    }

    await refresh();
    onSelectConversation(conversationId!);
  };

  // derive filtered list
  const shown = items.filter((i) =>
    i.title.toLowerCase().includes(filter.trim().toLowerCase())
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <input
          className="flex-1 rounded-lg border bg-zinc-900 px-3 py-2 text-sm outline-none placeholder:text-zinc-500 focus:ring-2 focus:ring-zinc-700"
          placeholder="Ara veya DM başlat..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && filter.trim()) {
              e.preventDefault();
              if (canCreate) {
                void createDirectConversation(filter);
                setFilter("");
              } else {
                setError("Önce kullanıcı adını ayarlayın.");
              }
            }
          }}
        />
        <button
          className="inline-flex items-center justify-center rounded-lg border bg-zinc-900 px-3 py-2 text-sm font-medium hover:bg-zinc-800"
          onClick={() => {
            if (filter.trim()) {
              if (canCreate) {
                void createDirectConversation(filter);
                setFilter("");
              } else {
                setError("Önce kullanıcı adını ayarlayın.");
              }
            } else {
              document.querySelector('input')?.focus();
            }
          }}
          type="button"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">Konuşmalar</p>
          {selectedItem ? (
            <p className="truncate text-xs text-zinc-400">{selectedItem.title}</p>
          ) : (
            <p className="truncate text-xs text-zinc-500">Bir konuşma seç</p>
          )}
        </div>
        <button
          className={cn(
            "inline-flex items-center gap-2 rounded-lg border bg-zinc-900 px-3 py-2 text-xs font-medium hover:bg-zinc-800",
            loading && "opacity-60"
          )}
          disabled={loading}
          onClick={() => void refresh()}
          type="button"
        >
          <RefreshCcw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Yenile
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <p className="px-2 py-3 text-sm text-zinc-400">Yükleniyor…</p>
        ) : error ? (
          <p className="px-2 py-3 text-sm text-red-200">{error}</p>
        ) : items.length === 0 ? (
          <p className="px-2 py-3 text-sm text-zinc-400">Henüz konuşma yok.</p>
        ) : (
          <ul className="space-y-1">
            {shown.map((item) => {
              const selected = item.id === selectedConversationId;
              const online = item.otherUserId ? isOnline(item.otherUserId) : false;
              return (
                <li key={item.id}>
                  <button
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left hover:bg-zinc-900/60",
                      selected ? "bg-zinc-900/70 border-zinc-700" : "bg-transparent"
                    )}
                    onClick={() => onSelectConversation(item.id)}
                    type="button"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="relative h-9 w-9 shrink-0">
                        {item.avatar_url ? (
                          <img
                            src={item.avatar_url}
                            alt="avatar"
                            className="h-9 w-9 rounded-full object-cover border"
                            onError={(e) => {
                              console.warn("avatar load failed", item.avatar_url, e);
                              // keep src so browser may show default broken icon;
                              // fallback placeholder will show via CSS if needed
                            }}
                            onLoad={() => {
                              console.debug("avatar loaded", item.avatar_url);
                            }}
                          />
                        ) : (
                          <div className="grid h-9 w-9 place-items-center rounded-full border bg-zinc-900/60 text-xs font-semibold text-zinc-200">
                            {item.title.slice(0, 1).toUpperCase()}
                          </div>
                        )}
                        {item.otherUserId ? (
                          <span
                            aria-label={online ? "online" : "offline"}
                            className={cn(
                              "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border border-zinc-950",
                              online ? "bg-emerald-400" : "bg-zinc-600"
                            )}
                          />
                        ) : null}
                      </div>

                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium flex items-center gap-1">
                          {item.title}
                          {item.pinned && <span title="Sabit" className="text-xs text-yellow-400">📌</span>}
                        </p>
                        {item.subtitle ? (
                          <p className="truncate text-xs text-zinc-400">{item.subtitle}</p>
                        ) : (
                          <p className="truncate text-xs text-zinc-500">{item.is_group ? "Grup" : "Direkt mesaj"}</p>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        const { error } = await supabase
                          .from("conversations")
                          .update({ pinned: !item.pinned })
                          .eq("id", item.id);
                        if (error) console.warn("pin toggle failed", error);
                        else await refresh();
                      }}
                      className="text-xs text-zinc-500 hover:text-zinc-300"
                      title={item.pinned ? "Çöz" : "Sabitle"}
                    >
                      {item.pinned ? "🔓" : "📌"}
                    </button>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
