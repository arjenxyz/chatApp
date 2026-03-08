import { NextRequest, NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";

interface JoinRequestBody {
  conversationId?: string;
}

function normalizeAuthHeader(request: NextRequest): string | null {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.slice("Bearer ".length).trim();
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as JoinRequestBody;
    const conversationId = body.conversationId?.trim();

    if (!conversationId) {
      return NextResponse.json({ error: "conversationId zorunlu." }, { status: 400 });
    }

    const accessToken = normalizeAuthHeader(request);
    if (!accessToken) {
      return NextResponse.json({ error: "Yetkisiz istek." }, { status: 401 });
    }

    const admin = getSupabaseAdminClient();

    const {
      data: { user },
      error: authError
    } = await admin.auth.getUser(accessToken);

    if (authError || !user) {
      return NextResponse.json({ error: "Oturum doğrulanamadı." }, { status: 401 });
    }

    const { data: conversation, error: conversationError } = await admin
      .from("conversations")
      .select("id, is_group")
      .eq("id", conversationId)
      .maybeSingle();

    if (conversationError) {
      return NextResponse.json({ error: conversationError.message }, { status: 500 });
    }

    if (!conversation) {
      return NextResponse.json({ error: "Watch Party odası bulunamadı." }, { status: 404 });
    }

    if (!conversation.is_group) {
      return NextResponse.json({ error: "Bu davet bir grup odasına ait değil." }, { status: 400 });
    }

    const { error: joinError } = await admin.from("participants").upsert(
      {
        conversation_id: conversationId,
        user_id: user.id
      },
      {
        onConflict: "conversation_id,user_id",
        ignoreDuplicates: true
      }
    );

    if (joinError) {
      return NextResponse.json({ error: joinError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bilinmeyen sunucu hatası.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
