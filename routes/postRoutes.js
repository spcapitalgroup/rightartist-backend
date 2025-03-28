const express = require("express");
const router = express.Router();
const formidable = require("formidable");
const path = require("path");
const sharp = require("sharp");
const fs = require("fs").promises;
const { v4: uuidv4 } = require("uuid");
const CalendarIntegrationService = require("../services/CalendarIntegrationService");

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
  // GET /api/posts/:postId - Get post details
  router.get("/:postId", async (req, res) => {
    const { Post, User, Comment } = req.app.get("db");
    const { postId } = req.params;

    try {
      const post = await Post.findByPk(postId, {
        include: [
          { model: User, as: "user", attributes: ["id", "username"] },
          { model: User, as: "client", attributes: ["id", "username"] },
          { model: User, as: "shop", attributes: ["id", "username"] },
          {
            model: Comment,
            as: "comments",
            include: [
              { model: User, as: "user", attributes: ["id", "username"] },
              {
                model: Comment,
                as: "replies",
                include: [{ model: User, as: "user", attributes: ["id", "username"] }],
              },
            ],
          },
        ],
      });

      if (!post) {
        return res.status(404).json({ message: "Post not found" });
      }

      res.json(post);
    } catch (error) {
      console.error("Error fetching post:", error);
      res.status(500).json({ message: "Server error" });
    }
  });

  // GET /api/posts/user/:userId/design - Get design posts for a user
  router.get("/user/:userId/design", async (req, res) => {
    const { Post, User } = req.app.get("db");
    const { userId } = req.params;

    try {
      const posts = await Post.findAll({
        where: {
          userId,
          feedType: "design",
        },
        include: [
          { model: User, as: "user", attributes: ["id", "username"] },
        ],
        order: [["createdAt", "DESC"]],
      });

      res.json({ posts });
    } catch (error) {
      console.error("Error fetching design posts for user:", error);
      res.status(500).json({ message: "Server error" });
    }
  });

  // POST /api/posts/create - Create a new post (JSON-based)
  router.post("/create", async (req, res) => {
    console.log("🔍 Entering /api/posts/create endpoint");
    console.log("🔍 Request Body:", req.body);

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
        images: [], // No file uploads for now
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
          id: uuidv4(),
          userId: designer.id,
          message: notificationMessage,
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

  // POST /api/posts/upload-images - Upload images for a post
  router.post("/upload-images", async (req, res) => {
    console.log("🔍 Entering /api/posts/upload-images endpoint");

    const { Post } = req.app.get("db");
    const form = new formidable.IncomingForm({
      uploadDir: path.join(__dirname, "../uploads"),
      keepExtensions: true,
      maxFileSize: 5 * 1024 * 1024, // 5MB limit
      multiples: true,
      filter: ({ mimetype }) => {
        const filetypes = /jpeg|jpg|png/;
        return mimetype && filetypes.test(mimetype);
      },
    });

    form.parse(req, async (err, fields, files) => {
      if (err) {
        console.error("❌ Formidable Error:", err.message);
        return res.status(400).json({ message: "Error parsing form data: " + err.message });
      }

      try {
        const postId = fields.postId;
        if (!postId) {
          return res.status(400).json({ message: "Missing postId" });
        }

        const post = await Post.findByPk(postId);
        if (!post) {
          return res.status(404).json({ message: "Post not found" });
        }

        if (post.userId !== req.user.id) {
          return res.status(403).json({ message: "You can only upload images for your own posts" });
        }

        const images = files.images;
        if (!images) {
          return res.status(400).json({ message: "No images provided" });
        }

        const imageArray = Array.isArray(images) ? images : [images];
        const uploadedImages = [];

        for (const image of imageArray) {
          const oldPath = image.filepath;
          const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
          const newFilename = `${uniqueSuffix}${path.extname(image.originalFilename)}`;
          const newPath = path.join(__dirname, "../uploads", newFilename);
          const watermarkedPath = path.join(__dirname, "../uploads", `watermarked-${newFilename}`);

          // Move the file to the uploads directory
          await fs.rename(oldPath, newPath);

          // Apply watermark
          const buffer = await fs.readFile(newPath);
          await addWatermark(buffer, watermarkedPath);

          // Delete the original file
          await fs.unlink(newPath);

          uploadedImages.push(`watermarked-${newFilename}`);
        }

        // Update the post with the new images
        const currentImages = post.images || [];
        post.images = [...currentImages, ...uploadedImages];
        await post.save();

        console.log("✅ Images uploaded and watermarked:", uploadedImages);
        res.status(200).json({ message: "Images uploaded successfully", images: uploadedImages });
      } catch (error) {
        console.error("❌ Image Upload Error:", error.message);
        res.status(500).json({ message: "Server error", error: error.message });
      }
    });
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

  // PUT /api/posts/:postId/accept - Accept a comment
  router.put("/:postId/accept", async (req, res) => {
    const { Post, Comment, User, Notification } = req.app.get("db");
    const clients = req.app.get("wsClients");
    const { postId } = req.params;
    const { commentId } = req.body;

    try {
      const post = await Post.findByPk(postId);
      if (!post) {
        return res.status(404).json({ message: "Post not found" });
      }

      // Ensure the authenticated user is the shop owner
      if (req.user.id !== post.shopId) {
        return res.status(403).json({ message: "Unauthorized" });
      }

      const comment = await Comment.findByPk(commentId);
      if (!comment || comment.postId !== postId) {
        return res.status(404).json({ message: "Comment not found" });
      }

      if (comment.withdrawn) {
        return res.status(400).json({ message: "Cannot accept a withdrawn comment" });
      }

      post.status = "accepted";
      await post.save();

      const user = await User.findByPk(comment.userId);
      if (!user) {
        return res.status(404).json({ message: "Comment author not found" });
      }

      const notification = {
        id: uuidv4(),
        userId: comment.userId,
        message: `Your comment on "${post.title}" has been accepted by ${req.user.firstName} ${req.user.lastName}.`,
        isRead: false,
        createdAt: new Date(),
      };
      await Notification.create(notification);

      const client = clients.get(comment.userId);
      if (client && client.readyState === 1) {
        client.send(JSON.stringify({ type: "notification", data: notification.message }));
        console.log("✅ WebSocket notification sent for comment acceptance");
      } else {
        console.warn("⚠️ User's WebSocket client not available:", comment.userId);
      }

      res.json(post);
    } catch (error) {
      console.error("Error accepting comment:", error);
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