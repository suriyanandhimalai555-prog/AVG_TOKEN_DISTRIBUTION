import { Router } from "express";
import { requireAdmin } from "../middleware/requireAdmin";
import { User } from "../models/User";
import { Subscription } from "../models/Subscription";
import { Payment } from "../models/Payment";

const router = Router();
router.use(requireAdmin);

router.get("/stats", async (_req, res) => {
  try {
    const startOfUtcDay = new Date();
    startOfUtcDay.setUTCHours(0, 0, 0, 0);

    const [
      totalUsers,
      activeSubscriptions,
      revenueUSD,
      tokenHolderCount,
      dexCount,
      paymentsToday,
    ] = await Promise.all([
      User.countDocuments(),
      Subscription.countDocuments({ status: "ACTIVE" }),
      Payment.sumConfirmedRevenue(),
      Subscription.countDocuments({ status: "ACTIVE", productLine: "TOKEN_HOLDER" }),
      Subscription.countDocuments({ status: "ACTIVE", productLine: "DEX_AUTOMATION" }),
      Payment.countDocuments({ createdAtGte: startOfUtcDay }),
    ]);

    return res.json({
      totalUsers,
      activeSubscriptions,
      revenueUSD,
      tokenHolderCount,
      dexCount,
      paymentsToday,
    });
  } catch (err) {
    console.error("[admin stats]", err);
    return res.status(500).json({ error: "Failed to load stats" });
  }
});

router.get("/users", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10) || 20));
    const skip = (page - 1) * limit;
    const search = String(req.query.search ?? "").trim();

    const filter = search ? { email: { $regex: search, $options: "i" } } : {};

    const [users, total] = await Promise.all([
      User.find(filter),
      User.countDocuments(filter),
    ]);

    const pagedUsers = users.slice(skip, skip + limit);
    const ids = pagedUsers.map((u) => u._id);
    const subs = await Subscription.find({ userId: { $in: ids } });
    const subByUser = new Map(subs.map((s) => [s.userId, s]));

    const out = pagedUsers.map((u) => ({
      ...u,
      subscription: subByUser.get(u._id) ?? null,
    }));

    return res.json({ users: out, total, page, limit });
  } catch (err) {
    console.error("[admin users]", err);
    return res.status(500).json({ error: "Failed to list users" });
  }
});

router.patch("/users/:id", async (req, res) => {
  try {
    const { role, subscriptionStatus } = req.body as {
      role?: "USER" | "ADMIN";
      subscriptionStatus?: string;
    };
    const id = req.params.id;

    if (role === "USER" || role === "ADMIN") {
      if (role === "USER" && req.user!.role === "ADMIN" && id === req.user!._id) {
        return res.status(400).json({ error: "You cannot revoke your own ADMIN role via this endpoint" });
      }
      await User.findByIdAndUpdate(id, { role });
    }

    if (
      subscriptionStatus &&
      ["ACTIVE", "EXPIRED", "CANCELLED", "PENDING"].includes(subscriptionStatus)
    ) {
      await Subscription.findOneAndUpdate(
        { userId: id },
        { status: subscriptionStatus as "ACTIVE" | "EXPIRED" | "CANCELLED" | "PENDING" }
      );
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("[admin patch user]", err);
    return res.status(500).json({ error: "Failed to update user" });
  }
});

router.get("/payments", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10) || 20));
    const skip = (page - 1) * limit;
    const status = String(req.query.status ?? "");

    const match: { status?: string } = {};
    if (status && status !== "ALL") {
      match.status = status;
    }

    const [payments, total] = await Promise.all([
      Payment.findWithUsers(match, { limit, offset: skip }),
      Payment.countDocuments(match),
    ]);

    return res.json({ payments, total, page, limit });
  } catch (err) {
    console.error("[admin payments]", err);
    return res.status(500).json({ error: "Failed to list payments" });
  }
});

export default router;
