import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { Session } from "../models/Session";
import { Batch } from "../models/Batch";
import { Wallet } from "../models/Wallet";
import { runDistribute, killProcess, getScriptsDir, isRunning } from "../lib/runner";
import { requireAuth } from "../middleware/requireAuth";
import { requirePlan } from "../middleware/requirePlan";
import { recordSessionAudit } from "../lib/sessionAudit";

const router = Router();

async function syncWalletStatusFromPlan(
  sessionId: string,
  fallbackFailureReason: string
): Promise<{ sentCount: number; failedCount: number }> {
  const planPath = path.join(getScriptsDir(), "output", "distribution-plan.json");
  if (!fs.existsSync(planPath)) {
    await Wallet.markUnsentFailed(sessionId, fallbackFailureReason);
    const [sentCount, failedCount] = await Promise.all([
      Wallet.count(sessionId, { sent: true }),
      Wallet.count(sessionId, { sent: false }),
    ]);
    return { sentCount, failedCount };
  }

  const plan = JSON.parse(fs.readFileSync(planPath, "utf8")) as Array<{
    index: number;
    sent: boolean;
    txHash: string | null;
    timestamp: string | null;
  }>;

  const sentEntries = plan.filter((e) => e.sent);
  if (sentEntries.length > 0) {
    await Wallet.markSent(
      sessionId,
      sentEntries.map((e) => ({
        index: e.index,
        txHash: e.txHash ?? null,
        timestamp: e.timestamp ? new Date(e.timestamp) : new Date(),
      }))
    );
  }

  await Wallet.markUnsentFailed(sessionId, fallbackFailureReason);

  const [sentCount, failedCount] = await Promise.all([
    Wallet.count(sessionId, { sent: true }),
    Wallet.count(sessionId, { sent: false }),
  ]);
  return { sentCount, failedCount };
}

// POST /api/distribute — spawn distribute.ts
router.post("/", requireAuth, requirePlan, async (req: Request, res: Response) => {
  try {
    const { sessionId, privateKey, delayMode } = req.body as {
      sessionId: string;
      privateKey: string;
      delayMode?: boolean;
    };
    if (!sessionId) return res.status(400).json({ error: "sessionId is required" });
    if (!privateKey) return res.status(400).json({ error: "privateKey is required" });

    const session = await Session.findById(sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });

    if (!session.userId || session.userId.toString() !== req.user!._id.toString()) {
      return res.status(404).json({ error: "Session not found" });
    }

    if (isRunning(sessionId)) {
      return res.status(409).json({ error: "Distribution already running for this session" });
    }

    await Session.update(sessionId, {
      status: "distributing",
      startedAt: new Date(),
    });
    await recordSessionAudit({
      userId: req.user!._id,
      sessionId,
      action: "DISTRIBUTE_STARTED",
      message: "Distribution started",
      details: { network: session.network, totalWallets: session.totalWallets },
    });

    const selectedRpc =
      session.network === "bscTestnet"
        ? (process.env.BSC_TESTNET_RPC_URL || process.env.ALCHEMY_RPC_URL || "")
        : (process.env.ALCHEMY_RPC_URL || "");
    console.log(`[network] session=${sessionId} network=${session.network} rpc=${selectedRpc}`);

    runDistribute(
      sessionId,
      {
        privateKey,
        tokenAddress: session.tokenAddress,
        multisenderAddress: session.multisenderAddress,
        totalWallets: session.totalWallets,
        rpcUrl:
          session.network === "bscTestnet"
            ? (process.env.BSC_TESTNET_RPC_URL || process.env.ALCHEMY_RPC_URL)
            : process.env.ALCHEMY_RPC_URL,
        fallbackRpc1:
          session.network === "bscTestnet"
            ? (process.env.BSC_TESTNET_FALLBACK_RPC_1 || "https://data-seed-prebsc-1-s1.binance.org:8545")
            : process.env.FALLBACK_RPC_1,
        fallbackRpc2:
          session.network === "bscTestnet"
            ? (process.env.BSC_TESTNET_FALLBACK_RPC_2 || "https://data-seed-prebsc-2-s1.binance.org:8545")
            : process.env.FALLBACK_RPC_2,
        delayMode: delayMode === true,
      },
      async (batchIndex, _totalBatches, walletCount, txHash, gasUsed) => {
        await Batch.upsertConfirmed({
          sessionId,
          batchIndex,
          walletCount,
          txHash,
          gasUsed,
        });
      },
      async (sentCount, failedCount) => {
        await Session.update(sessionId, { sentCount, failedCount });
      },
      async (bnbSpent) => {
        try {
          const counts = await syncWalletStatusFromPlan(
            sessionId,
            "Failed to send (insufficient gas/BNB or batch failure)"
          );
          await Session.update(sessionId, {
            status: "done",
            completedAt: new Date(),
            bnbSpent,
            sentCount: counts.sentCount,
            failedCount: counts.failedCount,
          });
          await recordSessionAudit({
            userId: req.user!._id,
            sessionId,
            action: "DISTRIBUTE_COMPLETED",
            message: "Distribution completed",
            details: {
              bnbSpent,
              sentCount: counts.sentCount,
              failedCount: counts.failedCount,
            },
          });
        } catch (syncErr) {
          console.error("[distribute] wallet sync error:", syncErr);
        }
      },
      async (err) => {
        console.error("[distribute] error:", err);
        try {
          const counts = await syncWalletStatusFromPlan(
            sessionId,
            `Failed to send (${String(err || "distribution error")})`
          );
          await Session.update(sessionId, {
            status: "error",
            completedAt: new Date(),
            sentCount: counts.sentCount,
            failedCount: counts.failedCount,
          });
          await recordSessionAudit({
            userId: req.user!._id,
            sessionId,
            action: "DISTRIBUTE_FAILED",
            message: "Distribution failed",
            details: {
              error: String(err || "distribution error"),
              sentCount: counts.sentCount,
              failedCount: counts.failedCount,
            },
          });
        } catch (syncErr) {
          console.error("[distribute] error-sync failed:", syncErr);
          await Session.update(sessionId, { status: "error" });
        }
      }
    );

    return res.json({ status: "started", sessionId });
  } catch (err) {
    console.error("[distribute POST]", err);
    return res.status(500).json({ error: "Failed to start distribution" });
  }
});

// DELETE /api/distribute — kill running process
router.delete("/", requireAuth, requirePlan, async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.body as { sessionId: string };
    if (!sessionId) return res.status(400).json({ error: "sessionId is required" });

    const sess = await Session.findById(sessionId);
    if (!sess || !sess.userId || sess.userId.toString() !== req.user!._id.toString()) {
      return res.status(404).json({ error: "Session not found" });
    }

    const killed = killProcess(sessionId);
    const counts = await syncWalletStatusFromPlan(sessionId, "Stopped by user");
    await Session.update(sessionId, {
      status: "stopped",
      completedAt: new Date(),
      sentCount: counts.sentCount,
      failedCount: counts.failedCount,
    });
    await recordSessionAudit({
      userId: req.user!._id,
      sessionId,
      action: "DISTRIBUTE_STOPPED",
      message: "Distribution stopped by user",
      details: { killed, sentCount: counts.sentCount, failedCount: counts.failedCount },
    });

    return res.json({ status: "stopped", killed });
  } catch (err) {
    console.error("[distribute DELETE]", err);
    return res.status(500).json({ error: "Failed to stop distribution" });
  }
});

export default router;
