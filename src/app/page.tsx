import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center gap-6 px-6 py-16">
      <section className="rounded-3xl border border-zinc-800 bg-zinc-900/55 p-6 shadow-2xl shadow-black/25 backdrop-blur md:p-9">
        <p className="inline-flex rounded-full border border-blue-900/60 bg-blue-950/40 px-3 py-1 text-xs font-medium tracking-wide text-blue-200">
          Realtime Chat Platform
        </p>

        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-zinc-100 md:text-4xl">
          Güvenli, hızlı ve profesyonel mesajlaşma deneyimi
        </h1>

        <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-300 md:text-base">
          Next.js App Router, Supabase Auth, Realtime ve RLS üzerine kurulu modern chat altyapısı.
          Direkt mesaj, çevrimiçi durum, okundu bilgisi ve güçlü veri güvenliği tek projede.
        </p>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Link
            className="inline-flex items-center justify-center rounded-xl border border-zinc-700 bg-zinc-100 px-5 py-2.5 text-sm font-semibold text-zinc-900 hover:bg-white"
            href="/auth/login"
          >
            Giriş / Kayıt
          </Link>
          <Link
            className="inline-flex items-center justify-center rounded-xl border border-zinc-700 bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-zinc-100 hover:bg-zinc-800"
            href="/chat"
          >
            Sohbete Git
          </Link>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <article className="rounded-2xl border border-zinc-800 bg-zinc-900/45 p-4">
          <p className="text-xs font-semibold tracking-wide text-zinc-400">AUTH</p>
          <p className="mt-2 text-sm text-zinc-200">Magic Link + OAuth destekli, şifresiz giriş akışı.</p>
        </article>
        <article className="rounded-2xl border border-zinc-800 bg-zinc-900/45 p-4">
          <p className="text-xs font-semibold tracking-wide text-zinc-400">REALTIME</p>
          <p className="mt-2 text-sm text-zinc-200">Anlık mesaj, online durumu ve okundu senkronizasyonu.</p>
        </article>
        <article className="rounded-2xl border border-zinc-800 bg-zinc-900/45 p-4">
          <p className="text-xs font-semibold tracking-wide text-zinc-400">SECURITY</p>
          <p className="mt-2 text-sm text-zinc-200">RLS policy’leri ile satır seviyesinde veri koruması.</p>
        </article>
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/45 p-5 text-sm text-zinc-300">
        <p className="mb-3 font-semibold text-zinc-100">Kurulum</p>
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            Supabase projesi aç, [login ve chat] SQL dosyalarını Supabase SQL Editor içinde çalıştır.
          </li>
          <li>
            <code className="rounded bg-zinc-950 px-1.5 py-0.5">.env.local</code> dosyasına{" "}
            <code className="rounded bg-zinc-950 px-1.5 py-0.5">NEXT_PUBLIC_SUPABASE_URL</code> ve{" "}
            <code className="rounded bg-zinc-950 px-1.5 py-0.5">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> ekle.
          </li>
          <li>
            <code className="rounded bg-zinc-950 px-1.5 py-0.5">npm i</code> ardından{" "}
            <code className="rounded bg-zinc-950 px-1.5 py-0.5">npm run dev</code> çalıştır.
          </li>
        </ol>
      </section>

    </main>
  );
}
