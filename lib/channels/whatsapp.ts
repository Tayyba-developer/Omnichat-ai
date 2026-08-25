/**
 * Send a WhatsApp message via Meta's Graph API v20.0
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
}): Promise<{
  success: boolean;
  messageId?: string;
  error?: string;
}> {
  if (!phoneNumberId || !accessToken) {
    return {
      success: false,
      error: "Missing phoneNumberId or accessToken",
    };
  }

  try {
    const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;

    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: to.replace(/[^0-9]/g, ""), // Strip to numbers only
      type: "text",
      text: {
        body: text,
      },
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("WhatsApp API error:", error);
      return {
        success: false,
        error: `WhatsApp API error: ${response.status} ${error}`,
      };
    }

    const data = (await response.json()) as { messages?: Array<{ id: string }> };
    const messageId = data.messages?.[0]?.id;

    return {
      success: true,
      messageId,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("WhatsApp send error:", errorMessage);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Parse a WhatsApp Cloud API webhook payload
 */
export function parseWhatsAppWebhook(body: {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: Array<{
          from: string;
          id: string;
          timestamp: string;
          text?: { body: string };
          type: string;
        }>;
        contacts?: Array<{ profile?: { name: string }; wa_id: string }>;
      };
    }>;
  }>;
}): Array<{
  from: string;
  waMessageId: string;
  text: string;
  customerName: string;
  timestamp: string;
}> {
  const messages: Array<{
    from: string;
    waMessageId: string;
    text: string;
    customerName: string;
    timestamp: string;
  }> = [];

  if (!body.entry) return messages;

  for (const entry of body.entry) {
    if (!entry.changes) continue;

    for (const change of entry.changes) {
      const value = change.value;
      if (!value) continue;

      const msgs = value.messages || [];
      const contacts = value.contacts || [];

      const contactMap: Record<string, string> = {};
      for (const contact of contacts) {
        if (contact.wa_id) {
          contactMap[contact.wa_id] = contact.profile?.name || contact.wa_id;
        }
      }

      for (const msg of msgs) {
        if (msg.type === "text" && msg.text?.body) {
          messages.push({
            from: msg.from,
            waMessageId: msg.id,
            text: msg.text.body,
            customerName: contactMap[msg.from] || msg.from,
            timestamp: new Date(Number(msg.timestamp) * 1000).toISOString(),
          });
        }
      }
    }
  }

  return messages;
}
