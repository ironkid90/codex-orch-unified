const jwt = require('jsonwebtoken');
const { User } = require('../models/User');
const { AuthenticationError, AuthorizationError } = require('../utils/errors');
const logger = require('../utils/logger');

/**
 * Authentication middleware
 * Verifies JWT token and attaches user to request object
 */
const auth = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.header('Authorization');
    const token = authHeader && authHeader.startsWith('Bearer ') 
      ? authHeader.substring(7) 
      : null;

    if (!token) {
      throw new AuthenticationError('Access denied. No token provided.');
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret');
    
    // Get user from database
    const user = await User.findOne({ id: decoded.id });
    if (!user) {
      throw new AuthenticationError('Invalid token. User not found.');
    }

    // Check if user is active
    if (!user.isActive) {
      throw new AuthenticationError('User account is not active.');
    }

    // Attach user to request object
    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      logger.warn('Invalid JWT token attempted');
      next(new AuthenticationError('Invalid token'));
    } else if (error.name === 'TokenExpiredError') {
      logger.warn('Expired JWT token attempted');
      next(new AuthenticationError('Token expired'));
    } else {
      logger.error('Authentication error:', error);
      next(error);
    }
  }
};

/**
 * Authorization middleware factory
 * Creates middleware that checks if user has required role
 */
const authorize = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AuthenticationError('Authentication required'));
    }

    // Convert single role to array
    const allowedRoles = Array.isArray(roles) ? roles : [roles];

    // Check if user has required role
    if (!allowedRoles.includes(req.user.role)) {
      logger.warn(`User ${req.user.username} attempted to access resource requiring roles: ${allowedRoles.join(', ')}`);
      return next(new AuthorizationError('Insufficient permissions'));
    }

    next();
  };
};

/**
 * Permission-based authorization middleware
 * Checks if user has specific permission
 */
const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AuthenticationError('Authentication required'));
    }

    if (!req.user.hasPermission(permission)) {
      logger.warn(`User ${req.user.username} attempted to access resource requiring permission: ${permission}`);
      return next(new AuthorizationError('Insufficient permissions'));
    }

    next();
  };
};

/**
 * Self or admin middleware
 * Allows access if user is accessing their own data or is an admin
 */
const selfOrAdmin = (req, res, next) => {
  if (!req.user) {
    return next(new AuthenticationError('Authentication required'));
  }

  const targetUserId = req.params.id;
  const isAdmin = req.user.role === 'admin';
  const isSelf = req.user.id === targetUserId;

  if (!isAdmin && !isSelf) {
    logger.warn(`User ${req.user.username} attempted to access another user's data`);
    return next(new AuthorizationError('Access denied'));
  }

  next();
};

/**
 * Admin only middleware
 * Allows access only for admin users
 */
const adminOnly = authorize(['admin']);

/**
 * User or admin middleware
 * Allows access for user role and above
 */
const userOrAdmin = authorize(['user', 'admin']);

/**
 * Optional authentication middleware
 * Authenticates user if token is provided, but doesn't require it
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    const token = authHeader && authHeader.startsWith('Bearer ') 
      ? authHeader.substring(7) 
      : null;

    if (!token) {
      return next();
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret');
    const user = await User.findOne({ id: decoded.id });
    
    if (user && user.isActive) {
      req.user = user;
    }
    
    next();
  } catch (error) {
    // Don't fail on optional auth, just continue without user
    next();
  }
};

module.exports = {
  auth,
  authorize,
  requirePermission,
  selfOrAdmin,
  adminOnly,
  userOrAdmin,
  optionalAuth,
};