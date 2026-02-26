import { User } from '../models/User';
import {
  IUser,
  IUserResponse,
  ICreateUser,
  IUpdateUser,
  IUserStats,
  IAuthResult,
  IUserActivity,
  IPaginatedUsers,
  ISearchUsersResponse,
  IUserFilter,
  UserRole,
} from '../types/User';
import { AppError } from '../utils/errors';
import logger from '../utils/logger';

/**
 * UserService class handles all user-related business logic
 */
export class UserService {
  /**
   * Create a new user
   * @param userData - User data object
   * @returns Created user response
   */
  async createUser(userData: ICreateUser): Promise<IUserResponse> {
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
      logger.error('Error creating user:', error as Error);
      throw error;
    }
  }

  /**
   * Get user by ID
   * @param id - User ID
   * @returns User response
   */
  async getUserById(id: string): Promise<IUserResponse> {
    try {
      const user = await User.findOne({ id });
      if (!user) {
        throw new AppError('User not found', 404);
      }
      return user.response;
    } catch (error) {
      logger.error('Error getting user by ID:', error as Error);
      throw error;
    }
  }

  /**
   * Get user by username
   * @param username - Username
   * @returns User response
   */
  async getUserByUsername(username: string): Promise<IUserResponse> {
    try {
      const user = await User.findByUsername(username);
      if (!user) {
        throw new AppError('User not found', 404);
      }
      return user.response;
    } catch (error) {
      logger.error('Error getting user by username:', error as Error);
      throw error;
    }
  }

  /**
   * Get user by email
   * @param email - Email address
   * @returns User response
   */
  async getUserByEmail(email: string): Promise<IUserResponse> {
    try {
      const user = await User.findByEmail(email);
      if (!user) {
        throw new AppError('User not found', 404);
      }
      return user.response;
    } catch (error) {
      logger.error('Error getting user by email:', error as Error);
      throw error;
    }
  }

  /**
   * Update user
   * @param id - User ID
   * @param updateData - Update data
   * @returns Updated user response
   */
  async updateUser(id: string, updateData: IUpdateUser): Promise<IUserResponse> {
    try {
      const user = await User.findOne({ id });
      if (!user) {
        throw new AppError('User not found', 404);
      }

      // Apply updates (excluding password and id)
      Object.keys(updateData).forEach(key => {
        if (key !== 'password' && key !== 'id') {
          (user as any)[key] = (updateData as any)[key];
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
      logger.error('Error updating user:', error as Error);
      throw error;
    }
  }

  /**
   * Delete user (soft delete)
   * @param id - User ID
   * @returns Success status
   */
  async deleteUser(id: string): Promise<boolean> {
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
      logger.error('Error deleting user:', error as Error);
      throw error;
    }
  }

  /**
   * Hard delete user (permanent deletion)
   * @param id - User ID
   * @returns Success status
   */
  async hardDeleteUser(id: string): Promise<boolean> {
    try {
      const result = await User.deleteOne({ id });
      if (result.deletedCount === 0) {
        throw new AppError('User not found', 404);
      }
      
      logger.info(`User permanently deleted: ${id}`);
      return true;
    } catch (error) {
      logger.error('Error hard deleting user:', error as Error);
      throw error;
    }
  }

  /**
   * Get all users with pagination
   * @param page - Page number
   * @param limit - Items per page
   * @param filter - Filter criteria
   * @returns Paginated users response
   */
  async getAllUsers(
    page: number = 1,
    limit: number = 20,
    filter: IUserFilter = {}
  ): Promise<IPaginatedUsers> {
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
      logger.error('Error getting all users:', error as Error);
      throw error;
    }
  }

  /**
   * Get active users
   * @returns Active users
   */
  async getActiveUsers(): Promise<IUserResponse[]> {
    try {
      const users = await User.findActive();
      return users.map(user => user.response);
    } catch (error) {
      logger.error('Error getting active users:', error as Error);
      throw error;
    }
  }

  /**
   * Get users by role
   * @param role - User role
   * @returns Users with specified role
   */
  async getUsersByRole(role: UserRole): Promise<IUserResponse[]> {
    try {
      const users = await User.findByRole(role);
      return users.map(user => user.response);
    } catch (error) {
      logger.error('Error getting users by role:', error as Error);
      throw error;
    }
  }

  /**
   * Search users
   * @param query - Search query
   * @param page - Page number
   * @param limit - Items per page
   * @returns Search results
   */
  async searchUsers(
    query: string,
    page: number = 1,
    limit: number = 20
  ): Promise<ISearchUsersResponse> {
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
      logger.error('Error searching users:', error as Error);
      throw error;
    }
  }

  /**
   * Get user statistics
   * @returns User statistics
   */
  async getUserStats(): Promise<IUserStats> {
    try {
      const stats = await User.getUserStats();
      return stats;
    } catch (error) {
      logger.error('Error getting user statistics:', error as Error);
      throw error;
    }
  }

  /**
   * Authenticate user
   * @param username - Username
   * @param password - Password
   * @returns Authentication result
   */
  async authenticateUser(username: string, password: string): Promise<IAuthResult> {
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
      logger.error('Error authenticating user:', error as Error);
      throw error;
    }
  }

  /**
   * Change user password
   * @param id - User ID
   * @param currentPassword - Current password
   * @param newPassword - New password
   * @returns Success status
   */
  async changePassword(
    id: string,
    currentPassword: string,
    newPassword: string
  ): Promise<boolean> {
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
      logger.error('Error changing password:', error as Error);
      throw error;
    }
  }

  /**
   * Reset user password (admin function)
   * @param id - User ID
   * @param newPassword - New password
   * @returns Success status
   */
  async resetPassword(id: string, newPassword: string): Promise<boolean> {
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
      logger.error('Error resetting password:', error as Error);
      throw error;
    }
  }

  /**
   * Add permission to user
   * @param id - User ID
   * @param permission - Permission to add
   * @returns Success status
   */
  async addPermission(id: string, permission: string): Promise<boolean> {
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
      logger.error('Error adding permission:', error as Error);
      throw error;
    }
  }

  /**
   * Remove permission from user
   * @param id - User ID
   * @param permission - Permission to remove
   * @returns Success status
   */
  async removePermission(id: string, permission: string): Promise<boolean> {
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
      logger.error('Error removing permission:', error as Error);
      throw error;
    }
  }

  /**
   * Export users data
   * @returns Users data for export
   */
  async exportUsers(): Promise<IUserResponse[]> {
    try {
      const users = await User.find().sort({ createdAt: -1 });
      return users.map(user => user.response);
    } catch (error) {
      logger.error('Error exporting users:', error as Error);
      throw error;
    }
  }

  /**
   * Get user activity
   * @param id - User ID
   * @returns User activity data
   */
  async getUserActivity(id: string): Promise<IUserActivity> {
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
      logger.error('Error getting user activity:', error as Error);
      throw error;
    }
  }
}

export default UserService;
// AUTO_REINDEX_MARKER: ci_auto_reindex_test_token_ts