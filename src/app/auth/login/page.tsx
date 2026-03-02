import Login from "./login";

export default function LoginPage() {
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
      </section>

      <div className="mt-5 text-center text-xs text-zinc-600">
        Girişte sorun yaşarsan e-posta kutundaki spam klasörünü kontrol et.
      </div>
    </main>
  );
}
