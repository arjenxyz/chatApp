"use client";

import { MessageCircle, Settings, UserRoundPlus, Users, Film } from "lucide-react";
import React from "react";
import { cn } from "@/lib/utils";

type Tab = "conversations" | "friends" | "groups" | "watch-party" | "settings";

interface BottomTabNavigationProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  mobileHidden?: boolean;
}

export function BottomTabNavigation({ activeTab, onTabChange, mobileHidden = false }: BottomTabNavigationProps) {
  const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
    { id: "conversations", label: "Sohbetler", icon: <MessageCircle className="h-5 w-5" /> },
    { id: "friends", label: "Arkadaşlar", icon: <UserRoundPlus className="h-5 w-5" /> },
    { id: "groups", label: "Gruplar", icon: <Users className="h-5 w-5" /> },
    { id: "watch-party", label: "Watch Party", icon: <Film className="h-5 w-5" /> },
    { id: "settings", label: "Ayarlar", icon: <Settings className="h-5 w-5" /> },
  ];

  return (
    <nav
      className={cn(
        "fixed bottom-0 left-0 right-0 border-t border-zinc-800 bg-zinc-950/95 px-0 py-0 backdrop-blur md:relative md:rounded-xl md:border md:border-zinc-800 md:bg-zinc-900/45 md:px-2 md:py-2 md:backdrop-blur",
        mobileHidden && "hidden md:block"
      )}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex items-center md:hidden">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-1 py-3 px-2 transition-colors",
              activeTab === tab.id
                ? "border-b-2 border-blue-500 text-blue-400"
                : "border-b-2 border-transparent text-zinc-400 hover:text-zinc-300"
            )}
            type="button"
          >
            {tab.icon}
            <span className="text-[11px] font-medium">{tab.label}</span>
          </button>
        ))}
      </div>

      <div className="hidden md:flex md:flex-wrap md:items-center md:gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
              activeTab === tab.id
                ? "border border-blue-500/70 bg-blue-600 text-white shadow-sm shadow-blue-900/40"
                : "border border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
            )}
            type="button"
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>
    </nav>
  );
}
