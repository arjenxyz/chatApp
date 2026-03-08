const YOUTUBE_VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;
const YOUTUBE_URL_TOKEN_REGEX = /(?:https?:\/\/|www\.|youtu\.be\/|youtube\.com\/)[^\s]+/gi;

export const WATCH_PARTY_PROMPT_MARKER = "[[WATCH_PARTY_PROMPT]]";
export const WATCH_PARTY_EVENT_MARKER = "[[WATCH_PARTY_EVENT]]";

const WATCH_PARTY_LINK_MODE_STORAGE_KEY = "chat.watchParty.linkMode.v1";

export type WatchPartyLinkMode = "ask" | "always_queue" | "never";

export type WatchPartyVideoMeta = {
  videoId: string;
  sourceUrl: string;
  canonicalUrl: string;
  title: string;
  thumbnailUrl: string;
  channelTitle: string;
};

export type WatchPartyPromptPayload = {
  schema: "watch_party_prompt_v1";
  suggestionId: string;
  sourceMessageId: string;
  proposedById: string;
  proposedByName: string;
  proposedAt: string;
  video: WatchPartyVideoMeta;
};

export type WatchPartyEventAction = "queue_add" | "queue_skip" | "queue_remove" | "queue_clear" | "queue_play" | "queue_stop" | "queue_replay";

export type WatchPartyEventPayload = {
  schema: "watch_party_event_v1";
  action: WatchPartyEventAction;
  suggestionId?: string;
  actorId: string;
  actorName: string;
  createdAt: string;
  reason?: string;
  video?: WatchPartyVideoMeta;
};

export type ParsedWatchPartyBotPayload =
  | {
      kind: "prompt";
      payload: WatchPartyPromptPayload;
    }
  | {
      kind: "event";
      payload: WatchPartyEventPayload;
    };

type YouTubeOEmbedResponse = {
  title?: string;
  author_name?: string;
  thumbnail_url?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function sanitizeUrlToken(token: string): string {
  return token.replace(/[),.;!?]+$/g, "");
}

function buildLinkModeStorageEntryKey(userId: string, conversationId: string): string {
  return `${WATCH_PARTY_LINK_MODE_STORAGE_KEY}:${userId}:${conversationId}`;
}

export function buildYouTubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function extractYouTubeVideoId(input: string): string | null {
  if (!input || !input.trim()) return null;

  const trimmed = input.trim();
  if (YOUTUBE_VIDEO_ID_REGEX.test(trimmed)) {
    return trimmed;
  }

  try {
    const urlText =
      trimmed.startsWith("http://") || trimmed.startsWith("https://")
        ? trimmed
        : `https://${trimmed}`;
    const url = new URL(urlText);
    const hostname = url.hostname.replace(/^www\./, "").toLowerCase();

    if (hostname === "youtu.be") {
      const shortId = url.pathname.split("/").filter(Boolean)[0] ?? "";
      return YOUTUBE_VIDEO_ID_REGEX.test(shortId) ? shortId : null;
    }

    if (hostname === "youtube.com" || hostname.endsWith(".youtube.com")) {
      const paramId = url.searchParams.get("v");
      if (paramId && YOUTUBE_VIDEO_ID_REGEX.test(paramId)) {
        return paramId;
      }

      const segments = url.pathname.split("/").filter(Boolean);
      for (const segment of segments) {
        if (YOUTUBE_VIDEO_ID_REGEX.test(segment)) {
          return segment;
        }
      }
    }
  } catch {
    return null;
  }

  return null;
}

export function extractYouTubeVideosFromText(input: string): Array<{ videoId: string; sourceUrl: string }> {
  if (!input.trim()) return [];

  const found = new Map<string, string>();
  const matches = input.match(YOUTUBE_URL_TOKEN_REGEX) ?? [];

  matches.forEach((match) => {
    const cleaned = sanitizeUrlToken(match);
    const videoId = extractYouTubeVideoId(cleaned);
    if (!videoId || found.has(videoId)) return;
    const sourceUrl = cleaned.startsWith("http://") || cleaned.startsWith("https://") ? cleaned : `https://${cleaned}`;
    found.set(videoId, sourceUrl);
  });

  if (found.size === 0) {
    input
      .split(/\s+/)
      .map((token) => sanitizeUrlToken(token))
      .forEach((token) => {
        if (!YOUTUBE_VIDEO_ID_REGEX.test(token) || found.has(token)) return;
        found.set(token, buildYouTubeWatchUrl(token));
      });
  }

  return Array.from(found.entries()).map(([videoId, sourceUrl]) => ({ videoId, sourceUrl }));
}

export async function fetchYouTubeVideoMeta(videoId: string, sourceUrl?: string): Promise<WatchPartyVideoMeta> {
  const canonicalUrl = buildYouTubeWatchUrl(videoId);
  const fallback: WatchPartyVideoMeta = {
    videoId,
    sourceUrl: sourceUrl?.trim() || canonicalUrl,
    canonicalUrl,
    title: `YouTube Video (${videoId})`,
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    channelTitle: "YouTube"
  };

  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`;
    const response = await fetch(oembedUrl, { method: "GET" });
    if (!response.ok) return fallback;

    const data = (await response.json()) as YouTubeOEmbedResponse;
    return {
      ...fallback,
      title: data.title?.trim() || fallback.title,
      channelTitle: data.author_name?.trim() || fallback.channelTitle,
      thumbnailUrl: data.thumbnail_url?.trim() || fallback.thumbnailUrl
    };
  } catch {
    return fallback;
  }
}

export function encodeWatchPartyPrompt(payload: WatchPartyPromptPayload): string {
  return `${WATCH_PARTY_PROMPT_MARKER}${JSON.stringify(payload)}`;
}

export function encodeWatchPartyEvent(payload: WatchPartyEventPayload): string {
  return `${WATCH_PARTY_EVENT_MARKER}${JSON.stringify(payload)}`;
}

function parseWatchPartyVideoMeta(value: unknown): WatchPartyVideoMeta | null {
  if (!isRecord(value)) return null;

  const videoId = value.videoId;
  const sourceUrl = value.sourceUrl;
  const canonicalUrl = value.canonicalUrl;
  const title = value.title;
  const thumbnailUrl = value.thumbnailUrl;
  const channelTitle = value.channelTitle;

  if (
    !isNonEmptyString(videoId) ||
    !isNonEmptyString(sourceUrl) ||
    !isNonEmptyString(canonicalUrl) ||
    !isNonEmptyString(title) ||
    !isNonEmptyString(thumbnailUrl) ||
    !isNonEmptyString(channelTitle)
  ) {
    return null;
  }

  return {
    videoId,
    sourceUrl,
    canonicalUrl,
    title,
    thumbnailUrl,
    channelTitle
  };
}

function parseWatchPartyPromptPayload(value: unknown): WatchPartyPromptPayload | null {
  if (!isRecord(value)) return null;

  const schema = value.schema;
  const suggestionId = value.suggestionId;
  const sourceMessageId = value.sourceMessageId;
  const proposedById = value.proposedById;
  const proposedByName = value.proposedByName;
  const proposedAt = value.proposedAt;
  const video = parseWatchPartyVideoMeta(value.video);

  if (
    schema !== "watch_party_prompt_v1" ||
    !isNonEmptyString(suggestionId) ||
    !isNonEmptyString(sourceMessageId) ||
    !isNonEmptyString(proposedById) ||
    !isNonEmptyString(proposedByName) ||
    !isNonEmptyString(proposedAt) ||
    !video
  ) {
    return null;
  }

  return {
    schema,
    suggestionId,
    sourceMessageId,
    proposedById,
    proposedByName,
    proposedAt,
    video
  };
}

function parseWatchPartyEventAction(value: unknown): WatchPartyEventAction | null {
  if (
    value === "queue_add" ||
    value === "queue_skip" ||
    value === "queue_remove" ||
    value === "queue_clear" ||
    value === "queue_play" ||
    value === "queue_stop" ||
    value === "queue_replay"
  ) {
    return value;
  }
  return null;
}

function parseWatchPartyEventPayload(value: unknown): WatchPartyEventPayload | null {
  if (!isRecord(value)) return null;

  const schema = value.schema;
  const action = parseWatchPartyEventAction(value.action);
  const actorId = value.actorId;
  const actorName = value.actorName;
  const createdAt = value.createdAt;
  const suggestionId = value.suggestionId;
  const reason = value.reason;
  const video = value.video === undefined ? undefined : parseWatchPartyVideoMeta(value.video);

  if (
    schema !== "watch_party_event_v1" ||
    !action ||
    !isNonEmptyString(actorId) ||
    !isNonEmptyString(actorName) ||
    !isNonEmptyString(createdAt)
  ) {
    return null;
  }

  if (suggestionId !== undefined && !isNonEmptyString(suggestionId)) {
    return null;
  }
  if (reason !== undefined && !isNonEmptyString(reason)) {
    return null;
  }
  if (value.video !== undefined && !video) {
    return null;
  }

  return {
    schema,
    action,
    actorId,
    actorName,
    createdAt,
    suggestionId: suggestionId as string | undefined,
    reason: reason as string | undefined,
    video: video ?? undefined
  };
}

export function parseWatchPartyBotPayload(content: string): ParsedWatchPartyBotPayload | null {
  if (!content.trim()) return null;

  if (content.startsWith(WATCH_PARTY_PROMPT_MARKER)) {
    const rawJson = content.slice(WATCH_PARTY_PROMPT_MARKER.length).trim();
    if (!rawJson) return null;
    try {
      const parsed = JSON.parse(rawJson) as unknown;
      const payload = parseWatchPartyPromptPayload(parsed);
      if (!payload) return null;
      return { kind: "prompt", payload };
    } catch {
      return null;
    }
  }

  if (content.startsWith(WATCH_PARTY_EVENT_MARKER)) {
    const rawJson = content.slice(WATCH_PARTY_EVENT_MARKER.length).trim();
    if (!rawJson) return null;
    try {
      const parsed = JSON.parse(rawJson) as unknown;
      const payload = parseWatchPartyEventPayload(parsed);
      if (!payload) return null;
      return { kind: "event", payload };
    } catch {
      return null;
    }
  }

  return null;
}

export function buildWatchPartyDisplayText(parsed: ParsedWatchPartyBotPayload): string {
  if (parsed.kind === "prompt") {
    return `Watch Party: "${parsed.payload.video.title}" videosu icin sira oneri`;
  }

  const { action, video, actorName } = parsed.payload;
  const videoTitle = video?.title || "video";
  if (action === "queue_add") {
    return `Watch Party: ${actorName} "${videoTitle}" videosunu siraya ekledi`;
  }
  if (action === "queue_skip") {
    return `Watch Party: ${actorName} video onerisi icin gec dedi`;
  }
  if (action === "queue_remove") {
    return `Watch Party: ${actorName} "${videoTitle}" videosunu siradan cikardi`;
  }
  if (action === "queue_play") {
    return `Watch Party: ${actorName} "${videoTitle}" videosunu oynatiyor`;
  }
  if (action === "queue_stop") {
    return `Watch Party: ${actorName} videoyu durdurdu`;
  }
  if (action === "queue_replay") {
    return `Watch Party: ${actorName} "${videoTitle}" videosunu yeniden baslatti`;
  }
  return `Watch Party: ${actorName} sirayi temizledi`;
}

export function loadWatchPartyLinkMode(userId: string, conversationId: string): WatchPartyLinkMode {
  if (typeof window === "undefined") return "ask";

  const key = buildLinkModeStorageEntryKey(userId, conversationId);
  const value = window.localStorage.getItem(key);
  if (value === "always_queue" || value === "never" || value === "ask") {
    return value;
  }
  return "ask";
}

export function saveWatchPartyLinkMode(userId: string, conversationId: string, mode: WatchPartyLinkMode): void {
  if (typeof window === "undefined") return;
  const key = buildLinkModeStorageEntryKey(userId, conversationId);
  window.localStorage.setItem(key, mode);
}
