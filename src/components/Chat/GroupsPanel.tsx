"use client";

import { Loader2, Plus, RefreshCcw, Users } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/AuthProvider";

type GroupRow = {
  id: string;
  name: string | null;
  owner_id: string | null;
  is_watch_party_room: boolean;
  created_at: string;
};

type ParticipantProfile = {
  id: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
};

type ParticipantRow = {
  conversation_id: string;
  user_id: string;
  profile: ParticipantProfile | ParticipantProfile[] | null;
};

type MessageRow = {
  conversation_id: string;
  content: string;
  created_at: string;
  deleted?: boolean;
};

type GroupItem = {
  id: string;
  name: string;
  ownerId: string | null;
  createdAt: string;
  members: Array<{ id: string; username: string }>;
  memberCount: number;
  lastMessage: string | null;
  lastMessageAt: string;
};

const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;
const MAX_GROUP_MEMBER_COUNT = 10;

function normalizeProfile(profile: ParticipantProfile | ParticipantProfile[] | null): ParticipantProfile | null {
  if (!profile) return null;
  if (Array.isArray(profile)) return profile[0] ?? null;
  return profile;
}

function sanitizePreview(value: string | null | undefined): string {
  if (!value) return "Henüz mesaj yok";
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return "Henüz mesaj yok";
  if (compact.length <= 68) return compact;
  return `${compact.slice(0, 68)}...`;
}

export function GroupsPanel({
  mode = "group",
  onOpenConversation
}: {
  mode?: "group" | "watch-party";
  onOpenConversation?: (conversationId: string) => void;
}) {
  const supabase = getSupabaseBrowserClient();
  const { user } = useAuth();

  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [createName, setCreateName] = useState("");
  const [createMembersInput, setCreateMembersInput] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);
  const isWatchPartyMode = mode === "watch-party";

  const refreshGroups = useCallback(async () => {
    if (!user) return;

    setLoading(true);
    setError(null);

    const { data: myMemberships, error: membershipError } = await supabase
      .from("participants")
      .select("conversation_id")
      .eq("user_id", user.id);

    if (membershipError) {
      setError(membershipError.message);
      setLoading(false);
      return;
    }

    const conversationIds = (myMemberships ?? []).map((row) => row.conversation_id);
    if (conversationIds.length === 0) {
      setGroups([]);
      setLoading(false);
      return;
    }

    const [{ data: conversations, error: conversationsError }, { data: participants, error: participantsError }, { data: messages, error: messagesError }] =
      await Promise.all([
        supabase
          .from("conversations")
          .select("id, name, owner_id, is_watch_party_room, created_at")
          .eq("is_group", true)
          .eq("is_watch_party_room", isWatchPartyMode)
          .in("id", conversationIds)
          .order("created_at", { ascending: false }),
        supabase
          .from("participants")
          .select("conversation_id, user_id, profile:profiles(id, username, full_name, avatar_url)")
          .in("conversation_id", conversationIds),
        supabase
          .from("messages")
          .select("conversation_id, content, created_at, deleted")
          .in("conversation_id", conversationIds)
          .order("created_at", { ascending: false })
      ]);

    if (conversationsError || participantsError || messagesError) {
      setError(conversationsError?.message ?? participantsError?.message ?? messagesError?.message ?? "Bilinmeyen hata");
      setLoading(false);
      return;
    }

    const participantMap = new Map<string, Array<{ id: string; username: string }>>();
    ((participants as ParticipantRow[] | null) ?? []).forEach((row) => {
      const profile = normalizeProfile(row.profile);
      const username = profile?.username || profile?.full_name || "kullanici";
      const list = participantMap.get(row.conversation_id) ?? [];
      list.push({ id: row.user_id, username });
      participantMap.set(row.conversation_id, list);
    });

    const lastMessageMap = new Map<string, MessageRow>();
    ((messages as MessageRow[] | null) ?? []).forEach((row) => {
      if (!lastMessageMap.has(row.conversation_id)) {
        lastMessageMap.set(row.conversation_id, row);
      }
    });

    const nextGroups = ((conversations as GroupRow[] | null) ?? []).map((group) => {
      const members = participantMap.get(group.id) ?? [];
      const lastMessage = lastMessageMap.get(group.id) ?? null;
      return {
        id: group.id,
        name: group.name || "İsimsiz Grup",
        ownerId: group.owner_id,
        createdAt: group.created_at,
        members,
        memberCount: members.length,
        lastMessage: lastMessage?.deleted ? "Bir mesaj silindi" : sanitizePreview(lastMessage?.content),
        lastMessageAt: lastMessage?.created_at ?? group.created_at
      };
    });

    nextGroups.sort((left, right) => new Date(right.lastMessageAt).getTime() - new Date(left.lastMessageAt).getTime());
    setGroups(nextGroups);
    setLoading(false);
  }, [isWatchPartyMode, supabase, user]);

  useEffect(() => {
    void refreshGroups();
  }, [refreshGroups]);

  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel(`groups-panel:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "participants",
          filter: `user_id=eq.${user.id}`
        },
        () => {
          void refreshGroups();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "participants",
          filter: `user_id=eq.${user.id}`
        },
        () => {
          void refreshGroups();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "conversations"
        },
        () => {
          void refreshGroups();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversations"
        },
        () => {
          void refreshGroups();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages"
        },
        () => {
          void refreshGroups();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages"
        },
        () => {
          void refreshGroups();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [refreshGroups, supabase, user]);

  const normalizedCreateMembers = useMemo(() => {
    return Array.from(
      new Set(
        createMembersInput
          .split(/[\s,]+/g)
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean)
      )
    );
  }, [createMembersInput]);

  const createGroup = useCallback(async () => {
    if (!user) return;

    setCreateError(null);
    setCreateSuccess(null);

    const groupName = createName.trim();
    if (groupName.length < 3) {
      setCreateError("Grup adı en az 3 karakter olmalı.");
      return;
    }
    if (groupName.length > 48) {
      setCreateError("Grup adı en fazla 48 karakter olabilir.");
      return;
    }

    const invalidUsername = normalizedCreateMembers.find((username) => !USERNAME_REGEX.test(username));
    if (invalidUsername) {
      setCreateError(`Geçersiz kullanıcı adı: ${invalidUsername}`);
      return;
    }

    setCreating(true);
    try {
      let extraMemberIds: string[] = [];
      let extraMembersById = new Map<string, string>();
      if (normalizedCreateMembers.length > 0) {
        const { data: profiles, error: profileError } = await supabase
          .from("profiles")
          .select("id, username")
          .in("username", normalizedCreateMembers);

        if (profileError) {
          setCreateError(profileError.message);
          return;
        }

        const profileRows = (profiles as Array<{ id: string; username: string | null }> | null) ?? [];
        const foundUsernames = new Set(profileRows.map((item) => item.username).filter((value): value is string => Boolean(value)));
        const missing = normalizedCreateMembers.filter((username) => !foundUsernames.has(username));

        if (missing.length > 0) {
          setCreateError(`Bulunamayan kullanıcı(lar): ${missing.join(", ")}`);
          return;
        }

        extraMemberIds = profileRows.map((item) => item.id).filter((id) => id !== user.id);
        extraMembersById = new Map(
          profileRows
            .filter((item) => item.id !== user.id)
            .map((item) => [item.id, item.username ?? "kullanici"])
        );
      }

      const participantIds = Array.from(new Set(extraMemberIds)).filter((memberId) => memberId !== user.id);
      if (participantIds.length + 1 > MAX_GROUP_MEMBER_COUNT) {
        setCreateError(`Bir grup en fazla ${MAX_GROUP_MEMBER_COUNT} üyeden oluşabilir.`);
        return;
      }

      if (participantIds.length > 0) {
        const { data: friendships, error: friendshipsError } = await supabase
          .from("friendships")
          .select("user_a, user_b")
          .or(`user_a.eq.${user.id},user_b.eq.${user.id}`);

        if (friendshipsError) {
          setCreateError(friendshipsError.message);
          return;
        }

        const friendIdSet = new Set(
          ((friendships as Array<{ user_a: string; user_b: string }> | null) ?? []).map((row) =>
            row.user_a === user.id ? row.user_b : row.user_a
          )
        );
        const notFriendUsernames = participantIds
          .filter((memberId) => !friendIdSet.has(memberId))
          .map((memberId) => extraMembersById.get(memberId) ?? "kullanici");

        if (notFriendUsernames.length > 0) {
          setCreateError(`Sadece arkadaşlarını gruba ekleyebilirsin: ${notFriendUsernames.join(", ")}`);
          return;
        }
      }

      const conversationId = crypto.randomUUID();
      const { error: conversationError } = await supabase
        .from("conversations")
        .insert({
          id: conversationId,
          name: groupName,
          is_group: true,
          is_watch_party_room: isWatchPartyMode,
          owner_id: user.id
        });

      if (conversationError) {
        setCreateError(conversationError.message);
        return;
      }

      const { error: creatorJoinError } = await supabase.from("participants").insert({
        conversation_id: conversationId,
        user_id: user.id
      });

      if (creatorJoinError) {
        setCreateError(creatorJoinError.message);
        return;
      }

      if (participantIds.length > 0) {
        const { error: membersJoinError } = await supabase.from("participants").insert(
          participantIds.map((memberId) => ({
            conversation_id: conversationId,
            user_id: memberId
          }))
        );

        if (membersJoinError) {
          setCreateError(membersJoinError.message);
          return;
        }
      }

      setCreateName("");
      setCreateMembersInput("");
      setCreateSuccess(isWatchPartyMode ? "Watch Party odası oluşturuldu." : "Grup oluşturuldu.");
      window.setTimeout(() => setCreateSuccess(null), 2000);
      await refreshGroups();
      if (onOpenConversation) onOpenConversation(conversationId);
    } finally {
      setCreating(false);
    }
  }, [createName, isWatchPartyMode, normalizedCreateMembers, onOpenConversation, refreshGroups, supabase, user]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-900/45 p-4 md:p-6">
      <div className="space-y-5">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4 md:p-5">
          <div className="mb-3 flex items-center gap-2">
            <Users className="h-4 w-4 text-zinc-300" />
            <h3 className="text-sm font-semibold text-zinc-100">{isWatchPartyMode ? "Yeni Watch Party Odası Oluştur" : "Yeni Grup Oluştur"}</h3>
          </div>

          <div className="space-y-3">
            <input
              className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-zinc-700"
              onChange={(event) => setCreateName(event.target.value)}
              placeholder={isWatchPartyMode ? "Watch Party oda adı" : "Grup adı"}
              value={createName}
            />
            <textarea
              className="min-h-[88px] w-full resize-y rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-zinc-700"
              onChange={(event) => setCreateMembersInput(event.target.value)}
              placeholder="Üye kullanıcı adları (virgül veya boşluk ile): ali, ayse, mehmet"
              value={createMembersInput}
            />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-zinc-500">
                Sistem seni otomatik olarak gruba ekler. Ek kullanıcılar opsiyonel.
              </p>
              <p className="text-xs text-zinc-500">Maksimum grup boyutu: {MAX_GROUP_MEMBER_COUNT} üye.</p>
              <button
                className={cn(
                  "inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition-colors",
                  creating
                    ? "border-zinc-700 bg-zinc-800 text-zinc-400"
                    : "border-blue-700 bg-blue-600 text-white hover:bg-blue-500"
                )}
                disabled={creating}
                onClick={() => void createGroup()}
                type="button"
              >
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {isWatchPartyMode ? "Watch Party Odası Oluştur" : "Grup Oluştur"}
              </button>
            </div>
          </div>

          {createError ? <p className="mt-3 text-xs text-red-300">{createError}</p> : null}
          {createSuccess ? <p className="mt-3 text-xs text-emerald-300">{createSuccess}</p> : null}
        </div>

        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-200">{isWatchPartyMode ? "Watch Party Odalarım" : "Gruplarım"} ({groups.length})</h3>
          <button
            className={cn(
              "inline-flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800",
              loading && "opacity-60"
            )}
            disabled={loading}
            onClick={() => void refreshGroups()}
            type="button"
          >
            <RefreshCcw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Yenile
          </button>
        </div>

        {loading ? (
          <p className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-6 text-sm text-zinc-400">Gruplar yükleniyor...</p>
        ) : error ? (
          <p className="rounded-xl border border-red-900/40 bg-red-950/30 px-4 py-6 text-sm text-red-300">{error}</p>
        ) : groups.length === 0 ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 px-4 py-10 text-center">
            <Users className="mx-auto h-7 w-7 text-zinc-500" />
            <p className="mt-3 text-sm text-zinc-300">{isWatchPartyMode ? "Henüz Watch Party odası yok." : "Henüz grup yok."}</p>
            <p className="mt-1 text-xs text-zinc-500">
              {isWatchPartyMode ? "Yukarıdaki form ile ilk Watch Party odanı oluşturabilirsin." : "Yukarıdaki form ile ilk grubunu oluşturabilirsin."}
            </p>
          </div>
        ) : (
          <ul className="grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
            {groups.map((group) => (
              <li key={group.id} className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-zinc-100">{group.name}</p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {group.memberCount} üye • {new Date(group.createdAt).toLocaleDateString("tr-TR")}
                    </p>
                    <p className="mt-1 truncate text-xs text-zinc-400">{group.lastMessage}</p>
                  </div>
                  <button
                    className="inline-flex shrink-0 items-center rounded-lg border border-blue-700/60 bg-blue-600/20 px-3 py-1.5 text-xs font-medium text-blue-300 hover:bg-blue-600/30"
                    onClick={() => onOpenConversation?.(group.id)}
                    type="button"
                  >
                    Sohbete Git
                  </button>
                </div>

                <div className="mt-2 flex flex-wrap gap-1">
                  {group.members.slice(0, 6).map((member) => (
                    <span
                      key={`${group.id}-${member.id}`}
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[11px]",
                        member.id === group.ownerId
                          ? "border-blue-700/50 bg-blue-600/20 text-blue-300"
                          : "border-zinc-700 bg-zinc-800/80 text-zinc-300"
                      )}
                    >
                      {member.username}
                    </span>
                  ))}
                  {group.members.length > 6 ? (
                    <span className="rounded-full border border-zinc-700 bg-zinc-800/80 px-2 py-0.5 text-[11px] text-zinc-400">
                      +{group.members.length - 6}
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
