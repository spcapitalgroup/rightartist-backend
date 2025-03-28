// paymentRoutes.js
const express = require("express");
const router = express.Router();
const axios = require("axios");

router.post("/subscribe", async (req, res) => {
  const { Payment } = req.app.get("db");
  try {
    const { userType } = req.user;
    if (!["shop", "elite"].includes(userType)) {
      return res.status(403).json({ message: "Only shops can subscribe" });
    }

    const { cardToken } = req.body;
    if (!cardToken) {
      return res.status(400).json({ message: "Card token required" });
    }

    const amount = userType === "shop" ? 24.99 : 50.00;
    const amountInCents = Math.round(amount * 100); // Convert to cents (e.g., $24.99 -> 2499)

    // TransactAPI request to process payment
    const transactResponse = await axios.post(
      "https://payment.ipospays.tech/api/v1/iposTransact",
      {
        merchantAuthentication: {
          merchantId: process.env.SPIN_TPN,
          transactionReferenceId: `sub-${req.user.id}-${Date.now()}`,
        },
        transactionRequest: {
          transactionType: 1, // Sale
          amount: amountInCents.toString(),
          cardToken: cardToken,
          applySteamSettingTipFeeTax: false,
        },
        preferences: {
          eReceipt: false,
        },
        Avs: {
          StreetNo: "",
          Zip: "",
        },
      },
      {
        headers: {
          token: process.env.HARLOW_TOKEN,
          "Content-Type": "application/json",
        },
      }
    );

    const { iposTransactResponse } = transactResponse.data;
    if (iposTransactResponse.responseCode !== "200") {
      return res.status(400).json({ message: iposTransactResponse.responseMessage || "Payment declined" });
    }

    // Store payment in database
    const payment = await Payment.create({
      userId: req.user.id,
      amount,
      type: "subscription",
      status: "completed",
      transactionId: iposTransactResponse.transactionId,
      rrn: iposTransactResponse.RRN,
    });

    console.log("✅ Subscription processed for:", req.user.id, "Amount:", amount);
    res.status(201).json({ message: "Subscription successful", payment });
  } catch (error) {
    console.error("❌ Subscription Error:", error.message);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

router.post("/design", async (req, res) => {
  const { Payment } = req.app.get("db");
  try {
    const { designId, amount, cardToken } = req.body;
    if (!designId || !amount || amount < 30 || amount > 50) {
      return res.status(400).json({ message: "Design ID and amount (30-50) required" });
    }
    if (!cardToken) {
      return res.status(400).json({ message: "Card token required" });
    }

    const amountInCents = Math.round(amount * 100); // Convert to cents

    // TransactAPI request to process payment
    const transactResponse = await axios.post(
      "https://payment.ipospays.tech/api/v1/iposTransact",
      {
        merchantAuthentication: {
          merchantId: process.env.SPIN_TPN,
          transactionReferenceId: `design-${req.user.id}-${Date.now()}`,
        },
        transactionRequest: {
          transactionType: 1, // Sale
          amount: amountInCents.toString(),
          cardToken: cardToken,
          applySteamSettingTipFeeTax: false,
        },
        preferences: {
          eReceipt: false,
        },
        Avs: {
          StreetNo: "",
          Zip: "",
        },
      },
      {
        headers: {
          token: process.env.HARLOW_TOKEN,
          "Content-Type": "application/json",
        },
      }
    );

    const { iposTransactResponse } = transactResponse.data;
    if (iposTransactResponse.responseCode !== "200") {
      return res.status(400).json({ message: iposTransactResponse.responseMessage || "Payment declined" });
    }

    // Store payment in database
    const payment = await Payment.create({
      userId: req.user.id,
      amount,
      type: "design",
      status: "completed",
      transactionId: iposTransactResponse.transactionId,
      rrn: iposTransactResponse.RRN,
    });

    console.log("✅ Design purchase for:", req.user.id, "Amount:", amount);
    res.status(201).json({ message: "Design purchased", payment });
  } catch (error) {
    console.error("❌ Design Payment Error:", error.message);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;