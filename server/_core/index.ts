import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { startRetryWorker, stopRetryWorker } from "../retryWorker";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Body limit must cover base64-encoded PDFs up to 100 MB (≈137 MB base64).
  app.use(express.json({ limit: "150mb" }));
  app.use(express.urlencoded({ limit: "150mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });

  // Retry worker is OPT-IN. Audit P0 (qc/AUDIT-RECONCILIATION-2026-07-17.md):
  // on this branch the worker is live and, combined with 1×1 thumbnails + prompt
  // regeneration on retry, can burn money on garbage. Default OFF until the
  // worker is rebuilt as render-only against persisted prompts. Set
  // RETRY_WORKER_ENABLED=true to re-enable intentionally.
  const retryWorkerEnabled = process.env.RETRY_WORKER_ENABLED === "true";
  const retryIntervalMs = parseInt(process.env.RETRY_WORKER_INTERVAL_MS || "30000");
  if (retryWorkerEnabled && process.env.NODE_ENV !== "test") {
    startRetryWorker({ maxConcurrentRetries: 3, pollIntervalMs: retryIntervalMs, enabled: true });
  } else if (process.env.NODE_ENV !== "test") {
    console.log("[RetryWorker] disabled (set RETRY_WORKER_ENABLED=true to enable)");
  }

  // Graceful shutdown
  const shutdown = () => {
    stopRetryWorker();
    server.close(() => process.exit(0));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

startServer().catch(console.error);
