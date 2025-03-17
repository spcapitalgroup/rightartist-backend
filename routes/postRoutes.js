const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "/Users/trentonshupp/Documents/RightArtist/rightartist-backend/uploads");
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

router.post("/", upload, async (req, res) => {
  console.log("🔍 Files received:", req.files);
  console.log("🔍 Body after multer:", req.body);

  const { Post, User, Notification } = req.app.get("db");
  const wss = req.app.get("wss"); // Get WebSocket server from app
  const { title, description, location, feedType } = req.body;

  try {
    if (!title || !description || !location || !["design", "booking"].includes(feedType)) {
      console.error("❌ Invalid input:", { title, description, location, feedType });
      return res.status(400).json({ message: "Missing or invalid required fields" });
    }

    if (!req.user || !req.user.id) {
      console.error("❌ No authenticated user in request");
      return res.status(401).json({ message: "Access Denied. No user data." });
    }

    const user = await User.findByPk(req.user.id);
    if (!user) {
      console.error("❌ User not found for ID:", req.user.id);
      return res.status(404).json({ message: "User not found" });
    }

    console.log("🔍 Authenticated User:", { id: user.id, userType: user.userType });

    const userType = user.userType;
    const allowedDesign = ["shop", "elite"];
    const allowedBooking = ["fan"];

    if ((userType === "shop" || userType === "elite") && !user.isPaid) {
      console.error("❌ Unpaid user attempted to post:", user.id);
      return res.status(403).json({ message: "Please complete payment to post" });
    }

    let postData = {
      title,
      description,
      location,
      feedType,
      status: "open",
      images: req.files ? req.files.map((file) => file.filename) : [],
    };

    if (feedType === "design") {
      if (!allowedDesign.includes(userType)) {
        console.error("❌ Unauthorized design post - UserType:", userType);
        return res.status(403).json({ message: "Only Shop Pros and Elites can post to Design Feed" });
      }
      postData.shopId = user.id;
    } else if (feedType === "booking") {
      if (!allowedBooking.includes(userType)) {
        console.error("❌ Unauthorized booking post - UserType:", userType);
        return res.status(403).json({ message: "Only Ink Hunters can post to Booking Feed" });
      }
      postData.clientId = user.id;
    }

    console.log("📝 Creating post for user:", user.id, "Data:", postData);
    const newPost = await Post.create(postData);

    // Notify designers - WebSocket optional
    const designers = await User.findAll({ where: { userType: "designer" } });
    const notificationMessage = feedType === "design"
      ? `New design request posted by ${user.username}: "${title}"`
      : `New booking request posted by ${user.username}: "${title}"`;

    for (const designer of designers) {
      const notification = await Notification.create({
        id: require("uuid").v4(),
        userId: designer.id,
        message: notificationMessage,
      });

      if (wss && wss.clients) {
        wss.clients.forEach((client) => {
          if (client.readyState === 1) { // WebSocket.OPEN
            client.send(JSON.stringify({ type: "notification", data: notification.message }));
          }
        });
        console.log("✅ Notification broadcasted to WebSocket clients");
      } else {
        console.warn("⚠️ WebSocket server not available, notification stored in DB");
      }
    }

    console.log("✅ Post created successfully:", newPost.id);
    res.status(201).json({ data: newPost });
  } catch (error) {
    console.error("❌ Post Creation Error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;