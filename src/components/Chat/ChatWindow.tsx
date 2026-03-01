"use client";

import { ArrowLeft, Copy, MoreVertical, Pencil, SendHorizontal, Trash2, Share2 } from "lucide-react";
import { ConversationList } from "./ConversationList";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";
import { usePresence } from "@/components/Presence/PresenceProvider";
import { useAuth } from "@/providers/AuthProvider";

type MessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  type: "text" | "image";
  replied_to?: { id: string; content: string; sender_id: string } | null;
  created_at: string;
  is_read: boolean;
};

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

type ParticipantRowQuery = {
  user_id: string;
  profile: ProfileRow | ProfileRow[] | null;
};

type ParticipantRow = {
  user_id: string;
  profile: ProfileRow | null;
};

type MessageGroup = {
  senderId: string;
  messages: MessageRow[];
  timestamp: string;
};

export function ChatWindow({
  conversationId,
  onBack
}: {
  conversationId: string | null;
  onBack?: () => void;
}) {

  type MessageItemProps = {
    m: MessageRow;
    mine: boolean;
    showTimestamp: boolean;
    supabase: ReturnType<typeof getSupabaseBrowserClient>;
    setMessages: React.Dispatch<React.SetStateAction<MessageRow[]>>;
    selected: boolean;
    onSelect: () => void;
    onReply: (msg: MessageRow) => void;
    onForward: (msg: MessageRow) => void;
  };

  function MessageItem({ 
    m, 
    mine, 
    showTimestamp,
    supabase, 
    setMessages,
    selected,
    onSelect,
    onReply,
    onForward
  }: MessageItemProps) {
    // editing is handled by parent via `editingMessage` state
    const [isHovered, setIsHovered] = useState(false);
    const touchTimer = useRef<number | null>(null);
    const lastTap = useRef<number>(0);

    const handleTouchStart = () => {
      touchTimer.current = window.setTimeout(() => {
        onSelect();
      }, 500);
    };
    const handleTouchEnd = () => {
      if (touchTimer.current) {
        clearTimeout(touchTimer.current);
        touchTimer.current = null;
      }
    };

    const showActions = isHovered || selected;

    // swipe detection
    const startX = useRef<number | null>(null);
    const handlePointerDown = (e: React.PointerEvent) => {
      startX.current = e.clientX;
    };
    const handlePointerUp = (e: React.PointerEvent) => {
      // double tap detection
      const now = Date.now();
      if (now - lastTap.current < 300) {
        onReply(m);
        // do not toggle selection on double tap
      }
      lastTap.current = now;

      if (startX.current !== null) {
        const dx = e.clientX - startX.current;
        if (dx > 50) {
          // right swipe
          onReply(m);
          onSelect();
        } else if (dx < -50) {
          onForward(m);
          onSelect();
        }
      }
      startX.current = null;
    };

    return (
      <div 
        className={cn("flex gap-1", mine ? "justify-end" : "justify-start")}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={() => {
          onSelect();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          onSelect();
        }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
      >
        {/* Action buttons - shown when hovered or selected */}
        {showActions && (
          <div className="flex items-center gap-0.5 self-end pb-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            <button
              onClick={() => onReply(m)}
              className="rounded p-1.5 hover:bg-zinc-700/50"
              title="Yanıtla"
            >
              <ArrowLeft className="h-3.5 w-3.5 text-zinc-400" />
            </button>
            <button
              onClick={() => onForward(m)}
              className="rounded p-1.5 hover:bg-zinc-700/50"
              title="İlet"
            >
              <Share2 className="h-3.5 w-3.5 text-zinc-400" />
            </button>
            <button
              onClick={() => {
                setMessages((prev) => prev.filter((x) => x.id !== m.id));
              }}
              className="rounded p-1.5 hover:bg-zinc-700/50"
              title="Sil"
            >
              <Trash2 className="h-3.5 w-3.5 text-zinc-400" />
            </button>
            <button
              onClick={() => {
                navigator.clipboard.writeText(m.content);
              }}
              className="rounded p-1.5 hover:bg-zinc-700/50"
              title="Kopyala"
            >
              <Copy className="h-3.5 w-3.5 text-zinc-400" />
            </button>
          </div>
        )}

        <div className="flex max-w-[70%] flex-col gap-0.5">
          {/* Message bubble */}
          <div
            className={cn(
              "group relative rounded-2xl px-3 py-1.5 text-[15px] leading-relaxed",
              mine 
                ? "bg-blue-600 text-white" 
                : "bg-zinc-800/80 text-zinc-50",
              selected && "ring-2 ring-zinc-400"
            )}
          >
            <>
              {m.replied_to ? (
                <div
                  id={`msg-${m.id}-reply`}
                  className="mb-1 max-w-[80%] cursor-pointer rounded-l pl-2 text-xs text-zinc-300" 
                  style={{ borderLeftColor: mine ? '#3b82f6' : '#22c55e', borderLeftWidth: 3, borderLeftStyle: 'solid' }}
                  onClick={() => {
                    // scroll to original message if available
                    const orig = document.getElementById(`msg-${m.replied_to?.id}`);
                    if (orig) orig.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }}
                >
                  <span className="font-semibold text-zinc-200">
                    {m.replied_to.sender_id === user?.id
                      ? 'Sen'
                      : participants.find((p) => p.user_id === m.replied_to?.sender_id)?.profile?.username || '—'}
                    :
                  </span>{" "}
                  {m.replied_to.content}
                </div>
              ) : null}
              <p
                id={`msg-${m.id}`}
                className="whitespace-pre-wrap break-words"
              >
                {m.content}
              </p>
            </>
          </div>

          {/* Timestamp and read status */}
          <div className={cn("flex items-center gap-1 px-3 text-[11px] text-zinc-500", mine && "justify-end")}>
            {showTimestamp && (
              <span>
                {new Date(m.created_at).toLocaleTimeString("tr-TR", {
                  hour: "2-digit",
                  minute: "2-digit"
                })}
              </span>
            )}
            {mine && (
              <span className="text-zinc-500">
                {m.is_read ? "✓✓" : "✓"}
              </span>
            )}
          </div>
        </div>

        {/* Action buttons - right side for sent */}
        {mine && isHovered && (
          <div className="flex items-center gap-0.5 self-end pb-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            <button
              onClick={() => {
                setEditingMessage(m);
                setText(m.content);
              }}
              className="rounded p-1.5 hover:bg-zinc-700/50"
              title="Düzenle"
            >
              <Pencil className="h-3.5 w-3.5 text-zinc-400" />
            </button>
            <button
              onClick={() => {
                navigator.clipboard.writeText(m.content);
              }}
              className="rounded p-1.5 hover:bg-zinc-700/50"
              title="Kopyala"
            >
              <Copy className="h-3.5 w-3.5 text-zinc-400" />
            </button>
            <button
              onClick={async () => {
                const { error } = await supabase
                  .from("messages")
                  .delete()
                  .eq("id", m.id);
                if (!error) {
                  setMessages((prev) => prev.filter((x) => x.id !== m.id));
                }
              }}
              className="rounded p-1.5 hover:bg-zinc-700/50"
              title="Sil"
            >
              <Trash2 className="h-3.5 w-3.5 text-zinc-400" />
            </button>
          </div>
        )}
      </div>
    );
  }

  const supabase = getSupabaseBrowserClient();
  const { user } = useAuth();
  const { isOnline } = usePresence();

  const [conversation, setConversation] = useState<ConversationRow | null>(null);
  const [participants, setParticipants] = useState<ParticipantRow[]>([]);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [selectedMsgIds, setSelectedMsgIds] = useState<Set<string>>(new Set());
  const [replyTarget, setReplyTarget] = useState<MessageRow | null>(null);
  const [forwardingMessage, setForwardingMessage] = useState<MessageRow | null>(null);
  const [editingMessage, setEditingMessage] = useState<MessageRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [text, setText] = useState("");
  const [mentionSuggestions, setMentionSuggestions] = useState<ProfileRow[]>([]);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);

  const trimmedText = text.trim();
  const canSend = Boolean(user && conversationId && trimmedText) && !sending;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const autoScrollRef = useRef(true);

  const title = useMemo(() => {
    if (!conversation) return "Sohbet";
    if (conversation.is_group) return conversation.name || "Grup Sohbeti";
    const other = participants.find((p) => p.user_id !== user?.id);
    return other?.profile?.username || other?.profile?.full_name || "Kullanıcı";
  }, [conversation, participants, user?.id]);

  const avatarById = useMemo(() => {
    const m: Record<string, string | null> = {};
    participants.forEach((p) => {
      if (p.profile?.avatar_url) {
        m[p.user_id] = p.profile.avatar_url;
      }
    });
    return m;
  }, [participants]);

  const headerAvatar = useMemo(() => {
    if (!conversation || conversation.is_group) return null;
    const other = participants.find((p) => p.user_id !== user?.id);
    return other?.profile?.avatar_url ?? null;
  }, [conversation, participants, user?.id]);

  const otherUserId = useMemo(() => {
    if (!conversation || conversation.is_group) return null;
    const other = participants.find((p) => p.user_id !== user?.id);
    return other?.user_id ?? null;
  }, [conversation, participants, user?.id]);

  // Group messages by sender and time (within 1 minute)
  const groupedMessages = useMemo(() => {
    const groups: MessageGroup[] = [];
    let currentDate = "";

    messages.forEach((msg, idx) => {
      const msgDate = new Date(msg.created_at).toLocaleDateString("tr-TR");
      const lastGroup = groups[groups.length - 1];
      const prevMsg = idx > 0 ? messages[idx - 1] : null;
      
      const timeDiff = prevMsg 
        ? new Date(msg.created_at).getTime() - new Date(prevMsg.created_at).getTime()
        : Infinity;
      
      // Add date separator if date changed
      if (msgDate !== currentDate) {
        currentDate = msgDate;
        groups.push({
          senderId: "DATE_SEPARATOR",
          messages: [msg],
          timestamp: msg.created_at
        });
      }
      
      const shouldGroup = 
        lastGroup &&
        lastGroup.senderId !== "DATE_SEPARATOR" &&
        lastGroup.senderId === msg.sender_id &&
        timeDiff < 60000; // 1 minute

      if (shouldGroup) {
        lastGroup.messages.push(msg);
      } else if (lastGroup?.senderId === "DATE_SEPARATOR") {
        lastGroup.messages.push(msg);
      } else {
        groups.push({
          senderId: msg.sender_id,
          messages: [msg],
          timestamp: msg.created_at
        });
      }
    });

    return groups;
  }, [messages]);

  const markRead = useCallback(async () => {
    if (!conversationId) return;
    const { error: rpcError } = await supabase.rpc("mark_conversation_read", {
      p_conversation_id: conversationId
    });
    if (rpcError) console.warn("[mark_conversation_read] failed:", rpcError.message);
  }, [conversationId, supabase]);

  useEffect(() => {
    if (!autoScrollRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;

    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, 120);
    el.style.height = `${next}px`;

    // mention detection
    const pos = el.selectionStart || 0;
    const prefix = text.slice(0, pos);
    const m = prefix.match(/@([a-z0-9_]*)$/i);
    if (m) {
      const q = m[1].toLowerCase();
      setMentionSuggestions(
        participants
          .map((p) => p.profile)
          .filter((prof): prof is ProfileRow => !!prof && !!prof.username)
          .filter((prof) => prof.username?.toLowerCase().startsWith(q))
      );
    } else {
      setMentionSuggestions([]);
    }
  }, [text, participants]);

  useEffect(() => {
    if (!conversationId) return;
    const onFocus = () => {
      void markRead();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
    };
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
    autoScrollRef.current = true;

    let cancelled = false;

    const load = async () => {
      const [{ data: conv, error: convError }, { data: part, error: partError }, { data: msgs, error: msgError }] =
        await Promise.all([
          supabase.from("conversations").select("id, name, is_group").eq("id", conversationId).single(),
          supabase
            .from("participants")
            .select("user_id, profile:profiles(id, username, full_name, avatar_url, status)")
            .eq("conversation_id", conversationId),
          supabase
            .from("messages")
            .select("id, conversation_id, sender_id, content, type, replied_to(id,content,sender_id), created_at, is_read")
            .eq("conversation_id", conversationId)
            .order("created_at", { ascending: true })
        ]);

      if (cancelled) return;

      if (convError || partError || msgError) {
        setError(convError?.message ?? partError?.message ?? msgError?.message ?? "Bilinmeyen hata");
        setLoading(false);
        return;
      }

      setConversation(conv as ConversationRow);

      const normalizedParticipants: ParticipantRow[] = ((part as ParticipantRowQuery[] | null) ?? []).map((p) => {
        const profile = p.profile
          ? Array.isArray(p.profile)
            ? p.profile[0] ?? null
            : p.profile
          : null;

        return { user_id: p.user_id, profile };
      });

      setParticipants(normalizedParticipants);
      // we only care about the optional `replied_to` field here, its shape
      // will be normalized later. using `unknown` avoids the `no-explicit-any`
      // lint error while still permitting runtime checks.
      const rawMsgs = ((msgs as unknown) as Array<{ replied_to?: unknown }> | null | undefined) ?? [];
      const norm = rawMsgs.map((x) => ({
        ...x,
        replied_to: Array.isArray(x.replied_to) ? x.replied_to[0] ?? null : x.replied_to
      }));
      setMessages(norm as MessageRow[]);
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
          const next = payload.new as MessageRow;
          // normalize replied_to to object and fetch if necessary
          if (next.replied_to) {
            if (Array.isArray(next.replied_to)) {
              next.replied_to = next.replied_to[0] ?? null;
            } else if (typeof next.replied_to === "string") {
              const { data: ref } = await supabase
                .from("messages")
                .select("id, content, sender_id")
                .eq("id", next.replied_to)
                .maybeSingle();
              if (ref) {
                next.replied_to = ref;
              }
            }
          }
          setMessages((prev) => (prev.some((m) => m.id === next.id) ? prev : [...prev, next]));
          if (next.sender_id !== user.id) void markRead();
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
          const next = payload.new as MessageRow;
          setMessages((prev) => prev.map((m) => (m.id === next.id ? { ...m, ...next } : m)));
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
          const old = payload.old as MessageRow;
          setMessages((prev) => prev.filter((m) => m.id !== old.id));
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [conversationId, markRead, supabase, user]);

  const send = async () => {
    if (!user || !conversationId) return;
    if (sendingRef.current) return;
    const content = trimmedText;
    if (!content) return;

    setError(null);
    sendingRef.current = true;
    setSending(true);
    autoScrollRef.current = true;

    try {
      if (editingMessage) {
        // update existing message
        const { error: updateError } = await supabase
          .from("messages")
          .update({ content })
          .eq("id", editingMessage.id);
        if (updateError) {
          setError(updateError.message);
          return;
        }
        setMessages((prev) =>
          prev.map((m) => (m.id === editingMessage.id ? { ...m, content } : m))
        );
        setEditingMessage(null);
      } else {
        const payload: {
          conversation_id: string;
          sender_id: string;
          content: string;
          type: string;
          replied_to?: string;
        } = {
          conversation_id: conversationId,
          sender_id: user.id,
          content,
          type: "text"
        };
        if (replyTarget) payload.replied_to = replyTarget.id;

        const { data: inserted, error: insertError } = await supabase
          .from("messages")
          .insert(payload)
          .select("id, conversation_id, sender_id, content, type, created_at, is_read, replied_to(id,content,sender_id)")
          .single();

        if (insertError) {
          setError(insertError.message);
          return;
        }

        if (inserted) {
          const rawInserted = (inserted as unknown) as MessageRow & { replied_to?: unknown };
          const next: MessageRow = {
            ...rawInserted,
            replied_to: Array.isArray(rawInserted.replied_to) ? rawInserted.replied_to[0] ?? null : rawInserted.replied_to
          };
          setMessages((prev) => (prev.some((m) => m.id === next.id) ? prev : [...prev, next]));
        }
      }

      setText("");
      setReplyTarget(null);
      // refocus after the DOM updates so mobile keyboard doesn't dismiss
      setTimeout(() => inputRef.current?.focus(), 0);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  if (!conversationId) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center">
        <p className="text-sm text-zinc-400">Bir konuşma seçerek mesajlaşmaya başlayın.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-zinc-800/50 px-4 py-2.5">
        {onBack ? (
          <button
            aria-label="Geri"
            className="inline-flex items-center justify-center rounded-lg p-1 hover:bg-zinc-800/50 md:hidden"
            onClick={onBack}
            type="button"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        ) : null}

        <div className="flex min-w-0 flex-1 items-center gap-3">
          {headerAvatar ? (
            <img
              src={headerAvatar}
              alt="avatar"
              className="h-9 w-9 rounded-full object-cover"
            />
          ) : (
            <div className="grid h-9 w-9 place-items-center rounded-full bg-zinc-800 text-sm font-medium">
              {title.slice(0, 1).toUpperCase()}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{title}</p>
            <div className="flex items-center gap-1.5">
              {otherUserId && (
                <span
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    isOnline(otherUserId) ? "bg-emerald-500" : "bg-zinc-600"
                  )}
                />
              )}
              <p className="truncate text-xs text-zinc-500">
                {otherUserId ? (isOnline(otherUserId) ? "aktif" : "çevrimdışı") : "grup"}
              </p>
            </div>
          </div>
        </div>

        <button
          className="rounded-lg p-1.5 hover:bg-zinc-800/50"
          type="button"
        >
          <MoreVertical className="h-5 w-5 text-zinc-400" />
        </button>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto bg-zinc-950 px-4 py-3"
        onScroll={() => {
          const el = scrollRef.current;
          if (!el) return;
          autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        }}
      >
        {loading ? (
          <p className="py-8 text-center text-sm text-zinc-500">Yükleniyor...</p>
        ) : error ? (
          <p className="py-8 text-center text-sm text-red-400">{error}</p>
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <p className="text-sm text-zinc-500">Henüz mesaj yok</p>
              <p className="mt-1 text-xs text-zinc-600">İlk mesajı gönderin</p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {groupedMessages.map((group, groupIdx) => {
              if (group.senderId === "DATE_SEPARATOR") {
                // Date separator + messages from that date
                const firstMsg = group.messages[0];
                const dateStr = new Date(firstMsg.created_at).toLocaleDateString("tr-TR", {
                  day: "numeric",
                  month: "long",
                  year: "numeric"
                });
                
                return (
                  <div key={groupIdx}>
                    <div className="mb-3 flex items-center justify-center">
                      <span className="rounded-full bg-zinc-900/50 px-3 py-1 text-xs text-zinc-500">
                        {dateStr}
                      </span>
                    </div>
                    <div className="space-y-0.5">
                      {group.messages.map((msg) => {
                        const mine = msg.sender_id === user?.id;
                        return (
                          <MessageItem
                            key={msg.id}
                            m={msg}
                            mine={mine}
                            showTimestamp={false}
                            supabase={supabase}
                            setMessages={setMessages}
                            selected={selectedMsgIds.has(msg.id)}
                            onSelect={() => {
                              setSelectedMsgIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(msg.id)) next.delete(msg.id);
                                else next.add(msg.id);
                                return next;
                              });
                            }}
                            onReply={(m) => setReplyTarget(m)}
                            onForward={(m) => setForwardingMessage(m)}
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              }

              const mine = group.senderId === user?.id;
              const avatarUrl = avatarById[group.senderId];
              
              return (
                <div key={groupIdx} className="group space-y-0.5">
                  {/* Show avatar for group start */}
                  {!mine && avatarUrl && (
                    <div className="flex items-center gap-2 px-3">
                      <img
                        src={avatarUrl}
                        alt="avatar"
                        className="h-6 w-6 rounded-full object-cover"
                      />
                      <span className="text-xs font-medium text-zinc-400">
                        {participants.find(p => p.user_id === group.senderId)?.profile?.username || "User"}
                      </span>
                    </div>
                  )}
                  {group.messages.map((msg, msgIdx) => (
                    <MessageItem
                      key={msg.id}
                      m={msg}
                      mine={mine}
                      showTimestamp={msgIdx === group.messages.length - 1}
                      supabase={supabase}
                      setMessages={setMessages}
                      selected={selectedMsgIds.has(msg.id)}
                      onSelect={() => {
                        setSelectedMsgIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(msg.id)) next.delete(msg.id);
                          else next.add(msg.id);
                          return next;
                        });
                      }}
                      onReply={(m) => setReplyTarget(m)}
                      onForward={(m) => setForwardingMessage(m)}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* selection toolbar */}
      {selectedMsgIds.size > 0 && (
        <div className="flex items-center justify-between border-b border-zinc-700 bg-zinc-800/60 px-3 py-2 text-sm">
          <span>{selectedMsgIds.size} mesaj seçili</span>
          <div className="flex gap-2">
            <button
              className="rounded-lg bg-zinc-700 px-2 py-1 text-xs hover:bg-zinc-600"
              onClick={async () => {
                // ask user whether to delete only for self or everyone
                const choice = window.prompt("Silmek istedğinizi yazın: 1=kendinden 2=herkesten", "2");
                if (!choice) return;
                if (choice === "1") {
                  setMessages((prev) => prev.filter((m) => !selectedMsgIds.has(m.id)));
                } else {
                  const ids = Array.from(selectedMsgIds);
                  await supabase.from("messages").delete().in("id", ids);
                  setMessages((prev) => prev.filter((m) => !selectedMsgIds.has(m.id)));
                }
                setSelectedMsgIds(new Set());
              }}
              type="button"
            >
              Sil
            </button>
            <button
              className="rounded-lg bg-zinc-700 px-2 py-1 text-xs hover:bg-zinc-600"
              onClick={() => setSelectedMsgIds(new Set())}
              type="button"
            >
              İptal
            </button>
          </div>
        </div>
      )}

      {/* Reply preview */}
      {replyTarget ? (
        <div
          className="flex cursor-pointer items-center justify-between border-b border-zinc-700 bg-zinc-800/60 px-3 py-2 text-sm"
          onClick={() => {
            const orig = document.getElementById(`msg-${replyTarget.id}`);
            if (orig) orig.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }}
        >
          <span className="truncate">Yanıtlanıyor: {replyTarget.content}</span>
          <button
            className="ml-2 rounded hover:bg-zinc-700/50 p-1"
            onClick={(e) => {
              e.stopPropagation();
              setReplyTarget(null);
            }}
            type="button"
          >
            ✖
          </button>
        </div>
      ) : null}

      {/* Forward modal */}
      {forwardingMessage && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-md rounded-lg bg-zinc-900 p-4">
            <p className="mb-2 text-sm">Mesajı iletmek istediğiniz konuşmayı seçin:</p>
            <ConversationList
              selectedConversationId={null}
              onSelectConversation={async (id) => {
                if (!user) return;
                const { error } = await supabase.from("messages").insert({
                  conversation_id: id,
                  sender_id: user.id,
                  content: forwardingMessage.content,
                  type: "text"
                });
                if (error) {
                  console.warn("forward failed", error);
                  alert("İletme başarısız");
                } else {
                  alert("İletildi");
                }
                setForwardingMessage(null);
              }}
            />
            <button
              className="mt-2 w-full rounded bg-zinc-800 px-3 py-2 text-sm hover:bg-zinc-700"
              onClick={() => setForwardingMessage(null)}
              type="button"
            >
              Kapat
            </button>
          </div>
        </div>
      )}

      {/* Input */}
      {editingMessage && (
        <div className="px-3 py-1 text-xs text-zinc-300">
          Düzenleniyor: {editingMessage.content}
        </div>
      )}
      <form
        className="flex items-end gap-2 border-t border-zinc-800/50 bg-zinc-900/30 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <div className="relative flex-1">
          <textarea
            ref={inputRef}
            className="min-h-[40px] w-full resize-none rounded-lg bg-zinc-900/50 px-3 py-2.5 text-sm outline-none placeholder:text-zinc-600 focus:bg-zinc-900"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              if (e.shiftKey) return;
              if (e.nativeEvent.isComposing) return;

              e.preventDefault();
              void send();
            }}
            placeholder="Mesaj yazın..."
            rows={1}
            value={text}
          />
          {mentionSuggestions.length > 0 && (
            <ul className="absolute bottom-full mb-1 max-h-40 w-full overflow-y-auto rounded bg-zinc-800 p-1 text-sm">
              {mentionSuggestions.map((prof) => (
                <li
                  key={prof.id}
                  className="cursor-pointer px-2 py-1 hover:bg-zinc-700"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    // insert mention
                    const pos = inputRef.current?.selectionStart || 0;
                    const prefix = text.slice(0, pos);
                    const m = prefix.match(/@([a-z0-9_]*)$/i);
                    if (!m) return;
                    const before = prefix.slice(0, m.index);
                    const after = text.slice(pos);
                    const newText = `${before}@${prof.username} ${after}`;
                    setText(newText);
                    // move cursor after inserted mention
                    setTimeout(() => {
                      const el = inputRef.current;
                      if (el) el.selectionStart = el.selectionEnd = before.length + prof.username!.length + 2;
                    }, 0);
                    setMentionSuggestions([]);
                  }}
                >
                  {prof.username}
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-all",
            canSend 
              ? "bg-blue-600 text-white hover:bg-blue-700 active:scale-95" 
              : "bg-zinc-800/50 text-zinc-600 cursor-not-allowed"
          )}
          disabled={!canSend}
          type="submit"
          aria-label="Gönder"
        >
          <SendHorizontal className="h-4.5 w-4.5" />
        </button>
      </form>
    </div>
  );
}