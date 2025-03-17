module.exports = (sequelize, DataTypes) => {
  const Comment = sequelize.define("Comment", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    postId: { type: DataTypes.UUID, allowNull: false },
    userId: { type: DataTypes.UUID, allowNull: false },
    content: { type: DataTypes.TEXT, allowNull: false },
    images: { type: DataTypes.JSON, defaultValue: [] },
    price: { type: DataTypes.FLOAT, allowNull: true },
    parentId: { type: DataTypes.UUID, allowNull: true }, // Added
    createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }, // Added for edits
  });

  Comment.associate = (models) => {
    Comment.belongsTo(models.Post, { foreignKey: "postId", as: "post" });
    Comment.belongsTo(models.User, { foreignKey: "userId", as: "user" });
    Comment.belongsTo(models.Comment, { foreignKey: "parentId", as: "parent" });
    Comment.hasMany(models.Comment, { foreignKey: "parentId", as: "replies" });
  };

  return Comment;
};