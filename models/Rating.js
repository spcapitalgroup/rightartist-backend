// models/Rating.js
module.exports = (sequelize, DataTypes) => {
    const Rating = sequelize.define(
      "Rating",
      {
        id: {
          type: DataTypes.UUID,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true,
        },
        raterId: {
          type: DataTypes.UUID,
          allowNull: false,
        },
        rateeId: {
          type: DataTypes.UUID,
          allowNull: false,
        },
        postId: {
          type: DataTypes.UUID,
          allowNull: false,
        },
        rating: {
          type: DataTypes.INTEGER,
          allowNull: false,
          validate: {
            min: 1,
            max: 5,
          },
        },
        comment: {
          type: DataTypes.TEXT,
          allowNull: true,
          defaultValue: "",
        },
        createdAt: {
          type: DataTypes.DATE,
          defaultValue: DataTypes.NOW,
        },
        updatedAt: {
          type: DataTypes.DATE,
          defaultValue: DataTypes.NOW,
        },
      },
      {
        timestamps: true,
        updatedAt: "updatedAt",
        createdAt: "createdAt",
      }
    );
  
    Rating.associate = (models) => {
      // Rater (the user who gave the rating)
      Rating.belongsTo(models.User, { foreignKey: "raterId", as: "rater" });
      // Ratee (the user who received the rating)
      Rating.belongsTo(models.User, { foreignKey: "rateeId", as: "ratee" });
      // Post (the post associated with this rating)
      Rating.belongsTo(models.Post, { foreignKey: "postId", as: "post" });
    };
  
    return Rating;
  };