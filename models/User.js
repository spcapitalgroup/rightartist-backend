module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define("User", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    firstName: { type: DataTypes.STRING, allowNull: false },
    lastName: { type: DataTypes.STRING, allowNull: false },
    username: { type: DataTypes.STRING, allowNull: false, unique: true },
    email: { type: DataTypes.STRING, allowNull: false, unique: true },
    password: { type: DataTypes.STRING, allowNull: false },
    userType: { type: DataTypes.ENUM("shop", "elite", "designer", "fan"), allowNull: false },
    isAdmin: { type: DataTypes.BOOLEAN, defaultValue: false },
    isPaid: { type: DataTypes.BOOLEAN, defaultValue: false },
    portfolio: { type: DataTypes.JSON, defaultValue: [] },
    paymentInfo: { type: DataTypes.JSON, defaultValue: JSON.stringify({ bankAccount: "", routingNumber: "" }) },
  });

  User.associate = (models) => {
    User.hasMany(models.Post, { foreignKey: "clientId", as: "clientPosts" });
    User.hasMany(models.Post, { foreignKey: "shopId", as: "shopPosts" });
    User.hasMany(models.Comment, { foreignKey: "userId", as: "comments" });
  };

  return User;
};