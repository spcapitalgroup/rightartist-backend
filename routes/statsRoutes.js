const express = require("express");
const router = express.Router();

router.get("/designer", async (req, res) => {
  const { Payment } = req.app.get("db");
  try {
    if (req.user.userType !== "designer") {
      return res.status(403).json({ message: "Designers only" });
    }

    const payments = await Payment.findAll({
      where: { userId: req.user.id, type: "design", status: "completed" },
    });
    const totalEarnings = payments.reduce((sum, p) => sum + (p.amount * 0.9), 0);
    const designsSold = payments.length;
    const trends = { monthly: designsSold > 5 ? "Hot Streak" : "Steady" };

    console.log("✅ Designer stats fetched for:", req.user.id);
    res.json({ message: "Stats fetched", data: { totalEarnings, designsSold, trends } });
  } catch (error) {
    console.error("❌ Designer Stats Error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/admin", async (req, res) => {
  const { User, Post, Payment } = req.app.get("db");
  try {
    if (!req.user.isAdmin) {
      return res.status(403).json({ message: "Admin access required" });
    }

    const totalUsers = await User.count();
    const totalPosts = await Post.count();
    const totalRevenue = await Payment.sum("amount", { where: { status: "completed" } }) || 0;

    console.log("✅ Admin stats fetched for:", req.user.id);
    res.json({ totalUsers, totalPosts, totalRevenue });
  } catch (error) {
    console.error("❌ Admin Stats Error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;