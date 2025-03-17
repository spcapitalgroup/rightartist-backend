module.exports = (sequelize, DataTypes) => {
    const Payment = sequelize.define("Payment", {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      amount: {
        type: DataTypes.FLOAT,
        allowNull: false,
      },
      type: {
        type: DataTypes.ENUM("subscription", "design"),
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM("pending", "completed"),
        defaultValue: "pending",
      },
      createdAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
    });
  
    Payment.associate = (models) => {
      Payment.belongsTo(models.User, { foreignKey: "userId", as: "user" });
    };
  
    return Payment;
  };