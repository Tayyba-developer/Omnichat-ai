/**
 * app.ts
 * ---------------------------------------------------------------------------
 * Express application assembly. Order matters here:
 *
 *   1. Security (helmet), CORS, request logging.
 *   2. express.json() for the JSON API.
 *   3. API router (dashboard, whatsapp, store, health).
 *   4. 404 + centralized error handler.
 *
 * CORS is enabled for the frontend origin (port 3000) and the
 * backend itself (port 5000, for local curl/testing).
 */

import express, { Express } from "express";
import helmet from "helmet";
import cors from "cors";
import { corsOrigins } from "./config";
import { apiRouter } from "./routes/index";

export function createApp(): Express {
  const app = express();
  app.disable("x-powered-by");

  // ---- Security & parsing ----
  app.use(helmet());
  app.use(
    cors({
      origin: corsOrigins,
      credentials: true,
    })
  );

  // ---- JSON for the API ----
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));

  // ---- API routes ----
  app.use("/api", apiRouter);

  // ---- 404 handler ----
  // Catch-all for any route that wasn't matched above.
  app.use((_req, res) => {
    res.status(404).json({ error: "not_found", message: "Route not found" });
  });

  // ---- Centralized error handler ----
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[error]", err);
    res.status(500).json({ error: "server_error", message });
  });

  return app;
}
