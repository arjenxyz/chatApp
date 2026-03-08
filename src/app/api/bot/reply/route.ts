import { NextRequest, NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BotReplyRequest = {
  conversationId?: string;
  prompt?: string;
  messages?: Array<{ senderName?: string; content?: string }>;
};

type HistoryRow = {
  senderName: string;
  content: string;
};

type BotCommandName =
  | "help"
  | "summary"
  | "tasks"
  | "decisions"
  | "agenda"
  | "standup"
  | "rewrite"
  | "translate"
  | "actionplan"
  | "ask";

type ParsedPrompt =
  | { kind: "command"; command: BotCommandName; args: string; raw: string }
  | { kind: "ask"; prompt: string; raw: string }
  | { kind: "unknown-command"; command: string; args: string; raw: string };

const COMMAND_ALIASES: Record<string, BotCommandName> = {
  help: "help",
  yardim: "help",
  "yardım": "help",
  summary: "summary",
  ozet: "summary",
  "özet": "summary",
  tasks: "tasks",
  task: "tasks",
  todo: "tasks",
  decisions: "decisions",
  decision: "decisions",
  kararlar: "decisions",
  agenda: "agenda",
  gundem: "agenda",
  "gündem": "agenda",
  standup: "standup",
  rewrite: "rewrite",
  duzenle: "rewrite",
  "düzenle": "rewrite",
  translate: "translate",
  cevir: "translate",
  "çevir": "translate",
  actionplan: "actionplan",
  plan: "actionplan",
  ask: "ask",
  ai: "ask",
  bot: "ask"
};

const ACTION_REGEX = /(yap|todo|task|görev|lazım|gerekli|teslim|deadline|takip|plan|aksiyon)/i;
const DECISION_REGEX = /(karar|onay|seçildi|anlaştık|mutabık|kabul|reddedildi|devam edelim|durduralım)/i;
const BLOCKER_REGEX = /(engel|blok|hata|sorun|risk|bekliyor|blocked)/i;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

const BOT_MAX_PROMPT_CHARS = parsePositiveInt(process.env.BOT_MAX_PROMPT_CHARS, 700);
const BOT_MAX_HISTORY_ITEMS = parsePositiveInt(process.env.BOT_MAX_HISTORY_ITEMS, 18);
const BOT_RATE_LIMIT_WINDOW_MS = parsePositiveInt(process.env.BOT_RATE_LIMIT_WINDOW_MS, 5 * 60 * 1000);
const BOT_RATE_LIMIT_MAX_REQUESTS = parsePositiveInt(process.env.BOT_RATE_LIMIT_MAX_REQUESTS, 8);
const BOT_DAILY_LIMIT = parsePositiveInt(process.env.BOT_DAILY_LIMIT, 40);

const botWindowUsageByUser = new Map<string, number[]>();
const botDailyUsageByUser = new Map<string, { dayKey: string; count: number }>();

function consumeBotQuota(userId: string): { ok: true } | { ok: false; error: string } {
  const now = Date.now();
  const dayKey = new Date(now).toISOString().slice(0, 10);
  const existingDaily = botDailyUsageByUser.get(userId);
  const dailyCount = existingDaily && existingDaily.dayKey === dayKey ? existingDaily.count : 0;

  if (dailyCount >= BOT_DAILY_LIMIT) {
    return {
      ok: false,
      error: `Günlük bot limitine ulaşıldı (${BOT_DAILY_LIMIT}). Yarın tekrar deneyebilirsin.`
    };
  }

  const minAllowedTs = now - BOT_RATE_LIMIT_WINDOW_MS;
  const recentUsage = (botWindowUsageByUser.get(userId) ?? []).filter((timestamp) => timestamp >= minAllowedTs);

  if (recentUsage.length >= BOT_RATE_LIMIT_MAX_REQUESTS) {
    const oldestAllowed = recentUsage[0] ?? now;
    const retryAfterSeconds = Math.max(1, Math.ceil((oldestAllowed + BOT_RATE_LIMIT_WINDOW_MS - now) / 1000));
    return {
      ok: false,
      error: `Bot çok sık çağrıldı. ${retryAfterSeconds} saniye sonra tekrar deneyin.`
    };
  }

  recentUsage.push(now);
  botWindowUsageByUser.set(userId, recentUsage);
  botDailyUsageByUser.set(userId, { dayKey, count: dailyCount + 1 });

  return { ok: true };
}

function compactText(value: string, maxLength = 1000): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return compact.slice(0, maxLength);
}

function clampReply(value: string, maxLength = 3500): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 20)}\n\n...(kısaltıldı)`;
}

function uniqueTop(values: string[], max = 6): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const normalized = value.toLocaleLowerCase("tr-TR");
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(value);
    if (result.length >= max) break;
  }

  return result;
}

function splitArgs(value: string): string[] {
  const matches = value.match(/"([^"]+)"|'([^']+)'|(\S+)/g) ?? [];
  return matches.map((token) => token.replace(/^['"]|['"]$/g, ""));
}

function parsePrompt(input: string): ParsedPrompt {
  const raw = input.trim();
  if (!raw) {
    return { kind: "ask", prompt: "Bu konuşmaya profesyonel bir asistan gibi destek ol.", raw };
  }

  if (raw.startsWith("/")) {
    const firstSpace = raw.indexOf(" ");
    const commandToken = (firstSpace === -1 ? raw.slice(1) : raw.slice(1, firstSpace)).trim().toLocaleLowerCase("tr-TR");
    const args = firstSpace === -1 ? "" : raw.slice(firstSpace + 1).trim();
    const command = COMMAND_ALIASES[commandToken];

    if (command) {
      return { kind: "command", command, args, raw };
    }
    return { kind: "unknown-command", command: commandToken, args, raw };
  }

  if (/@bot\b/i.test(raw)) {
    const cleaned = raw.replace(/@bot\b/gi, "").trim();
    return { kind: "ask", prompt: cleaned || "Konuşmaya profesyonel destek ver.", raw };
  }

  return { kind: "ask", prompt: raw, raw };
}

function buildHelpReply(unknownCommand?: string): string {
  const unknownLine = unknownCommand ? `Bilinmeyen komut: \`/${unknownCommand}\`\n\n` : "";
  return [
    unknownLine,
    "Atlas Bot Komutları",
    "",
    "1. `/help`",
    "2. `/summary [short|long]`",
    "3. `/tasks`",
    "4. `/decisions`",
    "5. `/agenda`",
    "6. `/standup`",
    "7. `/rewrite [formal|friendly|concise] <metin>`",
    "8. `/translate <hedef_dil> <metin>`",
    "9. `/actionplan <hedef>`",
    "10. `@bot <soru>` veya `/ask <soru>`",
    "",
    "Örnekler:",
    "- `/summary long`",
    "- `/tasks`",
    "- `/rewrite concise Müşteriye gönderilecek açıklamayı düzenle`",
    "- `/translate en Ürünü bugün canlıya alıyoruz.`"
  ].join("\n");
}

function buildSummaryFallback(history: HistoryRow[], mode: "short" | "long"): string {
  if (history.length === 0) return "Özet için yeterli konuşma geçmişi yok.";

  const lines = history.slice(-12).map((row) => `- ${row.senderName}: ${row.content}`);
  if (mode === "short") {
    return [`Kısa Özet`, "", ...lines.slice(-6)].join("\n");
  }

  const actions = uniqueTop(
    history
      .filter((row) => ACTION_REGEX.test(row.content))
      .map((row) => `${row.senderName}: ${row.content}`),
    5
  );
  const decisions = uniqueTop(
    history
      .filter((row) => DECISION_REGEX.test(row.content))
      .map((row) => `${row.senderName}: ${row.content}`),
    4
  );

  return [
    "Detaylı Özet",
    "",
    "Öne Çıkan Mesajlar:",
    ...lines.slice(-8),
    "",
    "Kararlar:",
    ...(decisions.length > 0 ? decisions.map((item) => `- ${item}`) : ["- Belirgin karar ifadesi yakalanmadı."]),
    "",
    "Aksiyonlar:",
    ...(actions.length > 0 ? actions.map((item) => `- ${item}`) : ["- Belirgin aksiyon maddesi yakalanmadı."])
  ].join("\n");
}

function buildTasksFallback(history: HistoryRow[]): string {
  const taskCandidates = uniqueTop(
    history
      .filter((row) => ACTION_REGEX.test(row.content))
      .map((row) => `${row.senderName}: ${row.content}`),
    8
  );

  if (taskCandidates.length === 0) {
    return [
      "Aksiyon Listesi",
      "",
      "Belirgin görev cümlesi az. Önerilen şablon:",
      "1. [Sorumlu] Görev - Teslim Tarihi",
      "2. [Sorumlu] Görev - Teslim Tarihi",
      "3. [Sorumlu] Engeller"
    ].join("\n");
  }

  return [
    "Aksiyon Listesi",
    "",
    ...taskCandidates.map((item, index) => `${index + 1}. ${item}`)
  ].join("\n");
}

function buildDecisionsFallback(history: HistoryRow[]): string {
  const decisionCandidates = uniqueTop(
    history
      .filter((row) => DECISION_REGEX.test(row.content))
      .map((row) => `${row.senderName}: ${row.content}`),
    8
  );

  if (decisionCandidates.length === 0) {
    return [
      "Karar Özeti",
      "",
      "Net bir karar ifadesi tespit edilmedi.",
      "Kararları netlemek için:",
      "1. Seçilen opsiyon",
      "2. Sorumlu kişi",
      "3. Hedef tarih"
    ].join("\n");
  }

  return ["Karar Özeti", "", ...decisionCandidates.map((item, index) => `${index + 1}. ${item}`)].join("\n");
}

function buildAgendaFallback(history: HistoryRow[]): string {
  const decisions = uniqueTop(
    history
      .filter((row) => DECISION_REGEX.test(row.content))
      .map((row) => row.content),
    3
  );
  const tasks = uniqueTop(
    history
      .filter((row) => ACTION_REGEX.test(row.content))
      .map((row) => row.content),
    4
  );
  const blockers = uniqueTop(
    history
      .filter((row) => BLOCKER_REGEX.test(row.content))
      .map((row) => row.content),
    3
  );

  return [
    "Toplantı Gündemi (Öneri)",
    "",
    "1. Durum Özeti",
    "2. Açık Aksiyonlar",
    ...tasks.map((item) => `- ${item}`),
    "3. Kararlar",
    ...(decisions.length > 0 ? decisions.map((item) => `- ${item}`) : ["- Karar başlığı eklenmedi"]),
    "4. Riskler / Blokerler",
    ...(blockers.length > 0 ? blockers.map((item) => `- ${item}`) : ["- Belirgin bloker yok"]),
    "5. Sonraki Kontrol Noktası"
  ].join("\n");
}

function buildStandupFallback(history: HistoryRow[]): string {
  const yesterday = uniqueTop(
    history
      .filter((row) => /(dün|tamamlandı|bitirdim|yaptım|completed)/i.test(row.content))
      .map((row) => `${row.senderName}: ${row.content}`),
    5
  );
  const today = uniqueTop(
    history
      .filter((row) => /(bugün|plan|yapacağım|devam edeceğim|today)/i.test(row.content))
      .map((row) => `${row.senderName}: ${row.content}`),
    5
  );
  const blockers = uniqueTop(
    history
      .filter((row) => BLOCKER_REGEX.test(row.content))
      .map((row) => `${row.senderName}: ${row.content}`),
    5
  );

  return [
    "Standup Özeti",
    "",
    "Dün:",
    ...(yesterday.length > 0 ? yesterday.map((item) => `- ${item}`) : ["- Kayıt yok"]),
    "",
    "Bugün:",
    ...(today.length > 0 ? today.map((item) => `- ${item}`) : ["- Kayıt yok"]),
    "",
    "Blokerler:",
    ...(blockers.length > 0 ? blockers.map((item) => `- ${item}`) : ["- Kayıt yok"])
  ].join("\n");
}

function buildActionPlanFallback(goal: string, history: HistoryRow[]): string {
  const tasks = uniqueTop(
    history
      .filter((row) => ACTION_REGEX.test(row.content))
      .map((row) => row.content),
    5
  );

  return [
    `Aksiyon Planı: ${goal || "Konuşma Hedefi"}`,
    "",
    "1. Kapsamı netleştir ve ölçülebilir hedef yaz.",
    "2. Sorumluları ata ve teslim tarihlerini belirle.",
    "3. Her madde için riskleri çıkar.",
    "4. Günlük/haftalık takip ritmi belirle.",
    "",
    "Konuşmadan yakalanan maddeler:",
    ...(tasks.length > 0 ? tasks.map((item) => `- ${item}`) : ["- Belirgin görev maddesi bulunamadı."])
  ].join("\n");
}

function rewriteFallback(style: string, text: string): string {
  const cleaned = compactText(text, 1500);
  if (!cleaned) return "Yeniden yazılacak metin bulunamadı.";

  const normalizedStyle = style.toLocaleLowerCase("tr-TR");
  if (normalizedStyle === "concise") {
    const firstSentence = cleaned.split(/[.!?]/)[0] ?? cleaned;
    return `${firstSentence.trim()}.`;
  }

  if (normalizedStyle === "formal" || normalizedStyle === "professional") {
    return `Merhaba,\n\n${cleaned}\n\nTeşekkürler.`;
  }

  if (normalizedStyle === "friendly") {
    return `Selam,\n${cleaned}\n\nİstersen bunu birlikte netleştirebiliriz.`;
  }

  return cleaned;
}

function parseRewriteArgs(args: string, history: HistoryRow[]): { style: string; text: string } {
  const tokens = splitArgs(args);
  let style = "professional";
  let text = "";

  if (tokens[0]?.startsWith("--style=")) {
    style = tokens[0].slice("--style=".length);
    text = tokens.slice(1).join(" ");
  } else if (tokens[0] && ["formal", "friendly", "concise", "professional"].includes(tokens[0].toLocaleLowerCase("tr-TR"))) {
    style = tokens[0];
    text = tokens.slice(1).join(" ");
  } else {
    text = tokens.join(" ");
  }

  if (!text.trim()) {
    text = history[history.length - 1]?.content ?? "";
  }

  return { style, text: text.trim() };
}

function parseTranslateArgs(args: string, history: HistoryRow[]): { target: string; text: string } {
  const tokens = splitArgs(args);
  const target = tokens[0]?.trim() ?? "";
  const text = tokens.slice(1).join(" ").trim() || history[history.length - 1]?.content || "";
  return { target, text };
}

function hasOpenAi(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

async function callOpenAi(params: {
  task: string;
  prompt: string;
  history: HistoryRow[];
  temperature?: number;
  maxTokens?: number;
}): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
  const taskPrompt = compactText(params.task, 1600);
  const userPrompt = compactText(params.prompt, 1600);
  const history = params.history.slice(-BOT_MAX_HISTORY_ITEMS);

  const messages = [
    {
      role: "system",
      content: [
        "Sen Atlas adlı profesyonel ekip sohbet asistanısın.",
        "Yanıt dili Türkçe olsun (çeviri komutları hariç).",
        "Gereksiz uzatma yapma; somut, uygulanabilir ve iyi biçimlenmiş yanıt üret.",
        "Varsayım yapıyorsan bunu açıkça belirt."
      ].join(" ")
    },
    ...history.map((row) => ({
      role: "user",
      content: `${row.senderName}: ${row.content}`
    })),
    {
      role: "user",
      content: `GÖREV:\n${taskPrompt}\n\nİSTEK:\n${userPrompt}`
    }
  ];

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: params.temperature ?? 0.3,
      max_tokens: params.maxTokens ?? 420,
      messages
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI error: ${text}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = data.choices?.[0]?.message?.content ?? null;
  return content?.trim() || null;
}

async function executeCommand(parsed: Extract<ParsedPrompt, { kind: "command" }>, history: HistoryRow[]): Promise<string> {
  const args = parsed.args.trim();

  switch (parsed.command) {
    case "help":
      return buildHelpReply();
    case "summary": {
      const mode: "short" | "long" =
        /\b(long|detay|detailed|full)\b/i.test(args) ? "long" : "short";

      const aiReply = await callOpenAi({
        task:
          mode === "long"
            ? "Konuşmayı detaylı şekilde özetle. Başlıklar: Öne Çıkanlar, Kararlar, Aksiyonlar, Riskler."
            : "Konuşmayı çok kısa özetle. En fazla 6 madde.",
        prompt: args || "Konuşmayı özetle.",
        history,
        maxTokens: mode === "long" ? 520 : 260
      });

      return aiReply || buildSummaryFallback(history, mode);
    }
    case "tasks": {
      const aiReply = await callOpenAi({
        task:
          "Konuşmadan görev/aksiyon maddelerini çıkar. Her madde için: görev, sorumlu (varsa), tarih (varsa), durum.",
        prompt: args || "Aksiyon listesini üret.",
        history,
        maxTokens: 460
      });

      return aiReply || buildTasksFallback(history);
    }
    case "decisions": {
      const aiReply = await callOpenAi({
        task: "Konuşmadan alınan kararları çıkar. Belirsiz olanları 'taslak karar' olarak ayır.",
        prompt: args || "Kararları listele.",
        history,
        maxTokens: 420
      });

      return aiReply || buildDecisionsFallback(history);
    }
    case "agenda": {
      const aiReply = await callOpenAi({
        task: "Konuşmaya göre profesyonel toplantı gündemi üret. Bölümler: Hedef, Gündem Maddeleri, Açık Riskler, Çıktılar.",
        prompt: args || "Toplantı gündemi oluştur.",
        history,
        maxTokens: 420
      });

      return aiReply || buildAgendaFallback(history);
    }
    case "standup": {
      const aiReply = await callOpenAi({
        task: "Standup formatında özet üret: Dün, Bugün, Blokerler. Kişilere göre grupla.",
        prompt: args || "Standup özeti çıkar.",
        history,
        maxTokens: 420
      });

      return aiReply || buildStandupFallback(history);
    }
    case "rewrite": {
      const { style, text } = parseRewriteArgs(args, history);
      if (!text) {
        return "Kullanım: `/rewrite [formal|friendly|concise|professional] <metin>`";
      }

      const aiReply = await callOpenAi({
        task: `Verilen metni ${style} tonda yeniden yaz. Anlamı koru.`,
        prompt: text,
        history: [],
        maxTokens: 360
      });

      return aiReply || rewriteFallback(style, text);
    }
    case "translate": {
      const { target, text } = parseTranslateArgs(args, history);
      if (!target || !text) {
        return "Kullanım: `/translate <hedef_dil> <metin>`  Örn: `/translate en Bu metni çevir`";
      }

      const aiReply = await callOpenAi({
        task: `Metni ${target} diline çevir. Sadece çeviri metnini döndür.`,
        prompt: text,
        history: [],
        maxTokens: 380
      });

      if (aiReply) return aiReply;
      return [
        `Hedef dil: ${target}`,
        "",
        "OPENAI_API_KEY olmadığı için kaliteli çeviri motoru devreye alınamadı.",
        "Bu komutun tam performansı için sunucuda OPENAI_API_KEY ayarla."
      ].join("\n");
    }
    case "actionplan": {
      const goal = args || "Konuşma hedefi";
      const aiReply = await callOpenAi({
        task:
          "Verilen hedef için profesyonel aksiyon planı hazırla. Bölümler: Fazlar, Sorumluluklar, Teslim Tarihleri, Riskler, Takip Ritmi.",
        prompt: goal,
        history,
        maxTokens: 480
      });

      return aiReply || buildActionPlanFallback(goal, history);
    }
    case "ask": {
      const askPrompt = args || "Bu konuşmada bir sonraki en doğru adımı öner.";
      const aiReply = await callOpenAi({
        task: "Profesyonel sohbet asistanı gibi soruyu yanıtla. Gerekirse kısa eylem planı ekle.",
        prompt: askPrompt,
        history,
        maxTokens: 460
      });

      if (aiReply) return aiReply;

      const context = history.slice(-5).map((row) => `- ${row.senderName}: ${row.content}`).join("\n");
      return [
        "Atlas Bot (Fallback)",
        "",
        `Soru: ${askPrompt}`,
        "",
        "Bağlam:",
        context || "- Henüz yeterli bağlam yok.",
        "",
        "Öneri:",
        "1. Hedefi tek cümlede netleştir.",
        "2. En kritik aksiyon sahibini ata.",
        "3. Bir sonraki kontrol zamanını belirle."
      ].join("\n");
    }
    default:
      return buildHelpReply();
  }
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return NextResponse.json({ error: "Missing access token." }, { status: 401 });
    }

    const body = (await request.json()) as BotReplyRequest;
    const conversationId = body.conversationId?.trim();
    const rawPrompt = body.prompt?.trim() ?? "";
    if (rawPrompt.length > BOT_MAX_PROMPT_CHARS) {
      return NextResponse.json(
        { error: `Bot isteği en fazla ${BOT_MAX_PROMPT_CHARS} karakter olabilir.` },
        { status: 400 }
      );
    }
    const prompt = rawPrompt ? compactText(rawPrompt, BOT_MAX_PROMPT_CHARS) : "";
    if (!conversationId || !prompt) {
      return NextResponse.json({ error: "conversationId and prompt are required." }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdminClient();
    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !authData.user) {
      return NextResponse.json({ error: "Invalid session token." }, { status: 401 });
    }

    const requesterId = authData.user.id;
    const [{ data: membership, error: membershipError }, { data: conversation, error: conversationError }] =
      await Promise.all([
        supabaseAdmin
          .from("participants")
          .select("conversation_id")
          .eq("conversation_id", conversationId)
          .eq("user_id", requesterId)
          .maybeSingle(),
        supabaseAdmin.from("conversations").select("id, is_group").eq("id", conversationId).maybeSingle()
      ]);

    if (membershipError || !membership) {
      return NextResponse.json({ error: membershipError?.message ?? "Conversation access denied." }, { status: 403 });
    }

    if (conversationError || !conversation || conversation.is_group !== true) {
      return NextResponse.json({ error: conversationError?.message ?? "Bot only works in group conversations." }, { status: 400 });
    }

    const quotaCheck = consumeBotQuota(requesterId);
    if (!quotaCheck.ok) {
      return NextResponse.json({ error: quotaCheck.error }, { status: 429 });
    }

    const history = ((body.messages ?? []) as Array<{ senderName?: string; content?: string }>)
      .map((row) => ({
        senderName: compactText(row.senderName || "kullanici", 48),
        content: compactText(row.content || "", 900)
      }))
      .filter((row) => row.content.length > 0)
      .slice(-BOT_MAX_HISTORY_ITEMS);

    const parsed = parsePrompt(prompt);

    let reply: string;
    if (parsed.kind === "unknown-command") {
      reply = buildHelpReply(parsed.command);
    } else if (parsed.kind === "command") {
      reply = await executeCommand(parsed, history);
    } else {
      const askLikeCommand: Extract<ParsedPrompt, { kind: "command" }> = {
        kind: "command",
        command: "ask",
        args: parsed.prompt,
        raw: parsed.raw
      };
      reply = await executeCommand(askLikeCommand, history);
    }

    return NextResponse.json({ reply: clampReply(reply), hasOpenAi: hasOpenAi() });
  } catch (error) {
    console.error("[bot-reply] unexpected error:", error);
    return NextResponse.json({ error: "Bot yanıtı oluşturulamadı." }, { status: 500 });
  }
}
