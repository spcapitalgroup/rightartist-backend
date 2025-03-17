const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage });

router.post("/upload", upload.single("image"), async (req, res) => {
  const { User } = req.app.get("db");
  try {
    if (!req.file) return res.status(400).json({ message: "Image required" });

    const user = await User.findByPk(req.user.id);
    const imageUrl = `/uploads/${req.file.filename}`;
    user.portfolio = [...user.portfolio, imageUrl];
    await user.save();

    console.log("✅ Portfolio image uploaded for:", req.user.id);
    res.status(201).json({ message: "Image uploaded", imageUrl });
  } catch (error) {
    console.error("❌ Portfolio Upload Error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/", async (req, res) => {
  const { User } = req.app.get("db");
  try {
    const user = await User.findByPk(req.user.id);
    res.json({ portfolio: user.portfolio });
  } catch (error) {
    console.error("❌ Portfolio Fetch Error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;