/**
 * index.ts
 * ---------------------------------------------------------------------------
 * Server entry point. Creates the Express app and binds to the PORT
 * from the environment (default 5000 — see config.ts).
 */

import http from "node:http";
import { createApp } from "./app";
import { config } from "./config";

const app = createApp();
const server = http.createServer(app);

server.listen(config.PORT, () => {
  console.info(`OmniChat AI backend listening on http://localhost:${config.PORT}`);
  console.info(`Health check -> http://localhost:${config.PORT}/api/health`);
});

// ---- Graceful shutdown ----
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`[shutdown] received ${signal}, closing gracefully`);
  server.close(() => {
    console.info("[shutdown] http server closed");
    process.exit(0);
  });
  // Force-exit if graceful close hangs.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
