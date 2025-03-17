const express = require("express");
const router = express.Router();

// Overlay routes removed
router.get("/", (req, res) => {
  res.status(404).json({ message: "Overlay functionality has been removed" });
});

module.exports = router;