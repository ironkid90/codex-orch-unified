const rateLimit = require('express-rate-limit');
const { RateLimitError } = require('../utils/errors');
const logger = require('../utils/logger');

/**
 * General rate limiter
 * Limits requests per IP address
 */
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    error: {
      message: 'Too many requests from this IP, please try again later.',
      statusCode: 429,
    },
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (req, res) => {
    logger.warn(`Rate limit exceeded for IP: ${req.ip}`);
    const error = new RateLimitError('Too many requests from this IP, please try again later.');
    res.status(429).json({
      success: false,
      error: {
        message: error.message,
        statusCode: error.statusCode,
      },
    });
  },
});

/**
 * Authentication rate limiter
 * Stricter limits for login attempts
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 login attempts per windowMs
  message: {
    error: {
      message: 'Too many login attempts from this IP, please try again later.',
      statusCode: 429,
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn(`Authentication rate limit exceeded for IP: ${req.ip}`);
    const error = new RateLimitError('Too many login attempts from this IP, please try again later.');
    res.status(429).json({
      success: false,
      error: {
        message: error.message,
        statusCode: error.statusCode,
      },
    });
  },
});

/**
 * User creation rate limiter
 * Moderate limits for user registration
 */
const createUserLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // limit each IP to 10 user creations per hour
  message: {
    error: {
      message: 'Too many accounts created from this IP, please try again later.',
      statusCode: 429,
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn(`User creation rate limit exceeded for IP: ${req.ip}`);
    const error = new RateLimitError('Too many accounts created from this IP, please try again later.');
    res.status(429).json({
      success: false,
      error: {
        message: error.message,
        statusCode: error.statusCode,
      },
    });
  },
});

/**
 * Password reset rate limiter
 * Limits password reset attempts
 */
const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // limit each IP to 3 password reset attempts per hour
  message: {
    error: {
      message: 'Too many password reset attempts from this IP, please try again later.',
      statusCode: 429,
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn(`Password reset rate limit exceeded for IP: ${req.ip}`);
    const error = new RateLimitError('Too many password reset attempts from this IP, please try again later.');
    res.status(429).json({
      success: false,
      error: {
        message: error.message,
        statusCode: error.statusCode,
      },
    });
  },
});

module.exports = {
  generalLimiter,
  authLimiter,
  createUserLimiter,
  passwordResetLimiter,
};