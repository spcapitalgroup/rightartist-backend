const express = require("express");
const router = express.Router();
const path = require("path");
const cloudinary = require("cloudinary").v2;
const multer = require("multer");

// Configure Multer for temporary file uploads (we'll upload to Cloudinary)
const storage = multer.memoryStorage();
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

module.exports = (wss, db) => {
  router.get("/feed", async (req, res) => {
    const { Post, User, Comment } = db;
    const { feedType } = req.query;
    try {
      if (!["design", "booking"].includes(feedType)) {
        return res.status(400).json({ message: "Invalid feed type" });
      }

      let whereClause = { feedType };

      // Restrict design feed to designers only
      if (feedType === "design" && req.user.userType !== "designer") {
        return res.status(403).json({ message: "Only designers can view the design feed" });
      }

      // For booking feed, no additional restrictions needed
      const posts = await Post.findAll({
        where: whereClause,
        include: [
          { model: User, as: "user", attributes: ["id", "username"] },
          { model: User, as: "shop", attributes: ["id", "username"] },
          { model: User, as: "client", attributes: ["id", "username"] },
          { model: Comment, as: "comments", include: [{ model: User, as: "user", attributes: ["id", "username"] }] },
        ],
        order: [["createdAt", "DESC"]],
      });

      console.log(`✅ Fetched ${feedType} feed for user:`, req.user.id);
      res.json({ posts });
    } catch (error) {
      console.error(`❌ Feed Fetch Error (${feedType}):`, error.message);
      res.status(500).json({ message: "Server error" });
    }
  });

  router.get("/user/:userId/design", async (req, res) => {
    const { Post, User, Comment } = db;
    const { userId } = req.params;
    try {
      const posts = await Post.findAll({
        where: {
          userId,
          feedType: "design",
        },
        include: [
          { model: User, as: "user", attributes: ["id", "username"] },
          { model: User, as: "shop", attributes: ["id", "username"] },
          { model: User, as: "client", attributes: ["id", "username"] },
          { model: Comment, as: "comments", include: [{ model: User, as: "user", attributes: ["id", "username"] }] },
        ],
        order: [["createdAt", "DESC"]],
      });

      console.log(`✅ Fetched design posts for user: ${userId}`);
      res.json({ posts });
    } catch (error) {
      console.error(`❌ Fetch Design Posts Error for user ${userId}:`, error.message);
      res.status(500).json({ message: "Server error" });
    }
  });

  router.get("/user/:userId/booking", async (req, res) => {
    const { Post, User, Comment } = db;
    const { userId } = req.params;
    try {
      const posts = await Post.findAll({
        where: {
          userId,
          feedType: "booking",
        },
        include: [
          { model: User, as: "user", attributes: ["id", "username"] },
          { model: User, as: "shop", attributes: ["id", "username"] },
          { model: User, as: "client", attributes: ["id", "username"] },
          { model: Comment, as: "comments", include: [{ model: User, as: "user", attributes: ["id", "username"] }] },
        ],
        order: [["createdAt", "DESC"]],
      });

      console.log(`✅ Fetched booking posts for user: ${userId}`);
      res.json({ posts });
    } catch (error) {
      console.error(`❌ Fetch Booking Posts Error for user ${userId}:`, error.message);
      res.status(500).json({ message: "Server error" });
    }
  });

  router.post("/create", async (req, res) => {
    const { Post, User } = db;
    const { title, description, location, feedType } = req.body;

    try {
      if (!title || !description || !location || !feedType) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      if (!["design", "booking"].includes(feedType)) {
        return res.status(400).json({ message: "Invalid feed type" });
      }

      // Permission checks
      if (feedType === "design" && req.user.userType !== "shop") {
        return res.status(403).json({ message: "Only shops can post design requests" });
      }

      if (feedType === "booking" && req.user.userType !== "fan") {
        return res.status(403).json({ message: "Only fans can post booking requests" });
      }

      if (req.user.userType === "designer") {
        return res.status(403).json({ message: "Designers cannot create posts directly" });
      }

      const user = await User.findByPk(req.user.id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const post = await Post.create({
        id: require("uuid").v4(),
        title,
        description,
        location,
        feedType,
        userId: req.user.id,
        clientId: feedType === "booking" ? req.user.id : null, // Set clientId for booking posts
        shopId: feedType === "design" ? req.user.id : null, // Set shopId for design posts
        status: "open",
        images: [],
      });

      console.log("✅ Post created by user:", req.user.id, "Type:", feedType);
      res.status(201).json({ message: "Post created", post });
    } catch (error) {
      console.error("❌ Post Creation Error:", error.message);
      res.status(500).json({ message: "Server error" });
    }
  });

  router.post("/upload-images", upload, async (req, res) => {
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ message: "No images uploaded" });
      }

      const postId = req.body.postId;
      if (!postId) {
        return res.status(400).json({ message: "Post ID required" });
      }

      const { Post } = db;
      const post = await Post.findByPk(postId);
      if (!post) {
        return res.status(404).json({ message: "Post not found" });
      }

      if (post.userId !== req.user.id) {
        return res.status(403).json({ message: "You can only upload images to your own post" });
      }

      const imageUrls = [];
      for (const file of req.files) {
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

      const updatedImages = [...(post.images || []), ...imageUrls];
      await post.update({ images: updatedImages });

      console.log("✅ Images uploaded for post:", postId, "URLs:", imageUrls);
      res.json({ message: "Images uploaded", imageUrls });
    } catch (error) {
      console.error("❌ Image Upload Error:", error.message);
      res.status(500).json({ message: "Server error" });
    }
  });

  router.post("/accept-offer", async (req, res) => {
    const { Post, Comment, Notification } = db;
    const { postId, commentId } = req.body;

    try {
      if (!postId || !commentId) {
        return res.status(400).json({ message: "Post ID and Comment ID required" });
      }

      const post = await Post.findByPk(postId);
      if (!post) {
        return res.status(404).json({ message: "Post not found" });
      }

      if (post.userId !== req.user.id) {
        return res.status(403).json({ message: "You can only accept offers on your own post" });
      }

      if (post.status !== "open") {
        return res.status(400).json({ message: "Post is not open for offers" });
      }

      const comment = await Comment.findByPk(commentId);
      if (!comment || comment.postId !== postId) {
        return res.status(404).json({ message: "Comment not found or does not belong to this post" });
      }

      if (comment.withdrawn) {
        return res.status(400).json({ message: "This offer has been withdrawn" });
      }

      await post.update({
        status: "accepted",
        shopId: comment.userId,
        depositAmount: comment.price,
      });

      const notificationMessage = `Your offer on "${post.title}" was accepted!`;
      await Notification.create({
        id: require("uuid").v4(),
        userId: comment.userId,
        message: notificationMessage,
      });

      console.log("✅ Offer accepted for post:", postId, "Comment:", commentId);
      res.json({ message: "Offer accepted" });

      if (wss) {
        const ws = wss.clients.get(comment.userId);
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "notification", data: notificationMessage, userId: comment.userId }));
        }
      }
    } catch (error) {
      console.error("❌ Accept Offer Error:", error.message);
      res.status(500).json({ message: "Server error" });
    }
  });

  router.post("/schedule", async (req, res) => {
    const { Post, Booking, Notification } = db;
    const { postId, scheduledDate, contactInfo } = req.body;

    try {
      if (!postId || !scheduledDate || !contactInfo) {
        return res.status(400).json({ message: "Post ID, scheduled date, and contact info required" });
      }

      const post = await Post.findByPk(postId);
      if (!post) {
        return res.status(404).json({ message: "Post not found" });
      }

      if (post.shopId !== req.user.id) {
        return res.status(403).json({ message: "You can only schedule your own accepted posts" });
      }

      if (post.status !== "accepted") {
        return res.status(400).json({ message: "Post must be accepted before scheduling" });
      }

      await post.update({
        status: "scheduled",
        scheduledDate,
        contactInfo,
      });

      await Booking.create({
        id: require("uuid").v4(),
        postId,
        shopId: req.user.id,
        clientId: post.clientId,
        scheduledDate,
        status: "scheduled",
        contactInfo,
      });

      const notificationMessage = `Booking scheduled for "${post.title}" on ${new Date(scheduledDate).toLocaleDateString()}`;
      await Notification.create({
        id: require("uuid").v4(),
        userId: post.clientId,
        message: notificationMessage,
      });

      console.log("✅ Booking scheduled for post:", postId);
      res.json({ message: "Booking scheduled" });

      if (wss) {
        const ws = wss.clients.get(post.clientId);
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "notification", data: notificationMessage, userId: post.clientId }));
        }
      }
    } catch (error) {
      console.error("❌ Schedule Booking Error:", error.message);
      res.status(500).json({ message: "Server error" });
    }
  });

  router.post("/complete", async (req, res) => {
    const { Post, Booking, Notification } = db;
    const { postId } = req.body;

    try {
      if (!postId) {
        return res.status(400).json({ message: "Post ID required" });
      }

      const post = await Post.findByPk(postId);
      if (!post) {
        return res.status(404).json({ message: "Post not found" });
      }

      if (post.shopId !== req.user.id) {
        return res.status(403).json({ message: "You can only complete your own scheduled posts" });
      }

      if (post.status !== "scheduled") {
        return res.status(400).json({ message: "Post must be scheduled before completing" });
      }

      await post.update({ status: "completed" });

      const booking = await Booking.findOne({ where: { postId } });
      if (booking) {
        await booking.update({ status: "completed" });
      }

      const notificationMessage = `Booking for "${post.title}" has been completed`;
      await Notification.create({
        id: require("uuid").v4(),
        userId: post.clientId,
        message: notificationMessage,
      });

      console.log("✅ Booking completed for post:", postId);
      res.json({ message: "Booking completed" });

      if (wss) {
        const ws = wss.clients.get(post.clientId);
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "notification", data: notificationMessage, userId: post.clientId }));
        }
      }
    } catch (error) {
      console.error("❌ Complete Booking Error:", error.message);
      res.status(500).json({ message: "Server error" });
    }
  });

  router.post("/cancel", async (req, res) => {
    const { Post, Booking, Notification } = db;
    const { postId } = req.body;

    try {
      if (!postId) {
        return res.status(400).json({ message: "Post ID required" });
      }

      const post = await Post.findByPk(postId);
      if (!post) {
        return res.status(404).json({ message: "Post not found" });
      }

      if (post.shopId !== req.user.id && post.userId !== req.user.id) {
        return res.status(403).json({ message: "You can only cancel your own posts" });
      }

      if (post.status === "completed") {
        return res.status(400).json({ message: "Cannot cancel a completed post" });
      }

      await post.update({ status: "cancelled" });

      const booking = await Booking.findOne({ where: { postId } });
      if (booking) {
        await booking.update({ status: "cancelled" });
      }

      const notificationMessage = `Booking for "${post.title}" has been cancelled`;
      const notificationUserId = post.shopId === req.user.id ? post.clientId : post.shopId;
      await Notification.create({
        id: require("uuid").v4(),
        userId: notificationUserId,
        message: notificationMessage,
      });

      console.log("✅ Booking cancelled for post:", postId);
      res.json({ message: "Booking cancelled" });

      if (wss) {
        const ws = wss.clients.get(notificationUserId);
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "notification", data: notificationMessage, userId: notificationUserId }));
        }
      }
    } catch (error) {
      console.error("❌ Cancel Booking Error:", error.message);
      res.status(500).json({ message: "Server error" });
    }
  });

  return router;
};