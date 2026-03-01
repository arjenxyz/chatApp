"use client";

import { useRouter } from "next/navigation";
import React, { useEffect } from "react";

import { ChatShell } from "@/components/Chat/ChatShell";
import { useAuth } from "@/providers/AuthProvider";

export default function ChatPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/auth/login");
  }, [loading, router, user]);

  if (loading) {
    return (
      <main className="mx-auto flex min-h-screen max-w-5xl items-center justify-center px-6 py-16">
        <p className="text-sm text-zinc-300">Yükleniyor…</p>
      </main>
    );
  }

  if (!user) return null;

  return <ChatShell />;
}

