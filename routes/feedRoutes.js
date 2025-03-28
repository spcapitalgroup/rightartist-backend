const express = require("express");
const router = express.Router();

router.get("/", async (req, res) => {
  const { Post, User, Comment } = req.app.get("db");
  const { feedType, postId } = req.query;

  try {
    console.log(
      "🔍 User accessing feed - ID:",
      req.user.id,
      "Type:",
      req.user.userType,
      "Feed:",
      feedType,
      "PostId:",
      postId
    );

    const userType = req.user.userType;
    const allowedDesign = ["designer", "shop", "elite"];
    const allowedBooking = ["fan", "shop", "elite"];
    if (
      (feedType === "design" && !allowedDesign.includes(userType)) ||
      (feedType === "booking" && !allowedBooking.includes(userType))
    ) {
      return res.status(403).json({ message: "Unauthorized to access this feed" });
    }

    let whereCondition = {};
    if (postId) {
      whereCondition = { id: postId };
    } else {
      whereCondition = { feedType };
      if (feedType === "design") {
        whereCondition.artistId = { [req.app.get("db").Op.is]: null };
        whereCondition.status = "open";
      } else if (feedType === "booking") {
        whereCondition = {
          ...whereCondition,
          [req.app.get("db").Op.or]: [
            { clientId: { [req.app.get("db").Op.ne]: null } },
            { shopId: { [req.app.get("db").Op.ne]: null } },
          ],
          status: "open",
        };
      }
    }

    console.log("🔍 Fetching posts with condition:", whereCondition);
    const posts = await Post.findAll({
      where: whereCondition,
      include: [
        { model: User, as: "user", attributes: ["id", "username"] },
        {
          model: Comment,
          as: "comments",
          include: [
            { model: User, as: "user", attributes: ["id", "username", "userType"] }, // Include userType
            {
              model: Comment,
              as: "replies",
              include: [{ model: User, as: "user", attributes: ["id", "username", "userType"] }], // Include userType
            },
            { model: Post, as: "Post" }, // Updated alias to "Post"
          ],
        },
      ],
      order: [
        ["createdAt", "DESC"],
        [{ model: Comment, as: "comments" }, "createdAt", "ASC"],
      ],
    });

    console.log("✅ Posts fetched:", posts.length);
    res.json({ posts });
  } catch (error) {
    console.error("❌ Feed Fetch Error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;