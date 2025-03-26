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

router.get("/inbox", async (req, res) => {
  const { Message, User } = req.app.get("db");
  try {
    const messages = await Message.findAll({
      where: { receiverId: req.user.id },
      order: [["createdAt", "DESC"]],
      include: [{ model: User, as: "sender", attributes: ["id", "username"] }],
    });
    console.log("✅ Inbox fetched for user:", req.user.id);
    res.json({ messages });
  } catch (error) {
    console.error("❌ Inbox Fetch Error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/sent", async (req, res) => {
  const { Message, User } = req.app.get("db");
  try {
    const messages = await Message.findAll({
      where: { senderId: req.user.id },
      order: [["createdAt", "DESC"]],
      include: [{ model: User, as: "sender", attributes: ["id", "username"] }],
    });
    console.log("✅ Sent messages fetched for user:", req.user.id);
    res.json({ messages });
  } catch (error) {
    console.error("❌ Sent Fetch Error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/users", async (req, res) => {
  const { User, Post, Comment } = req.app.get("db");
  try {
    let users = [];
    if (req.user.userType === "admin") {
      users = []; // Admin sees no one
      console.log("✅ Admin user fetch blocked:", req.user.id);
    } else if (req.user.userType === "shop") {
      const designers = await User.findAll({
        where: { userType: "designer" },
        attributes: ["id", "username"],
      });
      const posts = await Post.findAll({
        where: { feedType: "booking" },
        include: [{ model: Comment, as: "comments", where: { userId: req.user.id } }],
      });
      const fanIds = posts.map(post => post.clientId).filter(id => id);
      const fans = fanIds.length > 0 ? await User.findAll({
        where: { id: fanIds, userType: "fan" },
        attributes: ["id", "username"],
      }) : [];
      users = [...designers, ...fans];
    } else if (req.user.userType === "designer") {
      users = await User.findAll({
        where: { userType: "shop" },
        attributes: ["id", "username"],
      });
    } else if (req.user.userType === "fan") {
      users = await User.findAll({
        where: { userType: "shop" },
        attributes: ["id", "username"],
      });
    }

    console.log("✅ Users fetched for:", req.user.id, "Users:", users.map(u => ({ id: u.id, username: u.username })));
    res.json({ users });
  } catch (error) {
    console.error("❌ Users Fetch Error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/send", upload, async (req, res) => {
  const { Message, User, Notification, Post, Comment } = req.app.get("db");
  const clients = req.app.get("wsClients");
  const { receiverId, content } = req.body;

  try {
    if (!receiverId || !content) {
      return res.status(400).json({ message: "Receiver ID and content required" });
    }

    const receiver = await User.findByPk(receiverId);
    if (!receiver) {
      console.log("❌ Receiver not found:", receiverId);
      return res.status(404).json({ message: "Receiver not found" });
    }

    const sender = await User.findByPk(req.user.id);
    if (!sender) {
      console.log("❌ Sender not found:", req.user.id);
      return res.status(404).json({ message: "Sender not found" });
    }

    if (sender.userType === "admin" || receiver.userType === "admin") {
      console.log("❌ Admin cannot send or receive messages:", sender.id, "to", receiver.id);
      return res.status(403).json({ message: "Admin cannot send or receive messages" });
    }

    const validPairs = {
      shop: ["designer", "fan"],
      designer: ["shop"],
      fan: ["shop"],
    };
    if (!validPairs[sender.userType]?.includes(receiver.userType)) {
      console.log("❌ Invalid sender-receiver pair:", sender.userType, "to", receiver.userType);
      return res.status(403).json({ message: "Invalid sender-receiver pair" });
    }

    if (sender.userType === "shop" && receiver.userType === "fan") {
      const post = await Post.findOne({
        where: { feedType: "booking", clientId: receiver.id },
        include: [{ model: Comment, as: "comments", where: { userId: sender.id } }],
      });
      if (!post) {
        console.log("❌ Shop has no pitch on Fan's booking post:", sender.id, "to", receiver.id);
        return res.status(403).json({ message: "Shop must pitch to Fan’s booking request first" });
      }
    }

    // Handle image uploads
    let imageFilenames = [];
    if (req.files && req.files.length > 0) {
      console.log("🔍 Applying watermark to message images");
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

    const message = await Message.create({
      id: require("uuid").v4(),
      senderId: req.user.id,
      receiverId,
      content,
      isRead: false,
      images: imageFilenames,
    });

    const ws = clients.get(receiverId);
    if (ws && ws.readyState === 1) {
      console.log("🔍 Sending WebSocket message to:", receiverId, "Payload:", { type: "message", message });
      ws.send(JSON.stringify({ type: "message", message }));
      console.log("✅ WebSocket message sent to:", receiverId);
    } else {
      console.warn("⚠️ Receiver's WebSocket client not available:", receiverId);
    }

    const notificationMessage = `New message from ${sender.username}`;
    const notification = await Notification.create({
      id: require("uuid").v4(),
      userId: receiverId,
      message: notificationMessage,
    });
    console.log("🔍 Notification created for:", receiverId);

    const receiverClient = clients.get(receiverId);
    if (receiverClient && receiverClient.readyState === 1) {
      console.log("🔍 Sending WebSocket notification to:", receiverId, "Payload:", { type: "notification", data: notification.message, userId: receiverId });
      receiverClient.send(JSON.stringify({ 
        type: "notification", 
        data: notification.message,
        userId: receiverId 
      }));
      console.log("✅ WebSocket notification sent to:", receiverId);
    } else {
      console.warn("⚠️ Receiver's WebSocket client not available for notification:", receiverId);
    }

    console.log("✅ Message sent from:", req.user.id, "to:", receiverId);
    res.status(201).json({ message: "Message sent", data: message });
  } catch (error) {
    console.error("❌ Send Message Error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/mark-read", async (req, res) => {
  const { Message } = req.app.get("db");
  const clients = req.app.get("wsClients");
  try {
    const { messageId } = req.body;
    if (!messageId) {
      return res.status(400).json({ message: "Message ID required" });
    }

    const message = await Message.findByPk(messageId);
    if (!message || message.receiverId !== req.user.id) {
      return res.status(404).json({ message: "Message not found or not yours" });
    }

    await message.update({ isRead: true });
    console.log("✅ Message marked as read:", messageId);

    [message.senderId, message.receiverId].forEach((id) => {
      const client = clients.get(id);
      if (client && client.readyState === 1) {
        client.send(JSON.stringify({ type: "message", message }));
        console.log("✅ WebSocket message update sent to:", id);
      }
    });

    res.json({ message: "Marked as read" });
  } catch (error) {
    console.error("❌ Mark Read Error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;