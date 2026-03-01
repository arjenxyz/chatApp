"use client";

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { useAuth } from "@/providers/AuthProvider";

type PresenceContextValue = {
  onlineUserIds: Set<string>;
  isOnline: (userId: string) => boolean;
};

const PresenceContext = createContext<PresenceContextValue | undefined>(undefined);

export function PresenceProvider({ children }: { children: React.ReactNode }) {
  const supabase = getSupabaseBrowserClient();
  const { user } = useAuth();

  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    const updateMyStatus = async (status: "online" | "offline") => {
      if (!user) return;
      const { error } = await supabase.from("profiles").update({ status }).eq("id", user.id);
      if (error) console.warn("[profiles] status update failed:", error.message);
    };

    if (!user) {
      setOnlineUserIds(new Set());
      return;
    }

    const channel = supabase.channel("presence:global", {
      config: { presence: { key: user.id } }
    });
    channelRef.current = channel;

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState();
      const next = new Set(Object.keys(state));
      setOnlineUserIds(next);
    });

    channel.subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      void channel.track({ online_at: new Date().toISOString() });
      void updateMyStatus("online");
    });

    const onBeforeUnload = () => {
      void updateMyStatus("offline");
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      void updateMyStatus("offline");
      void channel.untrack();
      void supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [supabase, user]);

  const value = useMemo<PresenceContextValue>(
    () => ({
      onlineUserIds,
      isOnline: (userId: string) => onlineUserIds.has(userId)
    }),
    [onlineUserIds]
  );

  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
}

export function usePresence(): PresenceContextValue {
  const ctx = useContext(PresenceContext);
  if (!ctx) throw new Error("usePresence must be used within <PresenceProvider />");
  return ctx;
}

