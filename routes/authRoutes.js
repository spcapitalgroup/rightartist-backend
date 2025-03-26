const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const router = express.Router();

router.post("/login", async (req, res) => {
  const { User } = req.app.get("db");
  try {
    const { email, password } = req.body;
    console.log("🔍 Login Attempt - Email:", email);
    if (!email || !password) {
      console.log("❌ Missing email or password");
      return res.status(400).json({ message: "Email and password are required." });
    }
    const user = await User.findOne({ where: { email } });
    if (!user) {
      console.log("❌ User not found for email:", email);
      return res.status(400).json({ message: "Invalid credentials" });
    }
    console.log("✅ User Found - Details:", user.toJSON());
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.log("❌ Password mismatch for email:", email);
      return res.status(400).json({ message: "Invalid credentials" });
    }
    const token = jwt.sign(
      { id: user.id, userType: user.userType, isAdmin: user.isAdmin, isPaid: user.isPaid, isElite: user.isElite, firstName: user.firstName, lastName: user.lastName },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );
    console.log("✅ Login Successful - Token Payload:", { id: user.id, userType: user.userType });
    res.json({ message: "Login successful", token });
  } catch (error) {
    console.error("❌ Login Error:", error.message);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

router.post("/signup", async (req, res) => {
  const { User } = req.app.get("db");
  console.log("🔍 Signup Request Received:", req.body);
  try {
    const { email, password, firstName, lastName, userType } = req.body;
    if (!email || !password || !firstName || !lastName || !userType) {
      console.log("❌ Missing required fields:", req.body);
      return res.status(400).json({ message: "All fields are required" });
    }
    if (!["fan", "designer", "shop"].includes(userType)) {
      console.log("❌ Invalid userType:", userType);
      return res.status(400).json({ message: "Invalid user type" });
    }
    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      console.log("❌ Email already in use:", email);
      return res.status(400).json({ message: "Email already in use" });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const username = `${firstName}.${lastName}`.toLowerCase();
    const isPaid = userType === "shop"; // Shop Pro starts paid
    const isElite = false; // Elite via upgrade
    const isAdmin = false; // No admin signup—seeded separately

    console.log("🔍 Creating user with userType:", userType); // Debug: Confirm userType before creation

    const user = await User.create({
      id: require("uuid").v4(),
      email,
      password: hashedPassword,
      firstName,
      lastName,
      username,
      userType,
      isPaid,
      isElite,
      isAdmin,
      paymentInfo: JSON.stringify({ bankAccount: "", routingNumber: "" }),
    });

    const token = jwt.sign(
      { id: user.id, userType: user.userType, isAdmin: user.isAdmin, isPaid: user.isPaid, isElite: user.isElite },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );
    console.log("✅ User signed up successfully:", email, "Type:", userType);
    res.status(201).json({ message: "Signup successful", token });
  } catch (error) {
    console.error("❌ Signup Error:", error); // Log the full error object
    if (error.name === "SequelizeUniqueConstraintError") {
      if (error.fields.email) {
        console.log("❌ Email already in use:", req.body.email);
        return res.status(400).json({ message: "Email already in use" });
      }
      if (error.fields.username) {
        console.log("❌ Username already in use:", req.body.firstName + "." + req.body.lastName);
        return res.status(400).json({ message: "Username already in use" });
      }
    }
    if (error.name === "SequelizeValidationError") {
      console.log("❌ Validation Error Details:", error.errors);
      return res.status(400).json({ message: "Validation error", errors: error.errors.map(e => e.message) });
    }
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

router.get("/me", async (req, res) => {
  const { User } = req.app.get("db");
  try {
    if (!req.user || !req.user.id) {
      console.log("❌ No user in request - Headers:", req.headers.authorization, "Body:", req.body);
      return res.status(401).json({ message: "Unauthorized" });
    }
    const user = await User.findOne({ where: { id: req.user.id } });
    if (!user) {
      console.log("❌ User not found for ID:", req.user.id);
      return res.status(404).json({ message: "User not found" });
    }
    console.log("✅ User Fetched:", user.toJSON());
    const userData = {
      ...user.toJSON(),
      paymentInfo: user.paymentInfo ? JSON.parse(user.paymentInfo) : {},
    };
    res.json(userData);
  } catch (error) {
    console.error("❌ Fetch User Error:", error.message);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

router.put("/me", async (req, res) => {
  const { User } = req.app.get("db");
  try {
    const { firstName, lastName, password, paymentInfo, notifications, isElite } = req.body; // Added isElite
    if (!req.user || !req.user.id) {
      console.log("❌ No user in request - Headers:", req.headers.authorization, "Body:", req.body);
      return res.status(401).json({ message: "Unauthorized" });
    }
    const user = await User.findOne({ where: { id: req.user.id } });
    if (!user) {
      console.log("❌ User not found for ID:", req.user.id);
      return res.status(404).json({ message: "User not found" });
    }
    if (user.userType !== "shop" && isElite !== undefined) {
      console.log("❌ Only Shop users can toggle isElite:", user.userType);
      return res.status(403).json({ message: "Only Shop users can upgrade membership" });
    }

    const updates = {};
    if (firstName) updates.firstName = firstName;
    if (lastName) updates.lastName = lastName;
    if (password) updates.password = await bcrypt.hash(password, 10);
    if (paymentInfo) updates.paymentInfo = JSON.stringify(paymentInfo);
    if (typeof notifications === "boolean") updates.notifications = notifications;
    if (typeof isElite === "boolean") updates.isElite = isElite; // Allow Elite toggle

    await user.update(updates);
    console.log("✅ User Updated:", user.toJSON());

    const updatedUser = {
      ...user.toJSON(),
      paymentInfo: user.paymentInfo ? JSON.parse(user.paymentInfo) : {},
    };
    res.json(updatedUser);
  } catch (error) {
    console.error("❌ Update User Error:", error.message);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;