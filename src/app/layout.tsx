import type { Metadata } from "next";

import "./globals.css";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "ChatApp",
  description: "Next.js + Tailwind + Supabase realtime chat"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#3b82f6" />
        <link rel="apple-touch-icon" href="/icons/icon-192.svg" />
      </head>
      <body className="min-h-screen">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

