const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");
const { v4: uuidv4 } = require("uuid");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads");
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `${uniqueSuffix}${path.extname(file.originalName || file.originalname)}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    console.log("🔍 Multer received file:", file);
    const filetypes = /jpeg|jpg|png/;
    const extname = filetypes.test(path.extname(file.originalName || file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error("Only JPEG/JPG/PNG images are allowed"));
  },
  limits: { fileSize: 5 * 1024 * 1024 },
}).array("images", 5);

const addWatermark = async (buffer, outputFilePath) => {
  const watermarkText = "SPCapital \u00A9";
  try {
    const { width, height } = await sharp(buffer).metadata();
    const watermarkSVG = `<svg width="${width / 2}" height="${height / 10}">
      <text x="10" y="${height / 15}" font-family="Arial" font-size="30" fill="black">${watermarkText}</text>
    </svg>`;
    await sharp(buffer)
      .composite([{ input: Buffer.from(watermarkSVG), gravity: "centre", top: 20, left: 10 }])
      .toFile(outputFilePath);
    console.log("✅ Watermark added to:", outputFilePath);
    return outputFilePath;
  } catch (error) {
    console.error("❌ Error adding watermark:", error.message);
    throw new Error("Error adding watermark: " + error.message);
  }
};

// POST /api/comments - Create a new comment
router.post("/", upload, async (req, res) => {
  const { Post, User, Comment, Notification } = req.app.get("db");
  const clients = req.app.get("wsClients");
  const { content, postId, parentId, price, estimatedDuration, availability } = req.body;

  try {
    console.log("🔍 Starting comment creation for post:", postId);
    if (!content || !postId) {
      return res.status(400).json({ message: "Content and postId are required" });
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

    if (userType === "designer" && feedType !== "design") {
      return res.status(403).json({ message: "Designers can only comment on design feed posts" });
    }

    if (userType !== "designer" && userType !== "shop") {
      return res.status(403).json({ message: "Only designers and shop users can comment" });
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

    let imageFilenames = [];
    if (req.files && Array.isArray(req.files) && req.files.length > 0) {
      if (userType !== "designer" || feedType !== "design") {
        return res.status(403).json({ message: "Only designers can upload images in design feed comments" });
      }
      console.log("🔍 Applying watermark to comment images");
      try {
        for (const file of req.files) {
          const filePath = path.join("uploads", file.filename);
          const outputFilePath = path.join("uploads", "watermarked-" + file.filename);
          const buffer = await fs.readFileSync(filePath);
          const watermarkedFilePath = await addWatermark(buffer, outputFilePath);
          await fs.unlinkSync(filePath);
          imageFilenames.push(path.basename(watermarkedFilePath));
        }
      } catch (error) {
        console.error("❌ Watermark Application Error:", error.message);
        return res.status(500).json({ message: "Error applying watermark", error: error.message });
      }
    }

    const comment = await Comment.create({
      id: uuidv4(),
      content,
      userId: user.id,
      postId,
      parentId: parentId || null,
      price: feedType === "design" ? parseFloat(price) || 0 : parseFloat(price) || null,
      estimatedDuration: feedType === "booking" ? estimatedDuration || null : null,
      availability: feedType === "booking" ? availability || null : null,
      images: imageFilenames,
    });

    console.log("✅ Comment created:", comment.id);

    if (feedType === "booking" && userType === "shop" && !parentId) {
      const fanUser = await User.findByPk(post.userId);
      if (fanUser) {
        const notification = {
          id: uuidv4(),
          userId: fanUser.id,
          message: `${user.firstName} ${user.lastName} has pitched on your booking "${post.title}".`,
          isRead: false,
          createdAt: new Date(),
        };
        await Notification.create(notification);
        console.log("✅ Created notification for fan:", fanUser.id);

        const fanClient = clients.get(fanUser.id);
        if (fanClient && fanClient.readyState === 1) {
          console.log("🔍 Sending WebSocket notification to fan:", fanUser.id);
          fanClient.send(JSON.stringify({ type: "notification", data: notification.message }));
          console.log("✅ WebSocket notification sent to fan:", fanUser.id);
        } else {
          console.warn("⚠️ Fan's WebSocket client not available:", fanUser.id);
        }
      } else {
        console.log("🔍 No fan user found for notification");
      }
    }

    const ownerId = feedType === "design" ? post.shopId : post.clientId;
    const owner = await User.findByPk(ownerId);
    if (owner) {
      const notificationMessage = `New comment on your ${feedType} post "${post.title}" by ${user.username}`;
      const notification = await Notification.create({
        id: uuidv4(),
        userId: ownerId,
        message: notificationMessage,
      });
      console.log("🔍 Notification created for owner:", ownerId);

      const ownerClient = clients.get(ownerId);
      if (ownerClient && ownerClient.readyState === 1) {
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

// GET /api/comments/post/:postId - Fetch comments for a post
router.get("/post/:postId", async (req, res) => {
  const { Comment, User, Post } = req.app.get("db");
  const { postId } = req.params;

  try {
    const post = await Post.findByPk(postId);
    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

    const comments = await Comment.findAll({
      where: { postId },
      include: [
        { model: User, as: "user", attributes: ["id", "username"] },
        {
          model: Comment,
          as: "replies",
          include: [{ model: User, as: "user", attributes: ["id", "username"] }],
        },
      ],
      order: [["createdAt", "ASC"]],
    });

    res.json({ comments });
  } catch (error) {
    console.error("❌ Fetch Comments Error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

// PUT /api/comments/:commentId - Update a comment
router.put("/:commentId", async (req, res) => {
  const { Comment, Post } = req.app.get("db");
  const { content, price } = req.body;
  const { commentId } = req.params;

  try {
    if (!content) {
      return res.status(400).json({ message: "Content is required" });
    }

    const comment = await Comment.findByPk(commentId, {
      include: [{ model: Post, as: "Post" }],
    });
    if (!comment) {
      return res.status(404).json({ message: "Comment not found" });
    }

    if (comment.userId !== req.user.id) {
      return res.status(403).json({ message: "You can only edit your own comments" });
    }

    await comment.update({
      content,
      price: comment.Post?.feedType === "design" ? parseFloat(price) || 0 : null,
    });
    console.log("✅ Comment updated:", comment.id);
    res.json({ data: comment });
  } catch (error) {
    console.error("❌ Comment Update Error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

// POST /api/comments/:id/withdraw - Withdraw a pitch
router.post("/:id/withdraw", async (req, res) => {
  const { Comment, Post } = req.app.get("db");
  const { id } = req.params;

  try {
    const comment = await Comment.findByPk(id, {
      include: [{ model: Post, as: "Post" }],
    });
    if (!comment) {
      return res.status(404).json({ message: "Comment not found" });
    }

    if (comment.userId !== req.user.id) {
      return res.status(403).json({ message: "You can only withdraw your own pitch" });
    }

    if (comment.Post.feedType !== "booking") {
      return res.status(400).json({ message: "Can only withdraw pitches on booking posts" });
    }

    if (comment.parentId) {
      return res.status(400).json({ message: "Can only withdraw top-level pitches" });
    }

    if (comment.withdrawn) {
      return res.status(400).json({ message: "Pitch already withdrawn" });
    }

    if (comment.Post.shopId) {
      return res.status(400).json({ message: "Cannot withdraw a pitch after a pitch has been accepted" });
    }

    await comment.update({ withdrawn: true });
    console.log("✅ Pitch withdrawn:", comment.id);
    res.json({ message: "Pitch withdrawn successfully" });
  } catch (error) {
    console.error("❌ Withdraw Pitch Error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

// DELETE /api/comments/:id - Delete a comment (admin-only)
router.delete("/:id", async (req, res) => {
  const { Comment } = req.app.get("db");
  const { id } = req.params;

  try {
    if (!req.user || req.user.isAdmin !== true) {
      return res.status(403).json({ message: "Admins only" });
    }

    const comment = await Comment.findByPk(id);
    if (!comment) {
      return res.status(404).json({ message: "Comment not found" });
    }

    await comment.destroy();
    console.log("✅ Comment deleted by admin:", req.user.id, "Comment ID:", id);
    res.json({ message: "Comment deleted successfully" });
  } catch (error) {
    console.error("❌ Delete Comment Error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

// GET /api/comments - Fetch all comments (admin-only)
router.get("/", async (req, res) => {
  const { Comment, User, Post } = req.app.get("db");

  try {
    if (!req.user || req.user.isAdmin !== true) {
      return res.status(403).json({ message: "Admins only" });
    }

    const comments = await Comment.findAll({
      include: [
        { model: User, as: "user", attributes: ["id", "username"] },
        { model: Post, as: "Post", attributes: ["id", "title"], required: false },
      ],
    });

    res.json({ comments });
  } catch (error) {
    console.error("❌ Fetch Comments Error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;