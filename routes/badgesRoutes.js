const express = require("express");
const router = express.Router();

router.get("/", async (req, res) => {
  const { Badge, Payment } = req.app.get("db");
  try {
    const badges = await Badge.findAll({ where: { userId: req.user.id } });

    const designPayments = await Payment.count({
      where: { userId: req.user.id, type: "design", status: "completed" },
    });
    if (designPayments >= 10 && !badges.some(b => b.name === "Top Designer")) {
      await Badge.create({ userId: req.user.id, name: "Top Designer" });
      badges.push({ name: "Top Designer" });
    }

    console.log("✅ Badges fetched for:", req.user.id);
    res.json({ message: "Badges fetched", data: badges });
  } catch (error) {
    console.error("❌ Badges Fetch Error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;