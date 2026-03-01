import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 px-6 py-16">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Advanced Real-time Chat</h1>
        <p className="text-sm text-zinc-300">
          Next.js (App Router) + Tailwind CSS + Supabase (Auth, Realtime, Postgres, RLS)
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Link
          className="inline-flex items-center justify-center rounded-lg border bg-zinc-900 px-4 py-2 text-sm font-medium hover:bg-zinc-800"
          href="/auth/login"
        >
          Giriş / Kayıt
        </Link>
        <Link
          className="inline-flex items-center justify-center rounded-lg border bg-zinc-900 px-4 py-2 text-sm font-medium hover:bg-zinc-800"
          href="/chat"
        >
          Sohbete Git
        </Link>
      </div>

      <div className="rounded-lg border bg-zinc-900/40 p-4 text-sm text-zinc-300">
        <p className="mb-2 font-medium text-zinc-200">Kurulum</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            Supabase projesi oluştur, SQL dosyalarını Supabase SQL Editor&apos;da çalıştır.
          </li>
          <li>
            <code className="rounded bg-zinc-900 px-1 py-0.5">.env.local</code> içine{" "}
            <code className="rounded bg-zinc-900 px-1 py-0.5">NEXT_PUBLIC_SUPABASE_URL</code>{" "}
            ve{" "}
            <code className="rounded bg-zinc-900 px-1 py-0.5">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>{" "}
            ekle.
          </li>
          <li>
            <code className="rounded bg-zinc-900 px-1 py-0.5">npm i</code> ardından{" "}
            <code className="rounded bg-zinc-900 px-1 py-0.5">npm run dev</code>.
          </li>
        </ol>
      </div>
    </main>
  );
}

