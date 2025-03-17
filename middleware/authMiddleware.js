const jwt = require("jsonwebtoken");

const authenticateUser = (req, res, next) => {
  const authHeader = req.header("Authorization");
  console.log("🔍 Auth Header:", authHeader);

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.error("❌ Invalid Authorization Header");
    return res.status(401).json({ message: "Access Denied. Invalid token format." });
  }

  const token = authHeader.split(" ")[1];
  console.log("🔹 Received Token:", token);

  if (!token) {
    console.error("❌ No token provided");
    return res.status(401).json({ message: "Access Denied. No token provided." });
  }

  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      console.error("❌ Missing JWT_SECRET in environment variables");
      return res.status(500).json({ message: "Internal Server Error: Missing JWT_SECRET" });
    }

    const decoded = jwt.verify(token, secret);
    console.log("✅ Token Decoded:", decoded);

    if (!decoded.id || !decoded.userType) {
      console.error("❌ Token missing fields:", decoded);
      return res.status(401).json({ message: "Invalid token: Missing id or userType" });
    }

    req.user = decoded;
    next();
  } catch (error) {
    console.error("❌ Token Verification Error:", error.message);
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Token expired. Please log in again." });
    } else if (error.name === "JsonWebTokenError") {
      return res.status(401).json({ message: "Invalid token. Please provide a valid token." });
    }
    return res.status(401).json({ message: "Authentication failed." });
  }
};

module.exports = authenticateUser;