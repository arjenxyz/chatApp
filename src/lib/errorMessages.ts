export function mapUserFacingError(message: string | null | undefined, fallback = "Bir hata oluştu."): string {
  const raw = (message ?? "").trim();
  if (!raw) return fallback;

  const normalized = raw.toLowerCase();

  if (
    normalized.includes("cannot coerce the result to a single json object") ||
    normalized.includes("json object requested, multiple (or no) rows returned") ||
    normalized.includes("pgrst116")
  ) {
    return "Aradığın veri bulunamadı veya artık erişilemiyor.";
  }

  if (normalized.includes("row-level security policy") || normalized.includes("new row violates row-level security")) {
    return "Bu işlem için yetkin yok veya erişim kısıtı var.";
  }

  if (normalized.includes("jwt") || normalized.includes("token") || normalized.includes("auth") || normalized.includes("session")) {
    return "Oturum doğrulanamadı. Lütfen tekrar giriş yap.";
  }

  if (normalized.includes("fetch failed") || normalized.includes("failed to fetch") || normalized.includes("network")) {
    return "Bağlantı hatası oluştu. İnternetini kontrol edip tekrar dene.";
  }

  if (normalized.includes("duplicate key") || normalized.includes("already exists")) {
    return "Bu kayıt zaten mevcut.";
  }

  if (normalized.includes("invalid input syntax") || normalized.includes("invalid uuid")) {
    return "Gönderilen bilgi geçersiz görünüyor. Lütfen tekrar dene.";
  }

  return raw;
}

export function mapCaughtError(error: unknown, fallback = "İşlem tamamlanamadı."): string {
  if (error instanceof Error) {
    return mapUserFacingError(error.message, fallback);
  }
  return fallback;
}
