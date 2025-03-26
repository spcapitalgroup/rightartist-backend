// Load environment variables at the very top
const dotenv = require("dotenv");
dotenv.config();
console.log("🔍 Loaded JWT_SECRET:", process.env.JWT_SECRET ? "Set" : "Not set");

const express = require("express");
const cors = require("cors");
const { Sequelize, QueryTypes, Op } = require("sequelize");
const bcrypt = require("bcrypt");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");
const app = express();

// Import middleware and routes
const authenticateUser = require("./middleware/authMiddleware");
const userRoutes = require("./routes/userRoutes");
const adminRoutes = require("./routes/adminRoutes");
const statsRoutes = require("./routes/statsRoutes");
const authRoutes = require("./routes/authRoutes");
const feedRoutes = require("./routes/feedRoutes");
const postRoutes = require("./routes/postRoutes");
const commentRoutes = require("./routes/commentRoutes");
const messageRoutes = require("./routes/messageRoutes");

// Log all incoming requests for debugging
app.use((req, res, next) => {
  console.log(`🔍 Incoming Request - Method: ${req.method}, Path: ${req.path}`);
  next();
});

// CORS middleware to allow requests from the frontend
app.use(cors({
  origin: "http://localhost:3001",
  credentials: true,
}));

// Parse JSON and URL-encoded bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ensure uploads directory exists for postRoutes.js
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
  console.log("✅ Created uploads directory");
}

// Serve uploaded images statically
app.use("/uploads", express.static(uploadsDir));

// Database setup (SQLite3)
const sequelize = new Sequelize({
  dialect: "sqlite",
  storage: process.env.DATABASE_URL.replace("sqlite:", ""),
  logging: false,
});

// Define models
const User = sequelize.define("User", {
  id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
  firstName: { type: Sequelize.STRING, allowNull: false },
  lastName: { type: Sequelize.STRING, allowNull: false },
  username: { type: Sequelize.STRING, allowNull: false, unique: true },
  email: { type: Sequelize.STRING, allowNull: false, unique: true },
  password: { type: Sequelize.STRING, allowNull: false },
  userType: { type: Sequelize.ENUM("fan", "designer", "shop", "admin"), allowNull: false },
  isPaid: { type: Sequelize.BOOLEAN, defaultValue: false },
  isAdmin: { type: Sequelize.BOOLEAN, defaultValue: false },
  notifications: { type: Sequelize.JSON, defaultValue: [] },
  paymentInfo: { type: Sequelize.JSON, defaultValue: {} },
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

const Payment = sequelize.define("Payment", {
  id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
  userId: { type: Sequelize.UUID, allowNull: false },
  amount: { type: Sequelize.FLOAT, allowNull: false },
  status: { type: Sequelize.ENUM("completed", "failed"), allowNull: false },
  type: { type: Sequelize.STRING, allowNull: false },
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
  createdAt: { type: Sequelize.DATE, defaultValue: Sequelize.NOW },
  updatedAt: { type: Sequelize.DATE, defaultValue: Sequelize.NOW },
});

const Notification = sequelize.define("Notification", {
  id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
  userId: { type: Sequelize.UUID, allowNull: false },
  message: { type: Sequelize.STRING, allowNull: false },
  createdAt: { type: Sequelize.DATE, defaultValue: Sequelize.NOW },
  updatedAt: { type: Sequelize.DATE, defaultValue: Sequelize.NOW },
});

const Message = sequelize.define("Message", {
  id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
  content: { type: Sequelize.TEXT, allowNull: false },
  senderId: { type: Sequelize.UUID, allowNull: false },
  receiverId: { type: Sequelize.UUID, allowNull: false },
  isRead: { type: Sequelize.BOOLEAN, defaultValue: false },
  createdAt: { type: Sequelize.DATE, defaultValue: Sequelize.NOW },
  updatedAt: { type: Sequelize.DATE, defaultValue: Sequelize.NOW },
});

// Define relationships with cascading deletes
User.hasMany(Post, { foreignKey: "userId", onDelete: "CASCADE" });
Post.belongsTo(User, { foreignKey: "userId", as: "user" });

// Add associations for client and shop
Post.belongsTo(User, { foreignKey: "clientId", as: "client" });
Post.belongsTo(User, { foreignKey: "shopId", as: "shop" });

User.hasMany(Payment, { foreignKey: "userId", onDelete: "CASCADE" });
Payment.belongsTo(User, { foreignKey: "userId" });

User.hasMany(Comment, { foreignKey: "userId", onDelete: "CASCADE" });
Comment.belongsTo(User, { foreignKey: "userId", as: "user" });

Post.hasMany(Comment, { foreignKey: "postId", onDelete: "CASCADE", as: "comments" });
Comment.belongsTo(Post, { foreignKey: "postId" });

// Add self-referential association for Comment replies
Comment.hasMany(Comment, { foreignKey: "parentId", as: "replies", onDelete: "CASCADE" });
Comment.belongsTo(Comment, { foreignKey: "parentId", as: "parent" });

// Add relationships for Notification
User.hasMany(Notification, { foreignKey: "userId", onDelete: "CASCADE" });
Notification.belongsTo(User, { foreignKey: "userId" });

// Add relationships for Message
User.hasMany(Message, { foreignKey: "senderId", as: "sentMessages", onDelete: "CASCADE" });
User.hasMany(Message, { foreignKey: "receiverId", as: "receivedMessages", onDelete: "CASCADE" });
Message.belongsTo(User, { foreignKey: "senderId", as: "sender" });
Message.belongsTo(User, { foreignKey: "receiverId", as: "receiver" });

// Set database models on app
app.set("db", { User, Post, Payment, Comment, Notification, Message });

// WebSocket setup (use port 3002 to avoid conflict with Express on 3000 and frontend on 3001)
const wss = new WebSocket.Server({ port: 3002 });
app.set("wss", wss);
console.log("🔍 WebSocket server set in app:", !!app.get("wss"));

// Map to store WebSocket clients by userId (for commentRoutes.js and messageRoutes.js)
const wsClients = new Map();
app.set("wsClients", wsClients);

wss.on("connection", (ws, req) => {
  console.log("🔍 Total clients:", wss.clients.size);
  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message);
      console.log("🔍 WebSocket message received:", data);
      if (data.userId) {
        ws.userId = data.userId;
        wsClients.set(data.userId, ws); // Store the client in the Map
        ws.send(JSON.stringify({ type: "connected", userId: data.userId }));
      }
    } catch (error) {
      console.error("❌ WebSocket message error:", error.message);
    }
  });

  ws.on("close", () => {
    if (ws.userId) {
      wsClients.delete(ws.userId); // Remove the client from the Map
    }
    console.log("🔍 Client disconnected, total clients:", wss.clients.size);
  });
});

setInterval(() => {
  console.log("🔍 Current WebSocket clients:", wss.clients.size);
}, 10000);

// Mount routes
console.log("🔍 Mounting authRoutes for /api/auth/login, /api/auth/signup, /api/auth/me, etc.");
app.use("/api/auth", authRoutes); // Mount authRoutes under /api/auth

console.log("🔍 Mounting feedRoutes for /api/feed/");
app.use("/api/feed", authenticateUser, feedRoutes);

console.log("🔍 Mounting postRoutes for /api/posts");
app.use("/api/posts", authenticateUser, postRoutes);

console.log("🔍 Mounting commentRoutes for /api/comments");
app.use("/api/comments", authenticateUser, commentRoutes);

console.log("🔍 Mounting messageRoutes for /api/messages");
app.use("/api/messages", authenticateUser, messageRoutes);

app.use("/api/users", (req, res, next) => {
  console.log("🔍 Applying authMiddleware to /api/users");
  authenticateUser(req, res, next);
}, userRoutes);

app.use("/api/admin", authenticateUser, adminRoutes);
app.use("/api/stats", authenticateUser, statsRoutes);

// Add a route for /api/admin/validate-invite
app.get("/api/admin/validate-invite", async (req, res) => {
  const { invite } = req.query;
  try {
    console.log("🔍 Validating invite code:", invite);
    // For now, accept any invite code as valid (you can add proper validation logic later)
    if (!invite) {
      console.log("❌ Missing invite code");
      return res.status(400).json({ valid: false, message: "Invite code required" });
    }
    console.log("✅ Invite code validated:", invite);
    res.json({ valid: true });
  } catch (error) {
    console.error("❌ Validate Invite Error:", error.message);
    res.status(500).json({ valid: false, message: "Server error" });
  }
});

// Add a route for /api/notifications
app.get("/api/notifications", authenticateUser, async (req, res) => {
  try {
    console.log("🔍 Handling /api/notifications request for user:", req.user.id);
    // Fetch the user's notifications from the database
    const user = await User.findByPk(req.user.id);
    if (!user) {
      console.log("❌ User not found for notifications:", req.user.id);
      return res.status(404).json({ message: "User not found" });
    }
    console.log("🔍 Fetching notifications for user:", req.user.id);
    const notifications = user.notifications || [];
    console.log("🔍 Notifications fetched:", notifications);
    res.json(notifications);
  } catch (error) {
    console.error("❌ Error fetching notifications:", error.message);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Sync database and seed data
sequelize.sync({ force: false }).then(async () => {
  console.log("✅ Database & tables synced (force: false)");

  // Migration: Add the notifications column to Users table if it doesn't exist
  try {
    console.log("🔍 Checking for notifications column in Users table...");
    await sequelize.query(`
      ALTER TABLE Users ADD COLUMN notifications JSON DEFAULT '[]';
    `, { type: QueryTypes.RAW });
    console.log("✅ Added notifications column to Users table");
  } catch (error) {
    if (error.message.includes("duplicate column name")) {
      console.log("ℹ️ Notifications column already exists in Users table");
    } else {
      console.error("❌ Error adding notifications column:", error.message);
    }
  }

  // Migration: Add the images column to Posts table if it doesn't exist
  try {
    console.log("🔍 Checking for images column in Posts table...");
    await sequelize.query(`
      ALTER TABLE Posts ADD COLUMN images JSON DEFAULT '[]';
    `, { type: QueryTypes.RAW });
    console.log("✅ Added images column to Posts table");
  } catch (error) {
    if (error.message.includes("duplicate column name")) {
      console.log("ℹ️ Images column already exists in Posts table");
    } else {
      console.error("❌ Error adding images column:", error.message);
    }
  }

  // Migration: Add the clientId column to Posts table if it doesn't exist
  try {
    console.log("🔍 Checking for clientId column in Posts table...");
    await sequelize.query(`
      ALTER TABLE Posts ADD COLUMN clientId TEXT;
    `, { type: QueryTypes.RAW });
    console.log("✅ Added clientId column to Posts table");
  } catch (error) {
    if (error.message.includes("duplicate column name")) {
      console.log("ℹ️ clientId column already exists in Posts table");
    } else {
      console.error("❌ Error adding clientId column:", error.message);
    }
  }

  // Migration: Add the shopId column to Posts table if it doesn't exist
  try {
    console.log("🔍 Checking for shopId column in Posts table...");
    await sequelize.query(`
      ALTER TABLE Posts ADD COLUMN shopId TEXT;
    `, { type: QueryTypes.RAW });
    console.log("✅ Added shopId column to Posts table");
  } catch (error) {
    if (error.message.includes("duplicate column name")) {
      console.log("ℹ️ shopId column already exists in Posts table");
    } else {
      console.error("❌ Error adding shopId column:", error.message);
    }
  }

  // Migration: Add the artistId column to Posts table if it doesn't exist
  try {
    console.log("🔍 Checking for artistId column in Posts table...");
    await sequelize.query(`
      ALTER TABLE Posts ADD COLUMN artistId TEXT;
    `, { type: QueryTypes.RAW });
    console.log("✅ Added artistId column to Posts table");
  } catch (error) {
    if (error.message.includes("duplicate column name")) {
      console.log("ℹ️ artistId column already exists in Posts table");
    } else {
      console.error("❌ Error adding artistId column:", error.message);
    }
  }

  // Migration: Add the status column to Posts table if it doesn't exist
  try {
    console.log("🔍 Checking for status column in Posts table...");
    await sequelize.query(`
      ALTER TABLE Posts ADD COLUMN status TEXT DEFAULT 'open';
    `, { type: QueryTypes.RAW });
    console.log("✅ Added status column to Posts table");
  } catch (error) {
    if (error.message.includes("duplicate column name")) {
      console.log("ℹ️ status column already exists in Posts table");
    } else {
      console.error("❌ Error adding status column:", error.message);
    }
  }

  // Migration: Add the parentId column to Comments table if it doesn't exist
  try {
    console.log("🔍 Checking for parentId column in Comments table...");
    await sequelize.query(`
      ALTER TABLE Comments ADD COLUMN parentId TEXT;
    `, { type: QueryTypes.RAW });
    console.log("✅ Added parentId column to Comments table");
  } catch (error) {
    if (error.message.includes("duplicate column name")) {
      console.log("ℹ️ parentId column already exists in Comments table");
    } else {
      console.error("❌ Error adding parentId column:", error.message);
    }
  }

  // Migration: Add the price column to Comments table if it doesn't exist
  try {
    console.log("🔍 Checking for price column in Comments table...");
    await sequelize.query(`
      ALTER TABLE Comments ADD COLUMN price REAL;
    `, { type: QueryTypes.RAW });
    console.log("✅ Added price column to Comments table");
  } catch (error) {
    if (error.message.includes("duplicate column name")) {
      console.log("ℹ️ price column already exists in Comments table");
    } else {
      console.error("❌ Error adding price column:", error.message);
    }
  }

  // Seed data
  try {
    // Seed admin user
    console.log("🔍 Creating admin user...");
    const [adminUser, adminCreated] = await User.findOrCreate({
      where: { email: "admin@admin.com" },
      defaults: {
        id: "admin-user-id-1234",
        firstName: "Admin",
        lastName: "User",
        username: "AdminUser",
        email: "admin@admin.com",
        password: "$2b$10$0auJVrmbjZMtfpds9f2eyupdH6pcWDvaZ2EMik7XQfBECrDWIk9mG", // Hashed "admin123"
        userType: "admin",
        isPaid: true,
        isAdmin: true,
        notifications: [],
        paymentInfo: JSON.stringify({ bankAccount: "", routingNumber: "" }),
      },
    });
    console.log(adminCreated ? "✅ Admin user created" : "ℹ️ Admin user already exists, userType:", adminUser.userType);

    // Seed test designer
    console.log("🔍 Creating test designer...");
    const [designerUser, designerCreated] = await User.findOrCreate({
      where: { email: "designer@example.com" },
      defaults: {
        id: require("uuid").v4(),
        firstName: "Designer",
        lastName: "Test",
        username: "designer.test",
        email: "designer@example.com",
        password: bcrypt.hashSync("password123", 10),
        userType: "designer",
        isPaid: false,
        isAdmin: false,
        notifications: [],
        paymentInfo: JSON.stringify({ bankAccount: "", routingNumber: "" }),
      },
    });
    console.log(designerCreated ? "✅ Designer user created" : "ℹ️ Designer user already exists");

    // Seed test fan
    console.log("🔍 Creating test fan...");
    const [fanUser, fanCreated] = await User.findOrCreate({
      where: { email: "fan@example.com" },
      defaults: {
        id: require("uuid").v4(),
        firstName: "Fan",
        lastName: "Test",
        username: "fan.test",
        email: "fan@example.com",
        password: bcrypt.hashSync("password123", 10),
        userType: "fan",
        isPaid: false,
        isAdmin: false,
        notifications: [],
        paymentInfo: JSON.stringify({ bankAccount: "", routingNumber: "" }),
      },
    });
    console.log(fanCreated ? "✅ Fan user created" : "ℹ️ Fan user already exists");

    // Seed test shop
    console.log("🔍 Creating test shop...");
    const [shopUser, shopCreated] = await User.findOrCreate({
      where: { email: "shop@example.com" },
      defaults: {
        id: require("uuid").v4(),
        firstName: "Shop",
        lastName: "Test",
        username: "shop.test",
        email: "shop@example.com",
        password: bcrypt.hashSync("password123", 10),
        userType: "shop",
        isPaid: true,
        isAdmin: false,
        notifications: [],
        paymentInfo: JSON.stringify({ bankAccount: "", routingNumber: "" }),
      },
    });
    console.log(shopCreated ? "✅ Shop user created" : "ℹ️ Shop user already exists");

    // Seed trenton@test.com (designer)
    console.log("🔍 Creating trenton@test.com (designer)...");
    const [trentonUser, trentonCreated] = await User.findOrCreate({
      where: { email: "trenton@test.com" },
      defaults: {
        id: "e0536750-e2de-4b19-b0f5-df38dec52acc",
        firstName: "Trenton",
        lastName: "Shupp",
        username: "trenton.shupp",
        email: "trenton@test.com",
        password: bcrypt.hashSync("password123", 10), // Password: "password123"
        userType: "designer",
        isPaid: true,
        isAdmin: false,
        notifications: [],
        paymentInfo: JSON.stringify({ bankAccount: "", routingNumber: "" }),
      },
    });
    console.log(trentonCreated ? "✅ Trenton user created" : "ℹ️ Trenton user already exists, userType:", trentonUser.userType);
  } catch (error) {
    console.error("❌ Seeding error:", error.message);
  }
}).catch(err => {
  console.error("❌ Database sync error:", err.message);
});

// Start the Express server on port 3000
const PORT = process.env.PORT || 3000; // Use PORT from .env
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`⚠️ Port ${PORT} is in use, please free it up or use a different port.`);
  } else {
    console.error("❌ Server error:", err.message);
  }
});