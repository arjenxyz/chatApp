"use client";

import type { Session, User } from "@supabase/supabase-js";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

export type Profile = {
  id: string;
  username: string | null;
  avatar_url: string | null;
  full_name: string | null;
  updated_at: string | null;
  status: "online" | "offline" | null;
};

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = getSupabaseBrowserClient();

  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshProfile = useCallback(async () => {
    if (!user) {
      setProfile(null);
      return;
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("id, username, avatar_url, full_name, updated_at, status")
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      console.warn("[profiles] fetch failed:", error.message);
      return;
    }

    setProfile((data as Profile | null) ?? null);
  }, [supabase, user]);

  useEffect(() => {
    let ignore = false;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (ignore) return;
        setSession(data.session);
        setUser(data.session?.user ?? null);
      })
      .finally(() => {
        if (ignore) return;
        setLoading(false);
      });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setProfile(null);
    });

    return () => {
      ignore = true;
      subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    void refreshProfile();
  }, [refreshProfile]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user,
      profile,
      loading,
      refreshProfile,
      signOut: async () => {
        await supabase.auth.signOut();
      }
    }),
    [loading, profile, refreshProfile, session, supabase, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider />");
  return ctx;
}
