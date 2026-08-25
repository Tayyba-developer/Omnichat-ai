/**
 * whatsapp.routes.ts
 * ---------------------------------------------------------------------------
 * WhatsApp Cloud API webhook endpoint.
 *
 *   GET  /api/webhook       - verification handshake (hub.verify_token)
 *   POST /api/webhook       - incoming message ingestion
 *
 * Uses the service-role Supabase client so ingestion bypasses RLS.
 */

import { Router, Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../lib/supabase";
import { config } from "../config";
import { parseIncoming, verifyWebhook, sendWhatsAppMessage } from "../adapters/whatsapp";

export const whatsappRouter = Router();

// ---- GET: Webhook verification (Meta subscribes) ----
whatsappRouter.get("/webhook", (req: Request, res: Response) => {
  const challenge = req.query["hub.challenge"];
  const mode = req.query["hub.mode"];
  const verifyToken = req.query["hub.verify_token"];

  if (
    mode === "subscribe" &&
    verifyWebhook({
      verifyToken: config.WHATSAPP_VERIFY_TOKEN,
      hubVerifyToken: verifyToken as string | undefined,
    })
  ) {
    console.info("[whatsapp] webhook verified");
    res.status(200).send(challenge as string);
    return;
  }

  console.warn("[whatsapp] webhook verification failed");
  res.status(403).json({ error: "verification_failed" });
});

// ---- POST: Incoming message webhook ----
whatsappRouter.post(
  "/webhook",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const messages = parseIncoming(req.body);

      if (messages.length === 0) {
        res.status(200).json({ received: true, message: "no_text_messages" });
        return;
      }

      // Upsert conversation + insert messages in a single batch (no N+1).
      const waIds = Array.from(new Set(messages.map((m) => m.waId)));

      // 1) Fetch existing conversations for these wa_ids in one query.
      const { data: existingConvs, error: convErr } = await supabaseAdmin
        .from("conversations")
        .select("wa_id, id")
        .in("wa_id", waIds);
      if (convErr) throw convErr;

      const existingMap = new Map((existingConvs ?? []).map((c) => [c.wa_id, c.id]));

      // 2) Insert conversations that don't exist yet.
      const newConversations = waIds
        .filter((waId) => !existingMap.has(waId))
        .map((waId) => ({
          wa_id: waId,
          name: messages.find((m) => m.waId === waId)?.customerName ?? waId,
          status: "open" as const,
          last_message: messages.find((m) => m.waId === waId)?.text ?? null,
        }));

      if (newConversations.length > 0) {
        const { error: insertErr } = await supabaseAdmin.from("conversations").insert(newConversations);
        if (insertErr) throw insertErr;
      }

      // 3) Re-fetch conversation IDs (includes newly inserted rows).
      const { data: allConvs, error: refetchErr } = await supabaseAdmin
        .from("conversations")
        .select("wa_id, id")
        .in("wa_id", waIds);
      if (refetchErr) throw refetchErr;

      const convIdMap = new Map((allConvs ?? []).map((c) => [c.wa_id, c.id]));

      // 4) Batch-insert all messages.
      const messageInserts = messages.map((m) => ({
        conversation_id: convIdMap.get(m.waId)!,
        wa_id: m.waId,
        direction: "inbound" as const,
        text: m.text,
        timestamp: m.timestamp,
        provider_message_id: m.messageId,
        status: "received" as const,
      }));

      if (messageInserts.length > 0) {
        const { error: msgErr } = await supabaseAdmin.from("messages").insert(messageInserts);
        if (msgErr) throw msgErr;
      }

      // 5) Update each conversation's last_message + updated_at in parallel.
      await Promise.all(
        waIds.map((waId) => {
          const convId = convIdMap.get(waId);
          if (!convId) return Promise.resolve();
          const incoming = messages.find((m) => m.waId === waId);
          return supabaseAdmin
            .from("conversations")
            .update({
              last_message: incoming?.text ?? null,
              updated_at: incoming?.timestamp ?? new Date().toISOString(),
            })
            .eq("id", convId)
            .then(() => undefined);
        })
      );

      res.status(200).json({
        received: true,
        conversations: waIds.length,
        messages: messages.length,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---- POST: Send a WhatsApp message out ----
whatsappRouter.post(
  "/webhook/send",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { to, text, phoneNumberId } = req.body;
      if (!to || !text) {
        res.status(400).json({ error: "missing_to_or_text" });
        return;
      }

      const result = await sendWhatsAppMessage({
        to,
        text,
        phoneNumberId: phoneNumberId || config.WHATSAPP_PHONE_NUMBER_ID,
        accessToken: config.WHATSAPP_TOKEN,
      });

      if (!result.success) {
        res.status(502).json({ error: "send_failed", detail: result.error });
        return;
      }

      // Log the outbound message.
      await supabaseAdmin.from("messages").insert({
        wa_id: to,
        direction: "outbound" as const,
        text,
        status: "sent" as const,
      });

      res.status(200).json({ sent: true, messageId: result.messageId });
    } catch (err) {
      next(err);
    }
  }
);
