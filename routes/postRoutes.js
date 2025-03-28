const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Define uploads path (rightartist-backend/uploads)
const uploadsPath = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadsPath)) {
  fs.mkdirSync(uploadsPath, { recursive: true });
  console.log(`✅ Created uploads directory: ${uploadsPath}`);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsPath); // Save to rightartist-backend/uploads
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  },
});
const upload = multer({ storage });

module.exports = (wss, db) => {
  const Post = db.Post;
  const User = db.User;

  if (!Post || !User) {
    console.error("❌ Missing models in db:", { Post: !!Post, User: !!User });
    throw new Error("Required models not found in db object");
  }

  // Create a new post
  router.post("/create", async (req, res) => {
    try {
      const { title, description, location, feedType } = req.body;
      const userId = req.user.id; // From authMiddleware
      const post = await Post.create({
        title,
        description,
        location,
        feedType,
        userId,
        images: [],
      });
      res.json({ data: post });
    } catch (err) {
      console.error("❌ Post Creation Error:", err);
      res.status(500).json({ message: "Failed to create post" });
    }
  });

  // Upload images for a post
  router.post("/upload-images", upload.array("images", 5), async (req, res) => {
    try {
      const files = req.files;
      const postId = req.body.postId;
      if (!files || files.length === 0) {
        return res.status(400).json({ message: "No files uploaded" });
      }
      if (!postId) {
        return res.status(400).json({ message: "Post ID is required" });
      }

      const imagePaths = files.map(file => file.filename);
      const post = await Post.findByPk(postId);
      if (!post) {
        return res.status(404).json({ message: "Post not found" });
      }

      post.images = [...(post.images || []), ...imagePaths];
      await post.save();

      console.log(`✅ Uploaded images for post ${postId} to ${uploadsPath}:`, imagePaths);
      res.status(200).json({ images: imagePaths });
    } catch (err) {
      console.error("❌ Upload Error:", err);
      res.status(500).json({ message: "Failed to upload images" });
    }
  });

  // Fetch design posts for a user
  router.get("/user/:userId/design", async (req, res) => {
    try {
      const { userId } = req.params;
      const posts = await Post.findAll({
        where: {
          userId,
          feedType: "design",
        },
        include: [
          { model: User, as: "user", attributes: ["id", "username"] },
          { model: User, as: "shop", attributes: ["id", "username"] },
          { model: User, as: "client", attributes: ["id", "username"] },
        ],
      });
      res.json({ posts });
    } catch (err) {
      console.error("❌ Fetch Design Posts Error:", err);
      res.status(500).json({ message: "Failed to fetch design posts" });
    }
  });

  // Fetch booking posts for a user
  router.get("/user/:userId/booking", async (req, res) => {
    try {
      const { userId } = req.params;
      const posts = await Post.findAll({
        where: {
          userId,
          feedType: "booking",
        },
        include: [
          { model: User, as: "user", attributes: ["id", "username"] },
          { model: User, as: "shop", attributes: ["id", "username"] },
          { model: User, as: "client", attributes: ["id", "username"] },
        ],
      });
      res.json({ posts });
    } catch (err) {
      console.error("❌ Fetch Booking Posts Error:", err);
      res.status(500).json({ message: "Failed to fetch booking posts" });
    }
  });

  return router;
};