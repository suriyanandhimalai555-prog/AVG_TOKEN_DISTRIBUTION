import "dotenv/config";
import express from "express";
import cors from "cors";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import passport from "./config/passport";
import { postgresPool } from "./lib/postgres";
import { closeAllSseClients } from "./lib/runner";

import sessionsRouter from "./routes/sessions";
import generateRouter from "./routes/generate";
import prepareRouter from "./routes/prepare";
import distributeRouter from "./routes/distribute";
import progressRouter from "./routes/progress";
import statusRouter from "./routes/status";
import exportRouter from "./routes/export";
import batchesRouter from "./routes/batches";
import configRouter from "./routes/config";
import deployRouter from "./routes/deploy";
import walletRouter from "./routes/wallet";
import estimateRouter from "./routes/estimate";
import authRouter from "./routes/auth";
import paymentsRouter from "./routes/payments";
import adminRouter from "./routes/admin";
import { handleCoinbaseWebhook } from "./routes/paymentsWebhook";

const app = express();
const PORT = parseInt(process.env.PORT ?? "4000", 10);

app.set("trust proxy", 1);

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  process.env.FRONTEND_URL ?? "",
  process.env.CLIENT_URL ?? "",
].filter(Boolean);

function hostMatchesAllowed(requestOrigin: string): boolean {
  try {
    const req = new URL(requestOrigin);
    const reqBase = req.hostname.replace(/^www\./i, "");

    for (const allowed of allowedOrigins) {
      const a = new URL(allowed);

      if (a.hostname.replace(/^www\./i, "") === reqBase) {
        return true;
      }
    }
  } catch {
    /* ignore malformed origin */
  }

  return false;
}

app.use(
  cors({
    origin: (origin, cb) => {
      if (
        !origin ||
        allowedOrigins.includes(origin) ||
        hostMatchesAllowed(origin)
      ) {
        return cb(null, true);
      }

      return cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  })
);

// Coinbase Commerce webhook — MUST use raw body for HMAC
// This must remain before express.json().
app.post(
  "/api/payments/webhook",
  express.raw({
    type: "application/json",
    limit: "2mb",
  }),
  (req, res, next) => {
    void handleCoinbaseWebhook(req, res).catch(next);
  }
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

const sessionSecret =
  process.env.SESSION_SECRET ?? "dev-only-change-me-SESSION_SECRET";

const isProd = process.env.NODE_ENV === "production";

class EphemeralSessionStore extends session.Store {
  private sessions = new Map<
    string,
    {
      expiresAt: number;
      data: session.SessionData;
    }
  >();

  constructor() {
    super();

    setInterval(() => this.prune(), 60_000).unref();
  }

  private prune(): void {
    const now = Date.now();

    for (const [sid, entry] of this.sessions.entries()) {
      if (entry.expiresAt <= now) {
        this.sessions.delete(sid);
      }
    }
  }

  get(
    sid: string,
    callback: (
      err?: unknown,
      session?: session.SessionData | null
    ) => void
  ): void {
    const entry = this.sessions.get(sid);

    if (!entry) {
      return callback(undefined, null);
    }

    if (entry.expiresAt <= Date.now()) {
      this.sessions.delete(sid);
      return callback(undefined, null);
    }

    callback(undefined, entry.data);
  }

  set(
    sid: string,
    sess: session.SessionData,
    callback?: (err?: unknown) => void
  ): void {
    const maxAgeMs =
      typeof sess.cookie?.maxAge === "number"
        ? sess.cookie.maxAge
        : 7 * 24 * 60 * 60 * 1000;

    this.sessions.set(sid, {
      expiresAt: Date.now() + maxAgeMs,
      data: sess,
    });

    callback?.();
  }

  destroy(
    sid: string,
    callback?: (err?: unknown) => void
  ): void {
    this.sessions.delete(sid);
    callback?.();
  }
}

function buildSessionStore(): session.Store | undefined {
  if (!postgresPool) {
    console.warn(
      "[session] DATABASE_URL missing — using EphemeralSessionStore"
    );

    return new EphemeralSessionStore();
  }

  try {
    const PgStore = connectPgSimple(session);

    const store = new PgStore({
      pool: postgresPool,
      tableName: "express_sessions",
      createTableIfMissing: false,
      ttl: 7 * 24 * 60 * 60,
      // Keep the default errorLog so store errors are logged, not thrown.
    });

    // Prevent process crash when the session store emits connection errors.
    store.on("error", (err) => {
      const msg = err instanceof Error ? err.message : String(err);

      console.error(
        `[session] PgStore error: ${msg} (continuing with degraded sessions)`
      );
    });

    return store;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    console.error(
      `[session] Failed to initialize PgStore: ${msg} (using MemoryStore)`
    );

    return undefined;
  }
}

const sessionMiddleware = session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  store: buildSessionStore(),
  cookie: {
    secure: isProd,
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: isProd ? "none" : "lax",
  },
});

app.use(sessionMiddleware as unknown as express.RequestHandler);

app.use(passport.initialize());
app.use(passport.session());

// ─── Health check ─────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

// ─── API routes ───────────────────────────────────────────────────────────────

app.use("/api/auth", authRouter);
app.use("/api/admin", adminRouter);
app.use("/api/payments", paymentsRouter);

app.use("/api/sessions", sessionsRouter);
app.use("/api/generate", generateRouter);
app.use("/api/prepare", prepareRouter);
app.use("/api/distribute", distributeRouter);
app.use("/api/progress", progressRouter);
app.use("/api/status", statusRouter);
app.use("/api/export", exportRouter);
app.use("/api/batches", batchesRouter);
app.use("/api/config", configRouter);
app.use("/api/deploy", deployRouter);
app.use("/api/wallet", walletRouter);
app.use("/api/estimate", estimateRouter);

// ─── 404 ──────────────────────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({
    error: "Route not found",
  });
});

// ─── Error handler ────────────────────────────────────────────────────────────

app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error("[server error]", err.message);

    res.status(500).json({
      error: err.message ?? "Internal server error",
    });
  }
);

// ─── Server ───────────────────────────────────────────────────────────────────

async function start(): Promise<void> {
  const server = app.listen(PORT, () => {
    console.log(
      `[server] Running on http://localhost:${PORT}`
    );
  });

  if (postgresPool) {
    postgresPool
      .query("SELECT 1")
      .then(() => console.log("[PostgreSQL] connected"))
      .catch((err: Error) => {
        console.error(
          "[PostgreSQL] Initial connect error:",
          err.message
        );
      });
  }

  // Kubernetes sends SIGTERM when replacing an old pod.
  // Stop accepting new HTTP connections and allow existing
  // requests to finish before the process exits.
  const shutdown = (signal: string): void => {
    console.log(
      `[server] ${signal} received. Starting graceful shutdown...`
    );

    server.close(() => {
      console.log("[server] HTTP server closed.");
      process.exit(0);
    });

    // SSE progress streams and idle keep-alive sockets never finish on
    // their own, so server.close() would wait for the full timeout below
    // and hold up the rollout. Clients reconnect to the new pod.
    closeAllSseClients();
    server.closeIdleConnections();

    // Maximum graceful shutdown wait for in-flight requests.
    // Kubernetes terminationGracePeriodSeconds must be >= this.
    setTimeout(() => {
      console.error(
        "[server] Graceful shutdown timeout. Forcing exit."
      );

      server.closeAllConnections();
      process.exit(1);
    }, 20_000).unref();
  };

  process.on("SIGTERM", () => {
    shutdown("SIGTERM");
  });

  process.on("SIGINT", () => {
    shutdown("SIGINT");
  });
}

start().catch((err: Error) => {
  console.error("[server] Startup error:", err);
  process.exit(1);
});
