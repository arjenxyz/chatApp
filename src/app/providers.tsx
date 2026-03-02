"use client";

import React, { useEffect } from "react";

import { PresenceProvider } from "@/components/Presence/PresenceProvider";
import { AuthProvider } from "@/providers/AuthProvider";

export default function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    void navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) {
        void registration.unregister();
      }
    });

    if (!("caches" in window)) return;
    void caches.keys().then((keys) => {
      for (const key of keys) {
        void caches.delete(key);
      }
    });
  }, []);

  return (
    <AuthProvider>
      <PresenceProvider>{children}</PresenceProvider>
    </AuthProvider>
  );
}
