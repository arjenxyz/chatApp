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
  deleted?: boolean;
  edited?: boolean;
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
  deleted: boolean;
  edited: boolean;
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
    is_read: row.is_read,
    deleted: row.deleted ?? false,
    edited: row.edited ?? false
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
  networkOnline = true,
  onBack
}: {
  conversationId: string | null;
  networkOnline?: boolean;
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
  const [typingUserIds, setTypingUserIds] = useState<string[]>([]);
  const [typingDots, setTypingDots] = useState("");
  const [swipeState, setSwipeState] = useState<{ id: string; offset: number } | null>(null);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef(true);
  const sendingRef = useRef(false);
  const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const typingSentRef = useRef(false);
  const typingSentAtRef = useRef(0);
  const typingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const swipeStartRef = useRef<{
    id: string;
    mine: boolean;
    startX: number;
    startY: number;
    locked: boolean;
    isHorizontal: boolean;
  } | null>(null);

  const trimmedText = text.trim();
  const canSend = Boolean(user && conversationId && trimmedText && networkOnline) && !sending;

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

  const typingLabel = useMemo(() => {
    if (typingUserIds.length === 0) return null;

    const names = typingUserIds
      .map((userId) => participantsById.get(userId)?.profile?.username || participantsById.get(userId)?.profile?.full_name || null)
      .filter((value): value is string => Boolean(value));

    if (names.length === 0) return "Birisi yazıyor";
    if (names.length === 1) return `${names[0]} yazıyor`;
    return `${names[0]} ve ${names.length - 1} kişi yazıyor`;
  }, [participantsById, typingUserIds]);

  useEffect(() => {
    if (typingUserIds.length === 0) {
      setTypingDots("");
      return;
    }

    let step = 1;
    setTypingDots(".");

    const intervalId = window.setInterval(() => {
      step = step >= 3 ? 1 : step + 1;
      setTypingDots(".".repeat(step));
    }, 350);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [typingUserIds.length]);

  const markRead = useCallback(async () => {
    if (!conversationId) return;
    const { error: rpcError } = await supabase.rpc("mark_conversation_read", {
      p_conversation_id: conversationId
    });
    if (rpcError) console.warn("[mark_conversation_read] failed:", rpcError.message);
  }, [conversationId, supabase]);

  const sendTypingStatus = useCallback(
    async (isTyping: boolean) => {
      if (!typingChannelRef.current || !user || !conversationId) return;

      try {
        const status = await typingChannelRef.current.send({
          type: "broadcast",
          event: "typing",
          payload: {
            conversationId,
            userId: user.id,
            isTyping
          }
        });

        if (status !== "ok") {
          console.warn("[typing] broadcast status:", status);
        }
      } catch (broadcastError) {
        console.warn("[typing] broadcast failed:", broadcastError);
      }
    },
    [conversationId, user]
  );

  const notifyRecipientsForPush = useCallback(
    async (messageId: string) => {
      if (process.env.NODE_ENV !== "production") return;
      if (!conversationId) return;

      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) return;

      const response = await fetch("/api/push/message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          conversationId,
          messageId
        }),
        keepalive: true
      });

      if (!response.ok) {
        console.warn("[push] notify api status:", response.status);
      }
    },
    [conversationId, supabase.auth]
  );

  const handleSwipeStart = useCallback((event: React.TouchEvent, messageId: string, mine: boolean) => {
    const touch = event.touches[0];
    if (!touch) return;

    swipeStartRef.current = {
      id: messageId,
      mine,
      startX: touch.clientX,
      startY: touch.clientY,
      locked: false,
      isHorizontal: false
    };
  }, []);

  const handleSwipeMove = useCallback((event: React.TouchEvent) => {
    if (!swipeStartRef.current) return;

    const touch = event.touches[0];
    if (!touch) return;

    const state = swipeStartRef.current;
    const diffX = touch.clientX - state.startX;
    const diffY = touch.clientY - state.startY;

    if (!state.locked) {
      if (Math.abs(diffX) < 10 && Math.abs(diffY) < 10) return;
      state.locked = true;
      state.isHorizontal = Math.abs(diffX) > Math.abs(diffY);
      swipeStartRef.current = state;
    }

    if (!state.isHorizontal) return;

    let allowedOffset = 0;
    if (!state.mine && diffX > 0) allowedOffset = Math.min(diffX, 72);
    if (state.mine && diffX < 0) allowedOffset = Math.max(diffX, -72);

    if (allowedOffset !== 0) event.preventDefault();
    setSwipeState({ id: state.id, offset: allowedOffset });
  }, []);

  const handleSwipeEnd = useCallback((message: MessageRow) => {
    const state = swipeStartRef.current;
    const currentSwipe = swipeState;

    swipeStartRef.current = null;
    setSwipeState(null);

    if (!state || !currentSwipe || currentSwipe.id !== message.id) return;
    if (!state.isHorizontal) return;

    if (!state.mine && currentSwipe.offset >= 46) {
      setReplyTarget(message);
      setEditingTarget(null);
      setActiveMessageId(null);
      return;
    }

    if (state.mine && currentSwipe.offset <= -46) {
      setReplyTarget(message);
      setEditingTarget(null);
      setActiveMessageId(null);
    }
  }, [swipeState]);

  const handleSwipeCancel = useCallback(() => {
    swipeStartRef.current = null;
    setSwipeState(null);
  }, []);

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
    if (!replyTarget || editingTarget) return;
    setTimeout(focusInputWithoutScroll, 0);
  }, [editingTarget, focusInputWithoutScroll, replyTarget]);

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
    if (!conversationId || !user) return;

    if (!trimmedText) {
      if (typingSentRef.current) {
        typingSentRef.current = false;
        typingSentAtRef.current = Date.now();
        void sendTypingStatus(false);
      }
      return;
    }

    const now = Date.now();
    if (!typingSentRef.current || now - typingSentAtRef.current > 1200) {
      typingSentRef.current = true;
      typingSentAtRef.current = now;
      void sendTypingStatus(true);
    }

    const idleTimer = setTimeout(() => {
      if (!typingSentRef.current) return;
      typingSentRef.current = false;
      typingSentAtRef.current = Date.now();
      void sendTypingStatus(false);
    }, 1800);

    return () => {
      clearTimeout(idleTimer);
    };
  }, [conversationId, sendTypingStatus, trimmedText, user]);

  useEffect(() => {
    if (!user || !conversationId) {
      setConversation(null);
      setParticipants([]);
      setMessages([]);
      setError(null);
      setReplyTarget(null);
      setEditingTarget(null);
      setActiveMessageId(null);
      setTypingUserIds([]);
      setSwipeState(null);
      swipeStartRef.current = null;
      typingChannelRef.current = null;
      typingSentRef.current = false;
      typingSentAtRef.current = 0;
      const typingTimers = typingTimersRef.current;
      typingTimers.forEach((timer) => clearTimeout(timer));
      typingTimers.clear();
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
    setTypingUserIds([]);
    setSwipeState(null);
    swipeStartRef.current = null;
    autoScrollRef.current = true;
    typingSentRef.current = false;
    typingSentAtRef.current = 0;
    const typingTimers = typingTimersRef.current;
    typingTimers.forEach((timer) => clearTimeout(timer));
    typingTimers.clear();

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
          .select("id, conversation_id, sender_id, content, type, replied_to(id, content, sender_id), created_at, is_read, deleted, edited")
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
      .on("broadcast", { event: "typing" }, (payload) => {
        const typingPayload = payload.payload as {
          conversationId?: string;
          userId?: string;
          isTyping?: boolean;
        };

        if (typingPayload.conversationId !== conversationId) return;
        if (!typingPayload.userId || typingPayload.userId === user.id) return;

        const typingUserId = typingPayload.userId;
        const isTyping = Boolean(typingPayload.isTyping);

        const existingTimeout = typingTimers.get(typingUserId);
        if (existingTimeout) {
          clearTimeout(existingTimeout);
          typingTimers.delete(typingUserId);
        }

        if (!isTyping) {
          setTypingUserIds((prev) => prev.filter((item) => item !== typingUserId));
          return;
        }

        setTypingUserIds((prev) => (prev.includes(typingUserId) ? prev : [...prev, typingUserId]));

        const timeout = setTimeout(() => {
          typingTimers.delete(typingUserId);
          setTypingUserIds((prev) => prev.filter((item) => item !== typingUserId));
        }, 2400);
        typingTimers.set(typingUserId, timeout);
      })
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
          if (nextMessage.deleted) {
            setReplyTarget((prev) => (prev?.id === nextMessage.id ? null : prev));
            setEditingTarget((prev) => {
              if (prev?.id === nextMessage.id) {
                setText("");
                return null;
              }
              return prev;
            });
            setActiveMessageId((prev) => (prev === nextMessage.id ? null : prev));
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "messages"
        },
        (payload) => {
          const deleted = payload.old as { id?: string; conversation_id?: string | null };
          if (!deleted.id) return;

          setMessages((prev) =>
            prev.map((item) =>
              item.id === deleted.id ? { ...item, content: "", deleted: true } : item
            )
          );

          setReplyTarget((prev) => (prev?.id === deleted.id ? null : prev));
          setEditingTarget((prev) => {
            if (prev?.id === deleted.id) {
              setText("");
              return null;
            }
            return prev;
          });
          setActiveMessageId((prev) => (prev === deleted.id ? null : prev));
        }
      )
      .subscribe();

    typingChannelRef.current = channel;

    return () => {
      cancelled = true;
      if (typingChannelRef.current === channel) {
        typingChannelRef.current = null;
      }
      typingSentRef.current = false;
      typingSentAtRef.current = 0;
      typingTimers.forEach((timer) => clearTimeout(timer));
      typingTimers.clear();
      void supabase.removeChannel(channel);
    };
  }, [conversationId, markRead, supabase, user]);

  const deleteMessage = useCallback(
    async (message: MessageRow) => {
      if (!user) return;
      if (message.sender_id !== user.id) return;

      // mark message as deleted instead of removing it from the database
      const { error: deleteError } = await supabase
        .from("messages")
        .update({ content: "", deleted: true })
        .eq("id", message.id)
        .eq("sender_id", user.id);
      if (deleteError) {
        setError(deleteError.message);
        return;
      }

      // reflect change locally
      setMessages((prev) =>
        prev.map((item) => (item.id === message.id ? { ...item, content: "", deleted: true } : item))
      );
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
    if (!networkOnline) {
      setError("Bağlantı yok. Mesaj gönderilemedi.");
      return;
    }
    if (sendingRef.current) return;

    sendingRef.current = true;
    setSending(true);
    setError(null);
    autoScrollRef.current = true;

    try {
      if (editingTarget) {
        const { error: updateError } = await supabase
          .from("messages")
          .update({ content: trimmedText, edited: true })
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
        .select("id, conversation_id, sender_id, content, type, replied_to(id, content, sender_id), created_at, is_read, deleted")
        .single();
      if (insertError) {
        setError(insertError.message);
        return;
      }

      if (inserted) {
        const nextMessage = normalizeMessage(inserted as MessageRowRaw);
        setMessages((prev) => (prev.some((item) => item.id === nextMessage.id) ? prev : [...prev, nextMessage]));
        void notifyRecipientsForPush(nextMessage.id).catch((pushError) => {
          console.warn("[push] notify failed:", pushError);
        });
      }

      if (typingSentRef.current) {
        typingSentRef.current = false;
        typingSentAtRef.current = Date.now();
        void sendTypingStatus(false);
      }

      setText("");
      setReplyTarget(null);
      setActiveMessageId(null);
      setTimeout(focusInputWithoutScroll, 0);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, [
    conversationId,
    editingTarget,
    focusInputWithoutScroll,
    notifyRecipientsForPush,
    replyTarget,
    sendTypingStatus,
    supabase,
    trimmedText,
    user,
    networkOnline
  ]);

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
            <p
              className={cn(
                "truncate text-xs",
                !networkOnline ? "text-amber-300" : typingLabel ? "text-emerald-400" : "text-zinc-500"
              )}
            >
              {!networkOnline
                ? "bağlantı yok"
                : typingLabel
                  ? `${typingLabel}${typingDots}`
                  : otherUserId
                    ? isOnline(otherUserId)
                      ? "aktif"
                      : "çevrimdışı"
                    : "grup sohbeti"}
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
              const swipeOffset = swipeState?.id === message.id ? swipeState.offset : 0;
              const swipeActive = swipeOffset !== 0;
              const swipeReady = !mine ? swipeOffset >= 46 : swipeOffset <= -46;
              const swipeAllowed = !message.deleted;

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

                      <div className="relative">
                        <div
                          className={cn(
                            "pointer-events-none absolute inset-y-0 flex items-center",
                            mine ? "left-2 justify-start" : "right-2 justify-end"
                          )}
                        >
                          <Reply
                            className={cn(
                              "h-4 w-4 transition-all",
                              swipeActive && swipeAllowed ? "opacity-100" : "opacity-0",
                              swipeReady ? "scale-110 text-emerald-300" : "text-zinc-500"
                            )}
                          />
                        </div>

                        <div
                          id={`msg-${message.id}`}
                          className={cn(
                            "rounded-2xl border px-3 py-2 text-sm break-words break-all",
                            message.deleted
                              ? "border-zinc-700 bg-zinc-800/60 text-zinc-400 italic"
                              : mine
                              ? "border-blue-900/60 bg-blue-600/85 text-white"
                              : "border-zinc-800 bg-zinc-900/70 text-zinc-100",
                            active && "ring-1 ring-zinc-500",
                            swipeActive ? "transition-none" : "transition-transform duration-150 ease-out"
                          )}
                          onClick={() => setActiveMessageId((prev) => (prev === message.id ? null : message.id))}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setActiveMessageId((prev) => (prev === message.id ? null : message.id));
                            }
                          }}
                          onTouchCancel={swipeAllowed ? handleSwipeCancel : undefined}
                          onTouchEnd={swipeAllowed ? () => handleSwipeEnd(message) : undefined}
                          onTouchMove={swipeAllowed ? handleSwipeMove : undefined}
                          onTouchStart={swipeAllowed ? (event) => handleSwipeStart(event, message.id, mine) : undefined}
                          role="button"
                          style={swipeActive ? { transform: `translateX(${swipeOffset}px)` } : undefined}
                          tabIndex={0}
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

                          <p className="whitespace-pre-wrap break-words">
                            {message.deleted ? "Bir mesaj silindi" : message.content}
                            {message.edited && !message.deleted ? (
                              <span className="ml-1 text-[10px] text-zinc-400">(düzenlendi)</span>
                            ) : null}
                          </p>

                          <div
                            className={cn(
                              "mt-1 flex items-center justify-end gap-2 text-[10px]",
                              mine ? "text-blue-100/80" : "text-zinc-500"
                            )}
                          >
                            <span>
                              {new Date(message.created_at).toLocaleTimeString("tr-TR", {
                                hour: "2-digit",
                                minute: "2-digit"
                              })}
                            </span>
                            {mine ? <span>{message.is_read ? "okundu" : "gönderildi"}</span> : null}
                          </div>
                        </div>
                      </div>

                      {!message.deleted && (
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
                      )}
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

      {!networkOnline ? (
        <div className="border-t border-amber-900/60 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
          İnternet bağlantısı yok. Gönderme düğmesi bağlantı gelene kadar pasif.
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
