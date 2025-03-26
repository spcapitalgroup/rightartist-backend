const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const { Sequelize, Op } = require("sequelize");
const WebSocket = require("ws");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;
const wss = new WebSocket.Server({ port: 3002 });

// Middleware to log all incoming requests
app.use((req, res, next) => {
  console.log(`🔍 Incoming request - Method: ${req.method}, Path: ${req.path}`);
  next();
});

// Serve static files with debug logging using an absolute path
const uploadsPath = path.join(__dirname, "uploads");
console.log(`🔍 Serving static files from: ${uploadsPath}`);

// Check if specific files exist at startup
const checkFiles = ["watermarked-1743018265146-857098774.png", "watermarked-1743006915476-164745314.png"];
checkFiles.forEach(file => {
  const filePath = path.join(uploadsPath, file);
  if (fs.existsSync(filePath)) {
    console.log(`✅ File exists at startup: ${filePath}`);
  } else {
    console.log(`❌ File does not exist at startup: ${filePath}`);
  }
});

app.use(express.static(uploadsPath, {
  setHeaders: (res, path, stat) => {
    console.log(`🔍 Serving static file: ${path}`);
  },
  fallthrough: true,
}));
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

// Sequelize setup
const sequelize = new Sequelize(process.env.DATABASE_URL || "sqlite:./database.sqlite", {
  logging: false,
});

// Models
const User = sequelize.define("User", {
  id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
  firstName: { type: Sequelize.STRING, allowNull: false },
  lastName: { type: Sequelize.STRING, allowNull: false },
  username: { type: Sequelize.STRING, allowNull: false, unique: true },
  email: { type: Sequelize.STRING, allowNull: false, unique: true },
  password: { type: Sequelize.STRING, allowNull: false },
  userType: { type: Sequelize.ENUM("fan", "designer", "shop", "admin", "elite"), allowNull: false },
  isPaid: { type: Sequelize.BOOLEAN, defaultValue: false },
  isAdmin: { type: Sequelize.BOOLEAN, defaultValue: false },
  notifications: { type: Sequelize.JSON, defaultValue: [] },
  paymentInfo: { type: Sequelize.JSON, defaultValue: { bankAccount: "", routingNumber: "" } },
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
  status: { type: Sequelize.STRING, defaultValue: "open" },
  images: { type: Sequelize.JSON, defaultValue: [] },
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
  designId: { type: Sequelize.UUID, allowNull: true }, // Added designId field
  stage: { type: Sequelize.ENUM("initial_sketch", "revision_1", "revision_2", "revision_3", "final_draft", "final_design"), allowNull: true }, // Added stage field
  createdAt: { type: Sequelize.DATE, defaultValue: Sequelize.NOW },
  isRead: { type: Sequelize.BOOLEAN, defaultValue: false },
});

const Design = sequelize.define("Design", {
  id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
  designerId: { type: Sequelize.UUID, allowNull: false },
  shopId: { type: Sequelize.UUID, allowNull: false },
  postId: { type: Sequelize.UUID, allowNull: false },
  commentId: { type: Sequelize.UUID, allowNull: false },
  stage: { type: Sequelize.ENUM("initial_sketch", "revision_1", "revision_2", "revision_3", "final_draft", "final_design"), allowNull: false },
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

// Associations
User.hasMany(Post, { foreignKey: "userId" });
Post.belongsTo(User, { foreignKey: "userId", as: "user" });

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
Message.belongsTo(Design, { foreignKey: "designId", as: "design" }); // Added association

Design.belongsTo(User, { foreignKey: "designerId", as: "designer" });
Design.belongsTo(User, { foreignKey: "shopId", as: "shop" });
Design.belongsTo(Post, { foreignKey: "postId", as: "Post" });
Design.belongsTo(Comment, { foreignKey: "commentId" });

User.hasMany(Notification, { foreignKey: "userId" });
Notification.belongsTo(User, { foreignKey: "userId", as: "user" });

User.hasMany(Payment, { foreignKey: "userId" });
Payment.belongsTo(User, { foreignKey: "userId" });

// Middleware for authentication
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  console.log("🔍 Auth Header:", authHeader);
  if (!authHeader) {
    return res.status(401).json({ message: "No token provided" });
  }

  const token = authHeader.split(" ")[1];
  console.log("🔹 Received Token:", token);
  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  try {
    console.log("🔍 JWT_SECRET in authMiddleware:", process.env.JWT_SECRET ? "Set" : "Not set");
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log("✅ Token Decoded:", decoded);
    req.user = decoded;
    console.log("🔍 Set req.user:", req.user);
    next();
  } catch (error) {
    console.error("❌ Token Verification Error:", error.message);
    return res.status(401).json({ message: "Invalid token" });
  }
};

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
app.set("db", { User, Post, Comment, Message, Design, Notification, Payment, sequelize, Op });

// Routes
const authRoutes = require("./routes/authRoutes");
const feedRoutes = require("./routes/feedRoutes");
const postRoutes = require("./routes/postRoutes");
const commentRoutes = require("./routes/commentRoutes");
const messageRoutes = require("./routes/messageRoutes");
const designRoutes = require("./routes/designRoutes");
const statsRoutes = require("./routes/statsRoutes");
const notificationRoutes = require("./routes/notificationRoutes")(wss);

console.log("🔍 Mounting authRoutes for /api/auth/login, /api/auth/signup, /api/auth/me, etc.");
app.use("/api/auth", authRoutes);
console.log("🔍 Mounting feedRoutes for /api/feed/");
app.use("/api/feed", authMiddleware, feedRoutes);
console.log("🔍 Mounting postRoutes for /api/posts");
app.use("/api/posts", authMiddleware, postRoutes);
console.log("🔍 Mounting commentRoutes for /api/comments");
app.use("/api/comments", authMiddleware, commentRoutes);
console.log("🔍 Mounting messageRoutes for /api/messages");
app.use("/api/messages", authMiddleware, messageRoutes);
console.log("🔍 Mounting designRoutes for /api/designs");
app.use("/api/designs", authMiddleware, designRoutes);
console.log("🔍 Mounting statsRoutes for /api/stats");
app.use("/api/stats", authMiddleware, statsRoutes);
console.log("🔍 Mounting notificationRoutes for /api/notifications");
app.use("/api/notifications", authMiddleware, notificationRoutes);

// Start server
app.listen(port, async () => {
  console.log(`🚀 Server is running on port ${port}`);
  try {
    await sequelize.sync({ force: false });
    console.log("✅ Database & tables synced (force: false)");

    // Add notifications column to Users if it doesn't exist
    console.log("🔍 Checking for notifications column in Users table...");
    const [results] = await sequelize.query("PRAGMA table_info(Users);");
    const hasNotificationsColumn = results.some((column) => column.name === "notifications");
    if (!hasNotificationsColumn) {
      await sequelize.query('ALTER TABLE Users ADD COLUMN notifications JSON DEFAULT "[]";');
      console.log("✅ Added notifications column to Users table");
    } else {
      console.log("ℹ️ Notifications column already exists in Users table");
    }

    // Add images column to Posts if it doesn't exist
    console.log("🔍 Checking for images column in Posts table...");
    const [postResults] = await sequelize.query("PRAGMA table_info(Posts);");
    const hasImagesColumn = postResults.some((column) => column.name === "images");
    if (!hasImagesColumn) {
      await sequelize.query('ALTER TABLE Posts ADD COLUMN images JSON DEFAULT "[]";');
      console.log("✅ Added images column to Posts table");
    } else {
      console.log("ℹ️ Images column already exists in Posts table");
    }

    // Add clientId column to Posts if it doesn't exist
    console.log("🔍 Checking for clientId column in Posts table...");
    const hasClientIdColumn = postResults.some((column) => column.name === "clientId");
    if (!hasClientIdColumn) {
      await sequelize.query("ALTER TABLE Posts ADD COLUMN clientId UUID;");
      console.log("✅ Added clientId column to Posts table");
    } else {
      console.log("ℹ️ clientId column already exists in Posts table");
    }

    // Add shopId column to Posts if it doesn't exist
    console.log("🔍 Checking for shopId column in Posts table...");
    const hasShopIdColumn = postResults.some((column) => column.name === "shopId");
    if (!hasShopIdColumn) {
      await sequelize.query("ALTER TABLE Posts ADD COLUMN shopId UUID;");
      console.log("✅ Added shopId column to Posts table");
    } else {
      console.log("ℹ️ shopId column already exists in Posts table");
    }

    // Add artistId column to Posts if it doesn't exist
    console.log("🔍 Checking for artistId column in Posts table...");
    const hasArtistIdColumn = postResults.some((column) => column.name === "artistId");
    if (!hasArtistIdColumn) {
      await sequelize.query("ALTER TABLE Posts ADD COLUMN artistId UUID;");
      console.log("✅ Added artistId column to Posts table");
    } else {
      console.log("ℹ️ artistId column already exists in Posts table");
    }

    // Add status column to Posts if it doesn't exist
    console.log("🔍 Checking for status column in Posts table...");
    const hasStatusColumn = postResults.some((column) => column.name === "status");
    if (!hasStatusColumn) {
      await sequelize.query('ALTER TABLE Posts ADD COLUMN status STRING DEFAULT "open";');
      console.log("✅ Added status column to Posts table");
    } else {
      console.log("ℹ️ status column already exists in Posts table");
    }

    // Add parentId column to Comments if it doesn't exist
    console.log("🔍 Checking for parentId column in Comments table...");
    const [commentResults] = await sequelize.query("PRAGMA table_info(Comments);");
    const hasParentIdColumn = commentResults.some((column) => column.name === "parentId");
    if (!hasParentIdColumn) {
      await sequelize.query("ALTER TABLE Comments ADD COLUMN parentId UUID;");
      console.log("✅ Added parentId column to Comments table");
    } else {
      console.log("ℹ️ parentId column already exists in Comments table");
    }

    // Add price column to Comments if it doesn't exist
    console.log("🔍 Checking for price column in Comments table...");
    const hasPriceColumn = commentResults.some((column) => column.name === "price");
    if (!hasPriceColumn) {
      await sequelize.query("ALTER TABLE Comments ADD COLUMN price FLOAT;");
      console.log("✅ Added price column to Comments table");
    } else {
      console.log("ℹ️ price column already exists in Comments table");
    }

    // Add images column to Comments if it doesn't exist
    console.log("🔍 Checking for images column in Comments table...");
    const hasCommentImagesColumn = commentResults.some((column) => column.name === "images");
    if (!hasCommentImagesColumn) {
      await sequelize.query('ALTER TABLE Comments ADD COLUMN images JSON DEFAULT "[]";');
      console.log("✅ Added images column to Comments table");
    } else {
      console.log("ℹ️ images column already exists in Comments table");
    }

    // Add images column to Messages if it doesn't exist
    console.log("🔍 Checking for images column in Messages table...");
    const [messageResults] = await sequelize.query("PRAGMA table_info(Messages);");
    const hasMessageImagesColumn = messageResults.some((column) => column.name === "images");
    if (!hasMessageImagesColumn) {
      await sequelize.query('ALTER TABLE Messages ADD COLUMN images JSON DEFAULT "[]";');
      console.log("✅ Added images column to Messages table");
    } else {
      console.log("ℹ️ images column already exists in Messages table");
    }

    // Add designId column to Messages if it doesn't exist
    console.log("🔍 Checking for designId column in Messages table...");
    const hasDesignIdColumn = messageResults.some((column) => column.name === "designId");
    if (!hasDesignIdColumn) {
      await sequelize.query("ALTER TABLE Messages ADD COLUMN designId UUID;");
      console.log("✅ Added designId column to Messages table");
    } else {
      console.log("ℹ️ designId column already exists in Messages table");
    }

    // Add stage column to Messages if it doesn't exist
    console.log("🔍 Checking for stage column in Messages table...");
    const hasStageColumn = messageResults.some((column) => column.name === "stage");
    if (!hasStageColumn) {
      await sequelize.query('ALTER TABLE Messages ADD COLUMN stage STRING;');
      console.log("✅ Added stage column to Messages table");
    } else {
      console.log("ℹ️ stage column already exists in Messages table");
    }

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