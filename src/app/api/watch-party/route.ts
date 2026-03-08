import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface WatchPartyRequest {
  conversationId: string;
  videoId: string;
  currentTime?: number;
  status?: "playing" | "paused";
}

interface WatchPartyEventRequest extends WatchPartyRequest {
  eventType: "play" | "pause" | "seek" | "video_change";
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as WatchPartyEventRequest;
    const {
      conversationId,
      videoId,
      currentTime = 0,
      status = "paused",
      eventType = "seek"
    } = body;

    if (!conversationId || !videoId) {
      return NextResponse.json(
        { error: "conversationId and videoId are required" },
        { status: 400 }
      );
    }

    const authHeader = request.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Check if user is participant in conversation
    const { data: participant, error: participantError } = await supabase
      .from("participants")
      .select("id")
      .eq("conversation_id", conversationId)
      .eq("user_id", user.id)
      .single();

    if (participantError || !participant) {
      return NextResponse.json(
        { error: "Not a participant in this conversation" },
        { status: 403 }
      );
    }

    // Get or create watch party session
    const { data: session, error: sessionError } = await supabase
      .from("watch_party_sessions")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    let sessionId: string;

    if (sessionError && sessionError.code === "PGRST116") {
      // No existing session, create new one
      const { data: newSession, error: createError } = await supabase
        .from("watch_party_sessions")
        .insert({
          conversation_id: conversationId,
          video_id: videoId,
          currentTime,
          status
        })
        .select()
        .single();

      if (createError) {
        return NextResponse.json(
          { error: "Failed to create watch party session" },
          { status: 500 }
        );
      }

      sessionId = newSession.id;
    } else if (sessionError) {
      return NextResponse.json(
        { error: "Database error" },
        { status: 500 }
      );
    } else {
      sessionId = session.id;

      // Update session with latest video info
      await supabase
        .from("watch_party_sessions")
        .update({
          video_id: videoId,
          currentTime,
          status,
          updated_at: new Date().toISOString()
        })
        .eq("id", sessionId);
    }

    // Record event
    const { data: event, error: eventError } = await supabase
      .from("watch_party_events")
      .insert({
        session_id: sessionId,
        user_id: user.id,
        event_type: eventType,
        video_id: videoId,
        currentTime,
        status
      })
      .select()
      .single();

    if (eventError) {
      console.error("Event recording error:", eventError);
      // Don't fail the request if event recording fails
    }

    return NextResponse.json({
      success: true,
      sessionId,
      event
    });
  } catch (error) {
    console.error("Watch party API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const conversationId = request.nextUrl.searchParams.get("conversationId");

    if (!conversationId) {
      return NextResponse.json(
        { error: "conversationId is required" },
        { status: 400 }
      );
    }

    const authHeader = request.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Check if user is participant
    const { data: participant } = await supabase
      .from("participants")
      .select("id")
      .eq("conversation_id", conversationId)
      .eq("user_id", user.id)
      .single();

    if (!participant) {
      return NextResponse.json(
        { error: "Not a participant" },
        { status: 403 }
      );
    }

    // Get current session
    const { data: session } = await supabase
      .from("watch_party_sessions")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();

    if (!session) {
      return NextResponse.json({
        session: null,
        events: []
      });
    }

    // Get recent events
    const { data: events } = await supabase
      .from("watch_party_events")
      .select("*")
      .eq("session_id", session.id)
      .order("created_at", { ascending: false })
      .limit(50);

    return NextResponse.json({
      session,
      events: events || []
    });
  } catch (error) {
    console.error("Watch party GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
