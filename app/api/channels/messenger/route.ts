import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { verifyHubToken } from "@/lib/channels/verify";
import { messengerAdapter } from "@/lib/channels/messenger";
import { generateCustomerReply } from "@/lib/ai/gemini";

/**
 * GET /api/channels/messenger
 * Webhook verification handshake from Meta
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const verifyToken = process.env.MESSENGER_VERIFY_TOKEN;

  if (mode === "subscribe" && verifyHubToken(token, verifyToken) && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }

  return new NextResponse("Webhook verification failed", { status: 403 });
}

/**
 * POST /api/channels/messenger
 * Inbound Messenger messages from Meta
 */
export async function POST(request: NextRequest) {
  try {
    const signature = request.headers.get("x-hub-signature-256") || "";
    const bodyText = await request.text();

    // Verify signature
    const appSecret = process.env.MESSENGER_APP_SECRET || "";
    if (!messengerAdapter.verifySignature(bodyText, signature, appSecret)) {
      return new NextResponse("Invalid signature", { status: 403 });
    }

    const body = JSON.parse(bodyText);
    const inbound = messengerAdapter.parseWebhook(body);

    if (inbound.length === 0) {
      return new NextResponse("OK", { status: 200 });
    }

    // Get default business (or resolve from mapping in production)
    const businessId = process.env.MESSENGER_DEFAULT_BUSINESS_ID;
    if (!businessId) {
      console.error("MESSENGER_DEFAULT_BUSINESS_ID not configured");
      return new NextResponse("Business not configured", { status: 500 });
    }

    // Get channel config
    const { data: channels } = await supabaseAdmin
      .from("channels")
      .select("*")
      .eq("business_id", businessId)
      .eq("channel_type", "messenger")
      .maybeSingle();

    if (!channels) {
      console.error("Messenger channel not configured for business", businessId);
      return new NextResponse("Channel not configured", { status: 500 });
    }

    // Process each message
    for (const msg of inbound) {
      // Look up or create conversation
      const { data: existingConv } = await supabaseAdmin
        .from("conversations")
        .select("id")
        .eq("business_id", businessId)
        .eq("customer_identifier", msg.from)
        .eq("channel_type", "messenger")
        .maybeSingle();

      let conversationId: string;

      if (existingConv) {
        conversationId = existingConv.id;
        // Update last_message_at and preview
        await supabaseAdmin
          .from("conversations")
          .update({
            last_message_at: new Date().toISOString(),
            last_message_preview: msg.text.substring(0, 100),
          })
          .eq("id", conversationId);
      } else {
        // Create new conversation
        const { data: newConv } = await supabaseAdmin
          .from("conversations")
          .insert({
            business_id: businessId,
            customer_identifier: msg.from,
            customer_name: msg.customerName,
            channel_type: "messenger",
            channel_id: channels.id,
            status: "bot_active",
          })
          .select("id")
          .single();

        conversationId = newConv?.id || "";
      }

      // Store inbound message
      await supabaseAdmin.from("messages").insert({
        business_id: businessId,
        conversation_id: conversationId,
        channel_id: channels.id,
        sender_type: "customer",
        direction: "incoming",
        body: msg.text,
        provider_message_id: msg.channelMessageId,
      });

      // Fetch conversation history
      const { data: history } = await supabaseAdmin
        .from("messages")
        .select("body, sender_type")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })
        .limit(10);

      // Get AI reply
      const historyFormatted = (history || []).map(
        (h: { sender_type: string; body: string }) => ({
          sender: h.sender_type === "customer" ? ("customer" as const) : ("bot" as const),
          text: h.body,
        })
      );

      const aiResult = await generateCustomerReply(businessId, msg.text, historyFormatted, {
        channelType: "messenger",
        conversationId,
        customerName: msg.customerName,
      });

      // Store bot response
      const { data: botMsg } = await supabaseAdmin
        .from("messages")
        .insert({
          business_id: businessId,
          conversation_id: conversationId,
          channel_id: channels.id,
          sender_type: "bot",
          direction: "outgoing",
          body: aiResult.text,
        })
        .select("id")
        .single();

      // Send message via Messenger API if credentials available
      if (channels.access_token && channels.page_id) {
        const sendResult = await messengerAdapter.sendMessage({
          to: msg.from,
          text: aiResult.text,
          accessToken: channels.access_token,
          pageId: channels.page_id,
        });

        if (sendResult.success && sendResult.messageId && botMsg) {
          // Update message with provider_message_id
          await supabaseAdmin
            .from("messages")
            .update({ provider_message_id: sendResult.messageId })
            .eq("id", botMsg.id);
        }
      }

      // Process tool calls if any
      if (aiResult.toolsUsed.length > 0) {
        console.log("Tools used:", aiResult.toolsUsed);
        // Tool processing would happen here (orders, product lookups, etc.)
      }
    }

    return new NextResponse("OK", { status: 200 });
  } catch (error) {
    console.error("Messenger webhook error:", error);
    return new NextResponse(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
