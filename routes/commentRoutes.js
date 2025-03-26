const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads");
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    console.log("🔍 Multer received file:", file);
    const filetypes = /jpeg|jpg|png/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error("Only JPEG/JPG/PNG images are allowed"));
  },
  limits: { fileSize: 5 * 1024 * 1024 },
}).array("images", 5);

const addWatermark = async (buffer, outputFilePath) => {
  const watermarkText = "SPCapital \u00A9"; // Watermark text with copyright sign

  try {
    // Get the image's dimensions
    const { width, height } = await sharp(buffer).metadata();

    // Create the watermark SVG, scaled to fit the image's size
    const watermarkSVG = `<svg width="${width / 2}" height="${height / 10}">
      <text x="10" y="${height / 15}" font-family="Arial" font-size="30" fill="black">${watermarkText}</text>
    </svg>`;

    // Apply the watermark using sharp
    await sharp(buffer)
      .composite([
        {
          input: Buffer.from(watermarkSVG),
          gravity: "centre",
          top: 20,
          left: 10,
        },
      ])
      .toFile(outputFilePath); // Save watermarked image to the disk

    console.log("✅ Watermark added to:", outputFilePath);
    return outputFilePath;
  } catch (error) {
    console.error("❌ Error adding watermark:", error.message);
    throw new Error("Error adding watermark: " + error.message);
  }
};

router.post("/:postId", upload, async (req, res) => {
  const { Post, User, Comment, Notification } = req.app.get("db");
  const clients = req.app.get("wsClients");
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

    // Restrict designers to only comment on design feed posts
    if (userType === "designer" && feedType !== "design") {
      return res.status(403).json({ message: "Designers can only comment on design feed posts" });
    }

    // Allow shop users to comment on both design and booking feed posts
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

    // Handle image uploads (only for designers on design feed posts)
    let imageFilenames = [];
    if (req.files && req.files.length > 0) {
      if (userType !== "designer" || feedType !== "design") {
        return res.status(403).json({ message: "Only designers can upload images in design feed comments" });
      }
      console.log("🔍 Applying watermark to comment images");
      try {
        for (const file of req.files) {
          const filePath = path.join("uploads", file.filename);
          const outputFilePath = path.join("uploads", "watermarked-" + file.filename);
          const buffer = fs.readFileSync(filePath);
          const watermarkedFilePath = await addWatermark(buffer, outputFilePath);
          fs.unlinkSync(filePath);
          imageFilenames.push(path.basename(watermarkedFilePath));
        }
      } catch (error) {
        console.error("❌ Watermark Application Error:", error.message);
        return res.status(500).json({ message: "Error applying watermark", error: error.message });
      }
    }

    const comment = await Comment.create({
      id: require("uuid").v4(),
      content,
      userId: user.id,
      postId,
      parentId: parentId || null,
      price: feedType === "design" ? parseFloat(price) || 0 : null,
      images: imageFilenames,
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

router.put("/:commentId", async (req, res) => {
  const { Comment, Post } = req.app.get("db");
  const { content, price } = req.body;
  const { commentId } = req.params;

  try {
    if (!content) {
      return res.status(400).json({ message: "Content is required" });
    }

    const comment = await Comment.findByPk(commentId, {
      include: [{ model: Post, as: "Post" }], // Updated alias to "Post"
    });
    if (!comment) {
      return res.status(404).json({ message: "Comment not found" });
    }

    if (comment.userId !== req.user.id) {
      return res.status(403).json({ message: "You can only edit your own comments" });
    }

    await comment.update({ 
      content, 
      price: comment.Post?.feedType === "design" ? parseFloat(price) || 0 : null // Updated to use "Post" alias
    });
    console.log("✅ Comment updated:", comment.id);
    res.json({ data: comment });
  } catch (error) {
    console.error("❌ Comment Update Error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;