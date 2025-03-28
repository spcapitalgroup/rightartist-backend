// routes/bookingRoutes.js
const express = require("express");
const router = express.Router();
const authenticateUser = require("../middleware/authMiddleware");

// GET /api/bookings/shop/:shopId - Get bookings for a shop
router.get("/shop/:shopId", authenticateUser, async (req, res) => {
  try {
    const { shopId } = req.params;
    const { Booking, User, Post } = req.app.get("db");

    // Ensure the authenticated user is the shop owner
    if (req.user.id !== shopId) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const bookings = await Booking.findAll({
      where: { shopId },
      include: [
        { model: User, as: "client", attributes: ["id", "username"] },
        { model: Post, as: "post", attributes: ["id", "title"] },
      ],
    });

    res.json({ bookings });
  } catch (error) {
    console.error("Error fetching bookings:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// POST /api/bookings/schedule - Create a new booking
router.post("/schedule", authenticateUser, async (req, res) => {
  try {
    const { postId, shopId, clientId, scheduledDate, contactInfo } = req.body;
    const { Booking, Post } = req.app.get("db");

    if (!postId || !shopId || !clientId || !scheduledDate) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const booking = await Booking.create({
      postId,
      shopId,
      clientId,
      scheduledDate,
      contactInfo: contactInfo || {},
      status: "scheduled",
    });

    // Update the post status to "scheduled"
    const post = await Post.findByPk(postId);
    if (post) {
      post.status = "scheduled";
      post.scheduledDate = scheduledDate;
      post.contactInfo = contactInfo || {};
      await post.save();
    }

    res.status(201).json(booking);
  } catch (error) {
    console.error("Error creating booking:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// PUT /api/bookings/:bookingId/cancel - Cancel a booking
router.put("/:bookingId/cancel", authenticateUser, async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { Booking, Post } = req.app.get("db");

    const booking = await Booking.findByPk(bookingId);
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    // Ensure the authenticated user is the shop owner
    if (req.user.id !== booking.shopId) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    booking.status = "cancelled";
    await booking.save();

    // Update the post status to "cancelled"
    const post = await Post.findByPk(booking.postId);
    if (post) {
      post.status = "cancelled";
      await post.save();
    }

    res.json(booking);
  } catch (error) {
    console.error("Error cancelling booking:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// PUT /api/bookings/:bookingId/reschedule - Reschedule a booking
router.put("/:bookingId/reschedule", authenticateUser, async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { scheduledDate } = req.body;
    const { Booking, Post } = req.app.get("db");

    if (!scheduledDate) {
      return res.status(400).json({ message: "Missing scheduledDate" });
    }

    const booking = await Booking.findByPk(bookingId);
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    // Ensure the authenticated user is the shop owner
    if (req.user.id !== booking.shopId) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    booking.scheduledDate = scheduledDate;
    await booking.save();

    // Update the post's scheduledDate
    const post = await Post.findByPk(booking.postId);
    if (post) {
      post.scheduledDate = scheduledDate;
      await post.save();
    }

    res.json(booking);
  } catch (error) {
    console.error("Error rescheduling booking:", error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;