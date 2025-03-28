// routes/ratingRoutes.js
const express = require("express");
const router = express.Router();
const authenticateUser = require("../middleware/authMiddleware");

// POST /api/ratings - Create a new rating
router.post("/", authenticateUser, async (req, res) => {
  try {
    const { Rating, User } = req.app.get("db"); // Destructure models from req.app.get("db")
    const { postId, raterId, rateeId, rating, comment } = req.body;

    // Validate input
    if (!postId || !raterId || !rateeId || !rating) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // Ensure the rater is the authenticated user
    if (raterId !== req.user.id) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    // Check if the rater has already rated this user for this post
    const existingRating = await Rating.findOne({
      where: { raterId, rateeId, postId },
    });
    if (existingRating) {
      return res
        .status(400)
        .json({ message: "You have already rated this user for this post" });
    }

    // Create the new rating
    const newRating = await Rating.create({
      raterId,
      rateeId,
      postId,
      rating,
      comment: comment || "",
    });

    // Fetch the rating with associated rater and ratee
    const populatedRating = await Rating.findByPk(newRating.id, {
      include: [
        { model: User, as: "rater", attributes: ["id", "username"] },
        { model: User, as: "ratee", attributes: ["id", "username"] },
      ],
    });

    res.status(201).json(populatedRating);
  } catch (error) {
    console.error("Error creating rating:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// GET /api/ratings/post/:postId - Get ratings for a post
router.get("/post/:postId", authenticateUser, async (req, res) => {
  try {
    const { Rating, User } = req.app.get("db"); // Destructure models
    const ratings = await Rating.findAll({
      where: { postId: req.params.postId },
      include: [
        { model: User, as: "rater", attributes: ["id", "username"] },
        { model: User, as: "ratee", attributes: ["id", "username"] },
      ],
    });
    res.json({ ratings });
  } catch (error) {
    console.error("Error fetching ratings for post:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// GET /api/ratings/user/:userId - Get ratings for a user (as ratee)
router.get("/user/:userId", authenticateUser, async (req, res) => {
  try {
    const { Rating, User } = req.app.get("db"); // Destructure models
    const ratings = await Rating.findAll({
      where: { rateeId: req.params.userId },
      include: [
        { model: User, as: "rater", attributes: ["id", "username"] },
        { model: User, as: "ratee", attributes: ["id", "username"] },
      ],
    });
    res.json({ ratings });
  } catch (error) {
    console.error("Error fetching ratings for user:", error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;