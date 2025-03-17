const express = require("express");
const router = express.Router();

router.get("/stats", async (req, res) => {
  const { User, Post, Payment } = req.app.get("db");
  try {
    if (!req.user || !req.user.isAdmin) {
      return res.status(403).json({ message: "Admins only" });
    }

    const totalUsers = await User.count();
    const totalPosts = await Post.count();
    const totalRevenue = await Payment.sum("amount", { where: { status: "completed" } });

    console.log("✅ Admin stats fetched");
    res.json({ totalUsers, totalPosts, totalRevenue: totalRevenue || 0 });
  } catch (error) {
    console.error("❌ Admin Stats Error:", error.message);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;