import type { Metadata, Viewport } from "next";

import "./globals.css";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "ChatApp",
  description: "Next.js + Tailwind + Supabase realtime chat",
  manifest: "/manifest.json",
  applicationName: "ChatApp",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "ChatApp"
  },
  formatDetection: {
    telephone: false
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.svg", type: "image/svg+xml", sizes: "192x192" },
      { url: "/icons/icon-512.svg", type: "image/svg+xml", sizes: "512x512" }
    ],
    apple: [{ url: "/icons/icon-192.svg", sizes: "192x192", type: "image/svg+xml" }]
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1d4ed8"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" suppressHydrationWarning>
      <head>
        <meta content="yes" name="mobile-web-app-capable" />
      </head>
      <body className="min-h-screen">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
