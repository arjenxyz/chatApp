export type UserPreferences = {
  showTypingIndicator: boolean;
  sendReadReceipts: boolean;
  soundNotifications: boolean;
  enterToSend: boolean;
};

const DEFAULT_PREFERENCES: UserPreferences = {
  showTypingIndicator: true,
  sendReadReceipts: true,
  soundNotifications: false,
  enterToSend: true
};

const PREFERENCES_PREFIX = "chat.preferences";
export const USER_PREFERENCES_UPDATED_EVENT = "chat:user-preferences-updated";

function canUseStorage(): boolean {
  return typeof window !== "undefined";
}

function buildPreferencesStorageKey(userId: string): string {
  return `${PREFERENCES_PREFIX}.${userId}`;
}

function normalizePreferences(candidate: Partial<UserPreferences> | null | undefined): UserPreferences {
  return {
    showTypingIndicator:
      typeof candidate?.showTypingIndicator === "boolean"
        ? candidate.showTypingIndicator
        : DEFAULT_PREFERENCES.showTypingIndicator,
    sendReadReceipts:
      typeof candidate?.sendReadReceipts === "boolean"
        ? candidate.sendReadReceipts
        : DEFAULT_PREFERENCES.sendReadReceipts,
    soundNotifications:
      typeof candidate?.soundNotifications === "boolean"
        ? candidate.soundNotifications
        : DEFAULT_PREFERENCES.soundNotifications,
    enterToSend:
      typeof candidate?.enterToSend === "boolean" ? candidate.enterToSend : DEFAULT_PREFERENCES.enterToSend
  };
}

export function getDefaultUserPreferences(): UserPreferences {
  return { ...DEFAULT_PREFERENCES };
}

export function loadUserPreferences(userId: string | null | undefined): UserPreferences {
  if (!canUseStorage() || !userId) return getDefaultUserPreferences();

  try {
    const raw = window.localStorage.getItem(buildPreferencesStorageKey(userId));
    if (!raw) return getDefaultUserPreferences();
    const parsed = JSON.parse(raw) as Partial<UserPreferences>;
    return normalizePreferences(parsed);
  } catch {
    return getDefaultUserPreferences();
  }
}

export function saveUserPreferences(
  userId: string | null | undefined,
  partial: Partial<UserPreferences>
): UserPreferences {
  if (!userId) return normalizePreferences(partial);

  const current = loadUserPreferences(userId);
  const next = normalizePreferences({ ...current, ...partial });

  if (canUseStorage()) {
    window.localStorage.setItem(buildPreferencesStorageKey(userId), JSON.stringify(next));
    window.dispatchEvent(
      new CustomEvent(USER_PREFERENCES_UPDATED_EVENT, {
        detail: { userId, preferences: next }
      })
    );
  }

  return next;
}

export function subscribeUserPreferences(
  userId: string,
  onChange: (next: UserPreferences) => void
): () => void {
  if (!canUseStorage()) {
    return () => {};
  }

  const storageKey = buildPreferencesStorageKey(userId);

  const onUpdated = (event: Event) => {
    const custom = event as CustomEvent<{ userId?: string; preferences?: UserPreferences }>;
    if (!custom.detail || custom.detail.userId !== userId || !custom.detail.preferences) return;
    onChange(normalizePreferences(custom.detail.preferences));
  };

  const onStorage = (event: StorageEvent) => {
    if (event.key !== storageKey) return;
    onChange(loadUserPreferences(userId));
  };

  window.addEventListener(USER_PREFERENCES_UPDATED_EVENT, onUpdated as EventListener);
  window.addEventListener("storage", onStorage);

  return () => {
    window.removeEventListener(USER_PREFERENCES_UPDATED_EVENT, onUpdated as EventListener);
    window.removeEventListener("storage", onStorage);
  };
}

