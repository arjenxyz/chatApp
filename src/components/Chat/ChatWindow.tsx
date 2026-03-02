"use client";

import {
  AlertCircle,
  ArrowLeft,
  Bell,
  BellOff,
  Check,
  Copy,
  ImagePlus,
  Pencil,
  Plus,
  Reply,
  SendHorizontal,
  Shield,
  Sticker,
  Trash2,
  Upload,
  X
} from "lucide-react";
import LinkifyIt from "linkify-it";
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

type MessageStickerRowRaw = {
  id: string;
  name: string;
  image_url: string;
  created_by: string;
};

type MessageSticker = MessageStickerRowRaw | null;

type MessageRowRaw = {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  type: "text" | "image" | "sticker";
  media_url?: string | null;
  sticker_id?: string | null;
  sticker?: MessageStickerRowRaw | MessageStickerRowRaw[] | null;
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
  type: "text" | "image" | "sticker";
  replied_to: MessageReply | null;
  created_at: string;
  is_read: boolean;
  deleted: boolean;
  edited: boolean;
  mediaUrl: string | null;
  sticker: MessageSticker;
}

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

function normalizeSticker(row: MessageStickerRowRaw | MessageStickerRowRaw[] | null): MessageSticker {
  if (!row) return null;
  if (Array.isArray(row)) return row[0] ?? null;
  return row;
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
    edited: row.edited ?? false,
    mediaUrl: row.media_url ?? null,
    sticker: normalizeSticker(row.sticker ?? null)
  };
}

const CHAT_MEDIA_BUCKET = "chat-media";
const ALLOWED_MEDIA_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml"
];
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;

const linkify = new LinkifyIt();
const PHONE_REGEX = /\+?\d[\d\s\-]{6,}\d/g;

type LinkSegment = {
  text: string;
  href?: string;
};

type EmojiCategory = {
  id: string;
  label: string;
  icon: string;
  items: string[];
};

const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: "people",
    label: "İfadeler",
    icon: "😀",
    items: ["😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "😇", "🙂", "🙃", "😉", "😌", "😍", "🤩"]
  },
  {
    id: "gestures",
    label: "El hareketleri",
    icon: "🤝",
    items: ["👍", "👎", "👏", "🙌", "🤟", "🤘", "👌", "✌️", "🤞", "🤙", "👋", "🤚", "🫶"]
  },
  {
    id: "nature",
    label: "Doğa",
    icon: "🌸",
    items: ["🌸", "🌼", "🌻", "🌞", "🌚", "🌈", "☀️", "⛅", "🌊", "🌧️", "🌿", "🍃", "🍀", "🌳", "🌲", "🌴"]
  },
  {
    id: "objects",
    label: "Nesneler",
    icon: "🎉",
    items: ["🎉", "🎁", "🎈", "🎮", "🎧", "📸", "💡", "📌", "🧠", "🕹️", "🎨", "🧵", "💬", "🔔"]
  }
];

function splitSegmentsByPhone(segments: LinkSegment[]): LinkSegment[] {
  const results: LinkSegment[] = [];
  segments.forEach((segment) => {
    if (segment.href) {
      results.push(segment);
      return;
    }

    let cursor = 0;
    PHONE_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = PHONE_REGEX.exec(segment.text)) !== null) {
      if (match.index > cursor) {
        results.push({ text: segment.text.slice(cursor, match.index) });
      }
      const phoneText = match[0];
      const normalized = phoneText.replace(/[^+\d]/g, "");
      results.push({ text: phoneText, href: normalized ? `tel:${normalized}` : undefined });
      cursor = match.index + phoneText.length;
    }

    if (cursor < segment.text.length) {
      results.push({ text: segment.text.slice(cursor) });
    }
  });
  return results;
}

function buildLinkSegments(text: string): LinkSegment[] {
  if (!text) return [];
  const matches = linkify.match(text) ?? [];
  if (matches.length === 0) {
    return splitSegmentsByPhone([{ text }]);
  }

  const segments: LinkSegment[] = [];
  let cursor = 0;
  matches.forEach((match) => {
    const start = match.index ?? 0;
    const end = match.lastIndex ?? start + match.raw.length;
    if (start > cursor) {
      segments.push({ text: text.slice(cursor, start) });
    }
    segments.push({ text: match.raw, href: match.url });
    cursor = end;
  });
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor) });
  }

  return splitSegmentsByPhone(segments);
}

function renderLinkifiedText(text: string) {
  const segments = buildLinkSegments(text);
  if (segments.length === 0) return <>{text}</>;

  return segments.map((segment, index) => {
    const key = `${segment.text}-${index}`;
    if (!segment.href) {
      return <React.Fragment key={key}>{segment.text}</React.Fragment>;
    }
    const inputType = segment.href.startsWith("tel:") || segment.href.startsWith("mailto:");
    return (
      <a
        key={key}
        href={segment.href}
        target={inputType ? undefined : "_blank"}
        rel={inputType ? undefined : "noreferrer"}
        className="text-emerald-300 underline underline-offset-2 transition-colors hover:text-emerald-200"
      >
        {segment.text}
      </a>
    );
  });
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
  const [muted, setMuted] = useState(false);
  const [blockStatus, setBlockStatus] = useState<"none" | "blockedByMe" | "blockedByOther">("none");
  const [stickers, setStickers] = useState<MessageStickerRowRaw[]>([]);
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const [selectedMediaTab, setSelectedMediaTab] = useState<"emoji" | "sticker" | "gif">("emoji");
  const [hasUnreadMessages, setHasUnreadMessages] = useState(false);
  const [selectedEmojiCategory, setSelectedEmojiCategory] = useState(EMOJI_CATEGORIES[0]?.id ?? "people");
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [attachmentPreview, setAttachmentPreview] = useState<string | null>(null);
  const [stickerUploadName, setStickerUploadName] = useState("");
  const [stickerUploadFile, setStickerUploadFile] = useState<File | null>(null);
  const [stickerUploadPreview, setStickerUploadPreview] = useState<string | null>(null);
  const [stickerUploadError, setStickerUploadError] = useState<string | null>(null);
  const [stickerUploading, setStickerUploading] = useState(false);
  const [stickerDeleting, setStickerDeleting] = useState<string | null>(null);
  const [pendingStickers, setPendingStickers] = useState<MessageStickerRowRaw[]>([]);
  const [rejectedStickers, setRejectedStickers] = useState<Array<MessageStickerRowRaw & { rejection_reason?: string }>>(
    []
  );
  const [isAdmin, setIsAdmin] = useState(false);
  const [allPendingStickers, setAllPendingStickers] = useState<Array<MessageStickerRowRaw & { creator_username?: string }>>(
    []
  );
  const [showModerationPanel, setShowModerationPanel] = useState(false);
  const [gifSearchQuery, setGifSearchQuery] = useState("");
  const [gifs, setGifs] = useState<Array<{ id: string; url: string; title: string; images: { fixed_height: { url: string } } }>>([]);
  const [gifsLoading, setGifsLoading] = useState(false);

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
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const stickerUploadInputRef = useRef<HTMLInputElement | null>(null);

  const trimmedText = text.trim();
  const blockedByOther = blockStatus === "blockedByOther";
  const hasTextForMessage = trimmedText.length > 0;
  const canSend =
    Boolean(user && conversationId && networkOnline && !sending && !sendingRef.current && !blockedByOther) &&
    (editingTarget ? hasTextForMessage : hasTextForMessage || Boolean(attachmentFile));

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
    await supabase.rpc("mark_conversation_read", {
      p_conversation_id: conversationId
    });

  }, [conversationId, supabase]);

  const sendTypingStatus = useCallback(
    async (isTyping: boolean) => {
      if (!typingChannelRef.current || !user || !conversationId) return;

      try {
        await typingChannelRef.current.send({
          type: "broadcast",
          event: "typing",
          payload: {
            conversationId,
            userId: user.id,
            isTyping
          }
        });

      } catch {
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

      await fetch("/api/push/message", {
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


    },
    [conversationId, supabase.auth]
  );

  const loadStickers = useCallback(async () => {
    if (!user) return;

    // Check if user is admin
    const { data: profileData } = await supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .single();
    
    const adminStatus = profileData?.is_admin === true; // Strictly check for true, not truthy values
    console.log("[loadStickers] User ID:", user.id, "Admin status:", adminStatus, "Profile data:", profileData);
    setIsAdmin(adminStatus);

    const { data, error } = await supabase
      .from("stickers")
      .select("id, name, image_url, created_by, approved, rejection_reason")
      .order("created_at", { ascending: false })
      .limit(80);
    if (error) {
      console.warn("[stickers] load failed:", error.message);
      return;
    }
    
    const approved = (data ?? []).filter((s: MessageStickerRowRaw & { approved?: boolean; rejection_reason?: string | null }) => s.approved);
    const pending = (data ?? []).filter((s: MessageStickerRowRaw & { approved?: boolean; rejection_reason?: string | null }) => !s.approved && !s.rejection_reason && s.created_by === user.id);
    const rejected = (data ?? []).filter((s: MessageStickerRowRaw & { approved?: boolean; rejection_reason?: string | null }) => !s.approved && s.rejection_reason && s.created_by === user.id);
    setStickers(approved);
    setPendingStickers(pending);
    setRejectedStickers(rejected);

    // If admin, load all pending stickers with creator info
    if (adminStatus) {
      const { data: allPending } = await supabase
        .from("stickers")
        .select(`
          id,
          name,
          image_url,
          created_by,
          created_at,
          creator:profiles(username)
        `)
        .eq("approved", false)
        .is("rejection_reason", null)
        .order("created_at", { ascending: true });
      
      if (allPending) {
        setAllPendingStickers(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          allPending.map((s: any) => ({
            ...s,
            creator_username: s.creator && Array.isArray(s.creator) ? s.creator[0]?.username : (s.creator as { username?: string })?.username
          }))
        );
      } else {
        setAllPendingStickers([]);
      }
    } else {
      console.log("[loadStickers] Not admin, skipping pending stickers load");
      setAllPendingStickers([]);
    }
  }, [supabase, user]);

  const refreshNotificationSettings = useCallback(async () => {
    if (!user || !conversationId) {
      setMuted(false);
      return;
    }

    const { data, error } = await supabase
      .from("conversation_notification_settings")
      .select("muted")
      .match({ conversation_id: conversationId, user_id: user.id })
      .maybeSingle();

    if (error) {
      console.warn("[notifications] load failed:", error.message);
      return;
    }

    setMuted(data?.muted ?? false);
  }, [conversationId, supabase, user]);

  const toggleMute = useCallback(async () => {
    if (!user || !conversationId) return;
    const targetMute = !muted;

    const { data, error } = await supabase
      .from("conversation_notification_settings")
      .upsert({
        conversation_id: conversationId,
        user_id: user.id,
        muted: targetMute,
        updated_at: new Date().toISOString()
      }, { onConflict: 'conversation_id,user_id' })
      .select("muted")
      .single();

    if (error) {
      setError(error.message);
      return;
    }

    setMuted(data?.muted ?? targetMute);
  }, [conversationId, muted, supabase, user]);

  const refreshBlockStatus = useCallback(async () => {
    if (!user || !otherUserId) {
      setBlockStatus("none");
      return;
    }

    // Check if current user blocked the other user
    const { data: blockedByMe, error: errorByMe } = await supabase
      .from("user_blocks")
      .select("blocker_id, blocked_id")
      .eq("blocker_id", user.id)
      .eq("blocked_id", otherUserId)
      .maybeSingle();

    if (errorByMe) {

    }

    if (blockedByMe) {
      setBlockStatus("blockedByMe");
      return;
    }

    // Check if other user blocked current user
    const { data: blockedByOther, error: errorByOther } = await supabase
      .from("user_blocks")
      .select("blocker_id, blocked_id")
      .eq("blocker_id", otherUserId)
      .eq("blocked_id", user.id)
      .maybeSingle();

    if (errorByOther) {
      console.warn("[blocks] status failed:", errorByOther.message);
      return;
    }

    if (blockedByOther) {
      setBlockStatus("blockedByOther");
      return;
    }

    setBlockStatus("none");
  }, [otherUserId, supabase, user]);

  const handleBlockToggle = useCallback(async () => {
    if (!user || !otherUserId) return;
    if (typeof window === "undefined") return;

    const isCurrentlyBlocked = blockStatus === "blockedByMe";
    const message = isCurrentlyBlocked
      ? "Engellemeyi kaldırmak istediğine emin misin?"
      : "Bu kullanıcıyı engellemek istediğine emin misin?";

    if (!window.confirm(message)) return;

    if (isCurrentlyBlocked) {
      const { error } = await supabase
        .from("user_blocks")
        .delete()
        .match({ blocker_id: user.id, blocked_id: otherUserId });
      if (error) {
        setError(error.message);
        return;
      }
      setBlockStatus("none");
      return;
    }

    const { error } = await supabase
      .from("user_blocks")
      .insert({ blocker_id: user.id, blocked_id: otherUserId });
    if (error) {
      setError(error.message);
      return;
    }

    setBlockStatus("blockedByMe");
  }, [blockStatus, otherUserId, supabase, user]);

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

  const uploadMedia = useCallback(
    async (file: File) => {
      if (!conversationId || !user) throw new Error("Eksik bilgiler");
      const sanitizedName = encodeURIComponent(file.name.replace(/[^a-zA-Z0-9._-]/g, "_"));
      const path = `${conversationId}/${user.id}/${Date.now()}-${sanitizedName}`;
      console.log("[uploadMedia] Uploading to path:", path);
      const { error } = await supabase.storage.from(CHAT_MEDIA_BUCKET).upload(path, file, { upsert: true });
      if (error) {
        console.error("[uploadMedia] Upload error:", error);
        throw error;
      }
      console.log("[uploadMedia] Upload successful");
      const { data } = supabase.storage.from(CHAT_MEDIA_BUCKET).getPublicUrl(path);
      console.log("[uploadMedia] Public URL:", data.publicUrl);
      return data.publicUrl;
    },
    [conversationId, supabase, user]
  );

  const handleAttachmentChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      if (!ALLOWED_MEDIA_MIME_TYPES.includes(file.type)) {
        setError("Bu dosya türü desteklenmiyor.");
        event.target.value = "";
        return;
      }
      if (file.size > MAX_ATTACHMENT_SIZE) {
        setError("Dosya 10MB'den büyük olamaz.");
        event.target.value = "";
        return;
      }
      setError(null);
      if (attachmentPreview) {
        URL.revokeObjectURL(attachmentPreview);
      }
      setAttachmentFile(file);
      setAttachmentPreview(URL.createObjectURL(file));
      event.target.value = "";
    },
    [attachmentPreview]
  );

  const clearAttachment = useCallback(() => {
    if (attachmentPreview) {
      URL.revokeObjectURL(attachmentPreview);
    }
    setAttachmentFile(null);
    setAttachmentPreview(null);
    if (attachmentInputRef.current) {
      attachmentInputRef.current.value = "";
    }
  }, [attachmentPreview]);

  const handleStickerUploadChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!ALLOWED_MEDIA_MIME_TYPES.includes(file.type)) {
      setStickerUploadError("Bu dosya türü desteklenmiyor.");
      event.target.value = "";
      return;
    }
    if (file.size > MAX_ATTACHMENT_SIZE) {
      setStickerUploadError("Dosya 10MB'den büyük olamaz.");
      event.target.value = "";
      return;
    }
    setStickerUploadError(null);
    setStickerUploadFile(file);
    setStickerUploadPreview(URL.createObjectURL(file));
    event.target.value = "";
  }, []);

  const handleStickerUpload = useCallback(async () => {
    if (!user) return;
    if (!stickerUploadName.trim()) {
      setStickerUploadError("Sticker adı gerekli.");
      return;
    }
    if (!stickerUploadFile) {
      setStickerUploadError("Bir sticker dosyası seçmelisin.");
      return;
    }

    setStickerUploading(true);
    setStickerUploadError(null);

    try {
      const sanitizedName = encodeURIComponent(stickerUploadFile.name.replace(/[^a-zA-Z0-9._-]/g, "_"));
      const path = `stickers/${user.id}/${Date.now()}-${sanitizedName}`;
      const { error: uploadErr } = await supabase.storage.from(CHAT_MEDIA_BUCKET).upload(path, stickerUploadFile, { upsert: true });
      if (uploadErr) throw uploadErr;
      const { data: urlData } = supabase.storage.from(CHAT_MEDIA_BUCKET).getPublicUrl(path);
      const { error: insertError } = await supabase.from("stickers").insert({
        name: stickerUploadName.trim(),
        image_url: urlData.publicUrl,
        created_by: user.id,
        approved: false
      });
      if (insertError) throw insertError;
      setStickerUploadError(null);
      setStickerUploadName("");
      setStickerUploadFile(null);
      if (stickerUploadPreview) {
        URL.revokeObjectURL(stickerUploadPreview);
      }
      setStickerUploadPreview(null);
      if (stickerUploadInputRef.current) {
        stickerUploadInputRef.current.value = "";
      }
      // Show success message
      setTimeout(() => {
        setStickerUploadError(null);
      }, 2000);
      await loadStickers();
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : "Sticker yüklenemedi.";
      setStickerUploadError(message);
    } finally {
      setStickerUploading(false);
    }
  }, [loadStickers, stickerUploadFile, stickerUploadName, stickerUploadPreview, supabase, user]);

  const handleStickerDelete = useCallback(
    async (stickerId: string) => {
      if (!user) return;
      if (!window.confirm("Bu stickeri silmek istediğine emin misin?")) return;

      setStickerDeleting(stickerId);
      try {
        console.log("[sticker-delete] Deleting sticker:", stickerId, "User ID:", user.id);
        // Remove the created_by filter - RLS will handle the authorization
        const { data, error } = await supabase.from("stickers").delete().eq("id", stickerId).select();
        console.log("[sticker-delete] Delete response data:", data);
        console.log("[sticker-delete] Delete error:", error);
        if (error) {
          console.error("[sticker-delete] Database error details:", error);
          throw error;
        }
        console.log("[sticker-delete] Delete successful, reloading stickers");
        await loadStickers();
      } catch (deleteError) {
        const message = deleteError instanceof Error ? deleteError.message : "Sticker silinemedi.";
        console.error("[sticker-delete] Error details:", message, deleteError);
        setStickerUploadError(message);
      } finally {
        setStickerDeleting(null);
      }
    },
    [loadStickers, supabase, user]
  );

  const toggleMediaPicker = useCallback(() => {
    setMediaPickerOpen((prev) => !prev);
    if (!mediaPickerOpen) {
      // Klavyeyi kapat
      const input = inputRef.current;
      if (input) {
        input.blur();
      }
    }
  }, [mediaPickerOpen]);

  const fetchGifs = useCallback(async (query: string) => {
    if (!query.trim()) {
      setGifs([]);
      return;
    }

    setGifsLoading(true);
    try {
      const apiKey = process.env.NEXT_PUBLIC_GIPHY_API_KEY;
      const response = await fetch(
        `https://api.giphy.com/v1/gifs/search?q=${encodeURIComponent(query)}&limit=20&api_key=${apiKey}`
      );
      const data = await response.json();
      setGifs(data.data || []);
    } catch (error) {
      console.error("[gif-search] Error:", error);
      setGifs([]);
    } finally {
      setGifsLoading(false);
    }
  }, []);

  const loadTrendingGifs = useCallback(async () => {
    setGifsLoading(true);
    try {
      const apiKey = process.env.NEXT_PUBLIC_GIPHY_API_KEY;
      const response = await fetch(
        `https://api.giphy.com/v1/gifs/trending?limit=20&api_key=${apiKey}`
      );
      const data = await response.json();
      setGifs(data.data || []);
    } catch (error) {
      console.error("[gif-trending] Error:", error);
      setGifs([]);
    } finally {
      setGifsLoading(false);
    }
  }, []);

  const handleEmojiSelect = useCallback(
    (emoji: string) => {
      setText((prev) => prev + emoji);
      setTimeout(focusInputWithoutScroll, 0);
      setMediaPickerOpen(false); // Picker'ı kapat
    },
    [focusInputWithoutScroll]
  );

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
    if (!conversationId || !user) return;
    void loadStickers();
    void refreshNotificationSettings();
    void refreshBlockStatus();
  }, [conversationId, loadStickers, refreshBlockStatus, refreshNotificationSettings, user]);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    setHasUnreadMessages(false);
  }, []);

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
          .select("id, conversation_id, sender_id, content, type, replied_to(id, content, sender_id), created_at, is_read, deleted, edited, media_url, sticker_id, sticker:stickers(id, name, image_url, created_by)")
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
          let rawMessage = payload.new as MessageRowRaw;
          
          // Realtime events don't include relationship expansions, so we need to fetch the sticker if needed
          if (rawMessage.type === "sticker" && rawMessage.sticker_id && !rawMessage.sticker) {
            const { data: stickerData } = await supabase
              .from("stickers")
              .select("id, name, image_url, created_by")
              .eq("id", rawMessage.sticker_id)
              .maybeSingle();
            if (stickerData) {
              rawMessage = { ...rawMessage, sticker: stickerData };
            }
          }
          
          const withReply = await hydrateRealtimeReply(rawMessage);
          const nextMessage = normalizeMessage(withReply);

          setMessages((prev) => (prev.some((item) => item.id === nextMessage.id) ? prev : [...prev, nextMessage]));
          if (nextMessage.sender_id !== user.id) void markRead();
          
          // Handle auto-scroll: if user is near bottom, scroll automatically; otherwise show unread button
          if (autoScrollRef.current && bottomRef.current) {
            setTimeout(() => {
              bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
            }, 0);
          } else if (nextMessage.sender_id !== user.id) {
            setHasUnreadMessages(true);
          }
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
        async (payload) => {
          let rawMessage = payload.new as MessageRowRaw;
          
          // Realtime events don't include relationship expansions, so we need to fetch the sticker if needed
          if (rawMessage.type === "sticker" && rawMessage.sticker_id && !rawMessage.sticker) {
            const { data: stickerData } = await supabase
              .from("stickers")
              .select("id, name, image_url, created_by")
              .eq("id", rawMessage.sticker_id)
              .maybeSingle();
            if (stickerData) {
              rawMessage = { ...rawMessage, sticker: stickerData };
            }
          }
          
          const nextMessage = normalizeMessage(rawMessage);
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

  // Separate useEffect for block and notification listeners to avoid infinite loading loop
  useEffect(() => {
    if (!user) return;

    const blockChannel = supabase
      .channel(`block-notif:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "user_blocks",
          filter: `or(blocker_id.eq.${user.id},blocked_id.eq.${user.id})`
        },
        () => {
          void refreshBlockStatus();
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
          void refreshBlockStatus();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(blockChannel);
    };
  }, [user, refreshBlockStatus, supabase]);

  // Separate useEffect for notification settings
  useEffect(() => {
    if (!user || !conversationId) return;

    const notificationChannel = supabase
      .channel(`notif-settings:${conversationId}:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "conversation_notification_settings",
          filter: `and(conversation_id.eq.${conversationId},user_id.eq.${user.id})`
        },
        () => {
          void refreshNotificationSettings();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversation_notification_settings",
          filter: `and(conversation_id.eq.${conversationId},user_id.eq.${user.id})`
        },
        () => {
          void refreshNotificationSettings();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(notificationChannel);
    };
  }, [conversationId, user, refreshNotificationSettings, supabase]);

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

  const sendStickerMessage = useCallback(
    async (sticker: MessageStickerRowRaw) => {
      if (!user || !conversationId) return;
      if (blockedByOther) {
        setError("Bu kullanıcı seni engelledi.");
        return;
      }
      if (sendingRef.current) return;

      sendingRef.current = true;
      setSending(true);
      setError(null);
      autoScrollRef.current = true;

      try {
        const payload = {
          conversation_id: conversationId,
          sender_id: user.id,
          content: sticker.name,
          type: "sticker" as const,
          sticker_id: sticker.id
        };

        const { data: inserted, error: insertError } = await supabase
          .from("messages")
          .insert(payload)
          .select(
            "id, conversation_id, sender_id, content, type, replied_to(id, content, sender_id), created_at, is_read, deleted, edited, media_url, sticker_id, sticker:stickers(id, name, image_url, created_by)"
          )
          .single();
        if (insertError) {
          setError(insertError.message);
          return;
        }

        if (inserted) {
          const nextMessage = normalizeMessage(inserted as MessageRowRaw);
          setMessages((prev) => (prev.some((item) => item.id === nextMessage.id) ? prev : [...prev, nextMessage]));
          void notifyRecipientsForPush(nextMessage.id);
        }

        setReplyTarget(null);
        setActiveMessageId(null);
      } finally {
        sendingRef.current = false;
        setSending(false);
        setMediaPickerOpen(false); // Picker'ı kapat
      }
    },
    [blockedByOther, conversationId, notifyRecipientsForPush, supabase, user]
  );

  const sendGifMessage = useCallback(
    async (gifUrl: string, gifTitle: string) => {
      if (!user || !conversationId) return;
      if (blockedByOther) {
        setError("Bu kullanıcı seni engelledi.");
        return;
      }
      if (sendingRef.current) return;

      sendingRef.current = true;
      setSending(true);
      setError(null);
      autoScrollRef.current = true;

      try {
        const payload = {
          conversation_id: conversationId,
          sender_id: user.id,
          content: gifTitle || "GIF",
          type: "image" as const,
          media_url: gifUrl
        };

        const { data: inserted, error: insertError } = await supabase
          .from("messages")
          .insert(payload)
          .select(
            "id, conversation_id, sender_id, content, type, replied_to(id, content, sender_id), created_at, is_read, deleted, edited, media_url, sticker_id, sticker:stickers(id, name, image_url, created_by)"
          )
          .single();
        if (insertError) {
          setError(insertError.message);
          return;
        }

        if (inserted) {
          const nextMessage = normalizeMessage(inserted as MessageRowRaw);
          setMessages((prev) => (prev.some((item) => item.id === nextMessage.id) ? prev : [...prev, nextMessage]));
          void notifyRecipientsForPush(nextMessage.id);
        }

        setReplyTarget(null);
        setActiveMessageId(null);
        setGifSearchQuery("");
        setGifs([]);
      } finally {
        sendingRef.current = false;
        setSending(false);
        setMediaPickerOpen(false);
      }
    },
    [blockedByOther, conversationId, notifyRecipientsForPush, supabase, user]
  );

  const send = useCallback(async () => {
    if (!user || !conversationId || (!trimmedText && !attachmentFile)) return;
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
        type: "text" | "image";
        replied_to?: string;
        media_url?: string;
      } = {
        conversation_id: conversationId,
        sender_id: user.id,
        content: trimmedText,
        type: "text"
      };

      if (replyTarget) payload.replied_to = replyTarget.id;

      if (attachmentFile) {
        console.log("[send] Attachment file present:", attachmentFile.name);
        payload.media_url = await uploadMedia(attachmentFile);
        console.log("[send] Media URL set:", payload.media_url);
        payload.type = "image";
        clearAttachment();
      }

      const { data: inserted, error: insertError } = await supabase
        .from("messages")
        .insert(payload)
        .select("id, conversation_id, sender_id, content, type, replied_to(id, content, sender_id), created_at, is_read, deleted, edited, media_url, sticker_id, sticker:stickers(id, name, image_url, created_by)")
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
      setHasUnreadMessages(false);
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
    networkOnline,
    attachmentFile,
    clearAttachment,
    uploadMedia
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

          {!blockStatus || blockStatus === "none" ? (
            otherAvatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt={`${title} avatar`} className="h-9 w-9 rounded-full border border-zinc-800 object-cover" src={otherAvatarUrl} />
            ) : (
              <div className="grid h-9 w-9 place-items-center rounded-full border border-zinc-800 bg-zinc-900 text-xs font-semibold text-zinc-200">
                {title.slice(0, 1).toUpperCase()}
              </div>
            )
          ) : (
            <div className="grid h-9 w-9 place-items-center rounded-full border border-zinc-800 bg-zinc-800 text-xs font-semibold text-zinc-400">
              ?
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
                : blockStatus !== "none"
                  ? blockStatus === "blockedByMe"
                    ? "Engellendi"
                    : "Seni engelledi"
                  : typingLabel
                    ? `${typingLabel}${typingDots}`
                    : otherUserId
                      ? isOnline(otherUserId)
                        ? "çevrim içi"
                        : "çevrim dışı"
                      : "grup sohbeti"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            aria-label={muted ? "Bildirimleri aç" : "Bildirimleri sustur"}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/50 text-zinc-200 hover:bg-zinc-800"
            onClick={() => void toggleMute()}
            type="button"
          >
            {muted ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
          </button>
          {otherUserId ? (
            <button
              aria-label={blockStatus === "blockedByMe" ? "Engellemeyi kaldır" : "Engelle"}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/50 text-zinc-200 hover:bg-zinc-800"
              onClick={() => void handleBlockToggle()}
              type="button"
            >
              <Shield className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </header>

      <div
        ref={scrollRef}
        className="relative min-h-0 flex-1 overflow-y-auto px-3 py-4"
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
                              : (message.type === "image" || message.type === "sticker")
                              ? "border-transparent bg-transparent text-zinc-100"
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

                          {message.deleted ? (
                            <p className="whitespace-pre-wrap break-words text-zinc-500 italic">
                              Bir mesaj silindi
                            </p>
                          ) : message.type === "sticker" && message.sticker ? (
                            <div className="flex flex-col items-center">
                              <img
                                alt={message.sticker.name}
                                className="max-h-32 max-w-32 rounded-lg object-contain"
                                src={message.sticker.image_url}
                              />
                            </div>
                          ) : message.type === "image" && message.mediaUrl ? (
                            <div className="flex flex-col">
                              <img
                                alt="Gönderilen resim"
                                className="max-h-64 max-w-full rounded-lg object-contain"
                                src={message.mediaUrl}
                              />
                              {message.content ? (
                                <p className="mt-2 whitespace-pre-wrap break-words">
                                  {renderLinkifiedText(message.content)}
                                  {message.edited ? (
                                    <span className="ml-1 text-[10px] text-zinc-400">(düzenlendi)</span>
                                  ) : null}
                                </p>
                              ) : null}
                            </div>
                          ) : (
                            <p className="whitespace-pre-wrap break-words">
                              {renderLinkifiedText(message.content)}
                              {message.edited && !message.deleted ? (
                                <span className="ml-1 text-[10px] text-zinc-400">(düzenlendi)</span>
                              ) : null}
                            </p>
                          )}

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
        {hasUnreadMessages ? (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20">
            <button
              aria-label="Yeni mesajlara git"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-zinc-800/90 text-sm text-zinc-100 border border-zinc-700/50 shadow-lg hover:bg-zinc-700/90 transition-colors"
              onClick={scrollToBottom}
              type="button"
              title="Yeni mesaj var"
            >
              <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
              <div>Yeni mesaj</div>
            </button>
          </div>
        ) : null}
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
        <div className="border-t border-amber-900/60 bg-amber-950/40 px-3 py-2 text-xs text-amber-200 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>İnternet bağlantısı yok. Gönderme düğmesi bağlantı gelene kadar pasif.</span>
        </div>
      ) : blockStatus === "blockedByMe" ? (
        <div className="border-t border-yellow-900/60 bg-yellow-950/40 px-4 py-3 flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <Shield className="h-5 w-5 text-yellow-300 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-yellow-200">Bu kullanıcı engelli</p>
              <p className="text-xs text-yellow-100/70 mt-1">Mesajlarını görmeyeceksin ve seni görmeyecek. Engeli istediğin zaman kaldırabilirsin.</p>
            </div>
          </div>
          <button
            className="self-start inline-flex items-center gap-2 rounded-lg border border-yellow-700/50 bg-yellow-900/40 px-4 py-2 text-sm font-medium text-yellow-200 hover:bg-yellow-900/60 transition-colors"
            onClick={() => void handleBlockToggle()}
            type="button"
          >
            <X className="h-4 w-4" />
            Engeli Kaldır
          </button>
        </div>
      ) : blockedByOther ? (
        <div className="border-t border-red-900/60 bg-red-950/40 px-4 py-3">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-red-300 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-red-200">Engellendi</p>
              <p className="text-xs text-red-100/70 mt-1">Bu kullanıcı seni engelledi. Mesaj gönderemez ve göremezsin.</p>
            </div>
          </div>
        </div>
      ) : null}

      <form
        className="flex items-end gap-2 border-t border-zinc-800/80 bg-zinc-900/30 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <input
          ref={attachmentInputRef}
          accept={ALLOWED_MEDIA_MIME_TYPES.join(",")}
          className="hidden"
          onChange={handleAttachmentChange}
          type="file"
        />
        <button
          aria-label="Resim ekle"
          className={cn(
            "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800",
            (blockedByOther || blockStatus === "blockedByMe") && "opacity-60 cursor-not-allowed"
          )}
          disabled={blockedByOther || blockStatus === "blockedByMe"}
          onClick={() => attachmentInputRef.current?.click()}
          type="button"
        >
          <ImagePlus className="h-4 w-4" />
        </button>
        <button
          aria-label="Emoji ve Sticker"
          className={cn(
            "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800",
            (blockedByOther || blockStatus === "blockedByMe") && "opacity-60 cursor-not-allowed"
          )}
          disabled={blockedByOther || blockStatus === "blockedByMe"}
          onClick={toggleMediaPicker}
          type="button"
        >
          <Sticker className="h-4 w-4" />
        </button>

        {attachmentPreview ? (
          <div className="relative">
            <img
              alt="Önizleme"
              className="h-20 w-20 rounded-lg border border-zinc-700 object-cover"
              src={attachmentPreview}
            />
            <button
              aria-label="Kaldır"
              className="absolute -top-2 -right-2 inline-flex h-6 w-6 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
              onClick={clearAttachment}
              type="button"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : null}

        <textarea
          ref={inputRef}
          className="min-h-[44px] w-full flex-1 resize-none rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-zinc-700 disabled:opacity-60"
          disabled={sending || blockedByOther || blockStatus === "blockedByMe"}
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

      {mediaPickerOpen ? (
        <div className="border-t border-zinc-800/80 bg-zinc-900/30 p-3">
          <div className="mb-2 flex gap-2">
            <button
              className={cn(
                "rounded-lg px-3 py-1 text-sm",
                selectedMediaTab === "emoji" ? "bg-zinc-700 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
              )}
              onClick={() => setSelectedMediaTab("emoji")}
              type="button"
            >
              Emoji
            </button>
            <button
              className={cn(
                "rounded-lg px-3 py-1 text-sm",
                selectedMediaTab === "sticker" ? "bg-zinc-700 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
              )}
              onClick={() => setSelectedMediaTab("sticker")}
              type="button"
            >
              Sticker
            </button>
            <button
              className={cn(
                "rounded-lg px-3 py-1 text-sm",
                selectedMediaTab === "gif" ? "bg-zinc-700 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
              )}
              onClick={() => {
                setSelectedMediaTab("gif");
                if (gifs.length === 0) void loadTrendingGifs();
              }}
              type="button"
            >
              GIF
            </button>
          </div>

          {selectedMediaTab === "emoji" ? (
            <>
              <div className="mb-2 flex gap-2">
                {EMOJI_CATEGORIES.map((category) => (
                  <button
                    key={category.id}
                    className={cn(
                      "rounded-lg border px-2 py-1 text-xs",
                      selectedEmojiCategory === category.id
                        ? "border-zinc-600 bg-zinc-800 text-zinc-100"
                        : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:bg-zinc-800"
                    )}
                    onClick={() => setSelectedEmojiCategory(category.id)}
                    type="button"
                  >
                    {category.icon}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-8 gap-1">
                {EMOJI_CATEGORIES.find((cat) => cat.id === selectedEmojiCategory)?.items.map((emoji) => (
                  <button
                    key={emoji}
                    className="h-8 w-8 rounded-lg border border-zinc-800 bg-zinc-900 text-lg hover:bg-zinc-800"
                    onClick={() => handleEmojiSelect(emoji)}
                    type="button"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </>
          ) : selectedMediaTab === "sticker" ? (
            <>
              <div className="mb-3 flex items-center justify-between border-b border-zinc-800 pb-2">
                <h3 className="text-sm font-semibold text-zinc-100">Stickerlarım</h3>
                <div className="flex items-center gap-2">
                  {isAdmin === true && allPendingStickers.length > 0 ? (
                    <button
                      className="inline-flex items-center gap-1 rounded-lg border border-orange-700/50 bg-orange-600/20 px-2 py-1.5 text-xs font-medium text-orange-300 transition-colors hover:bg-orange-600/30"
                      onClick={() => setShowModerationPanel(!showModerationPanel)}
                      type="button"
                    >
                      <AlertCircle className="h-3 w-3" />
                      Onay Bekleyen ({allPendingStickers.length})
                    </button>
                  ) : null}
                  <button
                    className="inline-flex items-center gap-1 rounded-lg border border-emerald-700/50 bg-emerald-600/20 px-2 py-1.5 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-600/30"
                    onClick={() => setStickerUploadName("Yeni Sticker")}
                    type="button"
                  >
                    <Plus className="h-3 w-3" />
                    Yenisini Ekle
                  </button>
                </div>
              </div>

              {/* Admin moderation panel */}
              {isAdmin === true && showModerationPanel && allPendingStickers.length > 0 ? (
                <div className="mb-4 rounded-lg border border-orange-900/40 bg-orange-950/20 p-3 max-h-60 overflow-y-auto">
                  <p className="mb-2 text-xs font-semibold text-orange-300">Onay Bekleyen Stickerlar</p>
                  <div className="space-y-2">
                    {allPendingStickers.map((sticker) => (
                      <div key={sticker.id} className="rounded-lg border border-orange-900/50 bg-orange-900/10 p-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2 flex-1 min-w-0">
                            <div className="h-10 w-10 shrink-0 rounded border border-orange-900/50 bg-zinc-900 p-0.5">
                              <img
                                alt={sticker.name}
                                className="h-full w-full rounded object-contain"
                                src={sticker.image_url}
                              />
                            </div>
                            <div className="flex-1 min-w-0 text-xs">
                              <p className="font-semibold text-orange-300 truncate">{sticker.name}</p>
                              <p className="text-orange-400 text-[11px]">~ {sticker.creator_username || "bilinmiyor"}</p>
                            </div>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <button
                              className="inline-flex items-center justify-center rounded px-2 py-1 text-xs bg-emerald-600/30 text-emerald-300 hover:bg-emerald-600/40 border border-emerald-700/50 transition-colors"
                              onClick={async () => {
                                const { error } = await supabase
                                  .from("stickers")
                                  .update({ approved: true, rejection_reason: null })
                                  .eq("id", sticker.id);
                                if (!error) {
                                  await loadStickers();
                                }
                              }}
                              type="button"
                            >
                              Onayla
                            </button>
                            <button
                              className="inline-flex items-center justify-center rounded px-2 py-1 text-xs bg-red-600/30 text-red-300 hover:bg-red-600/40 border border-red-700/50 transition-colors"
                              onClick={async () => {
                                const { error } = await supabase
                                  .from("stickers")
                                  .update({ rejection_reason: "İçerik politikamızı ihlal ediyor" })
                                  .eq("id", sticker.id);
                                if (!error) {
                                  await loadStickers();
                                }
                              }}
                              type="button"
                            >
                              Reddet
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {stickerUploadName ? (
                <div className="mb-4 rounded-xl border border-zinc-700 bg-zinc-800/60 p-4">
                  <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">Yeni Sticker Yükle</h4>

                  {/* Drag-and-drop area */}
                  <div
                    className={cn(
                      "mb-3 rounded-lg border-2 border-dashed p-4 text-center transition-colors",
                      stickerUploadFile
                        ? "border-emerald-600/60 bg-emerald-600/10"
                        : "border-zinc-600 bg-zinc-900/30 hover:border-zinc-500 hover:bg-zinc-900/50"
                    )}
                    onClick={() => stickerUploadInputRef.current?.click()}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.currentTarget.classList.add("border-emerald-600/60", "bg-emerald-600/10");
                    }}
                    onDragLeave={(e) => {
                      e.currentTarget.classList.remove("border-emerald-600/60", "bg-emerald-600/10");
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.currentTarget.classList.remove("border-emerald-600/60", "bg-emerald-600/10");
                      const file = e.dataTransfer.files?.[0];
                      if (file) {
                        const event = {
                          target: { files: e.dataTransfer.files, value: "" }
                        } as React.ChangeEvent<HTMLInputElement>;
                        handleStickerUploadChange(event);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <input
                      ref={stickerUploadInputRef}
                      accept={ALLOWED_MEDIA_MIME_TYPES.join(",")}
                      className="hidden"
                      onChange={handleStickerUploadChange}
                      type="file"
                    />
                    {stickerUploadPreview ? (
                      <div className="flex flex-col items-center gap-2">
                        <img
                          alt="Önizleme"
                          className="h-16 w-16 rounded-lg object-contain"
                          src={stickerUploadPreview}
                        />
                        <p className="text-xs text-zinc-400">
                          {stickerUploadFile?.name ? `Seçili: ${stickerUploadFile.name}` : "Dosya seçildi"}
                        </p>
                        <button
                          className="text-xs text-zinc-500 hover:text-zinc-300 underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            stickerUploadInputRef.current?.click();
                          }}
                          type="button"
                        >
                          Başka dosya seç
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2">
                        <Upload className="h-5 w-5 text-zinc-500" />
                        <div>
                          <p className="text-xs font-medium text-zinc-300">Dosya sürükle ve bırak</p>
                          <p className="text-[11px] text-zinc-500">veya tıkla</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Name input */}
                  <input
                    className="mb-3 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-600"
                    onChange={(event) => setStickerUploadName(event.target.value)}
                    placeholder="Sticker adını yaz..."
                    type="text"
                    value={stickerUploadName}
                  />

                  {/* Error/Success message */}
                  {stickerUploadError ? (
                    <div className="mb-3 rounded-lg border border-red-900/50 bg-red-900/20 p-2 text-xs text-red-300 flex items-center gap-2">
                      <X className="h-3 w-3 shrink-0" />
                      {stickerUploadError}
                    </div>
                  ) : null}

                  {/* Action buttons */}
                  <div className="flex gap-2">
                    <button
                      className={cn(
                        "flex-1 inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors disabled:opacity-50",
                        stickerUploading || !stickerUploadFile || !stickerUploadName.trim()
                          ? "border border-zinc-700 bg-zinc-900 text-zinc-400"
                          : "border border-emerald-700/60 bg-emerald-600/30 text-emerald-300 hover:bg-emerald-600/40"
                      )}
                      disabled={stickerUploading || !stickerUploadFile || !stickerUploadName.trim()}
                      onClick={() => void handleStickerUpload()}
                      type="button"
                    >
                      {stickerUploading ? (
                        <>
                          <div className="h-3 w-3 animate-spin rounded-full border border-emerald-600 border-t-emerald-300" />
                          Yükleniyor...
                        </>
                      ) : (
                        <>
                          <Check className="h-3 w-3" />
                          Yükle
                        </>
                      )}
                    </button>
                    <button
                      className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-800 transition-colors"
                      onClick={() => {
                        setStickerUploadName("");
                        setStickerUploadFile(null);
                        if (stickerUploadPreview) {
                          URL.revokeObjectURL(stickerUploadPreview);
                        }
                        setStickerUploadPreview(null);
                        setStickerUploadError(null);
                      }}
                      type="button"
                    >
                      <X className="h-3 w-3" />
                      İptal
                    </button>
                  </div>
                </div>
              ) : null}

              {/* Info banner */}
              <div className="mb-3 rounded-lg border border-blue-900/40 bg-blue-950/20 p-3">
                <p className="text-xs text-blue-300">
                  <span className="font-semibold">💡 Bilgi:</span> Yüklediğiniz stickerler onay beklemektedir. Onaylandıktan sonra herkese görünecektir.
                </p>
              </div>

              {/* Rejected stickers section */}
              {rejectedStickers.length > 0 ? (
                <div className="mb-4 rounded-lg border border-red-900/40 bg-red-950/20 p-3">
                  <p className="mb-2 text-xs font-semibold text-red-300">Reddedilen Stickerlar ({rejectedStickers.length})</p>
                  <div className="space-y-2">
                    {rejectedStickers.map((sticker) => (
                      <div key={sticker.id} className="rounded-lg border border-red-900/50 bg-red-900/10 p-2">
                        <div className="flex items-start gap-2">
                          <div className="h-12 w-12 shrink-0 rounded border border-red-900/50 bg-zinc-900 p-1">
                            <img
                              alt={sticker.name}
                              className="h-full w-full rounded object-contain"
                              src={sticker.image_url}
                            />
                          </div>
                          <div className="flex-1 text-xs">
                            <p className="font-semibold text-red-300">{sticker.name}</p>
                            <p className="text-red-400">
                              {(sticker as MessageStickerRowRaw & { rejection_reason?: string }).rejection_reason || "İçerik politikamızı ihlal ediyor"}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Pending stickers section */}
              {pendingStickers.length > 0 ? (
                <div className="mb-4 rounded-lg border border-yellow-900/40 bg-yellow-950/20 p-3">
                  <p className="mb-2 text-xs font-semibold text-yellow-300">Onay Bekleniyor ({pendingStickers.length})</p>
                  <div className="grid grid-cols-6 gap-2">
                    {pendingStickers.map((sticker) => (
                      <div key={sticker.id} className="group relative aspect-square opacity-60">
                        <div className="h-full w-full rounded-lg border border-yellow-900/50 bg-zinc-900 p-1">
                          <img
                            alt={sticker.name}
                            className="h-full w-full rounded object-contain"
                            src={sticker.image_url}
                          />
                        </div>
                        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/50">
                          <div className="text-[10px] font-bold text-yellow-300">Bekleme</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Approved sticker grid */}
              <div className="space-y-3">
                {stickers.length === 0 ? (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-6 text-center">
                    <Sticker className="mx-auto mb-2 h-5 w-5 text-zinc-500" />
                    <p className="text-xs text-zinc-500">Henüz sticker yok</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-6 gap-2">
                    {stickers.map((sticker) => (
                      <div key={sticker.id} className="group relative aspect-square">
                        <button
                          className="h-full w-full rounded-lg border border-zinc-800 bg-zinc-900 p-1 transition-all hover:border-zinc-700 hover:bg-zinc-800"
                          onClick={() => void sendStickerMessage(sticker)}
                          type="button"
                        >
                          <img
                            alt={sticker.name}
                            className="h-full w-full rounded object-contain"
                            src={sticker.image_url}
                          />
                        </button>

                        {/* Delete button - shown for user's own stickers */}
                        {user?.id === sticker.created_by ? (
                          <button
                            aria-label="Sil"
                            className="absolute -top-2 -right-2 inline-flex h-5 w-5 items-center justify-center rounded-full border border-red-700/60 bg-red-600/20 text-red-300 opacity-0 transition-opacity hover:bg-red-600/40 group-hover:opacity-100"
                            disabled={stickerDeleting === sticker.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleStickerDelete(sticker.id);
                            }}
                            type="button"
                          >
                            {stickerDeleting === sticker.id ? (
                              <div className="h-3 w-3 animate-spin rounded-full border border-red-600 border-t-red-300" />
                            ) : (
                              <Trash2 className="h-3 w-3" />
                            )}
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : selectedMediaTab === "gif" ? (
            <>
              <div className="mb-3 flex gap-2">
                <input
                  className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-600"
                  onKeyUp={(e) => {
                    const query = (e.currentTarget as HTMLInputElement).value;
                    if (query.trim()) {
                      void fetchGifs(query);
                    }
                  }}
                  placeholder="GIF ara..."
                  type="text"
                  value={gifSearchQuery}
                  onChange={(e) => setGifSearchQuery(e.target.value)}
                />
              </div>
              {gifsLoading ? (
                <div className="py-8 text-center text-sm text-zinc-500">Yükleniyor...</div>
              ) : gifs.length === 0 ? (
                <div className="py-8 text-center text-sm text-zinc-500">GIF bulunamadı. Trending GIF&apos;leri görmek için sekmeyi aç.</div>
              ) : (
                <div className="grid grid-cols-3 gap-2 max-h-64 overflow-y-auto">
                  {gifs.map((gif) => (
                    <button
                      key={gif.id}
                      className="relative overflow-hidden rounded-lg border border-zinc-700 bg-zinc-800 hover:border-blue-600 transition-colors group"
                      onClick={() => void sendGifMessage(gif.images.fixed_height.url, gif.title)}
                      title={gif.title}
                      type="button"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        alt={gif.title}
                        className="h-20 w-full object-cover"
                        src={gif.images.fixed_height.url}
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                        <span className="text-white opacity-0 group-hover:opacity-100 transition-opacity text-xs font-medium">Gönder</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="py-8 text-center text-sm text-zinc-500">
              Bilinmeyen medya sekmesi.
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
