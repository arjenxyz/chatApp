"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { Check, ChevronDown, ChevronUp, Copy, ExternalLink, FastForward, Gauge, Link2, ListVideo, Pause, Play, Rewind, RotateCcw, SkipForward, StopCircle, Trash2, UserPlus, Volume2, VolumeX } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { WatchPartyTerms } from "./WatchPartyTerms";
import {
  encodeWatchPartyEvent,
  parseWatchPartyBotPayload,
  type WatchPartyEventPayload,
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

  // Terms
  const [termsAccepted, setTermsAccepted] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(TERMS_KEY) === "true";
  });

  const [sharedPaused, setSharedPaused] = useState(false);
  const [sharedMuted, setSharedMuted] = useState(false);
  const [sharedPlaybackRate, setSharedPlaybackRate] = useState(1);
  const [syncAnchorMs, setSyncAnchorMs] = useState<number | null>(null);
  const [pausedPositionSec, setPausedPositionSec] = useState<number | null>(null);

  const [roomOwnerId, setRoomOwnerId] = useState<string | null>(null);

  // Invite panel
  const [showInvitePanel, setShowInvitePanel] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [friends, setFriends] = useState<FriendItem[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<{ [friendId: string]: boolean }>({});
  const [copiedLink, setCopiedLink] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const lastAppliedPlaybackEventIdRef = useRef<string | null>(null);
  const realtimeChannelRef = useRef<RealtimeChannel | null>(null);
  const currentVideoIdRef = useRef<string | null>(null);
  const syncAnchorMsRef = useRef<number | null>(null);
  const sharedPausedRef = useRef(false);
  const pausedPositionSecRef = useRef<number | null>(null);
  const sharedMutedRef = useRef(false);
  const sharedPlaybackRateRef = useRef(1);
  const lastBroadcastSyncAtRef = useRef(0);

  const actorName = buildActorName(user);
  const projection = useMemo(() => projectQueueFromMessages(messages), [messages]);
  const isRoomOwner = Boolean(user?.id && roomOwnerId && user.id === roomOwnerId);
  const currentVideoId = projection.currentVideo?.videoId ?? null;

  const sendYTCommand = useCallback((func: string, args?: unknown[]) => {
    const targetWindow = iframeRef.current?.contentWindow;
    if (!targetWindow) return;
    const payload = { event: "command", func, args: args ?? [] };
    targetWindow.postMessage(JSON.stringify(payload), "*");
    targetWindow.postMessage(payload, "*");
  }, []);

  useEffect(() => {
    currentVideoIdRef.current = currentVideoId;
  }, [currentVideoId]);

  useEffect(() => {
    syncAnchorMsRef.current = syncAnchorMs;
  }, [syncAnchorMs]);

  useEffect(() => {
    sharedPausedRef.current = sharedPaused;
  }, [sharedPaused]);

  useEffect(() => {
    pausedPositionSecRef.current = pausedPositionSec;
  }, [pausedPositionSec]);

  useEffect(() => {
    sharedMutedRef.current = sharedMuted;
  }, [sharedMuted]);

  useEffect(() => {
    sharedPlaybackRateRef.current = sharedPlaybackRate;
  }, [sharedPlaybackRate]);

  // Notify parent when the playing video changes
  useEffect(() => {
    onNowPlayingChange?.(projection.currentVideo, projection.currentVideoStartedAt);
    if (projection.currentVideoStartedAt) {
      setSyncAnchorMs(new Date(projection.currentVideoStartedAt).getTime());
    } else {
      setSyncAnchorMs(null);
    }
    setSharedPaused(false);
    setPausedPositionSec(null);
    setSharedMuted(false);
    setSharedPlaybackRate(1);
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
      .on("broadcast", { event: "wp-sync" }, (packet: unknown) => {
        const payload = (packet as { payload?: unknown } | null)?.payload as {
          videoId?: string;
          positionSec?: number;
          paused?: boolean;
          muted?: boolean;
          playbackRate?: number;
          sentAtMs?: number;
        };

        const activeVideoId = currentVideoIdRef.current;
        if (!activeVideoId || payload.videoId !== activeVideoId) return;

        lastBroadcastSyncAtRef.current = Date.now();

        const paused = Boolean(payload.paused);
        const muted = Boolean(payload.muted);
        const playbackRate =
          typeof payload.playbackRate === "number" && Number.isFinite(payload.playbackRate)
            ? payload.playbackRate
            : 1;
        const basePosition =
          typeof payload.positionSec === "number" && Number.isFinite(payload.positionSec)
            ? payload.positionSec
            : 0;
        const sentAtMs =
          typeof payload.sentAtMs === "number" && Number.isFinite(payload.sentAtMs)
            ? payload.sentAtMs
            : Date.now();
        const networkDeltaSec = Math.max(0, (Date.now() - sentAtMs) / 1000);
        const incomingPosition = paused ? Math.max(0, basePosition) : Math.max(0, basePosition + networkDeltaSec);

        const localExpected = sharedPausedRef.current
          ? Math.max(0, pausedPositionSecRef.current ?? 0)
          : Math.max(0, syncAnchorMsRef.current !== null ? (Date.now() - syncAnchorMsRef.current) / 1000 : 0);

        if (Math.abs(incomingPosition - localExpected) > 0.25) {
          sendYTCommand("seekTo", [incomingPosition, true]);
        }

        if (paused) {
          setSharedPaused(true);
          setPausedPositionSec(incomingPosition);
          sendYTCommand("pauseVideo");
        } else {
          setSharedPaused(false);
          setPausedPositionSec(null);
          setSyncAnchorMs(Date.now() - incomingPosition * 1000);
          sendYTCommand("playVideo");
        }

        setSharedPlaybackRate(playbackRate);
        sendYTCommand("setPlaybackRate", [playbackRate]);

        setSharedMuted(muted);
        if (muted) {
          sendYTCommand("setVolume", [0]);
          sendYTCommand("mute");
        } else {
          sendYTCommand("setVolume", [100]);
          sendYTCommand("unMute");
        }
      })
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

    realtimeChannelRef.current = channel;

    return () => {
      cancelled = true;
      realtimeChannelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [conversationId, isGroupConversation, sendYTCommand, supabase, user]);

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

  const getSharedElapsed = useCallback((): number => {
    if (sharedPaused) return Math.max(0, pausedPositionSec ?? 0);
    if (syncAnchorMs === null) return 0;
    return Math.max(0, (Date.now() - syncAnchorMs) / 1000);
  }, [pausedPositionSec, sharedPaused, syncAnchorMs]);

  const toggleSharedPause = useCallback(() => {
    const positionSec = getSharedElapsed();
    if (sharedPaused) {
      void insertEvent({ action: "player_resume", video: projection.currentVideo ?? undefined, positionSec });
      return;
    }
    void insertEvent({ action: "player_pause", video: projection.currentVideo ?? undefined, positionSec });
  }, [getSharedElapsed, insertEvent, projection.currentVideo, sharedPaused]);

  const toggleSharedMute = useCallback(() => {
    void insertEvent({
      action: sharedMuted ? "player_unmute" : "player_mute",
      video: projection.currentVideo ?? undefined
    });
  }, [insertEvent, projection.currentVideo, sharedMuted]);

  const setSharedRate = useCallback((rate: number) => {
    void insertEvent({ action: "player_rate", video: projection.currentVideo ?? undefined, playbackRate: rate });
  }, [insertEvent, projection.currentVideo]);

  const seekShared = useCallback((delta: number) => {
    const positionSec = Math.max(0, getSharedElapsed() + delta);
    void insertEvent({ action: "player_seek", video: projection.currentVideo ?? undefined, positionSec });
  }, [getSharedElapsed, insertEvent, projection.currentVideo]);

  const latestPlaybackEvent = useMemo(() => {
    if (!projection.currentVideo?.videoId) return null;

    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message.deleted || !isBotMessage(message.content)) continue;
      const parsed = parseWatchPartyBotPayload(stripBotPrefix(message.content));
      if (!parsed || parsed.kind !== "event") continue;
      const action = parsed.payload.action;
      const eventVideoId = parsed.payload.video?.videoId ?? null;
      if (!eventVideoId || eventVideoId !== projection.currentVideo.videoId) continue;
      if (
        action === "player_pause" ||
        action === "player_resume" ||
        action === "player_seek" ||
        action === "player_mute" ||
        action === "player_unmute" ||
        action === "player_rate"
      ) {
        return {
          id: message.id,
          createdAt: message.created_at,
          payload: parsed.payload
        };
      }
    }
    return null;
  }, [messages, projection.currentVideo?.videoId]);

  useEffect(() => {
    if (!latestPlaybackEvent) return;
    if (lastAppliedPlaybackEventIdRef.current === latestPlaybackEvent.id) return;
    lastAppliedPlaybackEventIdRef.current = latestPlaybackEvent.id;

    const { action, positionSec, playbackRate } = latestPlaybackEvent.payload;
    const eventMs = new Date(latestPlaybackEvent.createdAt).getTime();

    if (action === "player_pause") {
      const nextPos = Math.max(0, positionSec ?? getSharedElapsed());
      setSharedPaused(true);
      setPausedPositionSec(nextPos);
      sendYTCommand("seekTo", [nextPos, true]);
      sendYTCommand("pauseVideo");
      return;
    }

    if (action === "player_resume") {
      const nextPos = Math.max(0, positionSec ?? pausedPositionSec ?? 0);
      setSharedPaused(false);
      setPausedPositionSec(null);
      setSyncAnchorMs(eventMs - nextPos * 1000);
      sendYTCommand("seekTo", [nextPos, true]);
      sendYTCommand("playVideo");
      return;
    }

    if (action === "player_seek") {
      const nextPos = Math.max(0, positionSec ?? 0);
      if (sharedPaused) {
        setPausedPositionSec(nextPos);
      } else {
        setSyncAnchorMs(eventMs - nextPos * 1000);
      }
      sendYTCommand("seekTo", [nextPos, true]);
      if (!sharedPaused) sendYTCommand("playVideo");
      return;
    }

    if (action === "player_mute") {
      setSharedMuted(true);
      sendYTCommand("setVolume", [0]);
      sendYTCommand("mute");
      return;
    }

    if (action === "player_unmute") {
      setSharedMuted(false);
      sendYTCommand("setVolume", [100]);
      sendYTCommand("unMute");
      return;
    }

    if (action === "player_rate") {
      const nextRate = playbackRate ?? 1;
      setSharedPlaybackRate(nextRate);
      sendYTCommand("setPlaybackRate", [nextRate]);
    }
  }, [getSharedElapsed, latestPlaybackEvent, pausedPositionSec, sendYTCommand, sharedPaused]);

  useEffect(() => {
    if (!isRoomOwner || !projection.currentVideo) return;

    const sendSyncPacket = () => {
      const channel = realtimeChannelRef.current;
      if (!channel) return;

      void channel.send({
        type: "broadcast",
        event: "wp-sync",
        payload: {
          videoId: projection.currentVideo?.videoId,
          positionSec: getSharedElapsed(),
          paused: sharedPaused,
          muted: sharedMuted,
          playbackRate: sharedPlaybackRate,
          sentAtMs: Date.now()
        }
      });
    };

    sendSyncPacket();
    const syncTimer = window.setInterval(sendSyncPacket, 400);
    return () => {
      window.clearInterval(syncTimer);
    };
  }, [getSharedElapsed, isRoomOwner, projection.currentVideo, sharedMuted, sharedPaused, sharedPlaybackRate]);

  useEffect(() => {
    if (!projection.currentVideo || sharedPaused || isRoomOwner) return;

    const tick = () => {
      if (Date.now() - lastBroadcastSyncAtRef.current < 1500) return;
      const expectedPos = getSharedElapsed();
      sendYTCommand("seekTo", [expectedPos, true]);
      sendYTCommand("setPlaybackRate", [sharedPlaybackRate]);
      if (sharedMuted) {
        sendYTCommand("setVolume", [0]);
        sendYTCommand("mute");
      } else {
        sendYTCommand("setVolume", [100]);
        sendYTCommand("unMute");
      }
      sendYTCommand("playVideo");
    };

    tick();
    const interval = window.setInterval(tick, 1000);
    return () => {
      window.clearInterval(interval);
    };
  }, [getSharedElapsed, isRoomOwner, projection.currentVideo, sendYTCommand, sharedMuted, sharedPaused, sharedPlaybackRate]);

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
    if (showInviteModal) void loadFriends();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showInviteModal]);

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

          <button
            className="inline-flex items-center gap-2 rounded-lg border border-cyan-700/60 bg-cyan-600/20 px-3 py-2 text-xs font-semibold text-cyan-100 transition-colors hover:bg-cyan-600/30"
            onClick={() => setShowInviteModal(true)}
            type="button"
          >
            <UserPlus className="h-3.5 w-3.5" />
            Arkadaşlarını davet et
          </button>
        </div>
      )}

      {showInviteModal ? (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <div className="flex max-h-[70vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-950 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
              <p className="text-sm font-semibold text-zinc-100">Arkadaşlarını davet et</p>
              <button
                className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
                onClick={() => setShowInviteModal(false)}
                type="button"
              >
                Kapat
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {friendsLoading ? (
                <p className="text-[11px] text-zinc-500">Yükleniyor...</p>
              ) : friends.length === 0 ? (
                <p className="text-[11px] text-zinc-600">Arkadaş bulunamadı.</p>
              ) : (
                <div className="space-y-1.5">
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
          </div>
        </div>
      ) : null}

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

            {/* ── Shared playback controls (owner only) ── */}
            <div className="flex flex-wrap items-center gap-1.5 border-t border-zinc-800/60 bg-zinc-950/80 px-3 py-2">
              <span className="text-[10px] text-zinc-600 mr-1">Ortak Oynatma:</span>

              {/* Duraklat / Devam */}
              <button
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800 disabled:opacity-40"
                disabled={!isRoomOwner}
                onClick={toggleSharedPause}
                title={sharedPaused ? "Devam et (herkes için)" : "Duraklat (herkes için)"}
                type="button"
              >
                {sharedPaused ? (
                  <Play className="h-3.5 w-3.5 text-cyan-400" />
                ) : (
                  <Pause className="h-3.5 w-3.5" />
                )}
                <span className="hidden sm:inline">
                  {sharedPaused ? "Devam" : "Duraklat"}
                </span>
              </button>

              {/* -10s */}
              <button
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800 disabled:opacity-40"
                disabled={!isRoomOwner}
                onClick={() => seekShared(-10)}
                title="-10 saniye (herkes için)"
                type="button"
              >
                <Rewind className="h-3.5 w-3.5" />
                <span className="hidden sm:inline text-[11px]">-10s</span>
              </button>

              {/* +10s */}
              <button
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800 disabled:opacity-40"
                disabled={!isRoomOwner}
                onClick={() => seekShared(10)}
                title="+10 saniye (herkes için)"
                type="button"
              >
                <FastForward className="h-3.5 w-3.5" />
                <span className="hidden sm:inline text-[11px]">+10s</span>
              </button>

              {/* Mute */}
              <button
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800 disabled:opacity-40"
                disabled={!isRoomOwner}
                onClick={toggleSharedMute}
                title={sharedMuted ? "Sesi aç (herkes için)" : "Sessiz (herkes için)"}
                type="button"
              >
                {sharedMuted ? (
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
                    disabled={!isRoomOwner}
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-40",
                      sharedPlaybackRate === rate
                        ? "bg-cyan-600/30 text-cyan-100"
                        : "text-zinc-300 hover:bg-zinc-800"
                    )}
                    onClick={() => setSharedRate(rate)}
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
                  setSharedPaused(false);
                  setPausedPositionSec(null);
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

      {/* Link/ID input kaldırıldı: videolar sohbetten otomatik sıraya eklenir */}
      {error ? (
        <div className="shrink-0 border-t border-zinc-800 px-3 py-2">
          <p className="text-[11px] text-red-300">{error}</p>
        </div>
      ) : loading ? (
        <div className="shrink-0 border-t border-zinc-800 px-3 py-2">
          <p className="text-[11px] text-zinc-500">Yükleniyor...</p>
        </div>
      ) : null}

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
