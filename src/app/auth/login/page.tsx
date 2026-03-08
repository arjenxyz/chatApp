import { readFile } from "node:fs/promises";
import path from "node:path";

import Login from "./login";

type ManifestData = {
  name?: string;
  short_name?: string;
  start_url?: string;
  display?: string;
  theme_color?: string;
  background_color?: string;
  shortcuts?: Array<{ name?: string; url?: string }>;
};

async function getManifestData(): Promise<ManifestData | null> {
  try {
    const manifestPath = path.join(process.cwd(), "public", "manifest.json");
    const raw = await readFile(manifestPath, "utf-8");
    return JSON.parse(raw) as ManifestData;
  } catch {
    return null;
  }
}

export default async function LoginPage() {
  const manifest = await getManifestData();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center px-6 py-16">
      <section className="rounded-3xl border border-zinc-800 bg-zinc-900/60 p-6 shadow-2xl shadow-black/30 backdrop-blur md:p-8">
        <div className="space-y-1">
          <p className="text-xs font-semibold tracking-wide text-zinc-400">Hesap Erişimi</p>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Giriş yap</h1>
          <p className="text-sm text-zinc-300">Magic Link veya OAuth ile güvenli şekilde devam et.</p>
        </div>

        <div className="mt-5">
          <Login />
        </div>

        <p className="mt-4 text-xs text-zinc-500">
          İlk girişte kullanıcı adı verirsen profil otomatik oluşturulur. Sonradan sohbet ekranından güncelleyebilirsin.
        </p>

        {manifest ? (
          <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 text-xs text-zinc-300">
            <p className="mb-2 font-semibold tracking-wide text-zinc-200">PWA / Manifest Bilgileri</p>
            <div className="space-y-1 text-zinc-400">
              <p>
                <span className="text-zinc-300">Ad:</span> {manifest.name ?? "-"}
              </p>
              <p>
                <span className="text-zinc-300">Kısa ad:</span> {manifest.short_name ?? "-"}
              </p>
              <p>
                <span className="text-zinc-300">Start URL:</span> {manifest.start_url ?? "-"}
              </p>
              <p>
                <span className="text-zinc-300">Display:</span> {manifest.display ?? "-"}
              </p>
              <p>
                <span className="text-zinc-300">Theme:</span> {manifest.theme_color ?? "-"} / {manifest.background_color ?? "-"}
              </p>
              <p>
                <span className="text-zinc-300">Kısayol:</span> {manifest.shortcuts?.length ?? 0}
              </p>
            </div>
          </div>
        ) : null}
      </section>

      <div className="mt-5 text-center text-xs text-zinc-600">
        Girişte sorun yaşarsan e-posta kutundaki spam klasörünü kontrol et.
      </div>
    </main>
  );
}
