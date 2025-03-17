const Sequelize = require("sequelize");

module.exports = (sequelize) => {
  const db = {};

  db.User = require("./User")(sequelize, Sequelize.DataTypes);
  db.Post = require("./Post")(sequelize, Sequelize.DataTypes);
  db.Comment = require("./Comment")(sequelize, Sequelize.DataTypes);
  db.Message = require("./Message")(sequelize, Sequelize.DataTypes);
  db.Notification = require("./Notification")(sequelize, Sequelize.DataTypes);
  db.Payment = require("./Payment")(sequelize, Sequelize.DataTypes);
  db.Badge = require("./Badge")(sequelize, Sequelize.DataTypes);

  Object.keys(db).forEach(modelName => {
    if (db[modelName].associate) {
      db[modelName].associate(db);
    }
  });

  db.sequelize = sequelize;
  db.Sequelize = Sequelize;

  return db;
};