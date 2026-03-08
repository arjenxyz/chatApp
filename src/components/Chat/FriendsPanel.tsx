"use client";

import { Check, Loader2, MessageSquareText, RefreshCcw, UserRoundPlus, X } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { mapCaughtError, mapUserFacingError } from "@/lib/errorMessages";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/AuthProvider";

const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;

type FriendshipRow = {
  user_a: string;
  user_b: string;
};

type FriendRequestRow = {
  id: string;
  sender_id: string;
  receiver_id: string;
  status: "pending" | "accepted" | "rejected" | "canceled";
  created_at: string;
};

type ProfileRow = {
  id: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
};

type FriendItem = {
  id: string;
  username: string;
  fullName: string | null;
  avatarUrl: string | null;
};

type FriendRequestItem = {
  id: string;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: string;
};

function toDisplayName(profile: ProfileRow | null | undefined): string {
  return profile?.username || profile?.full_name || "Kullanıcı";
}

export function FriendsPanel({
  onOpenConversation
}: {
  onOpenConversation?: (conversationId: string) => void;
}) {
  const supabase = getSupabaseBrowserClient();
  const { user, profile } = useAuth();

  const [friends, setFriends] = useState<FriendItem[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<FriendRequestItem[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<FriendRequestItem[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [newFriendUsername, setNewFriendUsername] = useState("");
  const [creating, setCreating] = useState(false);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);

  const friendIdSet = useMemo(() => new Set(friends.map((friend) => friend.id)), [friends]);
  const canCreate = Boolean(profile?.username);

  const ensureDirectConversation = useCallback(
    async (otherUserId: string): Promise<string> => {
      if (!user) throw new Error("Oturum bulunamadı.");

      const { data: myRows, error: myRowsError } = await supabase
        .from("participants")
        .select("conversation_id")
        .eq("user_id", user.id);
      if (myRowsError) throw new Error(mapUserFacingError(myRowsError.message, "Sohbet kontrol edilemedi."));

      const myConversationIds = (myRows ?? []).map((row) => row.conversation_id);
      if (myConversationIds.length > 0) {
        const { data: sharedRows, error: sharedRowsError } = await supabase
          .from("participants")
          .select("conversation_id")
          .eq("user_id", otherUserId)
          .in("conversation_id", myConversationIds);
        if (sharedRowsError) throw new Error(mapUserFacingError(sharedRowsError.message, "Ortak sohbetler alınamadı."));

        const sharedConversationIds = (sharedRows ?? []).map((row) => row.conversation_id);
        if (sharedConversationIds.length > 0) {
          const { data: existingDm, error: existingDmError } = await supabase
            .from("conversations")
            .select("id, is_group, created_at")
            .in("id", sharedConversationIds)
            .eq("is_group", false)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (existingDmError) throw new Error(mapUserFacingError(existingDmError.message, "Mevcut sohbet bulunamadı."));
          if (existingDm?.id) return existingDm.id;
        }
      }

      const conversationId = crypto.randomUUID();
      const { error: conversationError } = await supabase
        .from("conversations")
        .insert({ id: conversationId, owner_id: user.id, is_group: false });
      if (conversationError) throw new Error(mapUserFacingError(conversationError.message, "Sohbet oluşturulamadı."));

      const { error: joinError } = await supabase
        .from("participants")
        .insert({ conversation_id: conversationId, user_id: user.id });
      if (joinError) throw new Error(mapUserFacingError(joinError.message, "Sohbete katılım kaydedilemedi."));

      const { error: inviteError } = await supabase
        .from("participants")
        .insert({ conversation_id: conversationId, user_id: otherUserId });
      if (inviteError) throw new Error(mapUserFacingError(inviteError.message, "Davet kaydedilemedi."));

      return conversationId;
    },
    [supabase, user]
  );

  const refresh = useCallback(async () => {
    if (!user) return;

    setListLoading(true);
    setListError(null);

    const [{ data: friendships, error: friendshipsError }, { data: incoming, error: incomingError }, { data: outgoing, error: outgoingError }] =
      await Promise.all([
        supabase
          .from("friendships")
          .select("user_a, user_b")
          .or(`user_a.eq.${user.id},user_b.eq.${user.id}`),
        supabase
          .from("friend_requests")
          .select("id, sender_id, receiver_id, status, created_at")
          .eq("receiver_id", user.id)
          .eq("status", "pending")
          .order("created_at", { ascending: false }),
        supabase
          .from("friend_requests")
          .select("id, sender_id, receiver_id, status, created_at")
          .eq("sender_id", user.id)
          .eq("status", "pending")
          .order("created_at", { ascending: false })
      ]);

    if (friendshipsError || incomingError || outgoingError) {
      setListError(mapUserFacingError(friendshipsError?.message ?? incomingError?.message ?? outgoingError?.message ?? "Arkadaş listesi yüklenemedi.", "Arkadaş listesi yüklenemedi."));
      setListLoading(false);
      return;
    }

    const friendIds = ((friendships as FriendshipRow[] | null) ?? []).map((row) => (row.user_a === user.id ? row.user_b : row.user_a));

    const incomingRows = ((incoming as FriendRequestRow[] | null) ?? []).filter((row) => row.sender_id !== user.id);
    const outgoingRows = ((outgoing as FriendRequestRow[] | null) ?? []).filter((row) => row.receiver_id !== user.id);

    const profileIds = Array.from(
      new Set([
        ...friendIds,
        ...incomingRows.map((row) => row.sender_id),
        ...outgoingRows.map((row) => row.receiver_id)
      ])
    );

    const profileMap = new Map<string, ProfileRow>();
    if (profileIds.length > 0) {
      const { data: profiles, error: profileError } = await supabase
        .from("profiles")
        .select("id, username, full_name, avatar_url")
        .in("id", profileIds);

      if (profileError) {
        setListError(mapUserFacingError(profileError.message, "Profil bilgileri yüklenemedi."));
        setListLoading(false);
        return;
      }

      ((profiles as ProfileRow[] | null) ?? []).forEach((profileItem) => {
        profileMap.set(profileItem.id, profileItem);
      });
    }

    const nextFriends = friendIds
      .map((friendId) => {
        const friendProfile = profileMap.get(friendId);
        return {
          id: friendId,
          username: toDisplayName(friendProfile),
          fullName: friendProfile?.full_name ?? null,
          avatarUrl: friendProfile?.avatar_url ?? null
        };
      })
      .sort((left, right) => left.username.localeCompare(right.username, "tr-TR"));

    setFriends(nextFriends);
    setIncomingRequests(
      incomingRows.map((row) => ({
        id: row.id,
        userId: row.sender_id,
        displayName: toDisplayName(profileMap.get(row.sender_id)),
        avatarUrl: profileMap.get(row.sender_id)?.avatar_url ?? null,
        createdAt: row.created_at
      }))
    );
    setOutgoingRequests(
      outgoingRows.map((row) => ({
        id: row.id,
        userId: row.receiver_id,
        displayName: toDisplayName(profileMap.get(row.receiver_id)),
        avatarUrl: profileMap.get(row.receiver_id)?.avatar_url ?? null,
        createdAt: row.created_at
      }))
    );
    setListLoading(false);
  }, [supabase, user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel(`friends-panel:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "friend_requests",
          filter: `or(sender_id.eq.${user.id},receiver_id.eq.${user.id})`
        },
        () => {
          void refresh();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "friend_requests",
          filter: `or(sender_id.eq.${user.id},receiver_id.eq.${user.id})`
        },
        () => {
          void refresh();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "friendships",
          filter: `or(user_a.eq.${user.id},user_b.eq.${user.id})`
        },
        () => {
          void refresh();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "friendships",
          filter: `or(user_a.eq.${user.id},user_b.eq.${user.id})`
        },
        () => {
          void refresh();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [refresh, supabase, user]);

  const sendFriendRequest = useCallback(async () => {
    if (!user) return;

    setCreateError(null);
    setCreateSuccess(null);

    if (!canCreate) {
      setCreateError("Önce profil kısmından kullanıcı adını ayarla.");
      return;
    }

    const target = newFriendUsername.trim().toLowerCase();
    if (!target) {
      setCreateError("Kullanıcı adı gerekli.");
      return;
    }
    if (!USERNAME_REGEX.test(target)) {
      setCreateError("Kullanıcı adı formatı geçersiz.");
      return;
    }

    setCreating(true);
    try {
      const { data: other, error: otherError } = await supabase
        .from("profiles")
        .select("id, username, full_name")
        .eq("username", target)
        .maybeSingle();
      if (otherError) {
        setCreateError(mapUserFacingError(otherError.message, "Kullanıcı aranamadı."));
        return;
      }
      if (!other) {
        setCreateError("Kullanıcı bulunamadı.");
        return;
      }
      if (other.id === user.id) {
        setCreateError("Kendine istek gönderemezsin.");
        return;
      }

      const [userA, userB] = user.id < other.id ? [user.id, other.id] : [other.id, user.id];
      const { data: friendship, error: friendshipError } = await supabase
        .from("friendships")
        .select("user_a, user_b")
        .eq("user_a", userA)
        .eq("user_b", userB)
        .maybeSingle();
      if (friendshipError) {
        setCreateError(mapUserFacingError(friendshipError.message, "Arkadaşlık durumu kontrol edilemedi."));
        return;
      }

      if (friendship || friendIdSet.has(other.id)) {
        const dmConversationId = await ensureDirectConversation(other.id);
        setCreateSuccess("Bu kullanıcı zaten arkadaşın. Sohbet açıldı.");
        setNewFriendUsername("");
        await refresh();
        onOpenConversation?.(dmConversationId);
        return;
      }

      const { data: incomingPending, error: incomingPendingError } = await supabase
        .from("friend_requests")
        .select("id, status")
        .eq("sender_id", other.id)
        .eq("receiver_id", user.id)
        .maybeSingle();
      if (incomingPendingError) {
        setCreateError(mapUserFacingError(incomingPendingError.message, "İstek durumu kontrol edilemedi."));
        return;
      }

      if (incomingPending?.id && incomingPending.status === "pending") {
        const { error: acceptError } = await supabase
          .from("friend_requests")
          .update({ status: "accepted", updated_at: new Date().toISOString() })
          .eq("id", incomingPending.id)
          .eq("receiver_id", user.id);
        if (acceptError) {
          setCreateError(mapUserFacingError(acceptError.message, "İstek kabul edilemedi."));
          return;
        }

        const { error: insertFriendshipError } = await supabase.from("friendships").insert({
          user_a: userA,
          user_b: userB
        });
        if (insertFriendshipError && !insertFriendshipError.message.toLowerCase().includes("duplicate")) {
          setCreateError(mapUserFacingError(insertFriendshipError.message, "Arkadaşlık kaydı oluşturulamadı."));
          return;
        }

        const dmConversationId = await ensureDirectConversation(other.id);
        setCreateSuccess("Gelen istek otomatik kabul edildi ve sohbet açıldı.");
        setNewFriendUsername("");
        await refresh();
        onOpenConversation?.(dmConversationId);
        return;
      }

      const { data: outgoingRequest, error: outgoingRequestError } = await supabase
        .from("friend_requests")
        .select("id, status")
        .eq("sender_id", user.id)
        .eq("receiver_id", other.id)
        .maybeSingle();
      if (outgoingRequestError) {
        setCreateError(mapUserFacingError(outgoingRequestError.message, "Bekleyen istek kontrol edilemedi."));
        return;
      }

      if (outgoingRequest?.id) {
        if (outgoingRequest.status === "pending") {
          setCreateSuccess("Bu kullanıcıya zaten bekleyen bir istek var.");
          return;
        }

        const { error: resendError } = await supabase
          .from("friend_requests")
          .update({ status: "pending", updated_at: new Date().toISOString() })
          .eq("id", outgoingRequest.id)
          .eq("sender_id", user.id);
        if (resendError) {
          setCreateError(mapUserFacingError(resendError.message, "İstek tekrar gönderilemedi."));
          return;
        }

        setCreateSuccess("Arkadaşlık isteği tekrar gönderildi.");
        await refresh();
        return;
      }

      const { error: requestError } = await supabase.from("friend_requests").insert({
        sender_id: user.id,
        receiver_id: other.id,
        status: "pending"
      });
      if (requestError) {
        setCreateError(mapUserFacingError(requestError.message, "Arkadaşlık isteği gönderilemedi."));
        return;
      }

      setCreateSuccess("Arkadaşlık isteği gönderildi.");
      setNewFriendUsername("");
      await refresh();
    } catch (friendRequestError) {
      setCreateError(mapCaughtError(friendRequestError, "İşlem tamamlanamadı."));
    } finally {
      setCreating(false);
    }
  }, [canCreate, ensureDirectConversation, friendIdSet, newFriendUsername, onOpenConversation, refresh, supabase, user]);

  const respondToRequest = useCallback(
    async (requestId: string, senderId: string, action: "accepted" | "rejected") => {
      if (!user) return;

      setActionBusyId(requestId);
      setCreateError(null);
      setCreateSuccess(null);
      try {
        const { error: updateError } = await supabase
          .from("friend_requests")
          .update({ status: action, updated_at: new Date().toISOString() })
          .eq("id", requestId)
          .eq("receiver_id", user.id);
        if (updateError) {
          setCreateError(mapUserFacingError(updateError.message, "İstek güncellenemedi."));
          return;
        }

        if (action === "accepted") {
          const [userA, userB] = user.id < senderId ? [user.id, senderId] : [senderId, user.id];
          const { error: friendshipError } = await supabase.from("friendships").insert({
            user_a: userA,
            user_b: userB
          });

          if (friendshipError && !friendshipError.message.toLowerCase().includes("duplicate")) {
            setCreateError(mapUserFacingError(friendshipError.message, "Arkadaşlık kaydı oluşturulamadı."));
            return;
          }

          const dmConversationId = await ensureDirectConversation(senderId);
          setCreateSuccess("İstek kabul edildi ve sohbet açıldı.");
          onOpenConversation?.(dmConversationId);
        } else {
          setCreateSuccess("İstek reddedildi.");
        }

        await refresh();
      } catch (respondError) {
        setCreateError(mapCaughtError(respondError, "İstek işlenemedi."));
      } finally {
        setActionBusyId(null);
      }
    },
    [ensureDirectConversation, onOpenConversation, refresh, supabase, user]
  );

  const openFriendConversation = useCallback(
    async (friendId: string) => {
      setCreateError(null);
      setCreateSuccess(null);

      try {
        const conversationId = await ensureDirectConversation(friendId);
        onOpenConversation?.(conversationId);
      } catch (openError) {
        setCreateError(mapCaughtError(openError, "Sohbet açılamadı."));
      }
    },
    [ensureDirectConversation, onOpenConversation]
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-900/45 p-4 md:p-6">
      <div className="grid gap-5 xl:grid-cols-[minmax(340px,0.92fr),minmax(0,1.08fr)]">
        <div className="space-y-5">
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
            <p className="text-sm font-semibold text-zinc-100">Arkadaş Ekle</p>
            <p className="mt-1 text-xs text-zinc-500">Kullanıcı adı ile arkadaş isteği gönder, kabul edilince DM açılır.</p>

            <div className="mt-3 flex items-center gap-2">
              <input
                className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-zinc-700 disabled:opacity-60"
                disabled={!canCreate || creating}
                onChange={(event) => setNewFriendUsername(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                  event.preventDefault();
                  void sendFriendRequest();
                }}
                placeholder={canCreate ? "kullanici_adi" : "Önce profilde kullanıcı adını ayarla"}
                value={newFriendUsername}
              />
              <button
                className={cn(
                  "inline-flex h-10 w-10 items-center justify-center rounded-xl border transition-colors",
                  creating
                    ? "border-zinc-700 bg-zinc-800 text-zinc-400"
                    : "border-blue-700 bg-blue-600 text-white hover:bg-blue-500"
                )}
                disabled={!canCreate || creating}
                onClick={() => void sendFriendRequest()}
                type="button"
              >
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRoundPlus className="h-4 w-4" />}
              </button>
            </div>

            {createError ? <p className="mt-2 text-xs text-red-300">{createError}</p> : null}
            {createSuccess ? <p className="mt-2 text-xs text-emerald-300">{createSuccess}</p> : null}
          </section>

          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-100">Gelen İstekler ({incomingRequests.length})</h3>
              <button
                className={cn(
                  "inline-flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800",
                  listLoading && "opacity-60"
                )}
                disabled={listLoading}
                onClick={() => void refresh()}
                type="button"
              >
                <RefreshCcw className={cn("h-3.5 w-3.5", listLoading && "animate-spin")} />
                Yenile
              </button>
            </div>

            {listError ? <p className="mb-2 rounded-lg border border-red-900/40 bg-red-950/30 px-3 py-2 text-xs text-red-300">{listError}</p> : null}

            {incomingRequests.length === 0 ? (
              <p className="text-xs text-zinc-500">Bekleyen gelen istek yok.</p>
            ) : (
              <ul className="space-y-2">
                {incomingRequests.map((request) => (
                  <li key={request.id} className="flex items-center justify-between gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-zinc-100">{request.displayName}</p>
                      <p className="text-[11px] text-zinc-500">
                        {new Date(request.createdAt).toLocaleDateString("tr-TR")} tarihinde gönderildi
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors",
                          actionBusyId === request.id
                            ? "border-zinc-700 bg-zinc-800 text-zinc-400"
                            : "border-emerald-700/60 bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30"
                        )}
                        disabled={actionBusyId === request.id}
                        onClick={() => void respondToRequest(request.id, request.userId, "accepted")}
                        type="button"
                      >
                        {actionBusyId === request.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                        Kabul
                      </button>
                      <button
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors",
                          actionBusyId === request.id
                            ? "border-zinc-700 bg-zinc-800 text-zinc-400"
                            : "border-red-700/60 bg-red-600/20 text-red-300 hover:bg-red-600/30"
                        )}
                        disabled={actionBusyId === request.id}
                        onClick={() => void respondToRequest(request.id, request.userId, "rejected")}
                        type="button"
                      >
                        <X className="h-3 w-3" />
                        Reddet
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {outgoingRequests.length > 0 ? (
            <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
              <h3 className="mb-2 text-sm font-semibold text-zinc-100">Gönderilen İstekler ({outgoingRequests.length})</h3>
              <ul className="space-y-1.5">
                {outgoingRequests.map((request) => (
                  <li key={request.id} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2">
                    <p className="truncate text-xs text-zinc-300">{request.displayName}</p>
                    <span className="ml-2 shrink-0 text-[11px] text-zinc-500">Bekliyor</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <div className="space-y-5">
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
            <h3 className="mb-3 text-sm font-semibold text-zinc-100">Arkadaşlar ({friends.length})</h3>

            {friends.length === 0 ? (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 px-3 py-6 text-center">
                <MessageSquareText className="mx-auto h-6 w-6 text-zinc-600" />
                <p className="mt-2 text-sm text-zinc-400">Henüz arkadaş yok.</p>
                <p className="text-xs text-zinc-500">Yukarıdan kullanıcı adı ile istek gönder.</p>
              </div>
            ) : (
              <ul className="space-y-2">
                {friends.map((friend) => (
                  <li key={friend.id} className="flex items-center justify-between gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      {friend.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img alt={`${friend.username} avatar`} className="h-9 w-9 rounded-full border border-zinc-700 object-cover" src={friend.avatarUrl} />
                      ) : (
                        <div className="grid h-9 w-9 place-items-center rounded-full border border-zinc-700 bg-zinc-800 text-xs font-semibold text-zinc-300">
                          {friend.username.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-sm text-zinc-100">{friend.username}</p>
                        <p className="truncate text-[11px] text-zinc-500">{friend.fullName || "Direkt mesaj arkadaşı"}</p>
                      </div>
                    </div>
                    <button
                      className="inline-flex shrink-0 items-center rounded-lg border border-blue-700/60 bg-blue-600/20 px-3 py-1.5 text-xs font-medium text-blue-300 hover:bg-blue-600/30"
                      onClick={() => void openFriendConversation(friend.id)}
                      type="button"
                    >
                      Mesaj Aç
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
