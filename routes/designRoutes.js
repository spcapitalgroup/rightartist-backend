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
    // Verify file exists after writing
    if (fs.existsSync(outputFilePath)) {
      console.log("✅ File verified on disk:", outputFilePath);
    } else {
      console.error("❌ File not found on disk after writing:", outputFilePath);
    }
    return outputFilePath;
  } catch (error) {
    console.error("❌ Error adding watermark:", error.message);
    throw new Error("Error adding watermark: " + error.message);
  }
};

router.get("/pending", async (req, res) => {
  const { Design, User, Post, Comment } = req.app.get("db");
  try {
    const userType = req.user.userType;
    if (userType !== "designer" && userType !== "shop") {
      return res.status(403).json({ message: "Only designers and shop users can access designs" });
    }

    const whereCondition = {
      status: "pending",
      [userType === "designer" ? "designerId" : "shopId"]: req.user.id,
    };

    const designs = await Design.findAll({
      where: whereCondition,
      include: [
        { model: User, as: "designer", attributes: ["id", "username"] },
        { model: User, as: "shop", attributes: ["id", "username"] },
        { model: Post, as: "Post", attributes: ["id", "title"] },
        { model: Comment, attributes: ["id", "content"] },
      ],
      order: [["createdAt", "DESC"]],
    });

    console.log(`✅ Fetched pending designs for ${userType}:`, req.user.id);
    res.json({ designs });
  } catch (error) {
    console.error("❌ Fetch Pending Designs Error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/purchased", async (req, res) => {
  const { Design, User, Post, Comment } = req.app.get("db");
  try {
    const userType = req.user.userType;
    if (userType !== "shop") {
      return res.status(403).json({ message: "Only shop users can access purchased designs" });
    }

    const designs = await Design.findAll({
      where: {
        status: "purchased",
        shopId: req.user.id,
      },
      include: [
        { model: User, as: "designer", attributes: ["id", "username"] },
        { model: User, as: "shop", attributes: ["id", "username"] },
        { model: Post, as: "Post", attributes: ["id", "title"] },
        { model: Comment, attributes: ["id", "content"] },
      ],
      order: [["updatedAt", "DESC"]],
    });

    console.log("✅ Fetched purchased designs for shop:", req.user.id);
    res.json({ designs });
  } catch (error) {
    console.error("❌ Fetch Purchased Designs Error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

// New endpoint for designers to fetch sold designs
router.get("/sold", async (req, res) => {
  const { Design, User, Post, Comment } = req.app.get("db");
  try {
    const userType = req.user.userType;
    if (userType !== "designer") {
      return res.status(403).json({ message: "Only designers can access sold designs" });
    }

    const designs = await Design.findAll({
      where: {
        status: "purchased",
        designerId: req.user.id,
      },
      include: [
        { model: User, as: "designer", attributes: ["id", "username"] },
        { model: User, as: "shop", attributes: ["id", "username"] },
        { model: Post, as: "Post", attributes: ["id", "title"] },
        { model: Comment, attributes: ["id", "content"] },
      ],
      order: [["updatedAt", "DESC"]],
    });

    console.log("✅ Fetched sold designs for designer:", req.user.id);
    res.json({ designs });
  } catch (error) {
    console.error("❌ Fetch Sold Designs Error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/accept/:commentId", async (req, res) => {
  const { Design, Comment, Post, User, Notification } = req.app.get("db");
  const clients = req.app.get("wsClients");
  const { commentId } = req.params;

  try {
    const comment = await Comment.findByPk(commentId, {
      include: [{ model: Post, as: "Post" }],
    });
    if (!comment) {
      return res.status(404).json({ message: "Comment not found" });
    }

    console.log("🔍 Comment fetched:", comment.toJSON());
    const post = comment.Post;
    console.log("🔍 Post associated with comment:", post ? post.toJSON() : null);
    console.log("🔍 Post feedType (raw):", post?.feedType, "Type of feedType:", typeof post?.feedType);
    const feedType = post?.feedType ? String(post.feedType).trim() : null;
    console.log("🔍 Post feedType (normalized):", feedType);
    if (!post || feedType !== "design") {
      console.log("❌ Post feedType check failed - feedType:", feedType);
      return res.status(400).json({ message: "Comment must belong to a design feed post" });
    }

    if (post.shopId !== req.user.id) {
      return res.status(403).json({ message: "Only the shop owner can accept a design" });
    }

    const user = await User.findByPk(req.user.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const designer = await User.findByPk(comment.userId);
    if (!designer || designer.userType !== "designer") {
      return res.status(400).json({ message: "Comment must belong to a designer" });
    }

    const existingDesign = await Design.findOne({
      where: { commentId },
    });
    if (existingDesign) {
      return res.status(400).json({ message: "Design already accepted" });
    }

    const design = await Design.create({
      id: require("uuid").v4(),
      designerId: comment.userId,
      shopId: req.user.id,
      postId: post.id,
      commentId,
      stage: "initial_sketch",
      status: "pending",
      price: comment.price || 0,
      images: [],
    });

    const notificationMessage = `Your design for "${post.title}" has been accepted by ${user.username}`;
    const notification = await Notification.create({
      id: require("uuid").v4(),
      userId: designer.id,
      message: notificationMessage,
    });

    const designerClient = clients.get(designer.id);
    if (designerClient && designerClient.readyState === 1) {
      designerClient.send(JSON.stringify({ type: "notification", data: notification.message }));
      console.log("✅ WebSocket notification sent to designer:", designer.id);
    }

    console.log("✅ Design accepted:", design.id);
    res.status(201).json({ message: "Design accepted", data: design });
  } catch (error) {
    console.error("❌ Accept Design Error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

router.put("/:designId/stage", upload, async (req, res) => {
  const { Design, User, Notification } = req.app.get("db");
  const clients = req.app.get("wsClients");
  const { designId } = req.params;
  const { stage } = req.body;

  try {
    if (!stage || !["initial_sketch", "revision_1", "revision_2", "revision_3", "final_draft", "final_design"].includes(stage)) {
      return res.status(400).json({ message: "Invalid stage" });
    }

    const design = await Design.findByPk(designId, {
      include: [
        { model: User, as: "designer" },
        { model: User, as: "shop" },
      ],
    });
    if (!design) {
      return res.status(404).json({ message: "Design not found" });
    }

    if (design.designerId !== req.user.id) {
      return res.status(403).json({ message: "Only the designer can update the stage" });
    }

    if (design.status !== "pending") {
      return res.status(400).json({ message: "Cannot update stage of a purchased design" });
    }

    let imageFilenames = design.images || [];
    if (req.files && req.files.length > 0) {
      console.log("🔍 Applying watermark to design stage images");
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

    await design.update({ stage, images: imageFilenames });

    const notificationMessage = `Design stage updated to "${stage}" by ${design.designer.username}`;
    const notification = await Notification.create({
      id: require("uuid").v4(),
      userId: design.shopId,
      message: notificationMessage,
    });

    const shopClient = clients.get(design.shopId);
    if (shopClient && shopClient.readyState === 1) {
      shopClient.send(JSON.stringify({ type: "notification", data: notification.message }));
      console.log("✅ WebSocket notification sent to shop:", design.shopId);
    }

    console.log("✅ Design stage updated:", design.id);
    res.json({ message: "Stage updated", data: design });
  } catch (error) {
    console.error("❌ Update Design Stage Error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/:designId/purchase", async (req, res) => {
  const { Design, User, Payment, Notification } = req.app.get("db");
  const clients = req.app.get("wsClients");
  const { designId } = req.params;

  try {
    const design = await Design.findByPk(designId, {
      include: [
        { model: User, as: "designer" },
        { model: User, as: "shop" },
      ],
    });
    if (!design) {
      return res.status(404).json({ message: "Design not found" });
    }

    if (design.shopId !== req.user.id) {
      return res.status(403).json({ message: "Only the shop owner can purchase the design" });
    }

    if (design.status !== "pending") {
      return res.status(400).json({ message: "Design already purchased" });
    }

    if (design.stage !== "final_design") {
      return res.status(400).json({ message: "Design must be in final_design stage to purchase" });
    }

    await design.update({ status: "purchased" });

    await Payment.create({
      id: require("uuid").v4(),
      userId: req.user.id,
      amount: design.price,
      status: "completed",
      type: "design_purchase",
    });

    const notificationMessage = `Your design has been purchased by ${design.shop.username} for $${design.price}`;
    const notification = await Notification.create({
      id: require("uuid").v4(),
      userId: design.designerId,
      message: notificationMessage,
    });

    const designerClient = clients.get(design.designerId);
    if (designerClient && designerClient.readyState === 1) {
      designerClient.send(JSON.stringify({ type: "notification", data: notification.message }));
      console.log("✅ WebSocket notification sent to designer:", design.designerId);
    }

    console.log("✅ Design purchased:", design.id);
    res.json({ message: "Design purchased", data: design });
  } catch (error) {
    console.error("❌ Purchase Design Error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;