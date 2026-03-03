const PINNED_PREFIX = "chat.pinned";
const DRAFT_PREFIX = "chat.draft";

export const CHAT_PINNED_UPDATED_EVENT = "chat:pinned-updated";
export const CHAT_DRAFT_UPDATED_EVENT = "chat:draft-updated";

function canUseStorage(): boolean {
  return typeof window !== "undefined";
}

export function buildPinnedConversationsStorageKey(userId: string): string {
  return `${PINNED_PREFIX}.${userId}`;
}

export function buildConversationDraftStorageKey(userId: string, conversationId: string): string {
  return `${DRAFT_PREFIX}.${userId}.${conversationId}`;
}

export function loadPinnedConversationIds(userId: string | null | undefined): string[] {
  if (!canUseStorage() || !userId) return [];

  try {
    const raw = window.localStorage.getItem(buildPinnedConversationsStorageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return Array.from(new Set(parsed.filter((value): value is string => typeof value === "string")));
  } catch {
    return [];
  }
}

export function savePinnedConversationIds(userId: string | null | undefined, ids: string[]): string[] {
  if (!canUseStorage() || !userId) return [];

  const normalized = Array.from(new Set(ids.filter((value): value is string => Boolean(value))));
  window.localStorage.setItem(buildPinnedConversationsStorageKey(userId), JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent(CHAT_PINNED_UPDATED_EVENT, { detail: { userId, ids: normalized } }));
  return normalized;
}

export function togglePinnedConversationForUser(
  userId: string | null | undefined,
  conversationId: string
): string[] {
  if (!userId || !conversationId) return [];

  const current = loadPinnedConversationIds(userId);
  const hasConversation = current.includes(conversationId);
  const next = hasConversation
    ? current.filter((item) => item !== conversationId)
    : [conversationId, ...current];

  return savePinnedConversationIds(userId, next);
}

export function isConversationPinnedForUser(
  userId: string | null | undefined,
  conversationId: string | null | undefined
): boolean {
  if (!userId || !conversationId) return false;
  return loadPinnedConversationIds(userId).includes(conversationId);
}

export function loadConversationDraft(
  userId: string | null | undefined,
  conversationId: string | null | undefined
): string {
  if (!canUseStorage() || !userId || !conversationId) return "";
  return window.localStorage.getItem(buildConversationDraftStorageKey(userId, conversationId)) ?? "";
}

export function saveConversationDraft(
  userId: string | null | undefined,
  conversationId: string | null | undefined,
  draft: string
): void {
  if (!canUseStorage() || !userId || !conversationId) return;

  const key = buildConversationDraftStorageKey(userId, conversationId);
  const nextValue = draft ?? "";
  if (!nextValue.trim()) {
    window.localStorage.removeItem(key);
  } else {
    window.localStorage.setItem(key, nextValue);
  }

  window.dispatchEvent(
    new CustomEvent(CHAT_DRAFT_UPDATED_EVENT, {
      detail: { userId, conversationId, hasDraft: Boolean(nextValue.trim()) }
    })
  );
}

export function clearConversationDraft(
  userId: string | null | undefined,
  conversationId: string | null | undefined
): void {
  if (!canUseStorage() || !userId || !conversationId) return;
  window.localStorage.removeItem(buildConversationDraftStorageKey(userId, conversationId));
  window.dispatchEvent(
    new CustomEvent(CHAT_DRAFT_UPDATED_EVENT, {
      detail: { userId, conversationId, hasDraft: false }
    })
  );
}

