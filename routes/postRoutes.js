const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const sharp = require("sharp");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const CalendarIntegrationService = require("../services/CalendarIntegrationService");

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
  const watermarkText = "SPCapital \u00A9";

  try {
    const { width, height } = await sharp(buffer).metadata();

    const watermarkSVG = `<svg width="${width / 2}" height="${height / 10}">
      <text x="10" y="${height / 15}" font-family="Arial" font-size="30" fill="black">${watermarkText}</text>
    </svg>`;

    await sharp(buffer)
      .composite([
        {
          input: Buffer.from(watermarkSVG),
          gravity: "centre",
          top: 20,
          left: 10,
        },
      ])
      .toFile(outputFilePath);

    console.log("✅ Watermark added to:", outputFilePath);
    return outputFilePath;
  } catch (error) {
    console.error("❌ Error adding watermark:", error.message);
    throw new Error("Error adding watermark: " + error.message);
  }
};

module.exports = (wss) => {
  router.post("/", upload, async (req, res) => {
    console.log("🔍 Files received:", req.files);
    console.log("🔍 Body after multer:", req.body);

    if (req.files && req.files.length > 0) {
      console.log("🔍 Applying watermark to uploaded files");
      try {
        for (const file of req.files) {
          const filePath = path.join("uploads", file.filename);
          const outputFilePath = path.join("uploads", "watermarked-" + file.filename);
          const buffer = fs.readFileSync(filePath);
          const watermarkedFilePath = await addWatermark(buffer, outputFilePath);
          fs.unlinkSync(filePath);
          file.filename = path.basename(watermarkedFilePath);
        }
      } catch (error) {
        console.error("❌ Watermark Application Error:", error.message);
        return res.status(500).json({ message: "Error applying watermark", error: error.message });
      }
    }

    const { Post, User, Notification } = req.app.get("db");
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
        id: uuidv4(),
        userId: user.id,
        title,
        description,
        location,
        feedType,
        status: "open",
        images: req.files ? req.files.map((file) => file.filename) : [],
        createdAt: new Date(),
        updatedAt: new Date(),
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

      const designers = await User.findAll({ where: { userType: "designer" } });
      const notificationMessage = feedType === "design"
        ? `New design request posted by ${user.username}: "${title}"`
        : `New booking request posted by ${user.username}: "${title}"`;

      for (const designer of designers) {
        const notification = await Notification.create({
          id: uuidv4(),
          userId: designer.id,
          message: notificationMessage,
          isRead: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        if (wss && wss.clients) {
          wss.clients.forEach((client) => {
            if (client.readyState === 1) {
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
      res.status(500).json({ message: "Server error", error: error.message });
    }
  });

  router.post("/:id/schedule", async (req, res) => {
    const { Post, User, Notification, Message } = req.app.get("db");
    const { id } = req.params;
    const { scheduledDate, contactInfo } = req.body;

    try {
      if (!scheduledDate || !contactInfo || !contactInfo.phone || !contactInfo.email) {
        return res.status(400).json({ message: "Missing required fields: scheduledDate, contactInfo (phone, email)" });
      }

      const post = await Post.findByPk(id, {
        include: [
          { model: User, as: "user", attributes: ["id", "firstName", "lastName", "username", "email"] },
        ],
      });
      if (!post) {
        return res.status(404).json({ message: "Post not found" });
      }

      if (post.feedType !== "booking") {
        return res.status(400).json({ message: "Post must be a booking" });
      }
      if (post.userId !== req.user.id) {
        return res.status(403).json({ message: "You can only schedule your own bookings" });
      }
      if (!post.shopId) {
        return res.status(400).json({ message: "A pitch must be accepted before scheduling" });
      }
      if (post.status === "scheduled") {
        return res.status(400).json({ message: "Booking is already scheduled" });
      }

      const shop = await User.findByPk(post.shopId, {
        attributes: ["id", "firstName", "lastName", "depositSettings", "email", "calendarIntegrations"],
      });
      if (!shop) {
        return res.status(404).json({ message: "Shop not found" });
      }

      const fan = await User.findByPk(req.user.id, {
        attributes: ["id", "firstName", "lastName", "email", "calendarIntegrations"],
      });
      if (!fan) {
        return res.status(404).json({ message: "Fan not found" });
      }

      const eventData = {
        title: `Tattoo Appointment: ${post.title}`,
        description: `Booking with ${shop.firstName} ${shop.lastName} (${shop.email}) and ${fan.firstName} ${fan.lastName} (${fan.email})`,
        start: scheduledDate,
        end: new Date(new Date(scheduledDate).getTime() + 60 * 60 * 1000),
        organizer: { name: `${fan.firstName} ${fan.lastName}`, email: fan.email },
        attendees: [
          { name: `${fan.firstName} ${fan.lastName}`, email: fan.email },
          { name: `${shop.firstName} ${shop.lastName}`, email: shop.email },
        ],
      };

      const fanResult = await CalendarIntegrationService.createEvent(fan, eventData);
      const shopResult = await CalendarIntegrationService.createEvent(shop, eventData);

      const depositAmount = shop.depositSettings?.amount || 0;
      await post.update({
        scheduledDate,
        contactInfo,
        depositAmount,
        depositStatus: "pending",
        status: "scheduled",
        externalEventIds: { fan: fanResult.externalEventIds, shop: shopResult.externalEventIds },
      });

      const fanNotification = {
        id: uuidv4(),
        userId: req.user.id,
        message: `Your booking "${post.title}" has been scheduled with ${shop.firstName} ${shop.lastName} on ${new Date(scheduledDate).toLocaleString()}.`,
        isRead: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const shopNotification = {
        id: uuidv4(),
        userId: shop.id,
        message: `${req.user.firstName} ${req.user.lastName} scheduled an ink for "${post.title}" on ${new Date(scheduledDate).toLocaleString()}.`,
        isRead: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await Notification.bulkCreate([fanNotification, shopNotification]);

      if (wss && wss.clients && wss.clients.size > 0) {
        [fanNotification, shopNotification].forEach((notification) => {
          wss.clients.forEach((client) => {
            if (client.readyState === 1) {
              client.send(
                JSON.stringify({
                  type: "notification",
                  userId: notification.userId,
                  data: notification.message,
                })
              );
            }
          });
        });
        console.log("✅ WebSocket notifications sent for scheduling");
      } else {
        console.warn("⚠️ WebSocket server not available, notifications stored in DB");
      }

      const message = {
        id: uuidv4(),
        senderId: req.user.id,
        receiverId: shop.id,
        content: `I’ve scheduled our ink for ${new Date(scheduledDate).toLocaleString()}. Let’s confirm the details!`,
        images: [],
        createdAt: new Date(),
        isRead: false,
      };
      await Message.create(message);

      if (wss && wss.clients && wss.clients.size > 0) {
        wss.clients.forEach((client) => {
          if (client.readyState === 1) {
            client.send(
              JSON.stringify({
                type: "message",
                message,
              })
            );
          }
        });
        console.log("✅ WebSocket message sent for auto-created message");
      }

      console.log("✅ Scheduled ink for post:", id, "by user:", req.user.id);
      res.json({ message: "Ink scheduled successfully", post, icsContent: { fan: fanResult.icsContent, shop: shopResult.icsContent } });
    } catch (error) {
      console.error("❌ Schedule Ink Error:", error.message);
      res.status(500).json({ message: "Server error", error: error.message });
    }
  });

  router.get("/:id/ics", async (req, res) => {
    const { Post } = req.app.get("db");
    const { id } = req.params;

    try {
      const post = await Post.findByPk(id);
      if (!post) {
        return res.status(404).json({ message: "Post not found" });
      }

      if (post.userId !== req.user.id && post.shopId !== req.user.id) {
        return res.status(403).json({ message: "You can only access your own events" });
      }

      if (!post.scheduledDate) {
        return res.status(400).json({ message: "No scheduled date for this post" });
      }

      const userType = req.user.userType;
      const icsContent = userType === "fan" ? post.icsContent?.fan : post.icsContent?.shop;

      if (!icsContent) {
        return res.status(404).json({ message: "No calendar event found for this user" });
      }

      res.setHeader("Content-Type", "text/calendar");
      res.setHeader("Content-Disposition", `attachment; filename=event-${id}.ics`);
      res.send(icsContent);
    } catch (error) {
      console.error("❌ ICS Download Error:", error.message);
      res.status(500).json({ message: "Server error" });
    }
  });

  router.post("/:id/accept-pitch", async (req, res) => {
    const { Post, Comment, User, Notification } = req.app.get("db");
    const clients = req.app.get("wsClients");
    const { id } = req.params;
    const { commentId, shopId } = req.body;

    try {
      const post = await Post.findByPk(id);
      if (!post) {
        return res.status(404).json({ message: "Post not found" });
      }

      if (post.userId !== req.user.id) {
        return res.status(403).json({ message: "You can only accept pitches for your own posts" });
      }

      if (post.feedType !== "booking") {
        return res.status(400).json({ message: "Can only accept pitches on booking posts" });
      }

      const comment = await Comment.findByPk(commentId);
      if (!comment || comment.postId !== id) {
        return res.status(404).json({ message: "Comment not found" });
      }

      if (comment.withdrawn) {
        return res.status(400).json({ message: "Cannot accept a withdrawn pitch" });
      }

      const shop = await User.findByPk(shopId);
      if (!shop || shop.userType !== "shop") {
        return res.status(404).json({ message: "Shop not found" });
      }

      await post.update({ shopId, status: "accepted" });
      console.log("✅ Accepted pitch for post:", id, "shopId:", shopId);

      const notification = {
        id: uuidv4(),
        userId: shopId,
        message: `Your pitch on "${post.title}" has been accepted by ${req.user.firstName} ${req.user.lastName}.`,
        isRead: false,
        createdAt: new Date(),
      };
      await Notification.create(notification);
      console.log("✅ Created notification for shop:", shopId);

      const shopClient = clients.get(shopId);
      if (shopClient && shopClient.readyState === 1) {
        console.log("🔍 Sending WebSocket notification for pitch acceptance");
        shopClient.send(JSON.stringify({ type: "notification", data: notification.message }));
        console.log("✅ WebSocket notification sent for pitch acceptance");
      } else {
        console.warn("⚠️ Shop's WebSocket client not available:", shopId);
      }

      res.json({ message: "Pitch accepted successfully", post });
    } catch (error) {
      console.error("❌ Accept Pitch Error:", error.message);
      res.status(500).json({ message: "Server error" });
    }
  });

  router.delete("/:id", async (req, res) => {
    const { Post } = req.app.get("db");
    const { id } = req.params;

    try {
      if (!req.user || req.user.isAdmin !== true) {
        return res.status(403).json({ message: "Admins only" });
      }

      const post = await Post.findByPk(id);
      if (!post) {
        return res.status(404).json({ message: "Post not found" });
      }

      await post.destroy();
      console.log("✅ Post deleted by admin:", req.user.id, "Post ID:", id);
      res.json({ message: "Post deleted successfully" });
    } catch (error) {
      console.error("❌ Delete Post Error:", error.message);
      res.status(500).json({ message: "Server error" });
    }
  });

  return router;
};