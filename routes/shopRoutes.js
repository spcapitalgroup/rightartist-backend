const express = require("express");
const router = express.Router();
const { Op } = require("sequelize");

module.exports = () => {
  // GET /api/shops/bookings - Fetch all scheduled bookings for the shop
  router.get("/bookings", async (req, res) => {
    console.log("🔍 Entering /api/shops/bookings endpoint");

    const { Post, User } = req.app.get("db");

    try {
      if (!req.user || !req.user.id) {
        console.error("❌ No authenticated user in request");
        return res.status(401).json({ message: "Access Denied. No user data." });
      }

      if (req.user.userType !== "shop") {
        console.error("❌ Unauthorized access - UserType:", req.user.userType);
        return res.status(403).json({ message: "Only Shop Pros can access this endpoint" });
      }

      const bookings = await Post.findAll({
        where: {
          feedType: "booking",
          shopId: req.user.id,
          status: "scheduled",
        },
        include: [
          { model: User, as: "user", attributes: ["id", "username"] },
          { model: User, as: "shop", attributes: ["id", "username"] },
        ],
      });

      console.log("✅ Fetched scheduled bookings:", bookings.length);
      res.json({ bookings });
    } catch (error) {
      console.error("❌ Fetch Bookings Error:", error.message);
      res.status(500).json({ message: "Server error", error: error.message });
    }
  });

  // GET /api/shops/deposits - Fetch deposit stats for the current month
  router.get("/deposits", async (req, res) => {
    console.log("🔍 Entering /api/shops/deposits endpoint");

    const { Post } = req.app.get("db");

    try {
      if (!req.user || !req.user.id) {
        console.error("❌ No authenticated user in request");
        return res.status(401).json({ message: "Access Denied. No user data." });
      }

      if (req.user.userType !== "shop") {
        console.error("❌ Unauthorized access - UserType:", req.user.userType);
        return res.status(403).json({ message: "Only Shop Pros can access this endpoint" });
      }

      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const endOfMonth = new Date();
      endOfMonth.setMonth(endOfMonth.getMonth() + 1);
      endOfMonth.setDate(0);
      endOfMonth.setHours(23, 59, 59, 999);

      const bookings = await Post.findAll({
        where: {
          feedType: "booking",
          shopId: req.user.id,
          status: "scheduled",
          createdAt: {
            [Op.between]: [startOfMonth, endOfMonth],
          },
        },
      });

      const stats = {
        totalDepositAmount: 0,
        paidDeposits: 0,
        pendingDeposits: 0,
        bookings: bookings.map((booking) => ({
          id: booking.id,
          title: booking.title,
          depositAmount: booking.depositAmount || 0,
          depositStatus: booking.depositStatus || "pending",
        })),
      };

      bookings.forEach((booking) => {
        const depositAmount = booking.depositAmount || 0;
        stats.totalDepositAmount += depositAmount;
        if (booking.depositStatus === "paid") {
          stats.paidDeposits += 1;
        } else {
          stats.pendingDeposits += 1;
        }
      });

      console.log("✅ Fetched deposit stats:", stats);
      res.json(stats);
    } catch (error) {
      console.error("❌ Fetch Deposits Error:", error.message);
      res.status(500).json({ message: "Server error", error: error.message });
    }
  });

  return router;
};