"use client";

import {
  AlertCircle,
  ArrowLeft,
  Ban,
  Bell,
  BellOff,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Crown,
  Info,
  ImagePlus,
  Loader2,
  MoreVertical,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Reply,
  UserMinus,
  UserPlus,
  Users,
  Search,
  SendHorizontal,
  Sticker,
  Film,
  Trash2,
  Upload,
  X
} from "lucide-react";
import LinkifyIt from "linkify-it";
import { useRouter } from "next/navigation";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { usePresence } from "@/components/Presence/PresenceProvider";
import {
  buildPinnedConversationsStorageKey,
  CHAT_PINNED_UPDATED_EVENT,
  clearConversationDraft,
  isConversationPinnedForUser,
  loadConversationDraft,
  saveConversationDraft,
  togglePinnedConversationForUser
} from "@/lib/chatPreferences";
import {
  getDefaultUserPreferences,
  loadUserPreferences,
  subscribeUserPreferences,
  type UserPreferences
} from "@/lib/userPreferences";
import {
  buildWatchPartyDisplayText,
  encodeWatchPartyEvent,
  extractYouTubeVideosFromText,
  fetchYouTubeVideoMeta,
  parseWatchPartyBotPayload,
  type WatchPartyEventPayload
} from "@/lib/watchParty";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/AuthProvider";

type ConversationRow = {
  id: string;
  name: string | null;
  is_group: boolean;
  owner_id: string | null;
  created_at: string;
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
};

declare global {
  interface Window {
    YT?: {
      PlayerState: {
        PLAYING: number;
        PAUSED: number;
      };
    };
    onYouTubeIframeAPIReady?: (() => void) | undefined;
  }
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
const MAX_ATTACHMENT_SIZE = 4 * 1024 * 1024;
const MAX_TEXT_MESSAGE_LENGTH = 1200;
const MAX_BOT_PROMPT_LENGTH = 700;
const BOT_CLIENT_COOLDOWN_MS = 12_000;
const MAX_GROUP_MEMBER_COUNT = 10;
const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;
const BOT_MESSAGE_PREFIX = "[[BOT]]";
const INSTALL_CTA_MARKER = "[[INSTALL_CTA]]";
const SYSTEM_BOT_CONVERSATION_NAME = "Atlas Bot";
const BOT_TRIGGER_REGEX = /@bot\b/i;

function isBotMessageContent(content: string): boolean {
  return content.startsWith(BOT_MESSAGE_PREFIX);
}

function stripBotMarker(content: string): string {
  if (!isBotMessageContent(content)) return content;
  return content.slice(BOT_MESSAGE_PREFIX.length).trimStart();
}

function containsInstallCtaMarker(content: string): boolean {
  return stripBotMarker(content).includes(INSTALL_CTA_MARKER);
}

function stripInstallCtaMarker(content: string): string {
  return content.split(INSTALL_CTA_MARKER).join("").replace(/\s+/g, " ").trim();
}

function toReadableMessageText(content: string): string {
  const stripped = stripBotMarker(content);
  const parsed = parseWatchPartyBotPayload(stripped);
  if (parsed) {
    return buildWatchPartyDisplayText(parsed);
  }
  return stripInstallCtaMarker(stripped);
}

function mapMessageInsertErrorMessage(message: string): string {
  if (/row-level security policy/i.test(message)) {
    return "Bu konuşmaya mesaj gönderme iznin yok ya da konuşmada engel ilişkisi var.";
  }
  return message;
}



const linkify = new LinkifyIt();
const WP_INVITE_REGEX = /^\[\[WP_INVITE:([0-9a-f-]{36})\]\]$/;
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

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ChatWindow({
  conversationId,
  networkOnline = true,
  canInlineInstall = false,
  watchPartyMode = false,
  onInlineInstall,
  onBack,
  onLeaveConversation
}: {
  conversationId: string | null;
  networkOnline?: boolean;
  canInlineInstall?: boolean;
  watchPartyMode?: boolean;
  onInlineInstall?: (conversationId: string) => Promise<void> | void;
  onBack?: () => void;
  onLeaveConversation?: () => void;
}) {
  const supabase = getSupabaseBrowserClient();
  const router = useRouter();
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
  const [blockError, setBlockError] = useState<string | null>(null);
  const blockErrorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshBlockStatusRef = useRef<(() => Promise<void>) | null>(null);
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
  const [messageSearchOpen, setMessageSearchOpen] = useState(false);
  const [messageSearchQuery, setMessageSearchQuery] = useState("");
  const [activeSearchMatchIndex, setActiveSearchMatchIndex] = useState(0);
  const [isConversationPinned, setIsConversationPinned] = useState(false);
  const [preferences, setPreferences] = useState<UserPreferences>(getDefaultUserPreferences());
  const [botBusy, setBotBusy] = useState(false);
  const [installingInline, setInstallingInline] = useState(false);
  const [botError, setBotError] = useState<string | null>(null);
  const [actionDrawerOpen, setActionDrawerOpen] = useState(false);
  const [groupInviteUsername, setGroupInviteUsername] = useState("");
  const [groupInviteBusy, setGroupInviteBusy] = useState(false);
  const [groupInviteStatus, setGroupInviteStatus] = useState<string | null>(null);
  const [groupLeaveBusy, setGroupLeaveBusy] = useState(false);
  const [groupNameInput, setGroupNameInput] = useState("");
  const [groupNameSaving, setGroupNameSaving] = useState(false);
  const [groupMemberBusyId, setGroupMemberBusyId] = useState<string | null>(null);
  const [groupOwnerTransferBusy, setGroupOwnerTransferBusy] = useState(false);

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
  const previousMessageCountRef = useRef(0);
  const lastBotRequestAtRef = useRef(0);

  const trimmedText = text.trim();
  const blockedByOther = blockStatus === "blockedByOther";
  const hasTextForMessage = trimmedText.length > 0;
  const textTooLong = trimmedText.length > MAX_TEXT_MESSAGE_LENGTH;
  const canSend =
    Boolean(user && conversationId && networkOnline && !sending && !sendingRef.current && !blockedByOther && !textTooLong) &&
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
    console.log("[otherId] conversation.is_group:", conversation?.is_group, "other:", other?.user_id);
    return other?.user_id ?? null;
  }, [conversation, participants, user?.id]);

  const otherAvatarUrl = useMemo(() => {
    if (!conversation || conversation.is_group) return null;
    const other = participants.find((participant) => participant.user_id !== user?.id);
    return other?.profile?.avatar_url ?? null;
  }, [conversation, participants, user?.id]);

  const typingLabel = useMemo(() => {
    if (!preferences.showTypingIndicator) return null;
    if (typingUserIds.length === 0) return null;

    const names = typingUserIds
      .map((userId) => participantsById.get(userId)?.profile?.username || participantsById.get(userId)?.profile?.full_name || null)
      .filter((value): value is string => Boolean(value));

    if (names.length === 0) return "Birisi yazıyor";
    if (names.length === 1) return `${names[0]} yazıyor`;
    return `${names[0]} ve ${names.length - 1} kişi yazıyor`;
  }, [participantsById, preferences.showTypingIndicator, typingUserIds]);

  const normalizedSearchQuery = messageSearchQuery.trim().toLocaleLowerCase("tr-TR");
  const matchedMessageIds = useMemo(() => {
    if (!normalizedSearchQuery) return [];

    return messages
      .filter((message) => {
        if (message.deleted) return false;
        return toReadableMessageText(message.content).toLocaleLowerCase("tr-TR").includes(normalizedSearchQuery);
      })
      .map((message) => message.id);
  }, [messages, normalizedSearchQuery]);

  const matchedMessageIdSet = useMemo(() => new Set(matchedMessageIds), [matchedMessageIds]);
  const activeSearchMessageId = matchedMessageIds[activeSearchMatchIndex] ?? null;
  const isSystemBotConversation = Boolean(conversation?.name === SYSTEM_BOT_CONVERSATION_NAME);
  const isGroupConversation = Boolean(conversation?.is_group && !isSystemBotConversation);
  const isGroupOwner = Boolean(isGroupConversation && user?.id && conversation?.owner_id === user.id);
  const groupMembers = useMemo(() => {
    if (!isGroupConversation) return [];

    const normalized = participants.map((participant) => ({
      id: participant.user_id,
      username: participant.profile?.username || participant.profile?.full_name || "Kullanıcı",
      avatarUrl: participant.profile?.avatar_url ?? null,
      isOwner: participant.user_id === conversation?.owner_id,
      isMe: participant.user_id === user?.id
    }));

    return normalized.sort((left, right) => {
      if (left.isOwner !== right.isOwner) return left.isOwner ? -1 : 1;
      if (left.isMe !== right.isMe) return left.isMe ? -1 : 1;
      return left.username.localeCompare(right.username, "tr-TR");
    });
  }, [conversation?.owner_id, isGroupConversation, participants, user?.id]);

  const ensureCanInsertMessage = useCallback(
    async (setFailure: (message: string | null) => void = setError) => {
      if (!user || !conversationId) return false;

      const { data: isMember, error: memberError } = await supabase.rpc("is_conversation_member", {
        p_conversation: conversationId
      });

      if (memberError) {
        setFailure(memberError.message || "Mesaj izni doğrulanamadı.");
        return false;
      }

      if (!isMember) {
        setFailure("Bu konuşmaya mesaj gönderme iznin yok.");
        return false;
      }

      const otherParticipantIds = participants
        .map((participant) => participant.user_id)
        .filter((participantId) => participantId !== user.id);

      if (otherParticipantIds.length === 0) {
        return true;
      }

      const { data: blockRows, error: blockLookupError } = await supabase
        .from("user_blocks")
        .select("blocker_id, blocked_id")
        .or(`blocker_id.eq.${user.id},blocked_id.eq.${user.id}`);

      if (blockLookupError) {
        setFailure(blockLookupError.message || "Engel durumu doğrulanamadı.");
        return false;
      }

      const hasBlock = ((blockRows as Array<{ blocker_id: string; blocked_id: string }> | null) ?? []).some(
        (row) =>
          (row.blocker_id === user.id && otherParticipantIds.includes(row.blocked_id)) ||
          (row.blocked_id === user.id && otherParticipantIds.includes(row.blocker_id))
      );

      if (hasBlock) {
        setFailure("Bu konuşmada engel ilişkisi olduğu için mesaj gönderemezsin.");
        return false;
      }

      return true;
    },
    [conversationId, participants, supabase, user]
  );

  const watchPartyDecisionBySuggestionId = useMemo(() => {
    const decisions = new Map<string, { action: "queue_add" | "queue_skip"; actorName: string }>();
    messages.forEach((message) => {
      if (!isBotMessageContent(message.content) || message.deleted) return;
      const parsed = parseWatchPartyBotPayload(stripBotMarker(message.content));
      if (!parsed || parsed.kind !== "event") return;
      const { suggestionId, action, actorName } = parsed.payload;
      if (!suggestionId) return;
      if (action !== "queue_add" && action !== "queue_skip") return;
      decisions.set(suggestionId, { action, actorName });
    });
    return decisions;
  }, [messages]);

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

  useEffect(() => {
    setActiveSearchMatchIndex(0);
  }, [conversationId, normalizedSearchQuery]);

  useEffect(() => {
    setMessageSearchOpen(false);
    setMessageSearchQuery("");
    setGroupInviteUsername("");
    setGroupInviteStatus(null);
    setGroupNameInput("");
    setGroupNameSaving(false);
    setGroupMemberBusyId(null);
    setGroupOwnerTransferBusy(false);
    setActionDrawerOpen(false);
    setBotError(null);
  }, [conversationId]);

  useEffect(() => {
    setGroupNameInput(conversation?.name ?? "");
  }, [conversation?.name]);

  useEffect(() => {
    if (activeSearchMatchIndex < matchedMessageIds.length) return;
    setActiveSearchMatchIndex(0);
  }, [activeSearchMatchIndex, matchedMessageIds.length]);

  useEffect(() => {
    if (!messageSearchOpen || !activeSearchMessageId) return;

    const target = document.getElementById(`msg-${activeSearchMessageId}`);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    setActiveMessageId(activeSearchMessageId);
  }, [activeSearchMessageId, messageSearchOpen]);

  useEffect(() => {
    if (!user || !conversationId) {
      setText("");
      return;
    }

    setText(loadConversationDraft(user.id, conversationId));
  }, [conversationId, user]);

  useEffect(() => {
    if (!user || !conversationId) return;
    if (editingTarget) return;

    saveConversationDraft(user.id, conversationId, text);
  }, [conversationId, editingTarget, text, user]);

  useEffect(() => {
    if (!user || !conversationId) {
      setIsConversationPinned(false);
      return;
    }

    const syncPinnedState = () => {
      setIsConversationPinned(isConversationPinnedForUser(user.id, conversationId));
    };

    syncPinnedState();

    const onPinnedUpdated = () => {
      syncPinnedState();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === buildPinnedConversationsStorageKey(user.id)) {
        syncPinnedState();
      }
    };

    window.addEventListener(CHAT_PINNED_UPDATED_EVENT, onPinnedUpdated as EventListener);
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener(CHAT_PINNED_UPDATED_EVENT, onPinnedUpdated as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, [conversationId, user]);

  useEffect(() => {
    if (!user) {
      setPreferences(getDefaultUserPreferences());
      return;
    }

    setPreferences(loadUserPreferences(user.id));
    return subscribeUserPreferences(user.id, setPreferences);
  }, [user]);

  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    const previousCount = previousMessageCountRef.current;
    previousMessageCountRef.current = messages.length;

    if (!preferences.soundNotifications || !lastMessage || messages.length <= previousCount) return;
    if (lastMessage.sender_id === user?.id) return;
    if (isBotMessageContent(lastMessage.content)) return;
    if (typeof window === "undefined") return;

    try {
      const audioContext = new window.AudioContext();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 880;
      gain.gain.value = 0.03;
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.08);
      oscillator.onended = () => {
        void audioContext.close();
      };
    } catch {
      // no-op
    }
  }, [messages, preferences.soundNotifications, user?.id]);

  const markRead = useCallback(async () => {
    if (!conversationId) return;
    if (!preferences.sendReadReceipts) return;
    await supabase.rpc("mark_conversation_read", {
      p_conversation_id: conversationId
    });

  }, [conversationId, preferences.sendReadReceipts, supabase]);

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
    
    const adminStatus = profileData?.is_admin === true;
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

    const { data: blockedByOther } = await supabase
      .from("user_blocks")
      .select("blocker_id")
      .eq("blocker_id", otherUserId)
      .eq("blocked_id", user.id)
      .maybeSingle();

    if (blockedByOther) {
      setBlockStatus("blockedByOther");
      return;
    }

    const { data: blockedByMe } = await supabase
      .from("user_blocks")
      .select("blocker_id")
      .eq("blocker_id", user.id)
      .eq("blocked_id", otherUserId)
      .maybeSingle();

    setBlockStatus(blockedByMe ? "blockedByMe" : "none");
  }, [otherUserId, supabase, user]);

  // Keep a stable ref so the realtime subscription closure doesn’t go stale
  useEffect(() => {
    refreshBlockStatusRef.current = refreshBlockStatus;
  }, [refreshBlockStatus]);

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
        .eq("blocker_id", user.id)
        .eq("blocked_id", otherUserId);
      if (error) { setError(error.message); return; }
      setBlockStatus("none");
      return;
    }

    if (blockStatus === "blockedByOther") {
      setBlockError("Bu kullanıcı seni engelledi. Onu engelleyemezsin.");
      if (blockErrorTimeoutRef.current) clearTimeout(blockErrorTimeoutRef.current);
      blockErrorTimeoutRef.current = setTimeout(() => {
        setBlockError(null);
        blockErrorTimeoutRef.current = null;
      }, 4000);
      return;
    }

    const { error } = await supabase
      .from("user_blocks")
      .insert({ blocker_id: user.id, blocked_id: otherUserId });
    if (error) { setError(error.message); return; }
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
        setError(`Dosya en fazla ${formatFileSize(MAX_ATTACHMENT_SIZE)} olabilir.`);
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
      setStickerUploadError(`Dosya en fazla ${formatFileSize(MAX_ATTACHMENT_SIZE)} olabilir.`);
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

  const jumpSearchMatch = useCallback(
    (direction: -1 | 1) => {
      if (matchedMessageIds.length === 0) return;

      setActiveSearchMatchIndex((prev) => {
        const size = matchedMessageIds.length;
        return (prev + direction + size) % size;
      });
    },
    [matchedMessageIds.length]
  );

  const togglePinnedConversation = useCallback(() => {
    if (!user || !conversationId) return;
    const nextPinnedIds = togglePinnedConversationForUser(user.id, conversationId);
    setIsConversationPinned(nextPinnedIds.includes(conversationId));
  }, [conversationId, user]);

  const inviteMemberToGroup = useCallback(async () => {
    if (!user || !conversationId || !isGroupConversation) return;
    if (!isGroupOwner) {
      setGroupInviteStatus("Sadece grup yöneticisi üye ekleyebilir.");
      return;
    }

    const targetUsername = groupInviteUsername.trim().toLowerCase();
    setGroupInviteStatus(null);

    if (!targetUsername) {
      setGroupInviteStatus("Kullanıcı adı gerekli.");
      return;
    }
    if (!USERNAME_REGEX.test(targetUsername)) {
      setGroupInviteStatus("Geçersiz kullanıcı adı formatı.");
      return;
    }
    if (participants.length >= MAX_GROUP_MEMBER_COUNT) {
      setGroupInviteStatus(`Bu grup en fazla ${MAX_GROUP_MEMBER_COUNT} üyeye izin veriyor.`);
      return;
    }

    setGroupInviteBusy(true);
    try {
      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("id, username, full_name, avatar_url, status")
        .eq("username", targetUsername)
        .maybeSingle();

      if (profileError) {
        setGroupInviteStatus(profileError.message);
        return;
      }
      if (!profileData) {
        setGroupInviteStatus("Kullanıcı bulunamadı.");
        return;
      }
      if (participants.some((participant) => participant.user_id === profileData.id)) {
        setGroupInviteStatus("Bu kullanıcı zaten grupta.");
        return;
      }

      const [userA, userB] = user.id < profileData.id ? [user.id, profileData.id] : [profileData.id, user.id];
      const { data: friendship, error: friendshipError } = await supabase
        .from("friendships")
        .select("user_a")
        .eq("user_a", userA)
        .eq("user_b", userB)
        .maybeSingle();

      if (friendshipError) {
        setGroupInviteStatus(friendshipError.message);
        return;
      }
      if (!friendship) {
        setGroupInviteStatus("Bu kullanıcıyı gruba eklemek için önce arkadaş olmalısın.");
        return;
      }

      const { error: insertError } = await supabase.from("participants").insert({
        conversation_id: conversationId,
        user_id: profileData.id
      });

      if (insertError) {
        setGroupInviteStatus(insertError.message);
        return;
      }

      setParticipants((prev) => [
        ...prev,
        {
          user_id: profileData.id,
          profile: profileData as ProfileRow
        }
      ]);
      setGroupInviteUsername("");
      setGroupInviteStatus(`@${targetUsername} gruba eklendi.`);
    } finally {
      setGroupInviteBusy(false);
    }
  }, [conversationId, groupInviteUsername, isGroupConversation, isGroupOwner, participants, supabase, user]);

  const leaveGroup = useCallback(async () => {
    if (!user || !conversationId || !isGroupConversation) return;
    if (isGroupOwner && groupMembers.length > 1) {
      setGroupInviteStatus("Yönetici gruptan ayrılmadan önce yöneticiyi başka üyeye devretmeli.");
      return;
    }

    if (typeof window !== "undefined") {
      const confirmed = window.confirm("Bu gruptan ayrılmak istediğine emin misin?");
      if (!confirmed) return;
    }

    setGroupLeaveBusy(true);
    setGroupInviteStatus(null);
    try {
      if (isGroupOwner && groupMembers.length <= 1) {
        const { error: deleteConversationError } = await supabase.from("conversations").delete().eq("id", conversationId);
        if (deleteConversationError) {
          setGroupInviteStatus(deleteConversationError.message);
          return;
        }
      } else {
        const { error: leaveError } = await supabase
          .from("participants")
          .delete()
          .eq("conversation_id", conversationId)
          .eq("user_id", user.id);

        if (leaveError) {
          setGroupInviteStatus(leaveError.message);
          return;
        }
      }

      onLeaveConversation?.();
    } finally {
      setGroupLeaveBusy(false);
    }
  }, [conversationId, groupMembers.length, isGroupConversation, isGroupOwner, onLeaveConversation, supabase, user]);

  const saveGroupName = useCallback(async () => {
    if (!user || !conversationId || !isGroupConversation) return;
    if (!isGroupOwner) {
      setGroupInviteStatus("Grup adını sadece yönetici değiştirebilir.");
      return;
    }

    const nextName = groupNameInput.trim();
    if (nextName.length < 3) {
      setGroupInviteStatus("Grup adı en az 3 karakter olmalı.");
      return;
    }
    if (nextName.length > 48) {
      setGroupInviteStatus("Grup adı en fazla 48 karakter olabilir.");
      return;
    }
    if (nextName === (conversation?.name ?? "")) {
      setGroupInviteStatus("Grup adı zaten aynı.");
      return;
    }

    setGroupNameSaving(true);
    setGroupInviteStatus(null);
    try {
      const { error: updateError } = await supabase.from("conversations").update({ name: nextName }).eq("id", conversationId);
      if (updateError) {
        setGroupInviteStatus(updateError.message);
        return;
      }

      setConversation((prev) => (prev ? { ...prev, name: nextName } : prev));
      setGroupInviteStatus("Grup adı güncellendi.");
    } finally {
      setGroupNameSaving(false);
    }
  }, [conversation?.name, conversationId, groupNameInput, isGroupConversation, isGroupOwner, supabase, user]);

  const removeMemberFromGroup = useCallback(
    async (memberId: string) => {
      if (!user || !conversationId || !isGroupConversation) return;
      if (!isGroupOwner) {
        setGroupInviteStatus("Üye çıkarma işlemi için yönetici olman gerekiyor.");
        return;
      }
      if (memberId === user.id) {
        setGroupInviteStatus("Kendin için 'Gruptan Ayrıl' aksiyonunu kullan.");
        return;
      }
      if (memberId === conversation?.owner_id) {
        setGroupInviteStatus("Yöneticiyi gruptan çıkaramazsın.");
        return;
      }

      if (typeof window !== "undefined") {
        const target = groupMembers.find((member) => member.id === memberId)?.username ?? "bu kullanıcıyı";
        const confirmed = window.confirm(`${target} kişisini gruptan çıkarmak istediğine emin misin?`);
        if (!confirmed) return;
      }

      setGroupMemberBusyId(memberId);
      setGroupInviteStatus(null);
      try {
        const { error: removeError } = await supabase
          .from("participants")
          .delete()
          .eq("conversation_id", conversationId)
          .eq("user_id", memberId);

        if (removeError) {
          setGroupInviteStatus(removeError.message);
          return;
        }

        setParticipants((prev) => prev.filter((participant) => participant.user_id !== memberId));
        setGroupInviteStatus("Üye gruptan çıkarıldı.");
      } finally {
        setGroupMemberBusyId(null);
      }
    },
    [conversation?.owner_id, conversationId, groupMembers, isGroupConversation, isGroupOwner, supabase, user]
  );

  const transferGroupOwnership = useCallback(
    async (nextOwnerId: string) => {
      if (!user || !conversationId || !isGroupConversation) return;
      if (!isGroupOwner) {
        setGroupInviteStatus("Yönetici devri için mevcut yönetici olman gerekir.");
        return;
      }
      if (nextOwnerId === conversation?.owner_id) {
        setGroupInviteStatus("Bu kullanıcı zaten yönetici.");
        return;
      }

      setGroupOwnerTransferBusy(true);
      setGroupInviteStatus(null);
      try {
        const { error: updateError } = await supabase
          .from("conversations")
          .update({ owner_id: nextOwnerId })
          .eq("id", conversationId);

        if (updateError) {
          setGroupInviteStatus(updateError.message);
          return;
        }

        setConversation((prev) => (prev ? { ...prev, owner_id: nextOwnerId } : prev));
        const promotedUser = groupMembers.find((member) => member.id === nextOwnerId)?.username ?? "Üye";
        setGroupInviteStatus(`${promotedUser} artık grup yöneticisi.`);
      } finally {
        setGroupOwnerTransferBusy(false);
      }
    },
    [conversation?.owner_id, conversationId, groupMembers, isGroupConversation, isGroupOwner, supabase, user]
  );

  const insertBotMessage = useCallback(
    async (rawContent: string, repliedToMessageId?: string, setFailure: (message: string | null) => void = setError) => {
      if (!user || !conversationId || !rawContent.trim()) return null;
      if (!(await ensureCanInsertMessage(setFailure))) return null;

      const payload = {
        conversation_id: conversationId,
        sender_id: user.id,
        content: `${BOT_MESSAGE_PREFIX}${rawContent}`,
        type: "text" as const,
        replied_to: repliedToMessageId
      };

      const { data: insertedBotMessage, error: botInsertError } = await supabase
        .from("messages")
        .insert(payload)
        .select(
          "id, conversation_id, sender_id, content, type, replied_to(id, content, sender_id), created_at, is_read, deleted, edited, media_url, sticker_id, sticker:stickers(id, name, image_url, created_by)"
        )
        .single();

      if (botInsertError) {
        throw new Error(mapMessageInsertErrorMessage(botInsertError.message));
      }

      if (!insertedBotMessage) return null;

      const nextBotMessage = normalizeMessage(insertedBotMessage as MessageRowRaw);
      setMessages((prev) => (prev.some((item) => item.id === nextBotMessage.id) ? prev : [...prev, nextBotMessage]));
      void notifyRecipientsForPush(nextBotMessage.id);
      return nextBotMessage;
    },
    [conversationId, ensureCanInsertMessage, notifyRecipientsForPush, supabase, user]
  );

  const submitWatchPartyPromptDecision = useCallback(
    async (message: MessageRow, decision: "queue_add" | "queue_skip") => {
      if (!user || !conversationId) return;
      if (!isGroupOwner) {
        setError("Watch Party ortak kontrolleri sadece oda sahibi tarafından yönetilebilir.");
        return;
      }
      const parsed = parseWatchPartyBotPayload(stripBotMarker(message.content));
      if (!parsed || parsed.kind !== "prompt") return;

      const actorName =
        user.user_metadata?.username || user.user_metadata?.full_name || user.email || "Kullanıcı";

      const action = decision === "queue_add" ? "queue_add" : "queue_skip";
      const eventPayload: WatchPartyEventPayload = {
        schema: "watch_party_event_v1",
        action,
        suggestionId: parsed.payload.suggestionId,
        actorId: user.id,
        actorName,
        createdAt: new Date().toISOString(),
        video: parsed.payload.video
      };

      try {
        await insertBotMessage(encodeWatchPartyEvent(eventPayload), message.id, setError);
      } catch (insertError) {
        setError(insertError instanceof Error ? insertError.message : "Watch Party kararı kaydedilemedi.");
      }
    },
    [conversationId, insertBotMessage, isGroupOwner, user]
  );

  const resolveBotPrompt = useCallback(
    (value: string): string | null => {
      const raw = value.trim();
      if (!raw) return null;
      if (!BOT_TRIGGER_REGEX.test(raw)) return null;

      const cleaned = raw.replace(/@bot\b/gi, "").trim();
      if (!cleaned) {
        setBotError("@bot kullandıktan sonra bir mesaj yazmalısın.");
        return null;
      }
      if (cleaned.length > MAX_BOT_PROMPT_LENGTH) {
        setBotError(`Bot isteği en fazla ${MAX_BOT_PROMPT_LENGTH} karakter olabilir.`);
        return null;
      }

      const now = Date.now();
      const cooldownLeft = BOT_CLIENT_COOLDOWN_MS - (now - lastBotRequestAtRef.current);
      if (cooldownLeft > 0) {
        setBotError(`Bot için ${Math.ceil(cooldownLeft / 1000)} saniye bekle.`);
        return null;
      }

      return cleaned;
    },
    []
  );

  const requestBotReply = useCallback(
    async (prompt: string, repliedToMessageId?: string) => {
      if (!user || !conversationId || !isGroupConversation) return;

      setBotBusy(true);
      setBotError(null);
      lastBotRequestAtRef.current = Date.now();

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData.session?.access_token;
        if (!accessToken) {
          setBotError("Bot için oturum doğrulaması alınamadı.");
          return;
        }

        const recentMessages = messages
          .filter((item) => !item.deleted)
          .slice(-18)
          .map((item) => ({
            senderName:
              isBotMessageContent(item.content)
                ? "bot"
                : participantsById.get(item.sender_id)?.profile?.username ||
                  participantsById.get(item.sender_id)?.profile?.full_name ||
                  "kullanici",
            content: toReadableMessageText(item.content)
          }));

        const response = await fetch("/api/bot/reply", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`
          },
          body: JSON.stringify({
            conversationId,
            prompt,
            messages: recentMessages
          })
        });

        const data = (await response.json()) as { reply?: string; error?: string };
        if (!response.ok) {
          throw new Error(data.error || "Bot yanıtı alınamadı.");
        }

        const answer = data.reply?.trim();
        if (!answer) {
          throw new Error("Bot boş yanıt döndürdü.");
        }

        await insertBotMessage(answer, repliedToMessageId, setBotError);
      } catch (botRequestError) {
        setBotError(botRequestError instanceof Error ? botRequestError.message : "Bot yanıtında hata oluştu.");
      } finally {
        setBotBusy(false);
      }
    },
    [conversationId, insertBotMessage, isGroupConversation, messages, participantsById, supabase, user]
  );

  useEffect(() => {
    if (!conversationId || !user) return;

    if (!preferences.showTypingIndicator) {
      if (typingSentRef.current) {
        typingSentRef.current = false;
        typingSentAtRef.current = Date.now();
        void sendTypingStatus(false);
      }
      return;
    }

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
  }, [conversationId, preferences.showTypingIndicator, sendTypingStatus, trimmedText, user]);

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
        supabase.from("conversations").select("id, name, is_group, owner_id, created_at").eq("id", conversationId).single(),
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
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "participants",
          filter: `conversation_id=eq.${conversationId}`
        },
        async (payload) => {
          const row = payload.new as { user_id?: string | null };
          const participantUserId = row.user_id;
          if (!participantUserId) return;

          const { data: profileData } = await supabase
            .from("profiles")
            .select("id, username, full_name, avatar_url, status")
            .eq("id", participantUserId)
            .maybeSingle();

          setParticipants((prev) => {
            if (prev.some((participant) => participant.user_id === participantUserId)) return prev;
            return [...prev, { user_id: participantUserId, profile: (profileData as ProfileRow | null) ?? null }];
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "participants",
          filter: `conversation_id=eq.${conversationId}`
        },
        (payload) => {
          const row = payload.old as { user_id?: string | null };
          if (!row.user_id) return;

          if (row.user_id === user.id) {
            onLeaveConversation?.();
            return;
          }

          setParticipants((prev) => prev.filter((participant) => participant.user_id !== row.user_id));
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversations",
          filter: `id=eq.${conversationId}`
        },
        (payload) => {
          const row = payload.new as Partial<ConversationRow>;
          setConversation((prev) => (prev ? { ...prev, ...row } : prev));
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
      if (blockErrorTimeoutRef.current) {
        clearTimeout(blockErrorTimeoutRef.current);
        blockErrorTimeoutRef.current = null;
      }
      void supabase.removeChannel(channel);
    };
  }, [conversationId, markRead, onLeaveConversation, supabase, user]);

  // Block realtime subscription — uses ref so dep array stays stable
  useEffect(() => {
    if (!user) return;

    const blockChannel = supabase
      .channel(`block-notif:${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_blocks" },
        (payload: { new: {blocker_id?: string; blocked_id?: string}; old: {blocker_id?: string; blocked_id?: string} }) => {
          const change = payload.new || payload.old;
          if (change?.blocker_id === user.id || change?.blocked_id === user.id) {
            void refreshBlockStatusRef.current?.();
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(blockChannel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, supabase]);

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
      if (isBotMessageContent(message.content)) return;

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
      if (!(await ensureCanInsertMessage(setError))) return;
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
          setError(mapMessageInsertErrorMessage(insertError.message));
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
    [blockedByOther, conversationId, ensureCanInsertMessage, notifyRecipientsForPush, supabase, user]
  );

  const sendGifMessage = useCallback(
    async (gifUrl: string, gifTitle: string) => {
      if (!user || !conversationId) return;
      if (blockedByOther) {
        setError("Bu kullanıcı seni engelledi.");
        return;
      }
      if (!(await ensureCanInsertMessage(setError))) return;
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
          setError(mapMessageInsertErrorMessage(insertError.message));
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
    [blockedByOther, conversationId, ensureCanInsertMessage, notifyRecipientsForPush, supabase, user]
  );

  const handleWatchPartyLinkAutomation = useCallback(
    async (sourceMessageId: string, sourceText: string) => {
      if (!user || !conversationId || !isGroupConversation || !isGroupOwner) return;

      const foundVideos = extractYouTubeVideosFromText(sourceText);
      if (foundVideos.length === 0) return;

      const proposedByName =
        user.user_metadata?.username || user.user_metadata?.full_name || user.email || "Kullanıcı";

      for (const foundVideo of foundVideos) {
        const video = await fetchYouTubeVideoMeta(foundVideo.videoId, foundVideo.sourceUrl);
        const suggestionId = `${sourceMessageId}:${video.videoId}`;

        const queueEvent: WatchPartyEventPayload = {
          schema: "watch_party_event_v1",
          action: "queue_add",
          suggestionId,
          actorId: user.id,
          actorName: proposedByName,
          createdAt: new Date().toISOString(),
          video
        };
        await insertBotMessage(encodeWatchPartyEvent(queueEvent), sourceMessageId);
      }
    },
    [conversationId, insertBotMessage, isGroupConversation, isGroupOwner, user]
  );

  const send = useCallback(async () => {
    if (!user || !conversationId || (!trimmedText && !attachmentFile)) return;
    if (!networkOnline) {
      setError("Bağlantı yok. Mesaj gönderilemedi.");
      return;
    }
    if (trimmedText.length > MAX_TEXT_MESSAGE_LENGTH) {
      setError(`Mesaj en fazla ${MAX_TEXT_MESSAGE_LENGTH} karakter olabilir.`);
      return;
    }
    if (!(await ensureCanInsertMessage(setError))) {
      return;
    }
    if (sendingRef.current) return;

    sendingRef.current = true;
    setSending(true);
    setError(null);
    autoScrollRef.current = true;

    try {
      if (editingTarget) {
        if (isBotMessageContent(editingTarget.content)) {
          setEditingTarget(null);
          setText("");
          return;
        }
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
        setError(mapMessageInsertErrorMessage(insertError.message));
        return;
      }

      if (inserted) {
        const nextMessage = normalizeMessage(inserted as MessageRowRaw);
        setMessages((prev) => (prev.some((item) => item.id === nextMessage.id) ? prev : [...prev, nextMessage]));
        void notifyRecipientsForPush(nextMessage.id).catch((pushError) => {
          console.warn("[push] notify failed:", pushError);
        });

        if (trimmedText && isGroupConversation) {
          void handleWatchPartyLinkAutomation(nextMessage.id, trimmedText).catch((automationError) => {
            console.warn("[watch-party] otomasyon hatası:", automationError);
          });
        }

        const botPrompt = isGroupConversation ? resolveBotPrompt(trimmedText) : null;
        if (botPrompt) {
          void requestBotReply(botPrompt, nextMessage.id);
        }
      }

      if (typingSentRef.current) {
        typingSentRef.current = false;
        typingSentAtRef.current = Date.now();
        void sendTypingStatus(false);
      }

      setText("");
      clearConversationDraft(user.id, conversationId);
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
    ensureCanInsertMessage,
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
    handleWatchPartyLinkAutomation,
    uploadMedia,
    isGroupConversation,
    requestBotReply,
    resolveBotPrompt
  ]);

  const handleInstallCtaClick = useCallback(async () => {
    if (!conversationId || !onInlineInstall || installingInline) return;

    setInstallingInline(true);
    try {
      await onInlineInstall(conversationId);
    } finally {
      setInstallingInline(false);
    }
  }, [conversationId, installingInline, onInlineInstall]);

  if (!conversationId) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center">
        <p className="text-sm text-zinc-400">Konuşma seçerek mesajlaşmaya başlayabilirsin.</p>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col overflow-x-hidden">
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
                      : isSystemBotConversation
                        ? canInlineInstall
                          ? "kurulum hazır • tek tıkla kur"
                          : "bot asistan"
                        : botBusy
                          ? "bot düşünüyor..."
                          : "grup sohbeti • @bot aktif"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            aria-label="Sohbet menüsünü aç"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/50 text-zinc-200 hover:bg-zinc-800"
            onClick={() => setActionDrawerOpen(true)}
            type="button"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className={cn("pointer-events-none absolute inset-0 z-40", actionDrawerOpen && "pointer-events-auto")}>
        <button
          aria-label="Menüyü kapat"
          className={cn(
            "absolute inset-0 bg-black/60 transition-opacity",
            actionDrawerOpen ? "opacity-100" : "opacity-0"
          )}
          onClick={() => setActionDrawerOpen(false)}
          type="button"
        />
        <aside
          className={cn(
            "absolute right-0 top-0 h-full w-[min(92vw,380px)] border-l border-zinc-800 bg-zinc-950 shadow-2xl transition-transform",
            actionDrawerOpen ? "translate-x-0" : "translate-x-full"
          )}
        >
          <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
            <p className="text-sm font-semibold text-zinc-100">Sohbet Menüsü</p>
            <button
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
              onClick={() => setActionDrawerOpen(false)}
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="h-[calc(100%-3.5rem)] space-y-3 overflow-y-auto p-3">
            <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Hızlı İşlemler</p>
              <div className="flex flex-wrap gap-2">
                <button
                  className={cn(
                    "inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs transition-colors",
                    messageSearchOpen
                      ? "border-emerald-700/60 bg-emerald-600/20 text-emerald-300"
                      : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                  )}
                  onClick={() => {
                    setMessageSearchOpen((prev) => {
                      if (prev) {
                        setMessageSearchQuery("");
                        setActiveSearchMatchIndex(0);
                        setActiveMessageId(null);
                      }
                      return !prev;
                    });
                    setActionDrawerOpen(false);
                  }}
                  type="button"
                >
                  <Search className="h-3.5 w-3.5" />
                  {messageSearchOpen ? "Aramayı Kapat" : "Mesaj Ara"}
                </button>

                <button
                  className={cn(
                    "inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs transition-colors",
                    isConversationPinned
                      ? "border-amber-700/60 bg-amber-600/20 text-amber-300"
                      : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                  )}
                  onClick={() => togglePinnedConversation()}
                  type="button"
                >
                  {isConversationPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                  {isConversationPinned ? "Pin Kaldır" : "Sabitle"}
                </button>

                <button
                  className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
                  onClick={() => void toggleMute()}
                  type="button"
                >
                  {muted ? <BellOff className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
                  {muted ? "Bildirim Aç" : "Sustur"}
                </button>

                {otherUserId ? (
                  <button
                    className={cn(
                      "inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs transition-colors",
                      blockStatus === "blockedByMe"
                        ? "border-orange-700/50 bg-orange-900/50 text-orange-300 hover:bg-orange-900/70"
                        : "border-red-700/50 bg-red-900/50 text-red-300 hover:bg-red-900/70"
                    )}
                    onClick={() => void handleBlockToggle()}
                    type="button"
                  >
                    <Ban className="h-3.5 w-3.5" />
                    {blockStatus === "blockedByMe" ? "Engeli Kaldır" : "Engelle"}
                  </button>
                ) : null}
              </div>
            </section>

            {isGroupConversation ? (
              <>
                <section className="rounded-xl border border-cyan-900/40 bg-cyan-950/20 p-3">
                  <div className="mb-1 flex items-center gap-2">
                    <Bot className="h-4 w-4 text-cyan-300" />
                    <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Bot Kullanımı</p>
                  </div>
                  <p className="text-xs text-cyan-100/90">
                    Mesaja sadece <code>@bot</code> yazıp devamına isteğini eklemen yeterli.
                  </p>
                  <p className="mt-1 text-[11px] text-cyan-200/80">
                    Bot isteği limiti: {MAX_BOT_PROMPT_LENGTH} karakter ve {Math.round(BOT_CLIENT_COOLDOWN_MS / 1000)} saniye aralık.
                  </p>
                  {botBusy ? <p className="mt-2 text-xs text-cyan-200">Bot yanıt hazırlıyor...</p> : null}
                  {botError ? <p className="mt-2 text-xs text-red-300">{botError}</p> : null}
                </section>

                <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <Info className="h-4 w-4 text-zinc-300" />
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-300">Grup Ayarları</p>
                  </div>
                  <p className="text-xs text-zinc-400">
                    {groupMembers.length}/{MAX_GROUP_MEMBER_COUNT} üye
                    {conversation?.created_at ? ` • ${new Date(conversation.created_at).toLocaleDateString("tr-TR")} oluşturma` : ""}
                  </p>

                  <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/80 p-2">
                    <p className="mb-2 text-xs font-semibold text-zinc-300">Grup Adı</p>
                    <div className="flex flex-col gap-2">
                      <input
                        className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-zinc-600 disabled:opacity-60"
                        disabled={!isGroupOwner || groupNameSaving}
                        onChange={(event) => setGroupNameInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                          event.preventDefault();
                          void saveGroupName();
                        }}
                        placeholder="Grup adı"
                        value={groupNameInput}
                      />
                      {isGroupOwner ? (
                        <button
                          className={cn(
                            "inline-flex items-center justify-center gap-1 rounded-lg border px-3 py-2 text-xs transition-colors",
                            groupNameSaving
                              ? "border-zinc-700 bg-zinc-800 text-zinc-400"
                              : "border-blue-700/60 bg-blue-600/30 text-blue-200 hover:bg-blue-600/40"
                          )}
                          disabled={groupNameSaving}
                          onClick={() => void saveGroupName()}
                          type="button"
                        >
                          {groupNameSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pencil className="h-3.5 w-3.5" />}
                          Kaydet
                        </button>
                      ) : (
                        <p className="text-[11px] text-zinc-500">Grup adını sadece yönetici değiştirebilir.</p>
                      )}
                    </div>
                  </div>

                  <div className="mt-3">
                    <p className="mb-2 text-xs font-semibold text-zinc-300">Üyeler</p>
                    <ul className="max-h-52 space-y-1 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/80 p-2">
                      {groupMembers.map((member) => (
                        <li key={member.id} className="rounded-md border border-zinc-800/70 bg-zinc-900/60 p-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2">
                              {member.avatarUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  alt={member.username}
                                  className="h-7 w-7 rounded-full border border-zinc-700 object-cover"
                                  src={member.avatarUrl}
                                />
                              ) : (
                                <div className="grid h-7 w-7 place-items-center rounded-full border border-zinc-700 bg-zinc-800 text-[11px] font-semibold text-zinc-200">
                                  {member.username.slice(0, 1).toUpperCase()}
                                </div>
                              )}
                              <div className="min-w-0">
                                <p className="truncate text-xs text-zinc-200">{member.username}</p>
                                <p className="text-[11px] text-zinc-500">{isOnline(member.id) ? "çevrim içi" : "çevrim dışı"}</p>
                              </div>
                            </div>

                            <div className="flex items-center gap-1">
                              {member.isOwner ? (
                                <span className="inline-flex items-center gap-1 rounded-full border border-amber-700/60 bg-amber-600/20 px-2 py-0.5 text-[10px] text-amber-300">
                                  <Crown className="h-3 w-3" />
                                  Yönetici
                                </span>
                              ) : null}
                              {member.isMe ? (
                                <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400">Sen</span>
                              ) : null}
                            </div>
                          </div>

                          {isGroupOwner && !member.isOwner ? (
                            <div className="mt-2 flex flex-wrap gap-1">
                              <button
                                className={cn(
                                  "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] transition-colors",
                                  groupOwnerTransferBusy
                                    ? "border-zinc-700 bg-zinc-800 text-zinc-500"
                                    : "border-cyan-700/60 bg-cyan-600/20 text-cyan-200 hover:bg-cyan-600/30"
                                )}
                                disabled={groupOwnerTransferBusy || Boolean(groupMemberBusyId)}
                                onClick={() => void transferGroupOwnership(member.id)}
                                type="button"
                              >
                                {groupOwnerTransferBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Crown className="h-3 w-3" />}
                                Yönetici Yap
                              </button>
                              <button
                                className={cn(
                                  "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] transition-colors",
                                  groupMemberBusyId === member.id
                                    ? "border-zinc-700 bg-zinc-800 text-zinc-500"
                                    : "border-red-700/60 bg-red-600/20 text-red-200 hover:bg-red-600/30"
                                )}
                                disabled={groupMemberBusyId === member.id || groupOwnerTransferBusy}
                                onClick={() => void removeMemberFromGroup(member.id)}
                                type="button"
                              >
                                {groupMemberBusyId === member.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserMinus className="h-3 w-3" />}
                                Çıkar
                              </button>
                            </div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/80 p-2">
                    <p className="mb-2 text-xs font-semibold text-zinc-300">Üye Ekle</p>
                    {isGroupOwner ? (
                      <div className="flex gap-2">
                        <input
                          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-zinc-600"
                          onChange={(event) => setGroupInviteUsername(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                            event.preventDefault();
                            void inviteMemberToGroup();
                          }}
                          placeholder="Kullanıcı adı"
                          value={groupInviteUsername}
                        />
                        <button
                          className={cn(
                            "inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs transition-colors",
                            groupInviteBusy
                              ? "border-zinc-700 bg-zinc-800 text-zinc-400"
                              : "border-blue-700/60 bg-blue-600/30 text-blue-200 hover:bg-blue-600/40"
                          )}
                          disabled={groupInviteBusy}
                          onClick={() => void inviteMemberToGroup()}
                          type="button"
                        >
                          {groupInviteBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                          Ekle
                        </button>
                      </div>
                    ) : (
                      <p className="text-[11px] text-zinc-500">Üye ekleme işlemini sadece yönetici yapabilir.</p>
                    )}
                    <p className="mt-2 text-[11px] text-zinc-500">Maksimum üye sayısı: {MAX_GROUP_MEMBER_COUNT}</p>
                  </div>

                  <div className="mt-3 flex items-center justify-between rounded-lg border border-red-900/50 bg-red-950/20 p-2">
                    <p className="text-xs text-red-200">
                      {isGroupOwner && groupMembers.length > 1
                        ? "Ayrılmadan önce yönetici devri yapmalısın."
                        : "Gruptan ayrılabilirsin."}
                    </p>
                    <button
                      className={cn(
                        "inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs transition-colors",
                        groupLeaveBusy
                          ? "border-zinc-700 bg-zinc-800 text-zinc-400"
                          : "border-red-700/60 bg-red-600/20 text-red-200 hover:bg-red-600/30"
                      )}
                      disabled={groupLeaveBusy}
                      onClick={() => void leaveGroup()}
                      type="button"
                    >
                      {groupLeaveBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Users className="h-3.5 w-3.5" />}
                      Gruptan Ayrıl
                    </button>
                  </div>

                  {groupInviteStatus ? <p className="mt-2 text-xs text-zinc-300">{groupInviteStatus}</p> : null}
                </section>
              </>
            ) : null}
          </div>
        </aside>
      </div>

      {messageSearchOpen ? (
        <section className="border-b border-zinc-800/70 bg-zinc-900/50 px-3 py-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
              <input
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 py-2 pl-8 pr-3 text-xs text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-zinc-600"
                onChange={(event) => setMessageSearchQuery(event.target.value)}
                placeholder="Mesaj içinde ara..."
                value={messageSearchQuery}
              />
            </div>

            <div className="flex items-center gap-1 text-[11px] text-zinc-400">
              {matchedMessageIds.length > 0 ? `${activeSearchMatchIndex + 1}/${matchedMessageIds.length}` : "0/0"}
            </div>

            <button
              aria-label="Önceki eşleşme"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
              disabled={matchedMessageIds.length === 0}
              onClick={() => jumpSearchMatch(-1)}
              type="button"
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <button
              aria-label="Sonraki eşleşme"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
              disabled={matchedMessageIds.length === 0}
              onClick={() => jumpSearchMatch(1)}
              type="button"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            <button
              aria-label="Aramayı kapat"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
              onClick={() => {
                setMessageSearchOpen(false);
                setMessageSearchQuery("");
                setActiveSearchMatchIndex(0);
                setActiveMessageId(null);
              }}
              type="button"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {messageSearchQuery.trim() && matchedMessageIds.length === 0 ? (
            <p className="mt-2 text-[11px] text-zinc-500">Eşleşme bulunamadı.</p>
          ) : null}
        </section>
      ) : null}

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
            {(messages as MessageRow[]).map((message, index) => {
              const botMessage = isBotMessageContent(message.content);
              const mine = !botMessage && message.sender_id === user?.id;
              const sender = participantsById.get(message.sender_id);
              const senderName = botMessage
                ? "Atlas Bot"
                : sender?.profile?.username || sender?.profile?.full_name || "Kullanıcı";
              const rawDisplayContent = stripBotMarker(message.content);
              const parsedWatchParty = botMessage ? parseWatchPartyBotPayload(rawDisplayContent) : null;
              const hasInstallCta = botMessage && containsInstallCtaMarker(message.content);
              const displayContent = parsedWatchParty
                ? buildWatchPartyDisplayText(parsedWatchParty)
                : hasInstallCta
                ? stripInstallCtaMarker(rawDisplayContent)
                : rawDisplayContent;
              const promptDecision =
                parsedWatchParty?.kind === "prompt"
                  ? watchPartyDecisionBySuggestionId.get(parsedWatchParty.payload.suggestionId)
                  : undefined;
              const showDateSeparator =
                index === 0 ||
                new Date(messages[index - 1].created_at).toDateString() !== new Date(message.created_at).toDateString();
              const active = activeMessageId === message.id;
              const currentSwipe = swipeState;
              const swipeOffset = currentSwipe?.id === message.id ? (currentSwipe.offset ?? 0) : 0;
              const swipeActive = swipeOffset !== 0;
              const swipeReady = !mine ? swipeOffset >= 46 : swipeOffset <= -46;
              const swipeAllowed = !message.deleted;
              const searchMatched = matchedMessageIdSet.has(message.id);
              const searchFocused = activeSearchMessageId === message.id;

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
                              : botMessage
                              ? "border-cyan-900/50 bg-cyan-600/15 text-cyan-100"
                              : mine
                              ? "border-blue-900/60 bg-blue-600/85 text-white"
                              : "border-zinc-800 bg-zinc-900/70 text-zinc-100",
                            active && "ring-1 ring-zinc-500",
                            searchMatched && !searchFocused && "ring-1 ring-emerald-600/70",
                            searchFocused && "ring-2 ring-emerald-400",
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
                                {isBotMessageContent(message.replied_to.content)
                                  ? "Atlas Bot"
                                  : message.replied_to.sender_id === user?.id
                                  ? "Sen"
                                  : participantsById.get(message.replied_to.sender_id)?.profile?.username || "Kullanıcı"}
                                :
                              </span>{" "}
                              {toReadableMessageText(message.replied_to.content)}
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
                          ) : parsedWatchParty?.kind === "prompt" ? (
                            <div className="space-y-2">
                              <div className="overflow-hidden rounded-xl border border-cyan-900/60 bg-zinc-950/40">
                                <img
                                  alt={parsedWatchParty.payload.video.title}
                                  className="h-28 w-full object-cover"
                                  src={parsedWatchParty.payload.video.thumbnailUrl}
                                />
                                <div className="space-y-1 p-2">
                                  <p className="line-clamp-2 text-sm font-semibold text-cyan-100">{parsedWatchParty.payload.video.title}</p>
                                  <p className="text-[11px] text-cyan-200/80">{parsedWatchParty.payload.video.channelTitle}</p>
                                </div>
                              </div>

                              {promptDecision ? (
                                <p className="text-[11px] text-cyan-200/80">
                                  Karar verildi: {promptDecision.actorName} {promptDecision.action === "queue_add" ? "sıraya ekledi" : "pas geçti"}.
                                </p>
                              ) : !isGroupOwner ? (
                                <p className="text-[11px] text-zinc-400">
                                  Bu öneriyi sadece oda sahibi onaylayabilir.
                                </p>
                              ) : (
                                <div className="flex flex-wrap gap-1.5">
                                  <button
                                    className="inline-flex items-center rounded-lg border border-emerald-700/60 bg-emerald-600/20 px-2 py-1 text-[11px] font-semibold text-emerald-200 hover:bg-emerald-600/30"
                                    onClick={() => void submitWatchPartyPromptDecision(message, "queue_add")}
                                    type="button"
                                  >
                                    Evet
                                  </button>
                                  <button
                                    className="inline-flex items-center rounded-lg border border-zinc-700 bg-zinc-900/70 px-2 py-1 text-[11px] font-semibold text-zinc-200 hover:bg-zinc-800"
                                    onClick={() => void submitWatchPartyPromptDecision(message, "queue_skip")}
                                    type="button"
                                  >
                                    Hayır
                                  </button>
                                </div>
                              )}
                            </div>
                          ) : parsedWatchParty?.kind === "event" ? (
                            <p className="whitespace-pre-wrap break-words">{buildWatchPartyDisplayText(parsedWatchParty)}</p>
                          ) : WP_INVITE_REGEX.test(message.content) ? (
                            (() => {
                              const wpMatch = WP_INVITE_REGEX.exec(message.content);
                              const wpConvId = wpMatch?.[1] ?? "";
                              return (
                                <div className="flex items-center gap-3 rounded-xl border border-cyan-700/60 bg-cyan-950/40 px-3 py-2.5">
                                  <Film className="h-5 w-5 shrink-0 text-cyan-400" />
                                  <div className="min-w-0 flex-1">
                                    <p className="text-xs font-semibold text-cyan-100">Watch Party Daveti</p>
                                    <p className="text-[11px] text-zinc-400">Katılmak için tıkla</p>
                                  </div>
                                  <button
                                    className="shrink-0 rounded-lg border border-cyan-600/60 bg-cyan-600/20 px-3 py-1.5 text-xs font-semibold text-cyan-200 transition-colors hover:bg-cyan-600/30"
                                    onClick={() => router.push(`/chat?wp=${wpConvId}`)}
                                    type="button"
                                  >
                                    Katıl
                                  </button>
                                </div>
                              );
                            })()
                          ) : (
                            <p className="whitespace-pre-wrap break-words">
                              {renderLinkifiedText(displayContent)}
                              {message.edited && !message.deleted ? (
                                <span className="ml-1 text-[10px] text-zinc-400">(düzenlendi)</span>
                              ) : null}
                            </p>
                          )}

                          {hasInstallCta ? (
                            <button
                              className={cn(
                                "mt-3 inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
                                canInlineInstall
                                  ? "border-cyan-700/60 bg-cyan-600/20 text-cyan-100 hover:bg-cyan-600/30"
                                  : "border-zinc-700 bg-zinc-800/70 text-zinc-400"
                              )}
                              disabled={installingInline || !canInlineInstall || !onInlineInstall}
                              onClick={() => void handleInstallCtaClick()}
                              type="button"
                            >
                              {installingInline ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                              {canInlineInstall ? "Tek Tıkla Kur" : "Kurulum Şu Anda Kullanılamıyor"}
                            </button>
                          ) : null}

                          <div
                            className={cn(
                              "mt-1 flex items-center justify-end gap-2 text-[10px]",
                              mine ? "text-blue-100/80" : botMessage ? "text-cyan-200/70" : "text-zinc-500"
                            )}
                          >
                            <span>
                              {new Date(message.created_at).toLocaleTimeString("tr-TR", {
                                hour: "2-digit",
                                minute: "2-digit"
                              })}
                            </span>
                            {mine && !botMessage ? <span>{message.is_read ? "okundu" : "gönderildi"}</span> : null}
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
                              if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(displayContent);
                            }}
                            title="Kopyala"
                            type="button"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                          {mine && !botMessage ? (
                            <button
                              className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                              onClick={() => {
                                setEditingTarget(message);
                                setReplyTarget(null);
                                setText(displayContent);
                                setTimeout(focusInputWithoutScroll, 0);
                              }}
                              title="Düzenle"
                              type="button"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          ) : null}
                          {mine && !botMessage ? (
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
            {editingTarget
              ? `Düzenleniyor: ${toReadableMessageText(editingTarget.content)}`
              : `Yanıtlanıyor: ${toReadableMessageText(replyTarget?.content ?? "")}`}
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
        <div className="border-t border-orange-900/60 bg-orange-950/40 px-4 py-3 flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <Ban className="h-5 w-5 text-orange-300 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-orange-200">Bu kullanıcıyı engelledi</p>
              <p className="text-xs text-orange-100/70 mt-1">Mesajlarını görmeyeceksin ve sen de görmeyeceksin. Engeli istediğin zaman kaldırabilirsin.</p>
            </div>
          </div>
          <button
            className="self-start inline-flex items-center gap-2 rounded-lg border border-orange-700/50 bg-orange-900/40 px-4 py-2 text-sm font-medium text-orange-200 hover:bg-orange-900/60 transition-colors"
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
            <Ban className="h-5 w-5 text-red-300 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-red-200">Engellendi</p>
              <p className="text-xs text-red-100/70 mt-1">Bu kullanıcı seni engelledi. Mesaj gönderemez ve göremezsin.</p>
            </div>
          </div>
        </div>
      ) : null}

      {blockError ? (
        <div className="border-t border-red-900/60 bg-red-950/40 px-4 py-3 flex items-start gap-3 animate-in fade-in duration-200">
          <AlertCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-red-200">{blockError}</p>
          </div>
          <button
            onClick={() => {
              setBlockError(null);
              if (blockErrorTimeoutRef.current) {
                clearTimeout(blockErrorTimeoutRef.current);
                blockErrorTimeoutRef.current = null;
              }
            }}
            type="button"
            className="text-red-400 hover:text-red-300 shrink-0"
          >
            <X className="h-4 w-4" />
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
        <input
          ref={attachmentInputRef}
          accept={ALLOWED_MEDIA_MIME_TYPES.join(",")}
          className="hidden"
          onChange={handleAttachmentChange}
          type="file"
        />
        {!watchPartyMode ? (
          <>
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
          </>
        ) : onBack ? (
          <button
            aria-label="Video alanına dön"
            className="inline-flex h-11 shrink-0 items-center justify-center rounded-lg border border-cyan-700/60 bg-cyan-600/20 px-3 text-xs font-semibold text-cyan-100 hover:bg-cyan-600/30"
            onClick={onBack}
            type="button"
          >
            Video
          </button>
        ) : null}

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
            if (event.nativeEvent.isComposing) return;

            if (!preferences.enterToSend) {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void send();
              }
              return;
            }

            if (event.key !== "Enter") return;
            if (event.shiftKey) return;
            event.preventDefault();
            void send();
          }}
          placeholder={preferences.enterToSend ? "Mesaj yaz..." : "Mesaj yaz... (göndermek için Ctrl+Enter)"}
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
      <div className="flex items-center justify-between px-3 pb-2 text-[11px]">
        <span className="text-zinc-500">Medya limiti: {formatFileSize(MAX_ATTACHMENT_SIZE)}</span>
        <span className={cn("font-medium", textTooLong ? "text-red-300" : "text-zinc-500")}>
          {trimmedText.length}/{MAX_TEXT_MESSAGE_LENGTH}
        </span>
      </div>

      {mediaPickerOpen && !watchPartyMode ? (
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
