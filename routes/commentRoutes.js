const express = require("express");
const router = express.Router();

router.post("/:postId", async (req, res) => {
  const { Post, User, Comment, Notification } = req.app.get("db");
  const clients = req.app.get("wsClients"); // Map of userId to WebSocket clients
  const { content, parentId, price } = req.body;
  const { postId } = req.params;

  try {
    console.log("🔍 Starting comment creation for post:", postId);
    if (!content) {
      return res.status(400).json({ message: "Content is required" });
    }

    const user = await User.findByPk(req.user.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const post = await Post.findByPk(postId);
    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

    const userType = user.userType;
    const feedType = post.feedType;

    if (userType !== "designer" && userType !== "shop") {
      return res.status(403).json({ message: "Only designers can comment" });
    }

    if (feedType === "design") {
      if (parentId) {
        return res.status(403).json({ message: "Sub-comments not allowed in Design Feed" });
      }
      const existingComment = await Comment.findOne({ where: { userId: user.id, postId } });
      if (existingComment) {
        return res.status(403).json({ message: "You’ve already commented on this post" });
      }
    } else if (feedType === "booking") {
      if (!parentId) {
        const existingParent = await Comment.findOne({ where: { userId: user.id, postId, parentId: null } });
        if (existingParent) {
          return res.status(403).json({ message: "You’ve already responded to this post" });
        }
      } else {
        const parent = await Comment.findByPk(parentId);
        if (!parent || parent.postId !== postId || parent.userId !== user.id) {
          return res.status(400).json({ message: "Invalid parent comment" });
        }
      }
    }

    const comment = await Comment.create({
      id: require("uuid").v4(),
      content,
      userId: user.id,
      postId,
      parentId: parentId || null,
      price: feedType === "design" ? price : null,
    });

    console.log("✅ Comment created:", comment.id);

    // Notify post owner
    const ownerId = feedType === "design" ? post.shopId : post.clientId;
    const owner = await User.findByPk(ownerId);
    if (owner) {
      const notificationMessage = `New comment on your ${feedType} post "${post.title}" by ${user.username}`;
      const notification = await Notification.create({
        id: require("uuid").v4(),
        userId: ownerId,
        message: notificationMessage,
      });
      console.log("🔍 Notification created for owner:", ownerId);

      const ownerClient = clients.get(ownerId);
      if (ownerClient && ownerClient.readyState === 1) { // Use 1 for OPEN
        console.log("🔍 Sending WebSocket notification to:", ownerId);
        ownerClient.send(JSON.stringify({ type: "notification", data: notification.message }));
        console.log("✅ WebSocket notification sent to:", ownerId);
      } else {
        console.warn("⚠️ Owner's WebSocket client not available:", ownerId);
      }
    } else {
      console.log("🔍 No owner found for notification");
    }

    res.status(201).json({ data: comment });
  } catch (error) {
    console.error("❌ Comment Creation Error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

router.put("/:commentId", async (req, res) => {
  const { Comment } = req.app.get("db");
  const { content, price } = req.body;
  const { commentId } = req.params;

  try {
    if (!content) {
      return res.status(400).json({ message: "Content is required" });
    }

    const comment = await Comment.findByPk(commentId);
    if (!comment) {
      return res.status(404).json({ message: "Comment not found" });
    }

    if (comment.userId !== req.user.id) {
      return res.status(403).json({ message: "You can only edit your own comments" });
    }

    await comment.update({ content, price: comment.post?.feedType === "design" ? price : null });
    console.log("✅ Comment updated:", comment.id);
    res.json({ data: comment });
  } catch (error) {
    console.error("❌ Comment Update Error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;