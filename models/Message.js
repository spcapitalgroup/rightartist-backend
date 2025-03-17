module.exports = (sequelize, DataTypes) => {
    const Message = sequelize.define("Message", {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      senderId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      receiverId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      content: {
        type: DataTypes.TEXT,
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
  
    Message.associate = (models) => {
      Message.belongsTo(models.User, { foreignKey: "senderId", as: "sender" });
      Message.belongsTo(models.User, { foreignKey: "receiverId", as: "receiver" });
    };
  
    return Message;
  };