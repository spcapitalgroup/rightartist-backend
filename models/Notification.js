module.exports = (sequelize, DataTypes) => {
    const Notification = sequelize.define("Notification", {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      message: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      isRead: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      createdAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
    });
  
    Notification.associate = (models) => {
      Notification.belongsTo(models.User, { foreignKey: "userId", as: "user" });
    };
  
    return Notification;
  };