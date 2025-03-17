const express = require("express");
const router = express.Router();

router.post("/subscribe", async (req, res) => {
  const { Payment } = req.app.get("db");
  try {
    const { userType } = req.user;
    if (!["shop", "elite"].includes(userType)) {
      return res.status(403).json({ message: "Only shops can subscribe" });
    }

    const amount = userType === "shop" ? 24.99 : 50.00; // Mock HarlowPayments
    const payment = await Payment.create({
      userId: req.user.id,
      amount,
      type: "subscription",
      status: "completed",
    });

    console.log("✅ Subscription processed for:", req.user.id, "Amount:", amount);
    res.status(201).json({ message: "Subscription successful", payment });
  } catch (error) {
    console.error("❌ Subscription Error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/design", async (req, res) => {
  const { Payment } = req.app.get("db");
  try {
    const { designId, amount } = req.body;
    if (!designId || !amount || amount < 30 || amount > 50) {
      return res.status(400).json({ message: "Design ID and amount (30-50) required" });
    }

    const payment = await Payment.create({
      userId: req.user.id,
      amount,
      type: "design",
      status: "completed",
    });

    console.log("✅ Design purchase for:", req.user.id, "Amount:", amount);
    res.status(201).json({ message: "Design purchased", payment });
  } catch (error) {
    console.error("❌ Design Payment Error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;