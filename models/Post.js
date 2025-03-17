module.exports = (sequelize, DataTypes) => {
    const Post = sequelize.define("Post", {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      title: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      location: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM("open", "closed"),
        defaultValue: "open",
      },
      clientId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      artistId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      shopId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      images: {
        type: DataTypes.JSON,
        defaultValue: [],
      },
      feedType: {
        type: DataTypes.ENUM("design", "booking"),
        allowNull: false,
      },
    });
  
    Post.associate = (models) => {
      Post.belongsTo(models.User, { foreignKey: "clientId", as: "client" });
      Post.belongsTo(models.User, { foreignKey: "shopId", as: "shop" });
      Post.hasMany(models.Comment, { foreignKey: "postId", as: "comments" });
    };
  
    return Post;
  };