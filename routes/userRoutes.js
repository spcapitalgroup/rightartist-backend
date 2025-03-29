const express = require("express");
const router = express.Router();
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
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

// GET /api/users/:userId - Get user details
router.get("/:userId", async (req, res) => {
  const { User } = req.app.get("db");
  const { userId } = req.params;

  try {
    const user = await User.findByPk(userId, {
      attributes: [
        "id",
        "firstName",
        "lastName",
        "username",
        "email",
        "userType",
        "isPaid",
        "isAdmin",
        "depositSettings",
        "calendarIntegrations",
        "portfolio",
        "bio",
        "location",
        "operatingHours",
        "socialLinks",
        "createdAt",
        "updatedAt",
      ],
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(user);
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Get all users (admin-only)
router.get("/", async (req, res) => {
  const { User } = req.app.get("db");
  try {
    console.log("🔍 Entering /api/users endpoint");
    console.log("🔍 req.user:", req.user);
    console.log("🔍 req.user.isAdmin:", req.user?.isAdmin);
    if (!req.user || req.user.isAdmin !== true) {
      console.log("❌ Admin check failed - req.user:", req.user);
      return res.status(403).json({ message: "Admins only" });
    }

    const users = await User.findAll({
      attributes: ["id", "username", "email", "userType", "createdAt"],
    });

    console.log("✅ Users fetched for admin:", req.user.id);
    res.json({ users });
  } catch (error) {
    console.error("❌ Fetch Users Error:", error.message);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Delete a user (admin-only)
router.delete("/:id", async (req, res) => {
  const { User } = req.app.get("db");
  const { id } = req.params;
  try {
    console.log("🔍 Entering /api/users/:id DELETE endpoint");
    console.log("🔍 req.user:", req.user);
    console.log("🔍 req.user.isAdmin:", req.user?.isAdmin);
    if (!req.user || req.user.isAdmin !== true) {
      console.log("❌ Admin check failed - req.user:", req.user);
      return res.status(403).json({ message: "Admins only" });
    }

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    await user.destroy();
    console.log("✅ User deleted by admin:", req.user.id, "User ID:", id);
    res.json({ message: "User deleted successfully" });
  } catch (error) {
    console.error("❌ Delete User Error:", error.message);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// GET /api/users/:id/profile - Fetch user profile data
router.get("/:id/profile", async (req, res) => {
  const { User, Review } = req.app.get("db");
  const { id } = req.params;

  try {
    const user = await User.findByPk(id, {
      attributes: [
        "id",
        "firstName",
        "lastName",
        "username",
        "userType",
        "portfolio",
        "bio",
        "location",
        "operatingHours",
        "socialLinks",
      ],
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Social links visibility rules
    let socialLinks = user.socialLinks;
    if (req.user) {
      const requestingUserType = req.user.userType;
      const targetUserType = user.userType;
      if (
        (requestingUserType === "shop" && targetUserType === "designer") ||
        (requestingUserType === "designer" && targetUserType === "shop")
      ) {
        socialLinks = {}; // Hide social links
      }
    }

    // Fetch reviews for this user
    const reviews = await Review.findAll({
      where: { targetUserId: id },
      include: [{ model: User, as: "user", attributes: ["id", "username"] }],
      order: [["createdAt", "DESC"]],
    });

    // Calculate average rating
    const averageRating = reviews.length > 0
      ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length
      : 0;

    res.json({ user: { ...user.toJSON(), socialLinks }, reviews, averageRating });
  } catch (error) {
    console.error("❌ Fetch Profile Error:", error.message);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// POST /api/users/:id/portfolio - Add portfolio images
router.post("/:id/portfolio", upload, async (req, res) => {
  const { User } = req.app.get("db");
  const { id } = req.params;
  const { style, description } = req.body;

  try {
    if (!req.user || req.user.id !== id) {
      return res.status(403).json({ message: "You can only update your own portfolio" });
    }

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: "No images uploaded" });
    }

    const newImages = [];
    for (const file of req.files) {
      const result = await cloudinary.uploader.upload_stream(
        {
          folder: "rightartist/portfolio",
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

      newImages.push({
        imageUrl: result.secure_url,
        style: style || "Unknown",
        date: new Date().toISOString(),
        description: description || "",
      });
    }

    const updatedPortfolio = [...(user.portfolio || []), ...newImages];
    await user.update({ portfolio: updatedPortfolio });

    res.status(201).json({ message: "Portfolio updated successfully", portfolio: updatedPortfolio });
  } catch (error) {
    console.error("❌ Update Portfolio Error:", error.message);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// PUT /api/users/:id/profile - Update bio, location, operating hours, and social links
router.put("/:id/profile", async (req, res) => {
  const { User } = req.app.get("db");
  const { id } = req.params;
  const { bio, location, operatingHours, socialLinks } = req.body;

  try {
    if (!req.user || req.user.id !== id) {
      return res.status(403).json({ message: "You can only update your own profile" });
    }

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    await user.update({
      bio: bio || user.bio,
      location: location || user.location,
      operatingHours: operatingHours || user.operatingHours,
      socialLinks: socialLinks || user.socialLinks,
    });

    res.json({ message: "Profile updated successfully", user });
  } catch (error) {
    console.error("❌ Update Profile Error:", error.message);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// POST /api/reviews - Submit a review
router.post("/reviews", async (req, res) => {
  const { Review, Post, User } = req.app.get("db");
  const { targetUserId, rating, comment, bookingId } = req.body;

  try {
    if (!req.user) {
      return res.status(401).json({ message: "Authentication required" });
    }

    if (!targetUserId || !rating || !bookingId) {
      return res.status(400).json({ message: "Missing required fields: targetUserId, rating, bookingId" });
    }

    const booking = await Post.findByPk(bookingId);
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    if (booking.userId !== req.user.id) {
      return res.status(403).json({ message: "You can only review your own bookings" });
    }

    if (booking.status !== "completed") {
      return res.status(400).json({ message: "Booking must be completed to leave a review" });
    }

    const targetUser = await User.findByPk(targetUserId);
    if (!targetUser) {
      return res.status(404).json({ message: "Target user not found" });
    }

    const review = await Review.create({
      id: uuidv4(),
      userId: req.user.id,
      targetUserId,
      rating,
      comment,
      bookingId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    res.status(201).json({ message: "Review submitted successfully", review });
  } catch (error) {
    console.error("❌ Submit Review Error:", error.message);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// GET /api/users/:id/reviews - Fetch reviews for a user
router.get("/:id/reviews", async (req, res) => {
  const { Review, User } = req.app.get("db");
  const { id } = req.params;

  try {
    const reviews = await Review.findAll({
      where: { targetUserId: id },
      include: [{ model: User, as: "user", attributes: ["id", "username"] }],
      order: [["createdAt", "DESC"]],
    });

    res.json(reviews);
  } catch (error) {
    console.error("❌ Fetch Reviews Error:", error.message);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// GET /api/users/:id/rating - Calculate average rating for a user
router.get("/:id/rating", async (req, res) => {
  const { Review } = req.app.get("db");
  const { id } = req.params;

  try {
    const reviews = await Review.findAll({ where: { targetUserId: id } });
    const averageRating = reviews.length > 0
      ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length
      : 0;

    res.json({ averageRating });
  } catch (error) {
    console.error("❌ Fetch Average Rating Error:", error.message);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// DELETE /api/reviews/:id - Delete a review (admin-only)
router.delete("/reviews/:id", async (req, res) => {
  const { Review } = req.app.get("db");
  const { id } = req.params;

  try {
    if (!req.user || req.user.isAdmin !== true) {
      return res.status(403).json({ message: "Admins only" });
    }

    const review = await Review.findByPk(id);
    if (!review) {
      return res.status(404).json({ message: "Review not found" });
    }

    await review.destroy();
    res.json({ message: "Review deleted successfully" });
  } catch (error) {
    console.error("❌ Delete Review Error:", error.message);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;