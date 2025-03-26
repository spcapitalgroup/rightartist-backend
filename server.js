const express = require("express");
const dotenv = require("dotenv");
const Sequelize = require("sequelize");
const bcrypt = require("bcrypt");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");
const cors = require("cors");

dotenv.config();

console.log("🔍 Loaded JWT_SECRET:", process.env.JWT_SECRET ? "Set" : "Not Set");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

app.use((req, res, next) => {
  console.log("🔍 Raw Request - Method:", req.method, "Path:", req.path);
  console.log("🔍 Raw Request - Headers:", req.headers);
  console.log("🔍 Raw Request - Body:", req.body);
  next();
});

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log(`✅ Uploads directory created at: ${uploadsDir}`);
}
app.use("/uploads", express.static(uploadsDir));

const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: "sqlite",
  logging: false,
});

const db = require("./models")(sequelize);
app.set("db", db);

const authenticateUser = require("./middleware/authMiddleware");

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`🚀 Server is running on port ${PORT}`));
const wss = new WebSocket.Server({ server });
app.set("wss", wss);
console.log("🔍 WebSocket server set in app:", !!app.get("wss"));

const clients = new Map();

wss.on("connection", (ws) => {
  console.log("🔌 New WebSocket connection established");
  let userId = null;

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message.toString());
      if (data.userId) {
        userId = data.userId;
        clients.set(userId, ws);
        console.log(`✅ Client registered: ${userId}, Total clients: ${clients.size}`);
        ws.send(JSON.stringify({ type: "connected", userId }));
      }
      if (data.type === "heartbeat" && data.userId) {
        userId = data.userId;
        clients.set(userId, ws);
        console.log(`🏓 Heartbeat received from: ${userId}, Total clients: ${clients.size}`);
        ws.send(JSON.stringify({ type: "heartbeat_ack", userId }));
      }
    } catch (error) {
      console.error("❌ WebSocket message error:", error.message);
    }
  });

  ws.on("error", (err) => console.error("❌ WebSocket Error:", err.message));
  ws.on("close", () => {
    if (userId) {
      clients.delete(userId);
      console.log(`🔌 Client disconnected: ${userId}, Remaining clients: ${clients.size}`);
    }
  });

  ws.send(JSON.stringify({ type: "ping" }));
});

setInterval(() => {
  console.log("🔍 Current WebSocket clients:", Array.from(clients.keys()));
}, 30000);

app.set("wsClients", clients);

const authRoutes = require("./routes/authRoutes");
const feedRoutes = require("./routes/feedRoutes");
const postRoutes = require("./routes/postRoutes");
const messageRoutes = require("./routes/messageRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const portfolioRoutes = require("./routes/portfolioRoutes");
const adminRoutes = require("./routes/adminRoutes");
const overlayRoutes = require("./routes/overlayRoutes");
const statsRoutes = require("./routes/statsRoutes");
const badgesRoutes = require("./routes/badgesRoutes");
const notificationRoutes = require("./routes/notificationRoutes")(wss);
const commentRoutes = require("./routes/commentRoutes");

// Mount authRoutes at /api to handle /api/signup, /api/login, etc.
app.use("/api", authRoutes);

// Mount /me routes with authentication
app.use("/api/me", authenticateUser, authRoutes);

// Mount other routes
app.use("/api/feed/design", authenticateUser, feedRoutes);
app.use("/api/feed/booking", authenticateUser, feedRoutes);
app.use("/api/feed", authenticateUser, feedRoutes);
app.use("/api/posts", authenticateUser, postRoutes);
app.use("/api/messages", authenticateUser, messageRoutes);
app.use("/api/payments", authenticateUser, paymentRoutes);
app.use("/api/portfolio", authenticateUser, portfolioRoutes);
app.use("/api/admin", authenticateUser, adminRoutes);
app.use("/api/overlay", authRoutes);
app.use("/api/stats", authenticateUser, statsRoutes);
app.use("/api/badges", authenticateUser, badgesRoutes);
app.use("/api/notifications", authenticateUser, notificationRoutes);
app.use("/api/comments", authenticateUser, commentRoutes);

app.get("/", (req, res) => {
  res.send("RightArtist Backend is Running!");
});

sequelize
  .sync({ force: false })
  .then(async () => {
    console.log("✅ Database connected successfully");
    console.log("✅ Database & tables synced (force: true)");
    const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 10;
    try {
      console.log("🔍 Creating admin user...");
      const hashedPassword = await bcrypt.hash("newadminpass", saltRounds);
      const [admin, created] = await db.User.findOrCreate({
        where: { email: "admin@admin.com" },
        defaults: {
          id: "admin-user-id-1234",
          firstName: "Admin",
          lastName: "User",
          username: "AdminUser",
          email: "admin@admin.com",
          password: hashedPassword,
          userType: "admin", // Now "admin" type
          isAdmin: true, // Still true for backwards compatibility
          isPaid: true,
          isElite: false,
          portfolio: [],
          paymentInfo: JSON.stringify({ bankAccount: "", routingNumber: "" }),
        },
      });
      if (created) {
        console.log("✅ Admin user created with password 'newadminpass' and userType: 'admin'");
      } else {
        if (admin.userType !== "admin") {
          await admin.update({ userType: "admin", isAdmin: true });
          console.log("✅ Admin user updated to userType: 'admin'");
        }
        console.log("ℹ️ Admin user already exists, userType:", admin.userType);
      }

      console.log("🔍 Creating test designer...");
      const [designer, designerCreated] = await db.User.findOrCreate({
        where: { email: "trenton@test.com" },
        defaults: {
          id: "e0536750-e2de-4b19-b0f5-df38dec52acc",
          firstName: "Trenton",
          lastName: "Shupp",
          username: "trenton.shupp",
          email: "trenton@test.com",
          password: await bcrypt.hash("trenton123", saltRounds),
          userType: "designer",
          isAdmin: false,
          isPaid: true,
          isElite: false,
          portfolio: [],
          paymentInfo: JSON.stringify({ bankAccount: "", routingNumber: "" }),
        },
      });
      if (designerCreated) {
        console.log("✅ Test designer created with password 'trenton123'");
      }

      console.log("🔍 Creating test fan...");
      const [fan, fanCreated] = await db.User.findOrCreate({
        where: { email: "fan@test.com" },
        defaults: {
          id: "53857a86-b943-44bb-be32-aa0df82aad0d",
          firstName: "Fan",
          lastName: "User",
          username: "fan.user",
          email: "fan@test.com",
          password: await bcrypt.hash("fan123", saltRounds),
          userType: "fan",
          isAdmin: false,
          isPaid: true,
          isElite: false,
          portfolio: [],
          paymentInfo: JSON.stringify({ bankAccount: "", routingNumber: "" }),
        },
      });
      if (fanCreated) {
        console.log("✅ Test fan created with password 'fan123'");
      }

      console.log("Creating shop...");
      const [shop, shopCreated] = await db.User.findOrCreate({
        where: { email: "shop@test.com" },
        defaults: {
          id: "53857a86-b943-44bb-be32-aa0df82aad1e",
          firstName: "Shop",
          lastName: "User",
          username: "shop.user",
          email: "shop@test.com",
          password: await bcrypt.hash("shop123", saltRounds),
          userType: "shop",
          isAdmin: false,
          isPaid: true,
          isElite: false,
          portfolio: [],
          paymentInfo: JSON.stringify({ bankAccount: "", routingNumber: "" }),
        },
      });
      if (shopCreated) {
        console.log("✅ Test shop created with password 'shop123'");
      }
    } catch (error) {
      console.error("❌ Error seeding data:", error.message);
    }
  })
  .catch((err) => {
    console.error("❌ Database sync error:", err.message);
    process.exit(1);
  });

module.exports = { app, db };