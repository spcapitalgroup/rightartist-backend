// @ts-nocheck
module.exports = (sequelize, DataTypes) => {
  const Notification = sequelize.define(
    "Notification",
    {
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
    },
    {
      // Enable timestamps so createdAt is auto-handled,
      // but disable updatedAt so it isn't used in inserts/updates.
      timestamps: true,
      createdAt: "createdAt",
      updatedAt: false,
    }
  );

  Notification.associate = (models) => {
    Notification.belongsTo(models.User, { foreignKey: "userId", as: "user" });
  };

  return Notification;
};