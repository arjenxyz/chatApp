"use client";

import React from "react";

import { PresenceProvider } from "@/components/Presence/PresenceProvider";
import { AuthProvider } from "@/providers/AuthProvider";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <PresenceProvider>{children}</PresenceProvider>
    </AuthProvider>
  );
}

