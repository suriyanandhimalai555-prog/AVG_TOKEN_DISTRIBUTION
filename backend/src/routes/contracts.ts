import { Router, Request, Response } from "express";
import path from "path";
import fs from "fs";
import { getScriptsDir } from "../lib/runner";
import { requireAuth } from "../middleware/requireAuth";
import { requirePlan } from "../middleware/requirePlan";

const router = Router();

/**
 * GET /api/contracts/multisender-artifact
 *
 * Serves the compiled MultiSender ABI + bytecode so a browser wallet can
 * deploy the contract CLIENT-SIDE (wallet signs the deploy tx; the backend
 * never sees a private key). Public data only — ABI and bytecode carry no
 * secrets.
 */
router.get(
  "/multisender-artifact",
  requireAuth,
  requirePlan,
  (_req: Request, res: Response) => {
    try {
      // Artifacts live under the backend root (hardhat default layout);
      // getScriptsDir gives the backend root both in dev and in the Docker image.
      const artifactPath = path.join(
        getScriptsDir(),
        "artifacts",
        "contracts",
        "MultiSender.sol",
        "MultiSender.json"
      );

      if (!fs.existsSync(artifactPath)) {
        return res.status(503).json({
          error:
            "MultiSender artifact not compiled yet. Run `npx hardhat compile` in backend/ first.",
        });
      }

      const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8")) as {
        abi: unknown;
        bytecode: string;
      };

      if (!artifact.abi || typeof artifact.bytecode !== "string") {
        return res.status(500).json({ error: "Malformed artifact" });
      }

      return res.json({
        contractName: "MultiSender",
        abi: artifact.abi,
        bytecode: artifact.bytecode,
      });
    } catch (err) {
      console.error("[contracts artifact]", err);
      return res.status(500).json({ error: "Failed to load artifact" });
    }
  }
);

export default router;
