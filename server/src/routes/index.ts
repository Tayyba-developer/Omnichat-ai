/**
 * routes/index.ts
 * ---------------------------------------------------------------------------
 * API router aggregation. Mounts all route groups and a health probe.
 */

import { Router } from "express";
import { dashboardRouter } from "./dashboard.routes";
import { whatsappRouter } from "./whatsapp.routes";
import { storeRouter } from "./store.routes";

export const apiRouter = Router();

// Health probe (used by load balancers / deploy checks).
apiRouter.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", uptime: process.uptime() });
});

// API index — helps with debugging instead of a bare 404.
apiRouter.get("/", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "omnichat-backend",
    endpoints: [
      "GET  /api/health",
      "GET  /api/dashboard/stats",
      "GET  /api/dashboard/conversations?limit=&search=",
      "GET  /api/dashboard/conversation/:id",
      "GET  /api/webhook (verify)",
      "POST /api/webhook (inbound)",
      "POST /api/webhook/send",
      "POST /api/store/connect",
      "GET  /api/store/connections",
    ],
  });
});

// Dashboard endpoints (Overview stats + Inbox conversations).
apiRouter.use("/dashboard", dashboardRouter);

// WhatsApp webhook + send.
apiRouter.use("/", whatsappRouter);

// Store connections.
apiRouter.use("/", storeRouter);
