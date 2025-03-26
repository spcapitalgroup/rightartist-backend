const express = require("express");
const router = express.Router();

// Get all users (admin-only)
router.get("/", async (req, res) => {
  const { User } = req.app.get("db");
  try {
    console.log("🔍 Entering /api/users endpoint");
    console.log("🔍 req.user:", req.user);
    console.log("🔍 req.user.isAdmin:", req.user?.isAdmin);
    if (!req.user || req.user.isAdmin !== true) {
      console.log("❌ Admin check failed - req.user:", req.user);
      return res.status(403).json({ message: "Admins only" });
    }

    const users = await User.findAll({
      attributes: ["id", "username", "email", "userType", "createdAt"],
    });

    console.log("✅ Users fetched for admin:", req.user.id);
    res.json({ users });
  } catch (error) {
    console.error("❌ Fetch Users Error:", error.message);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Delete a user (admin-only)
router.delete("/:id", async (req, res) => {
  const { User } = req.app.get("db");
  const { id } = req.params;
  try {
    console.log("🔍 Entering /api/users/:id DELETE endpoint");
    console.log("🔍 req.user:", req.user);
    console.log("🔍 req.user.isAdmin:", req.user?.isAdmin);
    if (!req.user || req.user.isAdmin !== true) {
      console.log("❌ Admin check failed - req.user:", req.user);
      return res.status(403).json({ message: "Admins only" });
    }

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    await user.destroy();
    console.log("✅ User deleted by admin:", req.user.id, "User ID:", id);
    res.json({ message: "User deleted successfully" });
  } catch (error) {
    console.error("❌ Delete User Error:", error.message);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;