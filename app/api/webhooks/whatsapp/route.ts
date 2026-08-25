import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { parseWhatsAppWebhook, sendWhatsAppMessage } from "@/lib/channels/whatsapp";
import { generateCustomerReply } from "@/lib/ai/gemini";
import crypto from "crypto";

/**
 * Verify Meta's webhook signature (X-Hub-Signature-256).
 */
function verifyMetaSignature(body: string, signature: string, appSecret: string): boolean {
  if (!appSecret) {
    console.error(
      "Refusing the webhook: no app secret configured, so there is no way to prove this request came from Meta."
    );
    return false;
  }

  const expected = `sha256=${crypto.createHmac("sha256", appSecret).update(body).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature || "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * GET /api/webhooks/whatsapp
 * Webhook verification handshake from Meta (hub.challenge).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (mode === "subscribe" && token === verifyToken && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }

  return new NextResponse("Webhook verification failed", { status: 403 });
}

/**
 * POST /api/webhooks/whatsapp
 * Inbound WhatsApp messages from Meta. Uses the shared AI brain
 * (Gemini multi-model fallback + direct Supabase catalog lookup) so product
 * questions like "blue ceramic mug" never bounce with a "busy" message.
 */
export async function POST(request: NextRequest) {
  try {
    const signature = request.headers.get("x-hub-signature-256") || "";
    const bodyText = await request.text();

    if (!verifyMetaSignature(bodyText, signature, process.env.WHATSAPP_APP_SECRET || "")) {
      return new NextResponse("Invalid signature", { status: 403 });
    }

    const body = JSON.parse(bodyText);
    const inbound = parseWhatsAppWebhook(body);

    if (inbound.length === 0) {
      return new NextResponse("OK", { status: 200 });
    }

    // Get default business (or resolve from mapping in production).
    const businessId = process.env.WHATSAPP_DEFAULT_BUSINESS_ID;
    if (!businessId) {
      console.error("WHATSAPP_DEFAULT_BUSINESS_ID not configured");
      return new NextResponse("Business not configured", { status: 500 });
    }

    // Get channel config.
    const { data: channels } = await supabaseAdmin
      .from("channels")
      .select("*")
      .eq("business_id", businessId)
      .eq("channel_type", "whatsapp")
      .maybeSingle();

    if (!channels) {
      console.warn("WhatsApp channel not configured for business");
      return new NextResponse("Channel not configured", { status: 400 });
    }

    const accessToken = channels.access_token;
    const phoneNumberId = channels.phone_number_id;

    // Process each message.
    for (const msg of inbound) {
      try {
        // Find or create conversation.
        const { data: existingConv } = await supabaseAdmin
          .from("conversations")
          .select("id")
          .eq("business_id", businessId)
          .eq("customer_identifier", msg.from)
          .eq("channel_type", "whatsapp")
          .maybeSingle();

        let conversationId: string;

        if (existingConv) {
          conversationId = existingConv.id;
        } else {
          const { data: newConv, error: convErr } = await supabaseAdmin
            .from("conversations")
            .insert({
              business_id: businessId,
              customer_name: msg.customerName,
              customer_identifier: msg.from,
              channel_type: "whatsapp",
              status: "bot_active",
              last_message_preview: msg.text,
              last_message_at: msg.timestamp,
            })
            .select();

          if (convErr || !newConv?.[0]) {
            console.error("Failed to create conversation:", convErr);
            continue;
          }

          conversationId = newConv[0].id;
        }

        // Store inbound message.
        await supabaseAdmin.from("messages").insert({
          business_id: businessId,
          conversation_id: conversationId,
          channel_id: channels.id,
          sender_type: "customer",
          direction: "incoming",
          body: msg.text,
          provider_message_id: msg.waMessageId,
          created_at: msg.timestamp,
        });

        // Update conversation last message.
        await supabaseAdmin
          .from("conversations")
          .update({ last_message_preview: msg.text, last_message_at: msg.timestamp })
          .eq("id", conversationId);

        // Fetch conversation history (exclude current message).
        const { data: history } = await supabaseAdmin
          .from("messages")
          .select("sender_type, body, created_at")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: true })
          .limit(10);

        const historyFormatted = (history || [])
          .slice(0, -1)
          .map((h: { sender_type: string; body: string }) => ({
            sender: h.sender_type === "customer" ? ("customer" as const) : ("bot" as const),
            text: h.body,
          }));

        // Get AI reply (Gemini multi-model fallback + catalog lookup).
        const aiReply = await generateCustomerReply(businessId, msg.text, historyFormatted);

        // Store bot response.
        await supabaseAdmin.from("messages").insert({
          business_id: businessId,
          conversation_id: conversationId,
          channel_id: channels.id,
          sender_type: "bot",
          direction: "outgoing",
          body: aiReply.text,
        });

        // Send via WhatsApp if tokens are configured.
        if (accessToken && phoneNumberId) {
          const result = await sendWhatsAppMessage({
            to: msg.from,
            text: aiReply.text,
            phoneNumberId,
            accessToken,
          });

          if (!result.success) {
            console.error("Failed to send WhatsApp message:", result.error);
          }
        } else {
          console.warn("WhatsApp tokens not configured, skipping send");
        }
      } catch (msgError) {
        console.error("Error processing individual message:", msgError);
      }
    }

    return new NextResponse("OK", { status: 200 });
  } catch (error) {
    console.error("WhatsApp webhook error:", error);
    return new NextResponse("Internal error", { status: 500 });
  }
}


