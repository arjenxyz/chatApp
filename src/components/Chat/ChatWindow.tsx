"use client";

import { ArrowLeft, Copy, Pencil, Reply, SendHorizontal, Trash2 } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { usePresence } from "@/components/Presence/PresenceProvider";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/AuthProvider";

type ConversationRow = {
  id: string;
  name: string | null;
  is_group: boolean;
};

type ProfileRow = {
  id: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  status: string | null;
};

type ParticipantRowRaw = {
  user_id: string;
  profile: ProfileRow | ProfileRow[] | null;
};

type ParticipantRow = {
  user_id: string;
  profile: ProfileRow | null;
};

type MessageReply = {
  id: string;
  content: string;
  sender_id: string;
};

type MessageRowRaw = {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  type: "text" | "image";
  replied_to: MessageReply | MessageReply[] | string | null;
  created_at: string;
  is_read: boolean;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  type: "text" | "image";
  replied_to: MessageReply | null;
  created_at: string;
  is_read: boolean;
};

function normalizeParticipant(row: ParticipantRowRaw): ParticipantRow {
  const profile = row.profile
    ? Array.isArray(row.profile)
      ? row.profile[0] ?? null
      : row.profile
    : null;

  return { user_id: row.user_id, profile };
}

function normalizeReply(reply: MessageRowRaw["replied_to"]): MessageReply | null {
  if (!reply) return null;
  if (Array.isArray(reply)) return reply[0] ?? null;
  if (typeof reply === "string") return null;
  return reply;
}

function normalizeMessage(row: MessageRowRaw): MessageRow {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    sender_id: row.sender_id,
    content: row.content,
    type: row.type,
    replied_to: normalizeReply(row.replied_to),
    created_at: row.created_at,
    is_read: row.is_read
  };
}

function formatDateLabel(dateIso: string): string {
  const date = new Date(dateIso);
  return date.toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "long",
    year: "numeric"
  });
}

export function ChatWindow({
  conversationId,
  onBack
}: {
  conversationId: string | null;
  onBack?: () => void;
}) {
  const supabase = getSupabaseBrowserClient();
  const { user } = useAuth();
  const { isOnline } = usePresence();

  const [conversation, setConversation] = useState<ConversationRow | null>(null);
  const [participants, setParticipants] = useState<ParticipantRow[]>([]);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [replyTarget, setReplyTarget] = useState<MessageRow | null>(null);
  const [editingTarget, setEditingTarget] = useState<MessageRow | null>(null);
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef(true);
  const sendingRef = useRef(false);

  const trimmedText = text.trim();
  const canSend = Boolean(user && conversationId && trimmedText) && !sending;

  const participantsById = useMemo(() => {
    const map = new Map<string, ParticipantRow>();
    participants.forEach((participant) => map.set(participant.user_id, participant));
    return map;
  }, [participants]);

  const title = useMemo(() => {
    if (!conversation) return "Sohbet";
    if (conversation.is_group) return conversation.name || "Grup Sohbeti";
    const other = participants.find((participant) => participant.user_id !== user?.id);
    return other?.profile?.username || other?.profile?.full_name || "Kullanıcı";
  }, [conversation, participants, user?.id]);

  const otherUserId = useMemo(() => {
    if (!conversation || conversation.is_group) return null;
    const other = participants.find((participant) => participant.user_id !== user?.id);
    return other?.user_id ?? null;
  }, [conversation, participants, user?.id]);

  const otherAvatarUrl = useMemo(() => {
    if (!conversation || conversation.is_group) return null;
    const other = participants.find((participant) => participant.user_id !== user?.id);
    return other?.profile?.avatar_url ?? null;
  }, [conversation, participants, user?.id]);

  const markRead = useCallback(async () => {
    if (!conversationId) return;
    const { error: rpcError } = await supabase.rpc("mark_conversation_read", {
      p_conversation_id: conversationId
    });
    if (rpcError) console.warn("[mark_conversation_read] failed:", rpcError.message);
  }, [conversationId, supabase]);

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }, [text]);

  const focusInputWithoutScroll = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    try {
      input.focus({ preventScroll: true });
    } catch {
      input.focus();
    }
  }, []);

  useEffect(() => {
    if (!autoScrollRef.current) return;
    const container = scrollRef.current;
    if (!container) return;

    const inputFocused = typeof document !== "undefined" && document.activeElement === inputRef.current;
    container.scrollTo({
      top: container.scrollHeight,
      behavior: inputFocused ? "auto" : "smooth"
    });
  }, [messages.length]);

  useEffect(() => {
    if (!conversationId) return;
    const onFocus = () => void markRead();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [conversationId, markRead]);

  useEffect(() => {
    if (!user || !conversationId) {
      setConversation(null);
      setParticipants([]);
      setMessages([]);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    setConversation(null);
    setParticipants([]);
    setMessages([]);
    setReplyTarget(null);
    setEditingTarget(null);
    setActiveMessageId(null);
    autoScrollRef.current = true;

    let cancelled = false;

    const hydrateRealtimeReply = async (row: MessageRowRaw): Promise<MessageRowRaw> => {
      if (typeof row.replied_to !== "string") return row;

      const { data } = await supabase
        .from("messages")
        .select("id, content, sender_id")
        .eq("id", row.replied_to)
        .maybeSingle();

      return { ...row, replied_to: data ?? null };
    };

    const load = async () => {
      const [
        { data: conversationData, error: conversationError },
        { data: participantData, error: participantError },
        { data: messageData, error: messageError }
      ] = await Promise.all([
        supabase.from("conversations").select("id, name, is_group").eq("id", conversationId).single(),
        supabase
          .from("participants")
          .select("user_id, profile:profiles(id, username, full_name, avatar_url, status)")
          .eq("conversation_id", conversationId),
        supabase
          .from("messages")
          .select("id, conversation_id, sender_id, content, type, replied_to(id, content, sender_id), created_at, is_read")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: true })
      ]);

      if (cancelled) return;

      if (conversationError || participantError || messageError) {
        setError(conversationError?.message ?? participantError?.message ?? messageError?.message ?? "Bilinmeyen hata");
        setLoading(false);
        return;
      }

      const normalizedParticipants = ((participantData as ParticipantRowRaw[] | null) ?? []).map(normalizeParticipant);
      const normalizedMessages = ((messageData as MessageRowRaw[] | null) ?? []).map(normalizeMessage);

      setConversation(conversationData as ConversationRow);
      setParticipants(normalizedParticipants);
      setMessages(normalizedMessages);
      setLoading(false);
      void markRead();
    };

    void load();

    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`
        },
        async (payload) => {
          const withReply = await hydrateRealtimeReply(payload.new as MessageRowRaw);
          const nextMessage = normalizeMessage(withReply);

          setMessages((prev) => (prev.some((item) => item.id === nextMessage.id) ? prev : [...prev, nextMessage]));
          if (nextMessage.sender_id !== user.id) void markRead();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`
        },
        (payload) => {
          const nextMessage = normalizeMessage(payload.new as MessageRowRaw);
          setMessages((prev) => prev.map((item) => (item.id === nextMessage.id ? { ...item, ...nextMessage } : item)));
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`
        },
        (payload) => {
          const deleted = payload.old as { id: string };
          setMessages((prev) => prev.filter((item) => item.id !== deleted.id));
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [conversationId, markRead, supabase, user]);

  const deleteMessage = useCallback(
    async (message: MessageRow) => {
      if (!user) return;
      if (message.sender_id !== user.id) return;

      const { error: deleteError } = await supabase.from("messages").delete().eq("id", message.id).eq("sender_id", user.id);
      if (deleteError) {
        setError(deleteError.message);
        return;
      }

      setMessages((prev) => prev.filter((item) => item.id !== message.id));
      if (replyTarget?.id === message.id) setReplyTarget(null);
      if (editingTarget?.id === message.id) {
        setEditingTarget(null);
        setText("");
      }
      if (activeMessageId === message.id) setActiveMessageId(null);
    },
    [activeMessageId, editingTarget?.id, replyTarget?.id, supabase, user]
  );

  const send = useCallback(async () => {
    if (!user || !conversationId || !trimmedText) return;
    if (sendingRef.current) return;

    sendingRef.current = true;
    setSending(true);
    setError(null);
    autoScrollRef.current = true;

    try {
      if (editingTarget) {
        const { error: updateError } = await supabase
          .from("messages")
          .update({ content: trimmedText })
          .eq("id", editingTarget.id)
          .eq("sender_id", user.id);

        if (updateError) {
          setError(updateError.message);
          return;
        }

        setMessages((prev) => prev.map((item) => (item.id === editingTarget.id ? { ...item, content: trimmedText } : item)));
        setEditingTarget(null);
        setText("");
        return;
      }

      const payload: {
        conversation_id: string;
        sender_id: string;
        content: string;
        type: "text";
        replied_to?: string;
      } = {
        conversation_id: conversationId,
        sender_id: user.id,
        content: trimmedText,
        type: "text"
      };

      if (replyTarget) payload.replied_to = replyTarget.id;

      const { data: inserted, error: insertError } = await supabase
        .from("messages")
        .insert(payload)
        .select("id, conversation_id, sender_id, content, type, replied_to(id, content, sender_id), created_at, is_read")
        .single();

      if (insertError) {
        setError(insertError.message);
        return;
      }

      if (inserted) {
        const nextMessage = normalizeMessage(inserted as MessageRowRaw);
        setMessages((prev) => (prev.some((item) => item.id === nextMessage.id) ? prev : [...prev, nextMessage]));
      }

      setText("");
      setReplyTarget(null);
      setActiveMessageId(null);
      setTimeout(focusInputWithoutScroll, 0);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, [conversationId, editingTarget, focusInputWithoutScroll, replyTarget, supabase, trimmedText, user]);

  if (!conversationId) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center">
        <p className="text-sm text-zinc-400">Konuşma seçerek mesajlaşmaya başlayabilirsin.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-x-hidden">
      <header className="flex items-center justify-between gap-3 border-b border-zinc-800/80 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          {onBack ? (
            <button
              aria-label="Geri"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/50 text-zinc-200 hover:bg-zinc-800 md:hidden"
              onClick={onBack}
              type="button"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          ) : null}

          {otherAvatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt={`${title} avatar`} className="h-9 w-9 rounded-full border border-zinc-800 object-cover" src={otherAvatarUrl} />
          ) : (
            <div className="grid h-9 w-9 place-items-center rounded-full border border-zinc-800 bg-zinc-900 text-xs font-semibold text-zinc-200">
              {title.slice(0, 1).toUpperCase()}
            </div>
          )}

          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-zinc-100">{title}</p>
            <p className="truncate text-xs text-zinc-500">
              {otherUserId ? (isOnline(otherUserId) ? "aktif" : "çevrimdışı") : "grup sohbeti"}
            </p>
          </div>
        </div>

        <span className="text-[11px] text-zinc-600">{conversationId.slice(0, 8)}</span>
      </header>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-4"
        onScroll={() => {
          const el = scrollRef.current;
          if (!el) return;
          autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        }}
      >
        {loading ? (
          <p className="px-2 py-8 text-center text-sm text-zinc-500">Yükleniyor...</p>
        ) : error ? (
          <p className="px-2 py-8 text-center text-sm text-red-300">{error}</p>
        ) : messages.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-zinc-500">Henüz mesaj yok.</p>
        ) : (
          <ul className="space-y-3">
            {messages.map((message, index) => {
              const mine = message.sender_id === user?.id;
              const sender = participantsById.get(message.sender_id);
              const senderName = sender?.profile?.username || sender?.profile?.full_name || "Kullanıcı";
              const showDateSeparator =
                index === 0 ||
                new Date(messages[index - 1].created_at).toDateString() !== new Date(message.created_at).toDateString();
              const active = activeMessageId === message.id;

              return (
                <li key={message.id}>
                  {showDateSeparator ? (
                    <div className="mb-3 flex justify-center">
                      <span className="rounded-full border border-zinc-800 bg-zinc-900/50 px-3 py-1 text-[11px] text-zinc-500">
                        {formatDateLabel(message.created_at)}
                      </span>
                    </div>
                  ) : null}

                  <div className={cn("group flex", mine ? "justify-end" : "justify-start")}>
                    <div className={cn("max-w-[88%] md:max-w-[72%]", mine ? "items-end" : "items-start")}>
                      {!mine ? <p className="mb-1 px-1 text-[11px] text-zinc-500">{senderName}</p> : null}

                      <div
                        id={`msg-${message.id}`}
                        className={cn(
                          "rounded-2xl border px-3 py-2 text-sm break-words break-all",
                          mine
                            ? "border-blue-900/60 bg-blue-600/85 text-white"
                            : "border-zinc-800 bg-zinc-900/70 text-zinc-100",
                          active && "ring-1 ring-zinc-500"
                        )}
                        onClick={() => setActiveMessageId((prev) => (prev === message.id ? null : message.id))}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setActiveMessageId((prev) => (prev === message.id ? null : message.id));
                          }
                        }}
                      >
                        {message.replied_to ? (
                          <button
                            className={cn(
                              "mb-2 block w-full rounded-lg border px-2 py-1 text-left text-[11px]",
                              mine ? "border-blue-400/40 bg-blue-500/40" : "border-zinc-700 bg-zinc-800/70"
                            )}
                            onClick={() => {
                              const target = document.getElementById(`msg-${message.replied_to?.id}`);
                              target?.scrollIntoView({ behavior: "smooth", block: "center" });
                            }}
                            type="button"
                          >
                            <span className="font-semibold">
                              {message.replied_to.sender_id === user?.id
                                ? "Sen"
                                : participantsById.get(message.replied_to.sender_id)?.profile?.username || "Kullanıcı"}
                              :
                            </span>{" "}
                            {message.replied_to.content}
                          </button>
                        ) : null}

                        <p className="whitespace-pre-wrap break-words">{message.content}</p>

                        <div className={cn("mt-1 flex items-center justify-end gap-2 text-[10px]", mine ? "text-blue-100/80" : "text-zinc-500")}>
                          <span>
                            {new Date(message.created_at).toLocaleTimeString("tr-TR", {
                              hour: "2-digit",
                              minute: "2-digit"
                            })}
                          </span>
                          {mine ? <span>{message.is_read ? "okundu" : "gönderildi"}</span> : null}
                        </div>
                      </div>

                      <div className={cn("mt-1 flex items-center gap-1 px-1", active ? "opacity-100" : "opacity-0 group-hover:opacity-100")}>
                        <button
                          className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                          onClick={() => setReplyTarget(message)}
                          title="Yanıtla"
                          type="button"
                        >
                          <Reply className="h-3.5 w-3.5" />
                        </button>
                        <button
                          className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                          onClick={() => {
                            if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(message.content);
                          }}
                          title="Kopyala"
                          type="button"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                        {mine ? (
                          <button
                            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                            onClick={() => {
                              setEditingTarget(message);
                              setReplyTarget(null);
                              setText(message.content);
                              setTimeout(focusInputWithoutScroll, 0);
                            }}
                            title="Düzenle"
                            type="button"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                        {mine ? (
                          <button
                            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-red-900/60 bg-red-950/40 text-red-300 hover:bg-red-900/40"
                            onClick={() => void deleteMessage(message)}
                            title="Sil"
                            type="button"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div ref={bottomRef} />
      </div>

      {replyTarget || editingTarget ? (
        <div className="flex items-center justify-between border-t border-zinc-800/80 bg-zinc-900/40 px-3 py-2 text-xs text-zinc-300">
          <p className="truncate">
            {editingTarget ? `Düzenleniyor: ${editingTarget.content}` : `Yanıtlanıyor: ${replyTarget?.content ?? ""}`}
          </p>
          <button
            className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-300 hover:bg-zinc-800"
            onClick={() => {
              setReplyTarget(null);
              setEditingTarget(null);
              if (editingTarget) setText("");
            }}
            type="button"
          >
            İptal
          </button>
        </div>
      ) : null}

      <form
        className="flex items-end gap-2 border-t border-zinc-800/80 bg-zinc-900/30 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <textarea
          ref={inputRef}
          className="min-h-[44px] w-full flex-1 resize-none rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-zinc-700 disabled:opacity-60"
          disabled={sending}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            if (event.shiftKey) return;
            if (event.nativeEvent.isComposing) return;
            event.preventDefault();
            void send();
          }}
          placeholder="Mesaj yaz... (Enter gönderir, Shift+Enter satır)"
          rows={1}
          value={text}
        />
        <button
          aria-label="Gönder"
          className={cn(
            "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border text-sm",
            canSend
              ? "border-blue-700 bg-blue-600 text-white hover:bg-blue-500"
              : "border-zinc-800 bg-zinc-900 text-zinc-600"
          )}
          disabled={!canSend}
          type="submit"
        >
          <SendHorizontal className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
