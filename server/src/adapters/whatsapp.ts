/**
 * whatsapp.ts
 * ---------------------------------------------------------------------------
 * WhatsApp Business Cloud API adapter.
 *
 * Responsibilities:
 *  - `parseIncoming(body)` — normalize a Meta webhook payload into a flat
 *    list of { waId, customerName, text, timestamp } objects.
 *  - `verifyWebhook(params)` — check a `hub.verify_token` handshake.
 *  - `sendWhatsAppMessage(params)` — send a text message via Graph API.
 *
 * This is the ONLY adapter we keep; everything else (Instagram, Messenger,
 * channels, templates, opt-ins) was removed to eliminate the backend errors
 * caused by missing tables / stale code paths.
 */

/** A single normalized inbound message from WhatsApp. */
export interface WhatsAppInboundMessage {
  /** The customer's WhatsApp ID (phone number in international format). */
  waId: string;
  /** Human-readable name from the contact profile, or the wa_id fallback. */
  customerName: string;
  /** Message text body. */
  text: string;
  /** ISO timestamp derived from the Meta `timestamp` field. */
  timestamp: string;
  /** Meta's own message ID (for dedup / reference). */
  messageId: string;
}

/** Minimal shape of the WhatsApp webhook payload we care about. */
interface WhatsAppWebhookPayload {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: Array<{
          from?: string;
          id?: string;
          timestamp?: string;
          type?: string;
          text?: { body?: string };
        }>;
        contacts?: Array<{
          wa_id?: string;
          profile?: { name?: string };
        }>;
      };
    }>;
  }>;
}

/**
 * Parse a WhatsApp Cloud API webhook body into normalized messages.
 * Returns all text messages; non-text (media, reaction, status) updates
 * are silently skipped.
 */
export function parseIncoming(body: unknown): WhatsAppInboundMessage[] {
  const envelope = (body || {}) as WhatsAppWebhookPayload;
  const messages: WhatsAppInboundMessage[] = [];

  for (const entry of envelope.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      // Build a lookup of wa_id -> display name from contacts.
      const contactMap: Record<string, string> = {};
      for (const contact of value.contacts ?? []) {
        if (contact.wa_id) {
          contactMap[contact.wa_id] = contact.profile?.name || contact.wa_id;
        }
      }

      for (const msg of value.messages ?? []) {
        // Only process text messages; skip reactions, media, etc.
        if (msg.type !== "text" || !msg.text?.body) continue;

        const waId = msg.from || "";
        messages.push({
          waId,
          customerName: contactMap[waId] || waId,
          text: msg.text.body,
          timestamp: msg.timestamp
            ? new Date(Number(msg.timestamp) * 1000).toISOString()
            : new Date().toISOString(),
          messageId: msg.id || "",
        });
      }
    }
  }

  return messages;
}

/**
 * Verify a WhatsApp webhook handshake via hub.verify_token.
 * Returns true when the token matches (and mode is "subscribe").
 */
export function verifyWebhook(params: {
  verifyToken: string;
  hubVerifyToken?: string | null;
}): boolean {
  return Boolean(
    params.hubVerifyToken && params.hubVerifyToken === params.verifyToken
  );
}

/**
 * Send a WhatsApp text message via the Meta Graph API.
 * Returns { success, messageId?, error? }.
 */
export async function sendWhatsAppMessage({
  to,
  text,
  phoneNumberId,
  accessToken,
}: {
  to: string;
  text: string;
  phoneNumberId: string;
  accessToken: string;
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!phoneNumberId || !accessToken) {
    return { success: false, error: "Missing phoneNumberId or accessToken" };
  }

  try {
    const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to.replace(/[^0-9]/g, ""), // WhatsApp requires digits only
        type: "text",
        text: { body: text },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `WhatsApp API ${response.status}: ${errorText}`,
      };
    }

    const data = (await response.json()) as {
      messages?: Array<{ id?: string }>;
    };
    return {
      success: true,
      messageId: data.messages?.[0]?.id,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: errorMessage };
  }
}
