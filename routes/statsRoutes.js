const express = require("express");
const { Op, fn, col, literal } = require("sequelize");
const { startOfDay, endOfDay, subDays, startOfMonth, endOfMonth, subMonths, format } = require("date-fns");
const router = express.Router();

router.get("/designer", async (req, res) => {
  const { Payment } = req.app.get("db");
  try {
    if (req.user.userType !== "designer") {
      return res.status(403).json({ message: "Designers only" });
    }

    const payments = await Payment.findAll({
      where: { userId: req.user.id, type: "design", status: "completed" },
    });
    const totalEarnings = payments.reduce((sum, p) => sum + p.amount * 0.9, 0);
    const designsSold = payments.length;
    const trends = { monthly: designsSold > 5 ? "Hot Streak" : "Steady" };

    console.log("✅ Designer stats fetched for:", req.user.id);
    res.json({ message: "Stats fetched", data: { totalEarnings, designsSold, trends } });
  } catch (error) {
    console.error("❌ Designer Stats Error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/shop", async (req, res) => {
  const { Payment, Post } = req.app.get("db");
  try {
    if (req.user.userType !== "shop") {
      return res.status(403).json({ message: "Shop users only" });
    }

    // Fetch payments for shop (e.g., from bookings or designs)
    const payments = await Payment.findAll({
      where: { userId: req.user.id, status: "completed" },
    });
    const totalEarnings = payments.reduce((sum, p) => sum + p.amount * 0.9, 0);

    // Fetch number of bookings handled by the shop
    const bookings = await Post.count({
      where: { shopId: req.user.id, feedType: "booking" },
    });

    const trends = { monthly: bookings > 5 ? "Busy Shop" : "Steady" };

    console.log("✅ Shop stats fetched for:", req.user.id);
    res.json({ message: "Stats fetched", data: { totalEarnings, bookings, trends } });
  } catch (error) {
    console.error("❌ Shop Stats Error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/admin", async (req, res) => {
  const { User, Post, Payment } = req.app.get("db");
  try {
    if (!req.user.isAdmin) {
      return res.status(403).json({ message: "Admin access required" });
    }

    const totalUsers = await User.count();
    const totalPosts = await Post.count();
    const totalRevenue = (await Payment.sum("amount", { where: { status: "completed" } })) || 0;

    console.log("✅ Admin stats fetched for:", req.user.id);
    res.json({ totalUsers, totalPosts, totalRevenue });
  } catch (error) {
    console.error("❌ Admin Stats Error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

// New endpoint: Users per day by user type
router.get("/users/daily", async (req, res) => {
  const { User } = req.app.get("db");
  const { userType, range = "30days" } = req.query;
  try {
    if (!req.user.isAdmin) {
      return res.status(403).json({ message: "Admin access required" });
    }

    if (!["shop", "fan", "designer"].includes(userType)) {
      return res.status(400).json({ message: "Invalid user type" });
    }

    const days = range === "90days" ? 90 : 30;
    const startDate = subDays(new Date(), days);
    const endDate = new Date();

    const users = await User.findAll({
      where: {
        userType,
        createdAt: { [Op.between]: [startDate, endDate] },
      },
      attributes: [
        [fn("DATE", col("createdAt")), "date"],
        [fn("COUNT", col("id")), "count"],
      ],
      group: [fn("DATE", col("createdAt"))],
      order: [[fn("DATE", col("createdAt")), "ASC"]],
    });

    const labels = [];
    const data = [];
    for (let d = startDate; d <= endDate; d = new Date(d.setDate(d.getDate() + 1))) {
      labels.push(format(d, "yyyy-MM-dd"));
      const dayData = users.find(u => format(new Date(u.get("date")), "yyyy-MM-dd") === format(d, "yyyy-MM-dd"));
      data.push(dayData ? parseInt(dayData.get("count")) : 0);
    }

    console.log(`✅ Daily ${userType} users stats fetched for:`, req.user.id);
    res.json({ labels, data });
  } catch (error) {
    console.error(`❌ Daily ${userType} Users Stats Error:`, error.message);
    res.status(500).json({ message: "Server error" });
  }
});

// New endpoint: Users per month by user type
router.get("/users/monthly", async (req, res) => {
  const { User } = req.app.get("db");
  const { userType } = req.query;
  try {
    if (!req.user.isAdmin) {
      return res.status(403).json({ message: "Admin access required" });
    }

    if (!["shop", "fan", "designer"].includes(userType)) {
      return res.status(400).json({ message: "Invalid user type" });
    }

    const startDate = subMonths(new Date(), 12);
    const endDate = new Date();

    const users = await User.findAll({
      where: {
        userType,
        createdAt: { [Op.between]: [startDate, endDate] },
      },
      attributes: [
        // Use strftime for SQLite to group by year and month
        [fn("strftime", literal("'%Y-%m'"), col("createdAt")), "month"],
        [fn("COUNT", col("id")), "count"],
      ],
      group: [fn("strftime", literal("'%Y-%m'"), col("createdAt"))],
      order: [[fn("strftime", literal("'%Y-%m'"), col("createdAt")), "ASC"]],
    });

    const labels = [];
    const data = [];
    for (let d = startDate; d <= endDate; d = new Date(d.setMonth(d.getMonth() + 1))) {
      labels.push(format(d, "MMM yyyy"));
      const monthData = users.find(u => u.get("month") === format(d, "yyyy-MM"));
      data.push(monthData ? parseInt(monthData.get("count")) : 0);
    }

    console.log(`✅ Monthly ${userType} users stats fetched for:`, req.user.id);
    res.json({ labels, data });
  } catch (error) {
    console.error(`❌ Monthly ${userType} Users Stats Error:`, error.message);
    res.status(500).json({ message: "Server error" });
  }
});

// New endpoint: Churn rate by user type
router.get("/churn", async (req, res) => {
  const { User, Post, Comment, Payment } = req.app.get("db");
  const { userType } = req.query;
  try {
    if (!req.user.isAdmin) {
      return res.status(403).json({ message: "Admin access required" });
    }

    if (!["shop", "fan", "designer"].includes(userType)) {
      return res.status(400).json({ message: "Invalid user type" });
    }

    const startOfCurrentMonth = startOfMonth(new Date());
    const endOfCurrentMonth = endOfMonth(new Date());
    const startOfPreviousMonth = startOfMonth(subMonths(new Date(), 1));
    const endOfPreviousMonth = endOfMonth(subMonths(new Date(), 1));

    let churnRate = 0;

    if (userType === "shop") {
      // Shop users: Churn based on failed payments or isPaid becoming false
      const totalShopUsersStart = await User.count({
        where: {
          userType: "shop",
          createdAt: { [Op.lte]: endOfPreviousMonth },
        },
      });

      const failedPayments = await Payment.count({
        where: {
          userId: { [Op.in]: literal(`(SELECT id FROM "Users" WHERE "userType" = 'shop')`) },
          status: "failed",
          createdAt: { [Op.between]: [startOfCurrentMonth, endOfCurrentMonth] },
        },
      });

      const usersUnpaid = await User.count({
        where: {
          userType: "shop",
          isPaid: false,
          updatedAt: { [Op.between]: [startOfCurrentMonth, endOfCurrentMonth] },
        },
      });

      const churnedUsers = failedPayments + usersUnpaid;
      churnRate = totalShopUsersStart > 0 ? (churnedUsers / totalShopUsersStart) * 100 : 0;
    } else {
      // Fan/Designer users: Churn based on inactivity (no posts/comments in 30 days)
      const totalUsers = await User.count({
        where: {
          userType,
          createdAt: { [Op.lte]: subDays(new Date(), 30) },
        },
      });

      const activeUsers = await User.count({
        where: {
          userType,
          id: {
            [Op.in]: literal(`
              SELECT DISTINCT "userId" FROM (
                SELECT "userId" FROM "Posts" WHERE "createdAt" >= date('now', '-30 days')
                UNION
                SELECT "userId" FROM "Comments" WHERE "createdAt" >= date('now', '-30 days')
              ) AS activity
            `),
          },
        },
      });

      const churnedUsers = totalUsers - activeUsers;
      churnRate = totalUsers > 0 ? (churnedUsers / totalUsers) * 100 : 0;
    }

    console.log(`✅ Churn rate for ${userType} users:`, churnRate);
    res.json({ churnRate });
  } catch (error) {
    console.error(`❌ Churn Rate Error for ${userType}:`, error.message);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;