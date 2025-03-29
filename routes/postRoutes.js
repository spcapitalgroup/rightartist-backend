const express = require("express");
const router = express.Router();
const multer = require("multer");
const cloudinary = require("cloudinary").v2;

// Configure Multer for temporary file uploads (we'll upload to Cloudinary)
const storage = multer.memoryStorage(); // Use memory storage since we won't save to disk
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
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

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

      const post = await Post.findByPk(postId);
      if (!post) {
        return res.status(404).json({ message: "Post not found" });
      }

      // Upload images to Cloudinary with watermark
      const imageUrls = [];
      for (const file of files) {
        const result = await cloudinary.uploader.upload_stream(
          {
            folder: "rightartist/posts",
            transformation: [
              {
                overlay: {
                  font_family: "Arial",
                  font_size: 30,
                  text: "SPCapital ©",
                },
                gravity: "center",
                y: -20,
                x: 10,
                color: "black",
              },
            ],
          },
          (error, result) => {
            if (error) {
              console.error("❌ Cloudinary Upload Error:", error);
              throw new Error("Failed to upload image to Cloudinary");
            }
            return result;
          }
        ).end(file.buffer);

        imageUrls.push(result.secure_url);
      }

      post.images = [...(post.images || []), ...imageUrls];
      await post.save();

      console.log(`✅ Uploaded images for post ${postId} to Cloudinary:`, imageUrls);
      res.status(200).json({ images: imageUrls });
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