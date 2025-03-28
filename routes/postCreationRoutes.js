const express = require("express");
const router = express.Router();
const { v4: uuidv4 } = require("uuid");
const formidable = require("formidable");
const path = require("path");
const sharp = require("sharp");
const fs = require("fs").promises;

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

module.exports = (wss) => {
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
      res.status(500).json({ message: "Server error", error: error.message });
    }
  });

  // POST /api/posts/upload-images - Upload images for a post
  router.post("/upload-images", async (req, res) => {
    console.log("🔍 Entering /api/posts/upload-images endpoint");

    const { Post } = req.app.get("db");
    const form = new formidable.IncomingForm({
      uploadDir: path.join(__dirname, "../../uploads"),
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
          const newPath = path.join(__dirname, "../../uploads", newFilename);
          const watermarkedPath = path.join(__dirname, "../../uploads", `watermarked-${newFilename}`);

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

  return router;
};