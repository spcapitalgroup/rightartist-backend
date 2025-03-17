module.exports = (sequelize, DataTypes) => {
    const Badge = sequelize.define("Badge", {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false, // e.g., "Top Shop", "Top Designer"
      },
      createdAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
    });
  
    Badge.associate = (models) => {
      Badge.belongsTo(models.User, { foreignKey: "userId", as: "user" });
    };
  
    return Badge;
  };