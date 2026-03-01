import Login from "./login";

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-16">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Giriş</h1>
        <p className="text-sm text-zinc-300">Magic Link / OTP ile giriş yap.</p>
      </div>

      <Login />

      <p className="text-xs text-zinc-400">
        Not: İlk girişte kullanıcı adı girersen profil otomatik oluşturulur. Sonradan{" "}
        <span className="text-zinc-200">Sohbet</span> ekranından güncelleyebilirsin.
      </p>
    </main>
  );
}

