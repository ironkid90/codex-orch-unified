const { User, USER_ROLES, USER_STATUS } = require('../models/User');
const { AppError } = require('../utils/errors');
const logger = require('../utils/logger');

/**
 * UserService class handles all user-related business logic
 */
class UserService {
  /**
   * Create a new user
   * @param {Object} userData - User data object
   * @returns {Promise<Object>} Created user response
   */
  async createUser(userData) {
    try {
      // Check if username already exists
      const existingUsername = await User.findByUsername(userData.username);
      if (existingUsername) {
        throw new AppError('Username already exists', 400);
      }

      // Check if email already exists (if provided)
      if (userData.email) {
        const existingEmail = await User.findByEmail(userData.email);
        if (existingEmail) {
          throw new AppError('Email already exists', 400);
        }
      }

      // Create new user
      const user = new User(userData);
      
      // Validate user data
      const validationErrors = user.validateUser();
      if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(', '), 400);
      }

      await user.save();
      
      logger.info(`User created successfully: ${user.username}`);
      return user.response;
    } catch (error) {
      logger.error('Error creating user:', error);
      throw error;
    }
  }

  /**
   * Get user by ID
   * @param {string} id - User ID
   * @returns {Promise<Object>} User response
   */
  async getUserById(id) {
    try {
      const user = await User.findOne({ id });
      if (!user) {
        throw new AppError('User not found', 404);
      }
      return user.response;
    } catch (error) {
      logger.error('Error getting user by ID:', error);
      throw error;
    }
  }

  /**
   * Get user by username
   * @param {string} username - Username
   * @returns {Promise<Object>} User response
   */
  async getUserByUsername(username) {
    try {
      const user = await User.findByUsername(username);
      if (!user) {
        throw new AppError('User not found', 404);
      }
      return user.response;
    } catch (error) {
      logger.error('Error getting user by username:', error);
      throw error;
    }
  }

  /**
   * Get user by email
   * @param {string} email - Email address
   * @returns {Promise<Object>} User response
   */
  async getUserByEmail(email) {
    try {
      const user = await User.findByEmail(email);
      if (!user) {
        throw new AppError('User not found', 404);
      }
      return user.response;
    } catch (error) {
      logger.error('Error getting user by email:', error);
      throw error;
    }
  }

  /**
   * Update user
   * @param {string} id - User ID
   * @param {Object} updateData - Update data
   * @returns {Promise<Object>} Updated user response
   */
  async updateUser(id, updateData) {
    try {
      const user = await User.findOne({ id });
      if (!user) {
        throw new AppError('User not found', 404);
      }

      // Apply updates
      Object.keys(updateData).forEach(key => {
        if (key !== 'password' && key !== 'id') {
          user[key] = updateData[key];
        }
      });

      // Validate updated data
      const validationErrors = user.validateUser();
      if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(', '), 400);
      }

      await user.save();
      
      logger.info(`User updated successfully: ${user.username}`);
      return user.response;
    } catch (error) {
      logger.error('Error updating user:', error);
      throw error;
    }
  }

  /**
   * Delete user (soft delete)
   * @param {string} id - User ID
   * @returns {Promise<boolean>} Success status
   */
  async deleteUser(id) {
    try {
      const user = await User.findOne({ id });
      if (!user) {
        throw new AppError('User not found', 404);
      }

      user.delete();
      await user.save();
      
      logger.info(`User deleted successfully: ${user.username}`);
      return true;
    } catch (error) {
      logger.error('Error deleting user:', error);
      throw error;
    }
  }

  /**
   * Hard delete user (permanent deletion)
   * @param {string} id - User ID
   * @returns {Promise<boolean>} Success status
   */
  async hardDeleteUser(id) {
    try {
      const result = await User.deleteOne({ id });
      if (result.deletedCount === 0) {
        throw new AppError('User not found', 404);
      }
      
      logger.info(`User permanently deleted: ${id}`);
      return true;
    } catch (error) {
      logger.error('Error hard deleting user:', error);
      throw error;
    }
  }

  /**
   * Get all users with pagination
   * @param {number} page - Page number
   * @param {number} limit - Items per page
   * @param {Object} filter - Filter criteria
   * @returns {Promise<Object>} Paginated users response
   */
  async getAllUsers(page = 1, limit = 20, filter = {}) {
    try {
      const skip = (page - 1) * limit;
      
      const users = await User.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const total = await User.countDocuments(filter);
      const totalPages = Math.ceil(total / limit);

      return {
        users: users.map(user => user.response),
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      };
    } catch (error) {
      logger.error('Error getting all users:', error);
      throw error;
    }
  }

  /**
   * Get active users
   * @returns {Promise<Array>} Active users
   */
  async getActiveUsers() {
    try {
      const users = await User.findActive();
      return users.map(user => user.response);
    } catch (error) {
      logger.error('Error getting active users:', error);
      throw error;
    }
  }

  /**
   * Get users by role
   * @param {string} role - User role
   * @returns {Promise<Array>} Users with specified role
   */
  async getUsersByRole(role) {
    try {
      const users = await User.findByRole(role);
      return users.map(user => user.response);
    } catch (error) {
      logger.error('Error getting users by role:', error);
      throw error;
    }
  }

  /**
   * Search users
   * @param {string} query - Search query
   * @param {number} page - Page number
   * @param {number} limit - Items per page
   * @returns {Promise<Object>} Search results
   */
  async searchUsers(query, page = 1, limit = 20) {
    try {
      const skip = (page - 1) * limit;
      
      const users = await User.searchUsers(query, {
        skip,
        limit,
        sort: { createdAt: -1 },
      });

      // Count total matching users
      const totalUsers = await User.searchUsers(query);
      const total = totalUsers.length;
      const totalPages = Math.ceil(total / limit);

      return {
        users: users.map(user => user.response),
        query,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      };
    } catch (error) {
      logger.error('Error searching users:', error);
      throw error;
    }
  }

  /**
   * Get user statistics
   * @returns {Promise<Object>} User statistics
   */
  async getUserStats() {
    try {
      const stats = await User.getUserStats();
      return stats;
    } catch (error) {
      logger.error('Error getting user statistics:', error);
      throw error;
    }
  }

  /**
   * Authenticate user
   * @param {string} username - Username
   * @param {string} password - Password
   * @returns {Promise<Object>} Authentication result
   */
  async authenticateUser(username, password) {
    try {
      const user = await User.findByUsername(username).select('+password');
      
      if (!user || !(await user.checkPassword(password))) {
        // Record failed login attempt if user exists
        if (user) {
          user.recordFailedLogin();
          await user.save();
        }
        throw new AppError('Invalid username or password', 401);
      }

      if (!user.isActive) {
        throw new AppError('User account is not active', 401);
      }

      if (user.isLocked) {
        throw new AppError('User account is locked', 401);
      }

      // Record successful login
      user.recordLogin();
      await user.save();

      // Generate token
      const token = user.generateToken();

      logger.info(`User authenticated successfully: ${user.username}`);
      
      return {
        user: user.response,
        token,
      };
    } catch (error) {
      logger.error('Error authenticating user:', error);
      throw error;
    }
  }

  /**
   * Change user password
   * @param {string} id - User ID
   * @param {string} currentPassword - Current password
   * @param {string} newPassword - New password
   * @returns {Promise<boolean>} Success status
   */
  async changePassword(id, currentPassword, newPassword) {
    try {
      const user = await User.findOne({ id }).select('+password');
      if (!user) {
        throw new AppError('User not found', 404);
      }

      if (!(await user.checkPassword(currentPassword))) {
        throw new AppError('Current password is incorrect', 400);
      }

      user.password = newPassword;
      await user.save();

      logger.info(`Password changed successfully for user: ${user.username}`);
      return true;
    } catch (error) {
      logger.error('Error changing password:', error);
      throw error;
    }
  }

  /**
   * Reset user password (admin function)
   * @param {string} id - User ID
   * @param {string} newPassword - New password
   * @returns {Promise<boolean>} Success status
   */
  async resetPassword(id, newPassword) {
    try {
      const user = await User.findOne({ id });
      if (!user) {
        throw new AppError('User not found', 404);
      }

      user.password = newPassword;
      user.resetLoginAttempts();
      await user.save();

      logger.info(`Password reset successfully for user: ${user.username}`);
      return true;
    } catch (error) {
      logger.error('Error resetting password:', error);
      throw error;
    }
  }

  /**
   * Add permission to user
   * @param {string} id - User ID
   * @param {string} permission - Permission to add
   * @returns {Promise<boolean>} Success status
   */
  async addPermission(id, permission) {
    try {
      const user = await User.findOne({ id });
      if (!user) {
        throw new AppError('User not found', 404);
      }

      user.addPermission(permission);
      await user.save();

      logger.info(`Permission added to user ${user.username}: ${permission}`);
      return true;
    } catch (error) {
      logger.error('Error adding permission:', error);
      throw error;
    }
  }

  /**
   * Remove permission from user
   * @param {string} id - User ID
   * @param {string} permission - Permission to remove
   * @returns {Promise<boolean>} Success status
   */
  async removePermission(id, permission) {
    try {
      const user = await User.findOne({ id });
      if (!user) {
        throw new AppError('User not found', 404);
      }

      user.removePermission(permission);
      await user.save();

      logger.info(`Permission removed from user ${user.username}: ${permission}`);
      return true;
    } catch (error) {
      logger.error('Error removing permission:', error);
      throw error;
    }
  }

  /**
   * Export users data
   * @returns {Promise<Array>} Users data for export
   */
  async exportUsers() {
    try {
      const users = await User.find().sort({ createdAt: -1 });
      return users.map(user => user.response);
    } catch (error) {
      logger.error('Error exporting users:', error);
      throw error;
    }
  }

  /**
   * Get user activity
   * @param {string} id - User ID
   * @returns {Promise<Object>} User activity data
   */
  async getUserActivity(id) {
    try {
      const user = await User.findOne({ id });
      if (!user) {
        throw new AppError('User not found', 404);
      }

      return {
        id: user.id,
        username: user.username,
        lastLogin: user.lastLogin,
        loginAttempts: user.loginAttempts,
        isActive: user.isActive,
        isLocked: user.isLocked,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      };
    } catch (error) {
      logger.error('Error getting user activity:', error);
      throw error;
    }
  }
}

module.exports = UserService;
// AUTO_REINDEX_MARKER: ci_auto_reindex_test_token_js