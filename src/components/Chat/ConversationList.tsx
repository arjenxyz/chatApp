"use client";

import { MessageSquareText, Pin, PinOff, RefreshCcw, Search } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";

import { usePresence } from "@/components/Presence/PresenceProvider";
import {
  buildConversationDraftStorageKey,
  buildPinnedConversationsStorageKey,
  CHAT_DRAFT_UPDATED_EVENT,
  CHAT_PINNED_UPDATED_EVENT,
  loadConversationDraft,
  loadPinnedConversationIds,
  togglePinnedConversationForUser
} from "@/lib/chatPreferences";
import { buildWatchPartyDisplayText, parseWatchPartyBotPayload } from "@/lib/watchParty";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/AuthProvider";

type ConversationRow = {
  id: string;
  name: string | null;
  is_group: boolean;
  is_watch_party_room: boolean;
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
  deleted?: boolean;
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
  isBlocked?: boolean;
};

const MAX_DRAFT_PREVIEW_LENGTH = 56;
const BOT_MESSAGE_PREFIX = "[[BOT]]";
const INSTALL_CTA_MARKER = "[[INSTALL_CTA]]";
const SYSTEM_BOT_CONVERSATION_NAME = "Atlas Bot";

function buildDraftPreviewText(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  if (compact.length <= MAX_DRAFT_PREVIEW_LENGTH) return compact;
  return `${compact.slice(0, MAX_DRAFT_PREVIEW_LENGTH)}...`;
}

function buildPreviewText(message: Pick<LastMessageRow, "content" | "sender_id" | "deleted">, currentUserId: string): string {
  if (message.deleted) {
    return "Bir mesaj silindi";
  }

  if (!message.content) {
    return "Mesaj yok";
  }

  let normalizedContent = message.content.startsWith(BOT_MESSAGE_PREFIX)
    ? message.content
        .slice(BOT_MESSAGE_PREFIX.length)
        .replaceAll(INSTALL_CTA_MARKER, "")
        .trim()
    : message.content;

  if (message.content.startsWith(BOT_MESSAGE_PREFIX)) {
    const parsedWatchParty = parseWatchPartyBotPayload(normalizedContent);
    if (parsedWatchParty) {
      normalizedContent = buildWatchPartyDisplayText(parsedWatchParty);
    }
  }
  const prefix = message.content.startsWith(BOT_MESSAGE_PREFIX) ? "Bot: " : message.sender_id === currentUserId ? "Sen: " : "";
  const sliced = normalizedContent.length > 60 ? `${normalizedContent.slice(0, 60)}...` : normalizedContent;
  return `${prefix}${sliced}`;
}

export function ConversationList({
  selectedConversationId,
  onSelectConversation
}: {
  selectedConversationId: string | null;
  onSelectConversation: (conversationId: string) => void;
}) {
  const supabase = getSupabaseBrowserClient();
  const { user } = useAuth();
  const { isOnline } = usePresence();

  const [items, setItems] = useState<ConversationItem[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pinnedConversationIds, setPinnedConversationIds] = useState<string[]>([]);
  const [conversationFilter, setConversationFilter] = useState<"all" | "pinned">("all");
  const [draftVersion, setDraftVersion] = useState(0);

  const pinnedConversationSet = useMemo(() => new Set(pinnedConversationIds), [pinnedConversationIds]);

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

    const [
      { data: conversations, error: conversationsError },
      { data: participants, error: participantsError },
      { data: lastMessages, error: lastMessagesError },
      { data: blockedUsers, error: blockedUsersError }
    ] = await Promise.all([
      conversationIds.length > 0
        ? supabase
            .from("conversations")
            .select("id, name, is_group, is_watch_party_room, created_at")
            .in("id", conversationIds)
            .eq("is_watch_party_room", false)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      conversationIds.length > 0
        ? supabase
            .from("participants")
            .select("conversation_id, user_id, profile:profiles(id, username, full_name, avatar_url, status)")
            .in("conversation_id", conversationIds)
        : Promise.resolve({ data: [], error: null }),
      conversationIds.length > 0
        ? supabase
            .from("messages")
            .select("conversation_id, content, sender_id, created_at, deleted")
            .in("conversation_id", conversationIds)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("user_blocks")
        .select("blocked_id, blocker_id")
        .or(`blocker_id.eq.${user.id},blocked_id.eq.${user.id}`)
    ]);

    if (conversationsError || participantsError || lastMessagesError || blockedUsersError) {
      setError(
        conversationsError?.message ??
          participantsError?.message ??
          lastMessagesError?.message ??
          blockedUsersError?.message ??
          "Bilinmeyen hata"
      );
      setLoading(false);
      return;
    }

    // Build set of blocked user IDs
    const blockedUserIds = new Set<string>();
    ((blockedUsers as { blocked_id: string; blocker_id: string }[] | null) ?? []).forEach((block) => {
      if (block.blocker_id === user.id) {
        blockedUserIds.add(block.blocked_id);
      } else if (block.blocked_id === user.id) {
        blockedUserIds.add(block.blocker_id);
      }
    });

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

    const nextItems: ConversationItem[] = ((conversations as ConversationRow[] | null) ?? [])
      .map((conversation) => {
        const members = participantsByConversation.get(conversation.id) ?? [];
        const other = members.find((member) => member.user_id !== user.id);
        const otherProfile = other?.profile
          ? Array.isArray(other.profile)
            ? other.profile[0] ?? null
            : other.profile
          : null;

        const isBlocked = other?.user_id ? blockedUserIds.has(other.user_id) : false;
        const lastMessage = lastMessageByConversation.get(conversation.id) ?? null;
        const baseTitle = otherProfile?.username || otherProfile?.full_name || "Kullanıcı";
        const isSystemBotConversation = conversation.is_group && conversation.name === SYSTEM_BOT_CONVERSATION_NAME;
        const title = conversation.is_group ? conversation.name || "Grup Sohbeti" : baseTitle;
        const previewText = lastMessage ? buildPreviewText(lastMessage, user.id) : null;

        return {
          id: conversation.id,
          title,
          subtitle: conversation.is_group
            ? isSystemBotConversation
              ? "Bot Asistan"
              : "Grup"
            : isBlocked
              ? "Engellendi"
              : otherProfile?.full_name || "Direkt mesaj",
          isGroup: conversation.is_group,
          otherUserId: conversation.is_group ? null : other?.user_id ?? null,
          avatarUrl: conversation.is_group || isBlocked ? null : otherProfile?.avatar_url ?? null,
          lastMessage: previewText,
          createdAt: lastMessage?.created_at ?? conversation.created_at,
          isBlocked: !conversation.is_group && isBlocked
        };
      });

    nextItems.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());

    setItems(nextItems);
    setLoading(false);
  }, [supabase, user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!user) {
      setPinnedConversationIds([]);
      return;
    }

    const syncPinned = () => {
      setPinnedConversationIds(loadPinnedConversationIds(user.id));
    };

    syncPinned();

    const onPinnedUpdated = () => {
      syncPinned();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === buildPinnedConversationsStorageKey(user.id)) {
        syncPinned();
      }
    };

    window.addEventListener(CHAT_PINNED_UPDATED_EVENT, onPinnedUpdated as EventListener);
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener(CHAT_PINNED_UPDATED_EVENT, onPinnedUpdated as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, [user]);

  useEffect(() => {
    if (!user) {
      setDraftVersion((prev) => prev + 1);
      return;
    }

    const draftKeyPrefix = buildConversationDraftStorageKey(user.id, "");
    const onDraftUpdated = () => {
      setDraftVersion((prev) => prev + 1);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key && event.key.startsWith(draftKeyPrefix)) {
        setDraftVersion((prev) => prev + 1);
      }
    };

    window.addEventListener(CHAT_DRAFT_UPDATED_EVENT, onDraftUpdated as EventListener);
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener(CHAT_DRAFT_UPDATED_EVENT, onDraftUpdated as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, [user]);

  const patchLastMessageFromRealtime = useCallback(
    (message: {
      conversation_id?: string | null;
      sender_id?: string | null;
      content?: string | null;
      deleted?: boolean | null;
      created_at?: string | null;
    }) => {
      if (!user || !message.conversation_id) return;

      setItems((prev) => {
        const index = prev.findIndex((item) => item.id === message.conversation_id);
        if (index < 0) return prev;

        const current = prev[index];
        const nextItem: ConversationItem = {
          ...current,
          lastMessage: buildPreviewText(
            {
              content: message.content ?? "",
              sender_id: message.sender_id ?? "",
              deleted: Boolean(message.deleted)
            },
            user.id
          ),
          createdAt: message.created_at ?? current.createdAt
        };

        const next = [...prev];
        next.splice(index, 1);
        next.unshift(nextItem);
        return next;
      });
    },
    [user]
  );

  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel(`conversation-list:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "participants",
          filter: `user_id=eq.${user.id}`
        },
        () => {
          void refresh();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "participants",
          filter: `user_id=eq.${user.id}`
        },
        () => {
          void refresh();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "conversations"
        },
        () => {
          void refresh();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages"
        },
        (payload) => {
          patchLastMessageFromRealtime(payload.new as LastMessageRow);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages"
        },
        (payload) => {
          patchLastMessageFromRealtime(payload.new as LastMessageRow);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "user_blocks",
          filter: `or(blocker_id.eq.${user.id},blocked_id.eq.${user.id})`
        },
        () => {
          void refresh();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "user_blocks",
          filter: `or(blocker_id.eq.${user.id},blocked_id.eq.${user.id})`
        },
        () => {
          void refresh();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [patchLastMessageFromRealtime, refresh, supabase, user]);

  useEffect(() => {
    const onFocus = () => {
      void refresh();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refresh]);

  const draftByConversation = useMemo(() => {
    void draftVersion;
    const result = new Map<string, string>();
    if (!user) return result;

    items.forEach((item) => {
      const draft = loadConversationDraft(user.id, item.id);
      if (draft.trim()) {
        result.set(item.id, draft);
      }
    });

    return result;
  }, [draftVersion, items, user]);

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    const searched = query
      ? items.filter((item) => {
          const draft = draftByConversation.get(item.id) ?? "";
          return (
            item.title.toLowerCase().includes(query) ||
            item.subtitle.toLowerCase().includes(query) ||
            (item.lastMessage ?? "").toLowerCase().includes(query) ||
            draft.toLowerCase().includes(query)
          );
        })
      : items;

    const filtered =
      conversationFilter === "pinned"
        ? searched.filter((item) => pinnedConversationSet.has(item.id))
        : searched;

    return [...filtered].sort((left, right) => {
      const leftPinned = pinnedConversationSet.has(left.id);
      const rightPinned = pinnedConversationSet.has(right.id);
      if (leftPinned !== rightPinned) return leftPinned ? -1 : 1;
      return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    });
  }, [conversationFilter, draftByConversation, items, pinnedConversationSet, search]);

  const selectedItem = useMemo(() => {
    return items.find((item) => item.id === selectedConversationId) ?? null;
  }, [items, selectedConversationId]);

  const togglePinnedConversation = useCallback(
    (conversationId: string) => {
      if (!user) return;
      const next = togglePinnedConversationForUser(user.id, conversationId);
      setPinnedConversationIds(next);
    },
    [user]
  );

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
        <p className="text-[11px] text-zinc-500">Arkadaş ekleme ve istek yönetimi için Arkadaşlar sekmesini kullan.</p>
      </div>

      <div className="flex items-center justify-between border-b border-zinc-800/70 px-3 py-2">
        <p className="text-xs text-zinc-500">
          {filteredItems.length} konuşma • {pinnedConversationIds.length} sabit
        </p>
        <div className="flex items-center gap-2">
          <button
            className={cn(
              "rounded-lg border px-2 py-1 text-xs transition-colors",
              conversationFilter === "all"
                ? "border-zinc-700 bg-zinc-800 text-zinc-100"
                : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:bg-zinc-800"
            )}
            onClick={() => setConversationFilter("all")}
            type="button"
          >
            Tümü
          </button>
          <button
            className={cn(
              "rounded-lg border px-2 py-1 text-xs transition-colors",
              conversationFilter === "pinned"
                ? "border-zinc-700 bg-zinc-800 text-zinc-100"
                : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:bg-zinc-800"
            )}
            onClick={() => setConversationFilter("pinned")}
            type="button"
          >
            Pinli
          </button>
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
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading ? (
          <p className="px-2 py-4 text-sm text-zinc-400">Yükleniyor...</p>
        ) : error ? (
          <p className="px-2 py-4 text-sm text-red-300">{error}</p>
        ) : filteredItems.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <MessageSquareText className="h-8 w-8 text-zinc-700" />
            <p className="text-sm text-zinc-400">
              {conversationFilter === "pinned" ? "Pinli konuşma bulunamadı." : "Henüz konuşma bulunamadı."}
            </p>
            <p className="text-xs text-zinc-500">
              {conversationFilter === "pinned"
                ? "Bir konuşmayı sabitleyerek burada hızlı erişim sağlayabilirsin."
                : "Arkadaşlarından birine mesaj atınca konuşmalar burada görünür."}
            </p>
          </div>
        ) : (
          <ul className="space-y-1">
            {filteredItems.map((item) => {
              const selected = item.id === selectedConversationId;
              const online = item.otherUserId ? isOnline(item.otherUserId) : false;
              const pinned = pinnedConversationSet.has(item.id);
              const draft = draftByConversation.get(item.id) ?? "";
              const subtitle = draft ? `Taslak: ${buildDraftPreviewText(draft)}` : item.lastMessage ?? item.subtitle;

              return (
                <li key={item.id}>
                  <div className="group relative">
                    <button
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 pr-11 text-left transition-colors",
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
                        {item.otherUserId && !item.isBlocked ? (
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
                        <p className="flex items-center gap-1 truncate text-sm font-medium text-zinc-100">
                          <span className="truncate">{item.title}</span>
                          {pinned ? <Pin className="h-3.5 w-3.5 shrink-0 text-amber-300" /> : null}
                        </p>
                        <p className={cn("truncate text-xs", draft ? "text-amber-300" : "text-zinc-500")}>
                          {subtitle}
                        </p>
                      </div>

                      <span className="shrink-0 text-[10px] text-zinc-600">
                        {new Date(item.createdAt).toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit" })}
                      </span>
                    </button>

                    <button
                      aria-label={pinned ? "Sabitleneni kaldır" : "Sohbeti sabitle"}
                      className={cn(
                        "absolute right-2 top-1/2 -translate-y-1/2 rounded-md border p-1.5 transition-colors",
                        pinned
                          ? "border-amber-700/50 bg-amber-600/20 text-amber-300 hover:bg-amber-600/30"
                          : "border-zinc-700 bg-zinc-900/70 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200",
                        !pinned && "opacity-0 group-hover:opacity-100"
                      )}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        togglePinnedConversation(item.id);
                      }}
                      type="button"
                    >
                      {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
