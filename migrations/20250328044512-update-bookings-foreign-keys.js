// migrations/20250328044512-update-bookings-foreign-keys.js
"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Step 1: Create a new temporary table with the updated foreign key constraints
    await queryInterface.createTable("Bookings_temp", {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      postId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: "Posts",
          key: "id",
        },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      shopId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: "Users",
          key: "id",
        },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      clientId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: "Users",
          key: "id",
        },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      scheduledDate: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM("scheduled", "completed", "cancelled"),
        defaultValue: "scheduled",
        allowNull: false,
      },
      contactInfo: {
        type: Sequelize.JSON,
        defaultValue: {},
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
    });

    // Step 2: Copy data from the old Bookings table to the temporary table
    await queryInterface.sequelize.query(`
      INSERT INTO Bookings_temp (id, postId, shopId, clientId, scheduledDate, status, contactInfo, createdAt, updatedAt)
      SELECT id, postId, shopId, clientId, scheduledDate, status, contactInfo, createdAt, updatedAt
      FROM Bookings
    `);

    // Step 3: Drop the old Bookings table
    await queryInterface.dropTable("Bookings");

    // Step 4: Rename the temporary table to Bookings
    await queryInterface.renameTable("Bookings_temp", "Bookings");
  },

  down: async (queryInterface, Sequelize) => {
    // Step 1: Create a new temporary table with the original foreign key constraints (NO ACTION)
    await queryInterface.createTable("Bookings_temp", {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      postId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: "Posts",
          key: "id",
        },
        onDelete: "NO ACTION",
        onUpdate: "CASCADE",
      },
      shopId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: "Users",
          key: "id",
        },
        onDelete: "NO ACTION",
        onUpdate: "CASCADE",
      },
      clientId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: "Users",
          key: "id",
        },
        onDelete: "NO ACTION",
        onUpdate: "CASCADE",
      },
      scheduledDate: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM("scheduled", "completed", "cancelled"),
        defaultValue: "scheduled",
        allowNull: false,
      },
      contactInfo: {
        type: Sequelize.JSON,
        defaultValue: {},
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
    });

    // Step 2: Copy data from the current Bookings table to the temporary table
    await queryInterface.sequelize.query(`
      INSERT INTO Bookings_temp (id, postId, shopId, clientId, scheduledDate, status, contactInfo, createdAt, updatedAt)
      SELECT id, postId, shopId, clientId, scheduledDate, status, contactInfo, createdAt, updatedAt
      FROM Bookings
    `);

    // Step 3: Drop the current Bookings table
    await queryInterface.dropTable("Bookings");

    // Step 4: Rename the temporary table to Bookings
    await queryInterface.renameTable("Bookings_temp", "Bookings");
  },
};