import { NextRequest, NextResponse } from "next/server";
import * as webpush from "web-push";
import type { PushSubscription } from "web-push";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PushMessageRequest = {
  conversationId?: string;
  messageId?: string;
};

function trimPreview(text: string, max = 120) {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function getSenderDisplayName(profile: { username: string | null; full_name: string | null } | null) {
  return profile?.username || profile?.full_name || "Yeni mesaj";
}

function isGoneError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybeStatus = (error as { statusCode?: number }).statusCode;
  return maybeStatus === 404 || maybeStatus === 410;
}

export async function POST(request: NextRequest) {
  try {
    const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
    const vapidSubject = process.env.VAPID_SUBJECT ?? "mailto:admin@example.com";

    if (!vapidPublic || !vapidPrivate) {
      return NextResponse.json({ error: "Push is not configured on server." }, { status: 503 });
    }

    const authHeader = request.headers.get("authorization");
    const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return NextResponse.json({ error: "Missing access token." }, { status: 401 });
    }

    const body = (await request.json()) as PushMessageRequest;
    if (!body.conversationId || !body.messageId) {
      return NextResponse.json({ error: "conversationId and messageId are required." }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdminClient();
    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
    const sender = authData.user;
    if (authError || !sender) {
      return NextResponse.json({ error: "Invalid session token." }, { status: 401 });
    }

    const [{ data: message, error: messageError }, { data: participants, error: participantsError }, { data: senderProfile }] =
      await Promise.all([
        supabaseAdmin
          .from("messages")
          .select("id, conversation_id, sender_id, content")
          .eq("id", body.messageId)
          .maybeSingle(),
        supabaseAdmin.from("participants").select("user_id").eq("conversation_id", body.conversationId),
        supabaseAdmin
          .from("profiles")
          .select("username, full_name")
          .eq("id", sender.id)
          .maybeSingle()
      ]);

    if (messageError || !message) {
      return NextResponse.json({ error: messageError?.message ?? "Message not found." }, { status: 404 });
    }

    if (message.conversation_id !== body.conversationId || message.sender_id !== sender.id) {
      return NextResponse.json({ error: "Unauthorized push dispatch attempt." }, { status: 403 });
    }

    if (participantsError) {
      return NextResponse.json({ error: participantsError.message }, { status: 500 });
    }

    const recipientIds = ((participants as { user_id: string }[] | null) ?? [])
      .map((row) => row.user_id)
      .filter((userId) => userId !== sender.id);

    if (recipientIds.length === 0) {
      return NextResponse.json({ sent: 0, skipped: true });
    }

    // Check mute settings for recipients
    const { data: muteSettings, error: muteError } = await supabaseAdmin
      .from("conversation_notification_settings")
      .select("user_id, muted")
      .eq("conversation_id", body.conversationId)
      .in("user_id", recipientIds);

    if (muteError) {
      console.warn("[push] failed to check mute settings:", muteError.message);
      // Continue without filtering - better to send than not send
    }

    const mutedUserIds = new Set(
      ((muteSettings as { user_id: string; muted: boolean }[] | null) ?? [])
        .filter((setting) => setting.muted)
        .map((setting) => setting.user_id)
    );

    const activeRecipientIds = recipientIds.filter((userId) => !mutedUserIds.has(userId));

    if (activeRecipientIds.length === 0) {
      return NextResponse.json({ sent: 0, skipped: true, muted: recipientIds.length });
    }

    const { data: subscriptions, error: subscriptionsError } = await supabaseAdmin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .in("user_id", activeRecipientIds);

    if (subscriptionsError) {
      return NextResponse.json({ error: subscriptionsError.message }, { status: 500 });
    }

    const rows = (subscriptions as { id: string; endpoint: string; p256dh: string; auth: string }[] | null) ?? [];
    if (rows.length === 0) {
      return NextResponse.json({ sent: 0, skipped: true });
    }

    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

    const payload = JSON.stringify({
      title: getSenderDisplayName(
        (senderProfile as { username: string | null; full_name: string | null } | null) ?? null
      ),
      body: trimPreview(message.content || "Yeni mesaj"),
      url: `/chat?conversation=${body.conversationId}`,
      tag: `conversation:${body.conversationId}`
    });

    const expiredIds: string[] = [];
    let sentCount = 0;

    await Promise.all(
      rows.map(async (row) => {
        const subscription: PushSubscription = {
          endpoint: row.endpoint,
          keys: {
            p256dh: row.p256dh,
            auth: row.auth
          }
        };

        try {
          await webpush.sendNotification(subscription, payload);
          sentCount += 1;
        } catch (error) {
          if (isGoneError(error)) {
            expiredIds.push(row.id);
            return;
          }
          console.warn("[push] send failed:", error);
        }
      })
    );

    if (expiredIds.length > 0) {
      const { error } = await supabaseAdmin.from("push_subscriptions").delete().in("id", expiredIds);
      if (error) console.warn("[push] failed to clean expired subscriptions:", error.message);
    }

    return NextResponse.json({ sent: sentCount, subscriptions: rows.length, removed: expiredIds.length });
  } catch (error) {
    console.error("[push] unexpected error:", error);
    return NextResponse.json({ error: "Internal error while sending push notifications." }, { status: 500 });
  }
}
