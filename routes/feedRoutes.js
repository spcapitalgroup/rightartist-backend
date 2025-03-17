const express = require("express");
const router = express.Router();
const { Op } = require("sequelize");

router.get("/", async (req, res) => {
  const { Post, User, Comment } = req.app.get("db");
  try {
    const { page = 1, limit = 10, feedType } = req.query;
    const offset = (page - 1) * limit;

    if (!["design", "booking"].includes(feedType)) {
      console.log("❌ Invalid feed type:", feedType);
      return res.status(400).json({ message: "Invalid feed type" });
    }

    const userType = req.user.userType;
    console.log("🔍 User accessing feed - ID:", req.user.id, "Type:", userType, "Feed:", feedType);

    const allowedDesign = ["shop", "elite", "designer"];
    const allowedBooking = ["shop", "elite", "fan"];
    if (
      (feedType === "design" && !allowedDesign.includes(userType)) ||
      (feedType === "booking" && !allowedBooking.includes(userType))
    ) {
      console.log("❌ Unauthorized - UserType:", userType);
      return res.status(403).json({ message: "Unauthorized access to this feed" });
    }

    let whereCondition = { feedType };
    if (feedType === "design") {
      whereCondition.artistId = { [Op.is]: null };
      whereCondition.status = "open";
    } else if (feedType === "booking") {
      whereCondition = {
        ...whereCondition,
        [Op.or]: [{ clientId: { [Op.ne]: null } }, { shopId: { [Op.ne]: null } }],
        status: "open",
      };
    }

    console.log("🔍 Fetching posts with condition:", whereCondition);
    const posts = await Post.findAll({
      where: whereCondition,
      attributes: ["id", "title", "description", "images", "createdAt", "clientId", "shopId", "feedType"],
      include: [
        { model: User, as: "client", attributes: ["id", "username"] },
        { model: User, as: "shop", attributes: ["id", "username"] },
        {
          model: Comment,
          as: "comments",
          include: [
            { model: User, as: "user", attributes: ["id", "username"] },
            { model: Comment, as: "replies", include: [{ model: User, as: "user", attributes: ["id", "username"] }] },
          ],
        },
      ],
      order: [["createdAt", "DESC"]],
      limit: parseInt(limit),
      offset: parseInt(offset),
    });

    const totalPosts = await Post.count({ where: whereCondition });
    const nextPage = offset + parseInt(limit) < totalPosts ? parseInt(page) + 1 : null;

    console.log("✅ Posts fetched:", posts.length);
    res.json({ posts, nextPage });
  } catch (error) {
    console.error("❌ Feed Fetch Error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;