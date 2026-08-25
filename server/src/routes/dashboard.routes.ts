/**
 * dashboard.routes.ts
 * ---------------------------------------------------------------------------
 * Read-only dashboard endpoints that the Next.js frontend (port 3000) fetches
 * directly from the backend (port 5000):
 *
 *   GET /api/dashboard/stats           — Overview stat cards
 *   GET /api/dashboard/conversations   — Inbox list (latest 50)
 *   GET /api/dashboard/conversation/:id — Single conversation + messages
 */

import { Router, Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../lib/supabase";

export const dashboardRouter = Router();

// ---- GET /api/dashboard/stats ----
// Returns the aggregate metrics shown on the Overview page.
dashboardRouter.get(
  "/stats",
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const { data: convs, error: convErr } = await supabaseAdmin
        .from("conversations")
        .select("status");

      if (convErr) throw convErr;

      const conversations = convs ?? [];

      // Counts by status (open / needs_human / closed).
      const statusCounts = conversations.reduce(
        (acc, c) => {
          const s = c.status || "open";
          acc[s] = (acc[s] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );

      // Open = status 'open' (bot handling). Waiting = status 'needs_human'.
      const open = statusCounts["open"] || 0;
      const waitingForHuman = statusCounts["needs_human"] || 0;

            // ---- Orders counts + pending payment total ----
      const { data: orders, error: orderErr } = await supabaseAdmin
        .from("orders")
                .select("id, status, total_cents, display_id, customer_name, currency");

      if (orderErr) throw orderErr;

      const orderCounts = (orders ?? []).reduce(
        (acc, o) => {
          const s = o.status || "pending";
          acc[s] = (acc[s] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );

      // Pending orders: count + dollar total.
      const pendingOrders = (orders ?? []).filter((o) => o.status === "pending");
      const pendingPayment = pendingOrders.length;
      const pendingPaymentTotalCents = pendingOrders.reduce(
        (sum, o) => sum + (o.total_cents ?? 0),
        0
      );

      // Carts at risk = abandoned orders (no separate carts table in the
      // simplified schema).
      const cartsAtRisk = orderCounts["abandoned"] || 0;

      // Needs attention = open conversations created over an hour ago
      // with no human follow-up (best-effort using created_at).
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count: needsAttentionCount, error: naErr } = await supabaseAdmin
        .from("conversations")
        .select("id", { count: "exact", head: true })
        .eq("status", "open")
        .lt("created_at", oneHourAgo);

      if (naErr) {
        console.warn("[dashboard/stats] needs_attention query failed:", naErr.message);
      }

      // ---- Agent activity (simple: count conversations by status) ----
      const agentActivity = {
        open,
        waiting: waitingForHuman,
        resolved: statusCounts["closed"] || 0,
        total: conversations.length,
      };

            res.json({
        open,
        waiting_for_human: waitingForHuman,
        pending_payment: pendingPayment,
        pending_payment_total_cents: pendingPaymentTotalCents,
        pending_orders: pendingOrders.map((o) => ({
          id: o.id,
          display_id: o.display_id,
          customer_name: o.customer_name,
          total_cents: o.total_cents,
          currency: o.currency ?? "USD",
        })),
        carts_at_risk: cartsAtRisk,
        needs_attention: needsAttentionCount || 0,
        agent_activity: agentActivity,
        orders: {
          total: orders.length,
          pending: orderCounts["pending"] || 0,
          paid: orderCounts["paid"] || 0,
          abandoned: orderCounts["abandoned"] || 0,
        },
        total_conversations: conversations.length,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---- GET /api/dashboard/conversations ----
// Paginated list of the latest 50 conversations for the Inbox.
dashboardRouter.get(
  "/conversations",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = Math.min(
        Math.max(parseInt((req.query.limit as string) ?? "50", 10), 1),
        100
      );
      const search = ((req.query.search as string) ?? "").trim();

      let query = supabaseAdmin
        .from("conversations")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .limit(limit);

      if (search) {
        query = query.or(
          `name.ilike.%${search}%,wa_id.ilike.%${search}%,last_message.ilike.%${search}%`
        );
      }

      const { data, count, error } = await query;

      if (error) throw error;

      res.json({
        conversations: data ?? [],
        total: count ?? (data?.length ?? 0),
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---- GET /api/dashboard/conversation/:id ----
// Single conversation with all its messages.
dashboardRouter.get(
  "/conversation/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { data: conv, error: convErr } = await supabaseAdmin
        .from("conversations")
        .select("*")
        .eq("id", id)
        .single();

      if (convErr) {
        if (convErr.code === "PGRST116") {
          res.status(404).json({ error: "not_found", message: "Conversation not found" });
          return;
        }
        throw convErr;
      }

      const { data: messages, error: msgErr } = await supabaseAdmin
        .from("messages")
        .select("*")
        .eq("conversation_id", id)
        .order("timestamp", { ascending: true });

      if (msgErr) throw msgErr;

      res.json({ conversation: conv, messages: messages ?? [] });
    } catch (err) {
      next(err);
    }
  }
);
