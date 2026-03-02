import type { Metadata, Viewport } from "next";

import "./globals.css";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "ChatApp",
  description: "Next.js + Tailwind + Supabase realtime chat",
  manifest: "/manifest.json",
  applicationName: "ChatApp",
  appleWebApp: {
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
  const devServiceWorkerCleanupScript = `
    (() => {
      if (typeof window === "undefined") return;
      if (!("serviceWorker" in navigator)) return;
      if (sessionStorage.getItem("__chatapp_dev_sw_cleaned__") === "1") return;

      sessionStorage.setItem("__chatapp_dev_sw_cleaned__", "1");

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
    })();
  `;

  return (
    <html lang="tr" suppressHydrationWarning>
      <head>
        <meta content="yes" name="mobile-web-app-capable" />
        {process.env.NODE_ENV !== "production" ? (
          <script dangerouslySetInnerHTML={{ __html: devServiceWorkerCleanupScript }} />
        ) : null}
      </head>
      <body className="min-h-screen">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
