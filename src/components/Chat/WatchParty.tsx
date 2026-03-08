"use client";

import { Check, ChevronDown, ChevronUp, Copy, ExternalLink, FastForward, Gauge, Link2, ListVideo, Pause, Play, Rewind, RotateCcw, SkipForward, StopCircle, Trash2, UserPlus, Volume2, VolumeX } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { WatchPartyTerms } from "./WatchPartyTerms";
import {
  encodeWatchPartyEvent,
  extractYouTubeVideoId,
  fetchYouTubeVideoMeta,
  loadWatchPartyLinkMode,
  parseWatchPartyBotPayload,
  saveWatchPartyLinkMode,
  type WatchPartyEventPayload,
  type WatchPartyLinkMode,
  type WatchPartyPromptPayload,
  type WatchPartyVideoMeta
} from "@/lib/watchParty";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/AuthProvider";

type MessageRow = {
  id: string;
  sender_id: string;
  content: string;
  created_at: string;
  deleted?: boolean;
};

type QueueProjection = {
  currentVideo: WatchPartyVideoMeta | null;
  currentVideoEventId: string | null;
  currentVideoStartedAt: string | null;
  queue: WatchPartyVideoMeta[];
  pendingPrompts: WatchPartyPromptPayload[];
};

type FriendItem = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
};

const TERMS_KEY = "wp_terms_accepted_v1";

const BOT_MESSAGE_PREFIX = "[[BOT]]";

function stripBotPrefix(content: string): string {
  return content.startsWith(BOT_MESSAGE_PREFIX) ? content.slice(BOT_MESSAGE_PREFIX.length).trimStart() : content;
}

function isBotMessage(content: string): boolean {
  return content.startsWith(BOT_MESSAGE_PREFIX);
}

function buildActorName(user: ReturnType<typeof useAuth>["user"]): string {
  if (!user) return "Kullanıcı";
  return user.user_metadata?.username || user.user_metadata?.full_name || user.email || "Kullanıcı";
}

function mapMessageInsertErrorMessage(message: string): string {
  if (/row-level security policy/i.test(message)) {
    return "Bu konuşmaya Watch Party olayı yazma iznin yok ya da konuşmada engel ilişkisi var.";
  }
  return message;
}

function projectQueueFromMessages(messages: MessageRow[]): QueueProjection {
  const queue: WatchPartyVideoMeta[] = [];
  let currentVideo: WatchPartyVideoMeta | null = null;
  let currentVideoEventId: string | null = null;
  let currentVideoStartedAt: string | null = null;

  const prompts = new Map<string, WatchPartyPromptPayload>();
  const decidedSuggestionIds = new Set<string>();

  messages.forEach((message) => {
    if (message.deleted || !isBotMessage(message.content)) return;

    const parsed = parseWatchPartyBotPayload(stripBotPrefix(message.content));
    if (!parsed) return;

    if (parsed.kind === "prompt") {
      prompts.set(parsed.payload.suggestionId, parsed.payload);
      return;
    }

    const event = parsed.payload;

    if (event.suggestionId && (event.action === "queue_add" || event.action === "queue_skip")) {
      decidedSuggestionIds.add(event.suggestionId);
    }

    if (event.action === "queue_add" && event.video) {
      if (!queue.some((item) => item.videoId === event.video?.videoId)) {
        queue.push(event.video);
      }
      return;
    }

    if (event.action === "queue_remove" && event.video?.videoId) {
      const index = queue.findIndex((item) => item.videoId === event.video?.videoId);
      if (index >= 0) queue.splice(index, 1);
      if (currentVideo?.videoId === event.video.videoId) {
        currentVideo = null;
        currentVideoEventId = null;
        currentVideoStartedAt = null;
      }
      return;
    }

    if (event.action === "queue_clear") {
      queue.length = 0;
      currentVideo = null;
      currentVideoEventId = null;
      currentVideoStartedAt = null;
      return;
    }

    if (event.action === "queue_play" && event.video) {
      currentVideo = event.video;
      currentVideoEventId = message.id;
      currentVideoStartedAt = message.created_at;
      const index = queue.findIndex((item) => item.videoId === event.video?.videoId);
      if (index >= 0) queue.splice(index, 1);
      return;
    }

    if (event.action === "queue_stop") {
      if (currentVideo) {
        queue.unshift(currentVideo);
      }
      currentVideo = null;
      currentVideoEventId = null;
      currentVideoStartedAt = null;
      return;
    }

    if (event.action === "queue_replay" && event.video) {
      // Keep currentVideoEventId unchanged so the iframe key doesn't change
      // (video is the same, we just seek to 0 via postMessage after insertion)
      currentVideo = event.video;
      currentVideoStartedAt = message.created_at;
      // Don't reassign currentVideoEventId — prevents iframe reload
      return;
    }
  });

  const pendingPrompts = Array.from(prompts.values()).filter((prompt) => !decidedSuggestionIds.has(prompt.suggestionId));

  return {
    currentVideo,
    currentVideoEventId,
    currentVideoStartedAt,
    queue,
    pendingPrompts
  };
}

interface WatchPartyProps {
  conversationId: string;
  isGroupConversation: boolean;
  onNowPlayingChange?: (video: WatchPartyVideoMeta | null, startedAt: string | null) => void;
}

export function WatchParty({ conversationId, isGroupConversation, onNowPlayingChange }: WatchPartyProps) {
  const { user } = useAuth();
  const supabase = getSupabaseBrowserClient();

  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [watchUrlInput, setWatchUrlInput] = useState("");
  const [linkMode, setLinkMode] = useState<WatchPartyLinkMode>("ask");

  // Terms
  const [termsAccepted, setTermsAccepted] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(TERMS_KEY) === "true";
  });

  // Local-only video controls (per-user, not shared)
  const [isLocalPaused, setIsLocalPaused] = useState(false);
  const [isLocalMuted, setIsLocalMuted] = useState(false);
  const [localPauseAt, setLocalPauseAt] = useState<number | null>(null);
  const [localPlaybackRate, setLocalPlaybackRate] = useState(1);

  const [roomOwnerId, setRoomOwnerId] = useState<string | null>(null);

  // Invite panel
  const [showInvitePanel, setShowInvitePanel] = useState(false);
  const [friends, setFriends] = useState<FriendItem[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<{ [friendId: string]: boolean }>({});
  const [copiedLink, setCopiedLink] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement>(null);

  const actorName = buildActorName(user);
  const projection = useMemo(() => projectQueueFromMessages(messages), [messages]);
  const isRoomOwner = Boolean(user?.id && roomOwnerId && user.id === roomOwnerId);
  const currentVideoId = projection.currentVideo?.videoId ?? null;

  // Notify parent when the playing video changes
  useEffect(() => {
    onNowPlayingChange?.(projection.currentVideo, projection.currentVideoStartedAt);
    // Reset local pause state when video changes
    setIsLocalPaused(false);
    setLocalPauseAt(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projection.currentVideo?.videoId, projection.currentVideoStartedAt]);

  useEffect(() => {
    if (!user || !conversationId || !isGroupConversation) {
      setMessages([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    let cancelled = false;

    const load = async () => {
      const { data, error: loadError } = await supabase
        .from("messages")
        .select("id, sender_id, content, created_at, deleted")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })
        .limit(500);

      if (cancelled) return;

      if (loadError) {
        setError(loadError.message);
        setLoading(false);
        return;
      }

      setMessages(((data as MessageRow[] | null) ?? []).filter((item) => item.content));
      setLoading(false);
    };

    void load();

    const channel = supabase
      .channel(`watch-party-feed:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`
        },
        (payload) => {
          const next = payload.new as MessageRow;
          if (!next.content) return;
          setMessages((prev) => (prev.some((item) => item.id === next.id) ? prev : [...prev, next]));
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
          setMessages((prev) => prev.map((item) => (item.id === next.id ? { ...item, ...next } : item)));
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
          const oldRow = payload.old as { id?: string };
          if (!oldRow.id) return;
          setMessages((prev) => prev.filter((item) => item.id !== oldRow.id));
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [conversationId, isGroupConversation, supabase, user]);

  useEffect(() => {
    let cancelled = false;
    if (!conversationId) {
      setRoomOwnerId(null);
      return;
    }

    const loadOwner = async () => {
      const { data } = await supabase
        .from("conversations")
        .select("owner_id")
        .eq("id", conversationId)
        .maybeSingle();

      if (!cancelled) {
        setRoomOwnerId(data?.owner_id ?? null);
      }
    };

    void loadOwner();
    return () => {
      cancelled = true;
    };
  }, [conversationId, supabase]);

  useEffect(() => {
    if (!user || !conversationId) {
      setLinkMode("ask");
      return;
    }
    setLinkMode(loadWatchPartyLinkMode(user.id, conversationId));
  }, [conversationId, user]);

  const ensureCanInsertMessage = useCallback(async () => {
    if (!user || !conversationId) return false;

    const { data: isMember, error: memberError } = await supabase.rpc("is_conversation_member", {
      p_conversation: conversationId
    });

    if (memberError) {
      setError(memberError.message || "Watch Party yetkisi doğrulanamadı.");
      return false;
    }

    if (!isMember) {
      setError("Bu konuşmaya Watch Party olayı gönderemezsin.");
      return false;
    }

    return true;
  }, [conversationId, supabase, user]);

  const insertEvent = useCallback(
    async (eventPayload: Omit<WatchPartyEventPayload, "schema" | "actorId" | "actorName" | "createdAt">) => {
      if (!user || !conversationId) return;
      if (!isRoomOwner) {
        setError("Watch Party ortak kontrolleri sadece oda sahibi kullanabilir.");
        return;
      }
      if (!(await ensureCanInsertMessage())) return;

      const fullPayload: WatchPartyEventPayload = {
        schema: "watch_party_event_v1",
        actorId: user.id,
        actorName,
        createdAt: new Date().toISOString(),
        ...eventPayload
      };

      const { data: inserted, error: insertError } = await supabase
        .from("messages")
        .insert({
          conversation_id: conversationId,
          sender_id: user.id,
          content: `${BOT_MESSAGE_PREFIX}${encodeWatchPartyEvent(fullPayload)}`,
          type: "text"
        })
        .select("id, sender_id, content, created_at, deleted")
        .maybeSingle();

      if (insertError) {
        setError(mapMessageInsertErrorMessage(insertError.message));
        return;
      }

      if (inserted) {
        const next = inserted as MessageRow;
        setMessages((prev) => (prev.some((item) => item.id === next.id) ? prev : [...prev, next]));
      }
    },
    [actorName, conversationId, ensureCanInsertMessage, isRoomOwner, supabase, user]
  );

  const setMode = useCallback(
    (mode: WatchPartyLinkMode) => {
      if (!user || !conversationId) return;
      setLinkMode(mode);
      saveWatchPartyLinkMode(user.id, conversationId, mode);
    },
    [conversationId, user]
  );

  const addVideoToQueue = useCallback(async () => {
    if (!watchUrlInput.trim()) {
      setError("YouTube linki veya video ID gir.");
      return;
    }

    const videoId = extractYouTubeVideoId(watchUrlInput);
    if (!videoId) {
      setError("Geçersiz YouTube linki/video ID.");
      return;
    }

    setError(null);
    const video = await fetchYouTubeVideoMeta(videoId, watchUrlInput);
    await insertEvent({ action: "queue_add", video });
    setWatchUrlInput("");
  }, [insertEvent, watchUrlInput]);

  // ── YouTube iframe API (local only) ──────────────────────────────────
  const sendYTCommand = useCallback((func: string, args?: unknown[]) => {
    const targetWindow = iframeRef.current?.contentWindow;
    if (!targetWindow) return;
    const payload = { event: "command", func, args: args ?? [] };
    targetWindow.postMessage(JSON.stringify(payload), "*");
    targetWindow.postMessage(payload, "*");
  }, []);

  const iframeSrc = useMemo(() => {
    if (!currentVideoId) return "";
    const base = `https://www.youtube.com/embed/${currentVideoId}?autoplay=1&rel=0&enablejsapi=1`;
    const originPart = typeof window !== "undefined" ? `&origin=${encodeURIComponent(window.location.origin)}` : "";
    if (!projection.currentVideoStartedAt) {
      return `${base}${originPart}`;
    }
    const elapsed = Math.max(
      0,
      Math.floor((Date.now() - new Date(projection.currentVideoStartedAt).getTime()) / 1000)
    );
    return `${base}${originPart}&start=${elapsed}`;
  }, [currentVideoId, projection.currentVideoStartedAt]);

  const getEstimatedElapsed = useCallback((): number => {
    if (!projection.currentVideoStartedAt) return 0;
    const startedMs = new Date(projection.currentVideoStartedAt).getTime();
    if (localPauseAt !== null) return Math.max(0, (localPauseAt - startedMs) / 1000);
    return Math.max(0, (Date.now() - startedMs) / 1000);
  }, [localPauseAt, projection.currentVideoStartedAt]);

  const toggleLocalPause = useCallback(() => {
    if (isLocalPaused) {
      sendYTCommand("playVideo");
      setIsLocalPaused(false);
      setLocalPauseAt(null);
    } else {
      sendYTCommand("pauseVideo");
      setIsLocalPaused(true);
      setLocalPauseAt(Date.now());
    }
  }, [isLocalPaused, sendYTCommand]);

  const toggleLocalMute = useCallback(() => {
    if (isLocalMuted) {
      sendYTCommand("setVolume", [100]);
      sendYTCommand("unMute");
    } else {
      sendYTCommand("setVolume", [0]);
      sendYTCommand("mute");
    }
    setIsLocalMuted((prev) => !prev);
  }, [isLocalMuted, sendYTCommand]);

  const setPlaybackRate = useCallback((rate: number) => {
    sendYTCommand("setPlaybackRate", [rate]);
    setLocalPlaybackRate(rate);
  }, [sendYTCommand]);

  const seekLocal = useCallback((delta: number) => {
    const pos = getEstimatedElapsed() + delta;
    sendYTCommand("seekTo", [Math.max(0, pos), true]);
    if (localPauseAt !== null) {
      // update pause anchor so next seek is correct
      setLocalPauseAt(Date.now() - (pos * 1000 - (Date.now() - (localPauseAt ?? Date.now()))));
    }
  }, [getEstimatedElapsed, localPauseAt, sendYTCommand]);

  // ── Invite helpers ────────────────────────────────────────────────────
  const inviteLink = typeof window !== "undefined"
    ? `${window.location.origin}/chat?wp=${conversationId}`
    : "";

  const copyInviteLink = useCallback(() => {
    if (!inviteLink) return;
    void navigator.clipboard.writeText(inviteLink).then(() => {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    });
  }, [inviteLink]);

  const loadFriends = useCallback(async () => {
    if (!user || !inviteLink) return;
    setFriendsLoading(true);
    try {
      const { data: friendships, error: fsErr } = await supabase
        .from("friendships")
        .select("user_a, user_b")
        .or(`user_a.eq.${user.id},user_b.eq.${user.id}`);
      if (fsErr || !friendships) return;

      const friendIds = (friendships as { user_a: string; user_b: string }[]).map((row) =>
        row.user_a === user.id ? row.user_b : row.user_a
      );
      if (!friendIds.length) return;

      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, username, full_name, avatar_url")
        .in("id", friendIds);

      setFriends(
        ((profiles ?? []) as { id: string; username: string | null; full_name: string | null; avatar_url: string | null }[]).map((p) => ({
          id: p.id,
          username: p.username ?? "",
          displayName: p.username || p.full_name || "Kullanıcı",
          avatarUrl: p.avatar_url,
        }))
      );
    } finally {
      setFriendsLoading(false);
    }
  }, [supabase, user, inviteLink]);

  useEffect(() => {
    if (showInvitePanel) void loadFriends();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showInvitePanel]);

  const sendInviteDM = useCallback(async (friend: FriendItem) => {
    if (!user || invitingId) return;
    setInvitingId(friend.id);
    try {
      // Find or create DM
      const { data: myRows } = await supabase.from("participants").select("conversation_id").eq("user_id", user.id);
      const myIds = (myRows ?? []).map((r: { conversation_id: string }) => r.conversation_id);
      let dmId: string | null = null;

      if (myIds.length) {
        const { data: shared } = await supabase.from("participants").select("conversation_id").eq("user_id", friend.id).in("conversation_id", myIds);
        const sharedIds = (shared ?? []).map((r: { conversation_id: string }) => r.conversation_id);
        if (sharedIds.length) {
          const { data: dm } = await supabase.from("conversations").select("id").in("id", sharedIds).eq("is_group", false).order("created_at", { ascending: false }).limit(1).maybeSingle();
          dmId = dm?.id ?? null;
        }
      }

      if (!dmId) {
        const newId = crypto.randomUUID();
        await supabase.from("conversations").insert({ id: newId, owner_id: user.id, is_group: false });
        await supabase.from("participants").insert([{ conversation_id: newId, user_id: user.id }, { conversation_id: newId, user_id: friend.id }]);
        dmId = newId;
      }

      const msg = `[[WP_INVITE:${conversationId}]]`;
      await supabase.from("messages").insert({ conversation_id: dmId, sender_id: user.id, content: msg, type: "text" });

      setInviteSuccess((prev) => ({ ...prev, [friend.id]: true }));
      setTimeout(() => setInviteSuccess((prev) => { const n = { ...prev }; delete n[friend.id]; return n; }), 3000);
    } finally {
      setInvitingId(null);
    }
  }, [conversationId, invitingId, supabase, user]);

  if (!isGroupConversation) return null;

  // ── Terms gate ──────────────────────────────────────────────────────────
  if (!termsAccepted) {
    return <WatchPartyTerms onAccepted={() => setTermsAccepted(true)} />;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-zinc-950">
      {/* ── Header ── */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-800 px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-zinc-100">Watch Party</p>
          <p className="text-[11px] text-zinc-500">
            Kontrol: {isRoomOwner ? "Oda sahibi (sen)" : "Sadece oda sahibi"}
          </p>
          {projection.pendingPrompts.length > 0 && (
            <p className="text-[11px] text-amber-400">
              {projection.pendingPrompts.length} bekleyen öneri
            </p>
          )}
        </div>

        {/* Invite button */}
        <button
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors",
            showInvitePanel
              ? "border-cyan-600/60 bg-cyan-600/20 text-cyan-100"
              : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
          )}
          onClick={() => setShowInvitePanel((v) => !v)}
          type="button"
        >
          <UserPlus className="h-3.5 w-3.5" />
          Davet
          {showInvitePanel ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </button>

        {/* Link mode toggle */}
        <div className="flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 p-1">
          {([
            ["ask", "Sor"],
            ["always_queue", "Hep Ekle"],
            ["never", "Asla"],
          ] as Array<[WatchPartyLinkMode, string]>).map(([mode, label]) => (
            <button
              key={mode}
              className={cn(
                "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                linkMode === mode
                  ? "bg-cyan-600/30 text-cyan-100"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              )}
              onClick={() => setMode(mode)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Invite panel ── */}
      {showInvitePanel && (
        <div className="shrink-0 border-b border-zinc-800 bg-zinc-900/60 px-4 py-3">
          {/* Invite link row */}
          <div className="mb-3 flex items-center gap-2">
            <Link2 className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
            <p className="min-w-0 flex-1 truncate rounded bg-zinc-800 px-2 py-1 text-[11px] text-zinc-300 font-mono">
              {inviteLink}
            </p>
            <button
              className={cn(
                "inline-flex shrink-0 items-center gap-1 rounded border px-2 py-1 text-[11px] transition-colors",
                copiedLink
                  ? "border-green-600/60 bg-green-600/20 text-green-200"
                  : "border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
              )}
              onClick={copyInviteLink}
              type="button"
            >
              {copiedLink ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copiedLink ? "Kopyalandı" : "Kopyala"}
            </button>
          </div>

          {/* Friends list */}
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            Arkadaşlarını davet et
          </p>
          {friendsLoading ? (
            <p className="text-[11px] text-zinc-500">Yükleniyor...</p>
          ) : friends.length === 0 ? (
            <p className="text-[11px] text-zinc-600">Arkadaş bulunamadı.</p>
          ) : (
            <div className="max-h-36 space-y-1.5 overflow-y-auto">
              {friends.map((friend) => (
                <div
                  key={friend.id}
                  className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5"
                >
                  {friend.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt={friend.displayName}
                      className="h-6 w-6 shrink-0 rounded-full object-cover"
                      src={friend.avatarUrl}
                    />
                  ) : (
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-700 text-[10px] font-bold text-zinc-300">
                      {friend.displayName.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <p className="min-w-0 flex-1 truncate text-[11px] text-zinc-200">
                    {friend.displayName}
                  </p>
                  <button
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1 rounded border px-2 py-0.5 text-[11px] transition-colors",
                      inviteSuccess[friend.id]
                        ? "border-green-600/60 bg-green-600/20 text-green-200"
                        : "border-cyan-700/60 bg-cyan-600/20 text-cyan-100 hover:bg-cyan-600/30 disabled:opacity-50"
                    )}
                    disabled={invitingId === friend.id || !!inviteSuccess[friend.id]}
                    onClick={() => void sendInviteDM(friend)}
                    type="button"
                  >
                    {inviteSuccess[friend.id] ? (
                      <>
                        <Check className="h-3 w-3" />
                        Gönderildi
                      </>
                    ) : invitingId === friend.id ? (
                      "..."
                    ) : (
                      "Davet Et"
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Video player area ── */}
      <div className="shrink-0 bg-black">
        {projection.currentVideo ? (
          <>
            {/* Iframe wrapper with blocking overlay */}
            <div className="relative aspect-video w-full">
              <iframe
                ref={iframeRef}
                key={projection.currentVideo.videoId}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="h-full w-full"
                src={iframeSrc}
                title={projection.currentVideo.title}
              />
              {/* Transparent overlay — blocks accidental mouse interaction with the iframe */}
              <div className="absolute inset-0 z-10 cursor-default" />
            </div>

            {/* Now Playing bar */}
            <div className="flex items-center gap-2 border-t border-zinc-800 bg-zinc-950/90 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-zinc-100">
                  {projection.currentVideo.title}
                </p>
                <p className="text-[11px] text-zinc-400">
                  {projection.currentVideo.channelTitle}
                </p>
              </div>
              <a
                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[11px] text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
                href={`https://www.youtube.com/watch?v=${projection.currentVideo.videoId}`}
                rel="noopener noreferrer"
                target="_blank"
                title="YouTube'da aç"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>

            {/* ── Local controls (kişisel — sadece seni etkiler) ── */}
            <div className="flex flex-wrap items-center gap-1.5 border-t border-zinc-800/60 bg-zinc-950/80 px-3 py-2">
              <span className="text-[10px] text-zinc-600 mr-1">Kişisel:</span>

              {/* Duraklat / Devam */}
              <button
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800"
                onClick={toggleLocalPause}
                title={isLocalPaused ? "Devam et" : "Duraklat (sadece sen)"}
                type="button"
              >
                {isLocalPaused ? (
                  <Play className="h-3.5 w-3.5 text-cyan-400" />
                ) : (
                  <Pause className="h-3.5 w-3.5" />
                )}
                <span className="hidden sm:inline">
                  {isLocalPaused ? "Devam" : "Duraklat"}
                </span>
              </button>

              {/* -10s */}
              <button
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800"
                onClick={() => seekLocal(-10)}
                title="-10 saniye"
                type="button"
              >
                <Rewind className="h-3.5 w-3.5" />
                <span className="hidden sm:inline text-[11px]">-10s</span>
              </button>

              {/* +10s */}
              <button
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800"
                onClick={() => seekLocal(10)}
                title="+10 saniye"
                type="button"
              >
                <FastForward className="h-3.5 w-3.5" />
                <span className="hidden sm:inline text-[11px]">+10s</span>
              </button>

              {/* Mute */}
              <button
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800"
                onClick={toggleLocalMute}
                title={isLocalMuted ? "Sesi aç" : "Sessiz"}
                type="button"
              >
                {isLocalMuted ? (
                  <VolumeX className="h-3.5 w-3.5 text-amber-400" />
                ) : (
                  <Volume2 className="h-3.5 w-3.5" />
                )}
              </button>

              <div className="ml-1 flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-1.5 py-1">
                <Gauge className="h-3.5 w-3.5 text-zinc-400" />
                {[0.75, 1, 1.25, 1.5, 2].map((rate) => (
                  <button
                    key={rate}
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors",
                      localPlaybackRate === rate
                        ? "bg-cyan-600/30 text-cyan-100"
                        : "text-zinc-300 hover:bg-zinc-800"
                    )}
                    onClick={() => setPlaybackRate(rate)}
                    type="button"
                  >
                    {rate}x
                  </button>
                ))}
              </div>
            </div>

            {/* ── Shared controls (herkesi etkiler) ── */}
            <div className="flex flex-wrap items-center gap-1.5 border-t border-zinc-800/40 bg-zinc-950 px-3 py-2">
              <span className="text-[10px] text-zinc-600 mr-1">Ortak:</span>

              {/* Baştan */}
              <button
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800 disabled:opacity-40"
                disabled={!isRoomOwner}
                onClick={() => {
                  // Seek iframe to 0 immediately (no reload) then record the event
                  sendYTCommand("seekTo", [0, true]);
                  sendYTCommand("playVideo");
                  setIsLocalPaused(false);
                  setLocalPauseAt(null);
                  void insertEvent({
                    action: "queue_replay",
                    video: projection.currentVideo!,
                  });
                }}
                title="Videoyu baştan başlat (herkes için)"
                type="button"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Baştan</span>
              </button>

              {/* Sonraki */}
              <button
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800 disabled:opacity-40"
                disabled={projection.queue.length === 0 || !isRoomOwner}
                onClick={() =>
                  void insertEvent({
                    action: "queue_play",
                    video: projection.queue[0],
                  })
                }
                title="Sıradaki videoyu oynat"
                type="button"
              >
                <SkipForward className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Sonraki</span>
              </button>

              {/* Kapat — sıraya geri koyar */}
              <button
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800 disabled:opacity-40"
                disabled={!isRoomOwner}
                onClick={() =>
                  void insertEvent({
                    action: "queue_stop",
                    video: projection.currentVideo!,
                  })
                }
                title="Videoyu sıraya geri koy"
                type="button"
              >
                <StopCircle className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Kapat</span>
              </button>

              <div className="flex-1" />

              {/* Queue count */}
              <span className="text-[11px] text-zinc-500">
                <ListVideo className="mr-1 inline h-3.5 w-3.5 align-text-bottom" />
                {projection.queue.length}
              </span>

              {/* Temizle */}
              <button
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-800/60 bg-red-600/20 px-2.5 py-1.5 text-xs font-medium text-red-200 transition-colors hover:bg-red-600/30 disabled:opacity-40"
                disabled={(!projection.currentVideo && projection.queue.length === 0) || !isRoomOwner}
                onClick={() => void insertEvent({ action: "queue_clear" })}
                title="Şu anki videoyu ve sırayı temizle"
                type="button"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Temizle</span>
              </button>
            </div>
          </>
        ) : (
          /* Empty player placeholder */
          <div className="flex aspect-video w-full items-center justify-center bg-zinc-950/70">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900">
                <Play className="h-6 w-6 text-zinc-500" />
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-400">Oynatılacak video yok</p>
                <p className="mt-0.5 text-xs text-zinc-600">
                  Sıraya video ekle ve Oynat&#39;a bas
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Play from queue button when nothing is playing */}
        {!projection.currentVideo && projection.queue.length > 0 && (
          <div className="flex items-center justify-between border-t border-zinc-800/60 bg-zinc-950 px-3 py-2">
            <button
              className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-700/60 bg-cyan-600/20 px-3 py-1.5 text-xs font-medium text-cyan-100 transition-colors hover:bg-cyan-600/30"
              disabled={!isRoomOwner}
              onClick={() =>
                void insertEvent({ action: "queue_play", video: projection.queue[0] })
              }
              type="button"
            >
              <Play className="h-3.5 w-3.5" />
              Oynat
            </button>

            <button
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-800/60 bg-red-600/20 px-3 py-1.5 text-xs font-medium text-red-200 transition-colors hover:bg-red-600/30"
              disabled={!isRoomOwner}
              onClick={() => void insertEvent({ action: "queue_clear" })}
              type="button"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Temizle
            </button>

            <p className="text-[11px] text-zinc-500">
              <ListVideo className="mr-1 inline h-3.5 w-3.5 align-text-bottom" />
              {projection.queue.length} video
            </p>
          </div>
        )}
      </div>

      {/* ── Link input ── */}
      <div className="shrink-0 border-t border-zinc-800 px-3 py-2">
        <input
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 outline-none transition-colors placeholder:text-zinc-500 focus:border-cyan-600/60 focus:ring-1 focus:ring-cyan-600/30"
          onChange={(event) => setWatchUrlInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void addVideoToQueue();
            }
          }}
          placeholder="YouTube link veya video ID — Enter ile ekle"
          value={watchUrlInput}
        />
        {error ? (
          <p className="mt-1 text-[11px] text-red-300">{error}</p>
        ) : loading ? (
          <p className="mt-1 text-[11px] text-zinc-500">Yükleniyor...</p>
        ) : null}
      </div>

      {/* ── Queue ── */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-3 pb-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
              <ListVideo className="h-3.5 w-3.5" />
              Sıra ({projection.queue.length})
            </p>
          </div>

          {projection.queue.length === 0 ? (
            <p className="text-[11px] text-zinc-600">
              Sıra boş — link ekle ya da sohbetten Evet&#39;e bas.
            </p>
          ) : (
            <div className="space-y-2">
              {projection.queue.map((item, index) => (
                <div
                  key={item.videoId}
                  className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-2 transition-colors hover:bg-zinc-900"
                >
                  <span className="w-4 shrink-0 text-center text-[11px] font-bold text-zinc-600">
                    {index + 1}
                  </span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt={item.title}
                    className="h-9 w-16 shrink-0 rounded object-cover"
                    src={item.thumbnailUrl}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-1 text-xs font-medium text-zinc-100">{item.title}</p>
                    <p className="text-[11px] text-zinc-500">{item.channelTitle}</p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    <button
                      className="rounded border border-cyan-700/60 bg-cyan-600/20 px-2 py-0.5 text-[11px] text-cyan-100 hover:bg-cyan-600/30 disabled:opacity-50"
                      disabled={!isRoomOwner}
                      onClick={() => void insertEvent({ action: "queue_play", video: item })}
                      title="Bu videoyu şimdi oynat"
                      type="button"
                    >
                      Oynat
                    </button>
                    <button
                      className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
                      disabled={!isRoomOwner}
                      onClick={() => void insertEvent({ action: "queue_remove", video: item })}
                      title="Sıradan kaldır"
                      type="button"
                    >
                      Kaldır
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
