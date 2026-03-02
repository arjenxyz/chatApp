"use client";

import { Loader2, MessageSquareText, Plus, RefreshCcw, Search } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { usePresence } from "@/components/Presence/PresenceProvider";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/AuthProvider";

type ConversationRow = {
  id: string;
  name: string | null;
  is_group: boolean;
  created_at: string;
};

type ProfileRow = {
  id: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  status: string | null;
};

type ParticipantRow = {
  conversation_id: string;
  user_id: string;
  profile: ProfileRow | ProfileRow[] | null;
};

type LastMessageRow = {
  conversation_id: string;
  content: string;
  sender_id: string;
  created_at: string;
};

type ConversationItem = {
  id: string;
  title: string;
  subtitle: string;
  isGroup: boolean;
  otherUserId: string | null;
  avatarUrl: string | null;
  lastMessage: string | null;
  createdAt: string;
};

const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;

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
  const [search, setSearch] = useState("");
  const [newDmUsername, setNewDmUsername] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const dmInputRef = useRef<HTMLInputElement | null>(null);
  const canCreate = Boolean(profile?.username);

  const refresh = useCallback(async () => {
    if (!user) return;

    setError(null);
    setLoading(true);

    const { data: myRows, error: myRowsError } = await supabase
      .from("participants")
      .select("conversation_id")
      .eq("user_id", user.id);

    if (myRowsError) {
      setError(myRowsError.message);
      setLoading(false);
      return;
    }

    const conversationIds = (myRows ?? []).map((row) => row.conversation_id);
    if (conversationIds.length === 0) {
      setItems([]);
      setLoading(false);
      return;
    }

    const [
      { data: conversations, error: conversationsError },
      { data: participants, error: participantsError },
      { data: lastMessages, error: lastMessagesError }
    ] = await Promise.all([
      supabase
        .from("conversations")
        .select("id, name, is_group, created_at")
        .in("id", conversationIds)
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

    if (conversationsError || participantsError || lastMessagesError) {
      setError(conversationsError?.message ?? participantsError?.message ?? lastMessagesError?.message ?? "Bilinmeyen hata");
      setLoading(false);
      return;
    }

    const participantsByConversation = new Map<string, ParticipantRow[]>();
    ((participants as ParticipantRow[] | null) ?? []).forEach((participant) => {
      const list = participantsByConversation.get(participant.conversation_id) ?? [];
      list.push(participant);
      participantsByConversation.set(participant.conversation_id, list);
    });

    const lastMessageByConversation = new Map<string, LastMessageRow>();
    ((lastMessages as LastMessageRow[] | null) ?? []).forEach((message) => {
      if (!lastMessageByConversation.has(message.conversation_id)) {
        lastMessageByConversation.set(message.conversation_id, message);
      }
    });

    const nextItems: ConversationItem[] = ((conversations as ConversationRow[] | null) ?? []).map((conversation) => {
      const members = participantsByConversation.get(conversation.id) ?? [];
      const other = members.find((member) => member.user_id !== user.id);
      const otherProfile = other?.profile
        ? Array.isArray(other.profile)
          ? other.profile[0] ?? null
          : other.profile
        : null;

      const lastMessage = lastMessageByConversation.get(conversation.id) ?? null;
      const baseTitle = otherProfile?.username || otherProfile?.full_name || "Kullanıcı";
      const title = conversation.is_group ? conversation.name || "Grup Sohbeti" : baseTitle;

      let previewText: string | null = null;
      if (lastMessage?.content) {
        const prefix = lastMessage.sender_id === user.id ? "Sen: " : "";
        const sliced = lastMessage.content.length > 60 ? `${lastMessage.content.slice(0, 60)}...` : lastMessage.content;
        previewText = `${prefix}${sliced}`;
      }

      return {
        id: conversation.id,
        title,
        subtitle: conversation.is_group ? "Grup" : otherProfile?.full_name || "Direkt mesaj",
        isGroup: conversation.is_group,
        otherUserId: conversation.is_group ? null : other?.user_id ?? null,
        avatarUrl: conversation.is_group ? null : otherProfile?.avatar_url ?? null,
        lastMessage: previewText,
        createdAt: conversation.created_at
      };
    });

    setItems(nextItems);
    setLoading(false);
  }, [supabase, user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return items;

    return items.filter((item) => {
      return (
        item.title.toLowerCase().includes(query) ||
        item.subtitle.toLowerCase().includes(query) ||
        (item.lastMessage ?? "").toLowerCase().includes(query)
      );
    });
  }, [items, search]);

  const selectedItem = useMemo(() => {
    return items.find((item) => item.id === selectedConversationId) ?? null;
  }, [items, selectedConversationId]);

  const createDirectConversation = useCallback(async () => {
    if (!user) return;

    setCreateError(null);

    if (!profile?.username) {
      setCreateError("Önce kendi kullanıcı adını ayarla.");
      return;
    }

    const target = newDmUsername.trim().toLowerCase();
    if (!target) {
      setCreateError("Kullanıcı adı gerekli.");
      return;
    }
    if (!USERNAME_REGEX.test(target)) {
      setCreateError("Geçersiz kullanıcı adı formatı.");
      return;
    }

    setCreating(true);

    try {
      const { data: other, error: otherError } = await supabase
        .from("profiles")
        .select("id, username")
        .eq("username", target)
        .maybeSingle();

      if (otherError) {
        setCreateError(otherError.message);
        return;
      }
      if (!other) {
        setCreateError("Kullanıcı bulunamadı.");
        return;
      }
      if (other.id === user.id) {
        setCreateError("Kendinle direkt mesaj başlatamazsın.");
        return;
      }

      const { data: myRows, error: myRowsError } = await supabase
        .from("participants")
        .select("conversation_id")
        .eq("user_id", user.id);

      if (myRowsError) {
        setCreateError(myRowsError.message);
        return;
      }

      const myConversationIds = (myRows ?? []).map((row) => row.conversation_id);
      if (myConversationIds.length > 0) {
        const { data: sharedRows, error: sharedRowsError } = await supabase
          .from("participants")
          .select("conversation_id")
          .eq("user_id", other.id)
          .in("conversation_id", myConversationIds);

        if (sharedRowsError) {
          setCreateError(sharedRowsError.message);
          return;
        }

        const sharedConversationIds = (sharedRows ?? []).map((row) => row.conversation_id);
        if (sharedConversationIds.length > 0) {
          const { data: existingDm, error: existingDmError } = await supabase
            .from("conversations")
            .select("id, is_group, created_at")
            .in("id", sharedConversationIds)
            .eq("is_group", false)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (existingDmError) {
            setCreateError(existingDmError.message);
            return;
          }

          if (existingDm?.id) {
            setNewDmUsername("");
            onSelectConversation(existingDm.id);
            await refresh();
            return;
          }
        }
      }

      const { data: conversation, error: conversationError } = await supabase
        .from("conversations")
        .insert({ is_group: false })
        .select("id")
        .single();

      if (conversationError || !conversation) {
        setCreateError(conversationError?.message ?? "Sohbet oluşturulamadı.");
        return;
      }

      const conversationId = conversation.id as string;

      const { error: joinError } = await supabase
        .from("participants")
        .insert({ conversation_id: conversationId, user_id: user.id });
      if (joinError) {
        setCreateError(joinError.message);
        return;
      }

      const { error: inviteError } = await supabase
        .from("participants")
        .insert({ conversation_id: conversationId, user_id: other.id });
      if (inviteError) {
        setCreateError(inviteError.message);
        return;
      }

      setNewDmUsername("");
      await refresh();
      onSelectConversation(conversationId);
    } finally {
      setCreating(false);
    }
  }, [newDmUsername, onSelectConversation, profile?.username, refresh, supabase, user]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-zinc-800/80 p-3">
        <p className="text-sm font-semibold tracking-wide text-zinc-100">Konuşmalar</p>
        <p className="mt-0.5 text-xs text-zinc-500">
          {selectedItem ? selectedItem.title : "Bir konuşma seç"}
        </p>
      </div>

      <div className="space-y-2 border-b border-zinc-800/70 p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            className="w-full rounded-xl border border-zinc-800 bg-zinc-900/70 py-2 pl-9 pr-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-zinc-700"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Konuşma ara"
            value={search}
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            ref={dmInputRef}
            className="w-full rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-zinc-700 disabled:opacity-60"
            disabled={!canCreate || creating}
            onChange={(event) => setNewDmUsername(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
              event.preventDefault();
              void createDirectConversation();
            }}
            placeholder={canCreate ? "Kullanıcı adı ile DM başlat" : "Önce kullanıcı adı ayarla"}
            value={newDmUsername}
          />
          <button
            aria-label="Yeni DM başlat"
            className={cn(
              "inline-flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
            )}
            disabled={!canCreate || creating}
            onClick={() => void createDirectConversation()}
            type="button"
          >
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          </button>
        </div>

        {createError ? <p className="text-xs text-red-300">{createError}</p> : null}
      </div>

      <div className="flex items-center justify-between border-b border-zinc-800/70 px-3 py-2">
        <p className="text-xs text-zinc-500">{filteredItems.length} konuşma</p>
        <button
          className={cn(
            "inline-flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800",
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

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading ? (
          <p className="px-2 py-4 text-sm text-zinc-400">Yükleniyor...</p>
        ) : error ? (
          <p className="px-2 py-4 text-sm text-red-300">{error}</p>
        ) : filteredItems.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <MessageSquareText className="h-8 w-8 text-zinc-700" />
            <p className="text-sm text-zinc-400">Henüz konuşma bulunamadı.</p>
            <p className="text-xs text-zinc-500">Yeni DM başlatmak için yukarıdaki kutuyu kullan.</p>
          </div>
        ) : (
          <ul className="space-y-1">
            {filteredItems.map((item) => {
              const selected = item.id === selectedConversationId;
              const online = item.otherUserId ? isOnline(item.otherUserId) : false;

              return (
                <li key={item.id}>
                  <button
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                      selected
                        ? "border-zinc-700 bg-zinc-900/90"
                        : "border-transparent bg-zinc-900/30 hover:border-zinc-800 hover:bg-zinc-900/60"
                    )}
                    onClick={() => onSelectConversation(item.id)}
                    type="button"
                  >
                    <div className="relative h-10 w-10 shrink-0">
                      {item.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          alt={`${item.title} avatar`}
                          className="h-10 w-10 rounded-full border border-zinc-800 object-cover"
                          src={item.avatarUrl}
                        />
                      ) : (
                        <div className="grid h-10 w-10 place-items-center rounded-full border border-zinc-800 bg-zinc-900 text-xs font-semibold text-zinc-200">
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

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-zinc-100">{item.title}</p>
                      <p className="truncate text-xs text-zinc-500">{item.lastMessage ?? item.subtitle}</p>
                    </div>

                    <span className="shrink-0 text-[10px] text-zinc-600">
                      {new Date(item.createdAt).toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit" })}
                    </span>
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
