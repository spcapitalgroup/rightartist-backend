const express = require("express");
const router = express.Router();
const multer = require("multer");
const cloudinary = require("cloudinary").v2;

// Configure Multer for temporary file uploads (we'll upload to Cloudinary)
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    console.log("🔍 Multer received file:", file);
    const filetypes = /jpeg|jpg|png/;
    const extname = filetypes.test(file.originalname.toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error("Only JPEG/JPG/PNG images are allowed"));
  },
  limits: { fileSize: 5 * 1024 * 1024 },
}).array("images", 5);

router.get("/inbox", async (req, res) => {
  const { Message, User } = req.app.get("db");
  try {
    const messages = await Message.findAll({
      where: { receiverId: req.user.id },
      order: [["createdAt", "DESC"]],
      include: [
        { model: User, as: "sender", attributes: ["id", "username"] },
        { model: User, as: "receiver", attributes: ["id", "username"] },
      ],
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
      include: [
        { model: User, as: "sender", attributes: ["id", "username"] },
        { model: User, as: "receiver", attributes: ["id", "username"] },
      ],
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
  const { Message, User, Notification } = req.app.get("db");
  const clients = req.app.get("wsClients");
  const { receiverId, content, designId, stage } = req.body;

  try {
    if (!receiverId || !content) {
      return res.status(400).json({ message: "Receiver ID and content required" });
    }

    if (stage && !["initial_sketch", "revision_1", "revision_2", "revision_3", "final_draft", "final_design"].includes(stage)) {
      return res.status(400).json({ message: "Invalid stage" });
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

    let design = null;
    if (designId) {
      design = await Design.findByPk(designId);
      if (!design) {
        return res.status(404).json({ message: "Design not found" });
      }
      if (design.designerId !== req.user.id && design.shopId !== req.user.id) {
        return res.status(403).json({ message: "You can only send messages related to designs you are part of" });
      }
    }

    // Handle image uploads to Cloudinary with watermark
    let imageUrls = [];
    if (req.files && req.files.length > 0) {
      console.log("🔍 Uploading message images to Cloudinary");
      for (const file of req.files) {
        const result = await cloudinary.uploader.upload_stream(
          {
            folder: "rightartist/messages",
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
    }

    const message = await Message.create({
      id: require("uuid").v4(),
      senderId: req.user.id,
      receiverId,
      content,
      designId: designId || null,
      stage: stage || null,
      isRead: false,
      images: imageUrls,
    });

    const ws = clients.get(receiverId);
    if (ws && ws.readyState === 1) {
      console.log("🔍 Sending WebSocket message to:", receiverId, "Payload:", { type: "message", message });
      ws.send(JSON.stringify({ type: "message", message }));
      console.log("✅ WebSocket message sent to:", receiverId);
    } else {
      console.warn("⚠️ Receiver's WebSocket client not available:", receiverId);
    }

    // If this is a stage update, notify DesignsPage
    if (designId && stage) {
      const senderClient = clients.get(req.user.id);
      const receiverClient = clients.get(receiverId);
      if (senderClient && senderClient.readyState === 1) {
        senderClient.send(JSON.stringify({ type: "stage-update", designId }));
        console.log("✅ WebSocket stage-update sent to sender:", req.user.id);
      }
      if (receiverClient && receiverClient.readyState === 1) {
        receiverClient.send(JSON.stringify({ type: "stage-update", designId }));
        console.log("✅ WebSocket stage-update sent to receiver:", receiverId);
      }
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