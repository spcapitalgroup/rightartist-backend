const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs"); // Changed from bcrypt to bcryptjs
const { Sequelize, Op } = require("sequelize");
const WebSocket = require("ws");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;
const wss = new WebSocket.Server({ port: 3002 });

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Middleware to log all incoming requests
app.use((req, res, next) => {
  console.log(`🔍 Incoming request - Method: ${req.method}, Path: ${req.path}`);
  next();
});

// Ensure uploads directory exists (optional, as we'll use Cloudinary)
const uploadsPath = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsPath)) {
  fs.mkdirSync(uploadsPath, { recursive: true });
  console.log(`✅ Created uploads directory: ${uploadsPath}`);
}

// Configure Multer for file uploads (used in postRoutes.js)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  },
});
const upload = multer({ storage });

// Serve static files from uploads directory (optional, as we'll use Cloudinary URLs)
console.log(`🔍 Serving static files from: ${uploadsPath}`);
app.use(
  "/uploads",
  express.static(uploadsPath, {
    setHeaders: (res, filePath) => {
      console.log(`🔍 Serving static file: ${filePath}`);
    },
    fallthrough: true,
  })
);
app.use((req, res, next) => {
  if (req.path.startsWith("/uploads/") && !res.headersSent) {
    console.log(`❌ Static file not found: ${req.path}`);
    res.status(404).send("File not found");
  } else {
    next();
  }
});

// Other middleware
app.use(cors());
app.use(express.json());

// Sequelize setup for PlanetScale
const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: "mysql",
  dialectModule: require("mysql2"),
  logging: false,
  dialectOptions: {
    ssl: {
      rejectUnauthorized: true, // Required for PlanetScale
    },
  },
});

// Models
const User = sequelize.define("User", {
  id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
  firstName: { type: Sequelize.STRING, allowNull: false },
  lastName: { type: Sequelize.STRING, allowNull: false },
  username: { type: Sequelize.STRING, allowNull: false, unique: true },
  email: { type: Sequelize.STRING, allowNull: false, unique: true },
  password: { type: Sequelize.STRING, allowNull: false },
  userType: {
    type: Sequelize.ENUM("fan", "designer", "shop", "admin", "elite"),
    allowNull: false,
  },
  isPaid: { type: Sequelize.BOOLEAN, defaultValue: false },
  isAdmin: { type: Sequelize.BOOLEAN, defaultValue: false },
  notifications: { type: Sequelize.JSON, defaultValue: [] },
  paymentInfo: {
    type: Sequelize.JSON,
    defaultValue: { bankAccount: "", routingNumber: "" },
  },
  depositSettings: {
    type: Sequelize.JSON,
    defaultValue: { required: false, amount: 0 },
  },
  calendarIntegrations: { type: Sequelize.JSON, defaultValue: {} },
  portfolio: { type: Sequelize.JSON, defaultValue: [] },
  bio: { type: Sequelize.TEXT, defaultValue: "" },
  location: { type: Sequelize.STRING, defaultValue: "" },
  operatingHours: { type: Sequelize.JSON, defaultValue: {} },
  socialLinks: { type: Sequelize.JSON, defaultValue: {} },
  createdAt: { type: Sequelize.DATE, defaultValue: Sequelize.NOW },
  updatedAt: { type: Sequelize.DATE, defaultValue: Sequelize.NOW },
});

const Post = sequelize.define("Post", {
  id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
  title: { type: Sequelize.STRING, allowNull: false },
  description: { type: Sequelize.TEXT, allowNull: false },
  location: { type: Sequelize.STRING, allowNull: false },
  feedType: { type: Sequelize.ENUM("design", "booking"), allowNull: false },
  userId: { type: Sequelize.UUID, allowNull: false },
  clientId: { type: Sequelize.UUID, allowNull: true },
  shopId: { type: Sequelize.UUID, allowNull: true },
  artistId: { type: Sequelize.UUID, allowNull: true },
  status: {
    type: Sequelize.ENUM(
      "open",
      "accepted",
      "scheduled",
      "completed",
      "cancelled"
    ),
    defaultValue: "open",
  },
  images: { type: Sequelize.JSON, defaultValue: [] },
  scheduledDate: { type: Sequelize.DATE, allowNull: true },
  contactInfo: { type: Sequelize.JSON, defaultValue: {} },
  depositAmount: { type: Sequelize.FLOAT, allowNull: true },
  depositStatus: { type: Sequelize.ENUM("pending", "paid"), defaultValue: "pending" },
  externalEventIds: { type: Sequelize.JSON, defaultValue: {} },
  createdAt: { type: Sequelize.DATE, defaultValue: Sequelize.NOW },
  updatedAt: { type: Sequelize.DATE, defaultValue: Sequelize.NOW },
});

const Comment = sequelize.define("Comment", {
  id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
  content: { type: Sequelize.TEXT, allowNull: false },
  userId: { type: Sequelize.UUID, allowNull: false },
  postId: { type: Sequelize.UUID, allowNull: false },
  parentId: { type: Sequelize.UUID, allowNull: true },
  price: { type: Sequelize.FLOAT, allowNull: true },
  estimatedDuration: { type: Sequelize.STRING, allowNull: true },
  availability: { type: Sequelize.STRING, allowNull: true },
  withdrawn: { type: Sequelize.BOOLEAN, defaultValue: false },
  images: { type: Sequelize.JSON, defaultValue: [] },
  createdAt: { type: Sequelize.DATE, defaultValue: Sequelize.NOW },
  updatedAt: { type: Sequelize.DATE, defaultValue: Sequelize.NOW },
});

const Message = sequelize.define("Message", {
  id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
  senderId: { type: Sequelize.UUID, allowNull: false },
  receiverId: { type: Sequelize.UUID, allowNull: false },
  content: { type: Sequelize.TEXT, allowNull: false },
  images: { type: Sequelize.JSON, defaultValue: [] },
  designId: { type: Sequelize.UUID, allowNull: true },
  stage: {
    type: Sequelize.ENUM(
      "initial_sketch",
      "revision_1",
      "revision_2",
      "revision_3",
      "final_draft",
      "final_design"
    ),
    allowNull: true,
  },
  createdAt: { type: Sequelize.DATE, defaultValue: Sequelize.NOW },
  isRead: { type: Sequelize.BOOLEAN, defaultValue: false },
});

const Design = sequelize.define("Design", {
  id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
  designerId: { type: Sequelize.UUID, allowNull: false },
  shopId: { type: Sequelize.UUID, allowNull: false },
  postId: { type: Sequelize.UUID, allowNull: false },
  commentId: { type: Sequelize.UUID, allowNull: false },
  stage: {
    type: Sequelize.ENUM(
      "initial_sketch",
      "revision_1",
      "revision_2",
      "revision_3",
      "final_draft",
      "final_design"
    ),
    allowNull: false,
  },
  images: { type: Sequelize.JSON, defaultValue: [] },
  status: { type: Sequelize.ENUM("pending", "purchased"), defaultValue: "pending" },
  price: { type: Sequelize.FLOAT, allowNull: false },
  createdAt: { type: Sequelize.DATE, defaultValue: Sequelize.NOW },
  updatedAt: { type: Sequelize.DATE, defaultValue: Sequelize.NOW },
});

const Notification = sequelize.define("Notification", {
  id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
  userId: { type: Sequelize.UUID, allowNull: false },
  message: { type: Sequelize.STRING, allowNull: false },
  isRead: { type: Sequelize.BOOLEAN, defaultValue: false },
  createdAt: { type: Sequelize.DATE, defaultValue: Sequelize.NOW },
});

const Payment = sequelize.define("Payment", {
  id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
  userId: { type: Sequelize.UUID, allowNull: false },
  amount: { type: Sequelize.FLOAT, allowNull: false },
  status: { type: Sequelize.STRING, allowNull: false },
  type: { type: Sequelize.STRING, allowNull: false },
  createdAt: { type: Sequelize.DATE, defaultValue: Sequelize.NOW },
});

const Review = sequelize.define("Review", {
  id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
  userId: { type: Sequelize.UUID, allowNull: false },
  targetUserId: { type: Sequelize.UUID, allowNull: false },
  rating: { type: Sequelize.INTEGER, allowNull: false },
  comment: { type: Sequelize.TEXT, allowNull: true },
  bookingId: { type: Sequelize.UUID, allowNull: false },
  createdAt: { type: Sequelize.DATE, defaultValue: Sequelize.NOW },
  updatedAt: { type: Sequelize.DATE, defaultValue: Sequelize.NOW },
});

const Rating = sequelize.define("Rating", {
  id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
  raterId: { type: Sequelize.UUID, allowNull: false },
  rateeId: { type: Sequelize.UUID, allowNull: false },
  postId: { type: Sequelize.UUID, allowNull: false },
  rating: {
    type: Sequelize.INTEGER,
    allowNull: false,
    validate: { min: 1, max: 5 },
  },
  comment: { type: Sequelize.TEXT, allowNull: true, defaultValue: "" },
  createdAt: { type: Sequelize.DATE, defaultValue: Sequelize.NOW },
  updatedAt: { type: Sequelize.DATE, defaultValue: Sequelize.NOW },
});

const Booking = sequelize.define("Booking", {
  id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
  postId: { type: Sequelize.UUID, allowNull: false },
  shopId: { type: Sequelize.UUID, allowNull: false },
  clientId: { type: Sequelize.UUID, allowNull: false },
  scheduledDate: { type: Sequelize.DATE, allowNull: false },
  status: {
    type: Sequelize.ENUM("scheduled", "completed", "cancelled"),
    defaultValue: "scheduled",
    allowNull: false,
  },
  contactInfo: { type: Sequelize.JSON, defaultValue: {} },
  createdAt: { type: Sequelize.DATE, defaultValue: Sequelize.NOW },
  updatedAt: { type: Sequelize.DATE, defaultValue: Sequelize.NOW },
});

// Associations
User.hasMany(Post, { foreignKey: "userId" });
Post.belongsTo(User, { foreignKey: "userId", as: "user" });
Post.belongsTo(User, { foreignKey: "shopId", as: "shop" });
Post.belongsTo(User, { foreignKey: "clientId", as: "client" });
User.hasMany(Post, { foreignKey: "shopId", as: "shopPosts" });
User.hasMany(Post, { foreignKey: "clientId", as: "clientPosts" });
Post.hasMany(Comment, { foreignKey: "postId", as: "comments" });
Comment.belongsTo(Post, { foreignKey: "postId", as: "Post" });
User.hasMany(Comment, { foreignKey: "userId" });
Comment.belongsTo(User, { foreignKey: "userId", as: "user" });
Comment.hasMany(Comment, { foreignKey: "parentId", as: "replies" });
Comment.belongsTo(Comment, { foreignKey: "parentId", as: "parent" });
User.hasMany(Message, { foreignKey: "senderId", as: "sentMessages" });
User.hasMany(Message, { foreignKey: "receiverId", as: "receivedMessages" });
Message.belongsTo(User, { foreignKey: "senderId", as: "sender" });
Message.belongsTo(User, { foreignKey: "receiverId", as: "receiver" });
Message.belongsTo(Design, { foreignKey: "designId", as: "design" });
Design.belongsTo(User, { foreignKey: "designerId", as: "designer" });
Design.belongsTo(User, { foreignKey: "shopId", as: "shop" });
Design.belongsTo(Post, { foreignKey: "postId", as: "Post" });
Design.belongsTo(Comment, { foreignKey: "commentId" });
User.hasMany(Notification, { foreignKey: "userId" });
Notification.belongsTo(User, { foreignKey: "userId", as: "user" });
User.hasMany(Payment, { foreignKey: "userId" });
Payment.belongsTo(User, { foreignKey: "userId" });
User.hasMany(Review, { foreignKey: "userId", as: "reviewsGiven" });
User.hasMany(Review, { foreignKey: "targetUserId", as: "reviewsReceived" });
Review.belongsTo(User, { foreignKey: "userId", as: "user" });
Review.belongsTo(User, { foreignKey: "targetUserId", as: "targetUser" });
Review.belongsTo(Post, { foreignKey: "bookingId", as: "booking" });
User.hasMany(Rating, { foreignKey: "raterId", as: "ratingsGiven" });
User.hasMany(Rating, { foreignKey: "rateeId", as: "ratingsReceived" });
Rating.belongsTo(User, { foreignKey: "raterId", as: "rater" });
Rating.belongsTo(User, { foreignKey: "rateeId", as: "ratee" });
Post.hasMany(Rating, { foreignKey: "postId", as: "ratings" });
Rating.belongsTo(Post, { foreignKey: "postId", as: "post" });
Booking.belongsTo(Post, { foreignKey: "postId", as: "post" });
Booking.belongsTo(User, { foreignKey: "shopId", as: "shop" });
Booking.belongsTo(User, { foreignKey: "clientId", as: "client" });
Post.hasMany(Booking, { foreignKey: "postId", as: "bookings" });
User.hasMany(Booking, { foreignKey: "shopId", as: "shopBookings" });
User.hasMany(Booking, { foreignKey: "clientId", as: "clientBookings" });

// Import authMiddleware
const authenticateUser = require("./middleware/authMiddleware");

// WebSocket setup
const wsClients = new Map();
app.set("wsClients", wsClients);
console.log("🔍 WebSocket server set in app:", !!app.get("wsClients"));

wss.on("connection", (ws) => {
  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message);
      console.log("🔍 WebSocket message received:", data);
      if (data.userId) {
        wsClients.set(data.userId, ws);
        ws.send(JSON.stringify({ type: "connected", userId: data.userId }));
        console.log("🔍 Total clients:", wsClients.size);
      }
    } catch (error) {
      console.error("❌ WebSocket Message Error:", error.message);
    }
  });

  ws.on("close", () => {
    for (const [userId, client] of wsClients.entries()) {
      if (client === ws) {
        wsClients.delete(userId);
        console.log("🔍 Client disconnected, total clients:", wsClients.size);
        break;
      }
    }
  });
});

// Set Sequelize instance in app
const db = {
  User,
  Post,
  Comment,
  Message,
  Design,
  Notification,
  Payment,
  Review,
  Rating,
  Booking,
  sequelize,
  Op,
};
app.set("db", db);

// Routes
const authRoutes = require("./routes/authRoutes");
const feedRoutes = require("./routes/feedRoutes");
const postRoutes = require("./routes/postRoutes");
const commentRoutes = require("./routes/commentRoutes");
const messageRoutes = require("./routes/messageRoutes");
const designRoutes = require("./routes/designRoutes");
const statsRoutes = require("./routes/statsRoutes");
const notificationRoutes = require("./routes/notificationRoutes")(wss);
const userRoutes = require("./routes/userRoutes");
const shopRoutes = require("./routes/shopRoutes");
const ratingRoutes = require("./routes/ratingRoutes");
const bookingRoutes = require("./routes/bookingRoutes");

console.log("🔍 Mounting authRoutes for /api/auth/login, /api/auth/signup, /api/auth/me, etc.");
app.use("/api/auth", authRoutes);
console.log("🔍 Mounting feedRoutes for /api/feed/");
app.use("/api/feed", authenticateUser, feedRoutes);
console.log("🔍 Mounting postRoutes for /api/posts");
app.use("/api/posts", authenticateUser, postRoutes(wss, db));
console.log("🔍 Mounting commentRoutes for /api/comments");
app.use("/api/comments", authenticateUser, commentRoutes);
console.log("🔍 Mounting messageRoutes for /api/messages");
app.use("/api/messages", authenticateUser, messageRoutes);
console.log("🔍 Mounting designRoutes for /api/designs");
app.use("/api/designs", authenticateUser, designRoutes);
console.log("🔍 Mounting statsRoutes for /api/stats");
app.use("/api/stats", authenticateUser, statsRoutes);
console.log("🔍 Mounting notificationRoutes for /api/notifications");
app.use("/api/notifications", authenticateUser, notificationRoutes);
console.log("🔍 Mounting userRoutes for /api/users");
app.use("/api/users", authenticateUser, userRoutes);
console.log("🔍 Mounting shopRoutes for /api/shops");
app.use("/api/shops", authenticateUser, shopRoutes);
console.log("🔍 Mounting ratingRoutes for /api/ratings");
app.use("/api/ratings", authenticateUser, ratingRoutes);
console.log("🔍 Mounting bookingRoutes for /api/bookings");
app.use("/api/bookings", authenticateUser, bookingRoutes);

// Start server
app.listen(port, async () => {
  console.log(`🚀 Server is running on port ${port}`);
  try {
    await sequelize.sync({ force: false });
    console.log("✅ Database & tables synced (force: false)");

    // Create admin user
    console.log("🔍 Creating admin user...");
    const adminExists = await User.findOne({ where: { email: "admin@admin.com" } });
    if (!adminExists) {
      await User.create({
        id: require("uuid").v4(),
        firstName: "Admin",
        lastName: "User",
        username: "admin",
        email: "admin@admin.com",
        password: await bcrypt.hash("admin123", 10),
        userType: "admin",
        isAdmin: true,
        isPaid: true,
      });
      console.log("✅ Admin user created");
    } else {
      console.log("ℹ️ Admin user already exists, userType:", adminExists.userType);
    }

    // Create test designer
    console.log("🔍 Creating test designer...");
    const designerExists = await User.findOne({ where: { email: "designer@example.com" } });
    if (!designerExists) {
      await User.create({
        id: require("uuid").v4(),
        firstName: "Designer",
        lastName: "User",
        username: "designer.test",
        email: "designer@example.com",
        password: await bcrypt.hash("password123", 10),
        userType: "designer",
        isPaid: true,
      });
      console.log("✅ Test designer created");
    } else {
      console.log("ℹ️ Designer user already exists");
    }

    // Create test fan
    console.log("🔍 Creating test fan...");
    const fanExists = await User.findOne({ where: { email: "fan@example.com" } });
    if (!fanExists) {
      await User.create({
        id: require("uuid").v4(),
        firstName: "Fan",
        lastName: "User",
        username: "fan.test",
        email: "fan@example.com",
        password: await bcrypt.hash("password123", 10),
        userType: "fan",
      });
      console.log("✅ Test fan created");
    } else {
      console.log("ℹ️ Fan user already exists");
    }

    // Create test shop
    console.log("🔍 Creating test shop...");
    const shopExists = await User.findOne({ where: { email: "shop@test.com" } });
    if (!shopExists) {
      await User.create({
        id: require("uuid").v4(),
        firstName: "Shop",
        lastName: "User",
        username: "shop.user",
        email: "shop@test.com",
        password: await bcrypt.hash("password123", 10),
        userType: "shop",
        isPaid: true,
      });
      console.log("✅ Test shop created");
    } else {
      console.log("ℹ️ Shop user already exists");
    }

    // Create trenton@test.com (designer)
    console.log("🔍 Creating trenton@test.com (designer)...");
    const trentonExists = await User.findOne({ where: { email: "trenton@test.com" } });
    if (!trentonExists) {
      await User.create({
        id: require("uuid").v4(),
        firstName: "Trenton",
        lastName: "Shupp",
        username: "trenton.shupp",
        email: "trenton@test.com",
        password: await bcrypt.hash("password123", 10),
        userType: "designer",
        isPaid: true,
      });
      console.log("✅ Trenton user created");
    } else {
      console.log("ℹ️ Trenton user already exists, userType:", trentonExists.userType);
    }
  } catch (error) {
    console.error("❌ Database Sync Error:", error.message);
  }
});