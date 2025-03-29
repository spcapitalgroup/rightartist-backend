const express = require("express");
const router = express.Router();

module.exports = (wss) => {
  router.get("/", async (req, res) => {
    const { Notification } = req.app.get("db");
    try {
      if (req.user.isAdmin) {
        console.log("✅ Admin fetch blocked:", req.user.id);
        return res.json({ success: true, notifications: [] }); // Admin gets nothing
      }
      const notifications = await Notification.findAll({
        where: { userId: req.user.id },
        order: [["createdAt", "DESC"]],
        attributes: ["id", "userId", "message", "isRead", "createdAt"], // Explicitly exclude updatedAt
      });
      res.json({ success: true, notifications });
    } catch (err) {
      console.error("🔴 Error fetching notifications:", err.message);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });

  router.put("/mark-read", async (req, res) => {
    const { Notification } = req.app.get("db");
    try {
      if (req.user.isAdmin) {
        console.log("✅ Admin mark-read blocked:", req.user.id);
        return res.json({ success: true, message: "No notifications for admin" });
      }
      const updatedRows = await Notification.update(
        { isRead: true },
        { where: { userId: req.user.id, isRead: false } }
      );

      if (!updatedRows[0]) {
        return res.status(404).json({ success: false, message: "No unread notifications found" });
      }

      if (wss && wss.clients.size > 0) {
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(
              JSON.stringify({ type: "notification-update", userId: req.user.id })
            );
          }
        });
      }

      res.json({ success: true, message: "Notifications marked as read" });
    } catch (err) {
      console.error("🔴 Error updating notifications:", err.message);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });

  return router;
};