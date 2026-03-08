import { NextRequest, NextResponse } from "next/server";

type LinkPreviewResponse = {
  url: string;
  title: string;
  image: string | null;
  siteName: string | null;
  domain: string;
};

type LinkPreviewRequestBody = {
  url?: string;
};

const REQUEST_TIMEOUT_MS = 5000;
const MAX_HTML_LENGTH = 350_000;
const USER_AGENT =
  "Mozilla/5.0 (compatible; AtlasChatBot/1.0; +https://atlas.chat) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";
const SPAM_HOST_KEYWORDS = ["casino", "bet", "porn", "xxx", "viagra", "loan", "airdrop", "giveaway", "bonus"];

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function normalizeText(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
  return cleaned || null;
}

function extractMetaTag(html: string, key: string, attribute: "property" | "name" = "property"): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<meta[^>]*${attribute}=["']${escaped}["'][^>]*content=["']([^"']+)["'][^>]*>|<meta[^>]*content=["']([^"']+)["'][^>]*${attribute}=["']${escaped}["'][^>]*>`,
    "i"
  );
  const match = html.match(pattern);
  return normalizeText(match?.[1] ?? match?.[2] ?? null);
}

function extractTitleTag(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return normalizeText(match?.[1] ?? null);
}

function isPrivateIp(hostname: string): boolean {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return false;
  const [a, b] = hostname.split(".").map((part) => Number(part));
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isSpamLikeHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (SPAM_HOST_KEYWORDS.some((keyword) => normalized.includes(keyword))) return true;
  if ((normalized.match(/-/g) ?? []).length >= 5) return true;
  return false;
}

function isAllowedUrl(rawUrl: string): { ok: true; url: URL } | { ok: false; message: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, message: "Geçersiz URL." };
  }

  if (!(parsed.protocol === "http:" || parsed.protocol === "https:")) {
    return { ok: false, message: "Sadece http/https URL destekleniyor." };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal") || isPrivateIp(hostname)) {
    return { ok: false, message: "Bu alan adı güvenlik nedeniyle önizlenemiyor." };
  }

  if (isSpamLikeHost(hostname)) {
    return { ok: false, message: "Bu bağlantı spam filtresine takıldı." };
  }

  return { ok: true, url: parsed };
}

function resolveImageUrl(imageUrl: string | null, baseUrl: string): string | null {
  if (!imageUrl) return null;
  try {
    return new URL(imageUrl, baseUrl).toString();
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as LinkPreviewRequestBody;
    const rawUrl = body.url?.trim();

    if (!rawUrl) {
      return NextResponse.json({ error: "url zorunlu." }, { status: 400 });
    }

    if (rawUrl.length > 2048) {
      return NextResponse.json({ error: "URL çok uzun." }, { status: 400 });
    }

    const allowed = isAllowedUrl(rawUrl);
    if (!allowed.ok) {
      return NextResponse.json({ error: allowed.message }, { status: 422 });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(allowed.url.toString(), {
        method: "GET",
        redirect: "follow",
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml"
        },
        signal: controller.signal
      });

      if (!response.ok) {
        return NextResponse.json({ error: "Önizleme alınamadı." }, { status: 422 });
      }

      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
        return NextResponse.json({ error: "Bu bağlantı türü önizlenemiyor." }, { status: 422 });
      }

      const finalUrl = response.url;
      const finalAllowed = isAllowedUrl(finalUrl);
      if (!finalAllowed.ok) {
        return NextResponse.json({ error: finalAllowed.message }, { status: 422 });
      }

      const html = (await response.text()).slice(0, MAX_HTML_LENGTH);
      const title =
        extractMetaTag(html, "og:title") ||
        extractMetaTag(html, "twitter:title", "name") ||
        extractTitleTag(html) ||
        finalAllowed.url.hostname;

      const image = resolveImageUrl(
        extractMetaTag(html, "og:image") || extractMetaTag(html, "twitter:image", "name"),
        finalUrl
      );
      const siteName =
        extractMetaTag(html, "og:site_name") ||
        extractMetaTag(html, "application-name", "name") ||
        null;

      const preview: LinkPreviewResponse = {
        url: finalUrl,
        title,
        image,
        siteName,
        domain: finalAllowed.url.hostname
      };

      return NextResponse.json({ preview });
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return NextResponse.json({ error: "Önizleme servisi geçici olarak kullanılamıyor." }, { status: 500 });
  }
}
