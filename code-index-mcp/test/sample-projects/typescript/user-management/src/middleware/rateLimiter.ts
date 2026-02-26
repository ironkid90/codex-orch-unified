import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';
import { RateLimitError } from '../utils/errors';
import logger from '../utils/logger';
import { IApiResponse } from '../types/User';

/**
 * General rate limiter
 * Limits requests per IP address
 */
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.',
    error: {
      message: 'Too many requests from this IP, please try again later.',
      statusCode: 429,
    },
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (req: Request, res: Response) => {
    logger.warn(`Rate limit exceeded for IP: ${req.ip}`);
    const error = new RateLimitError('Too many requests from this IP, please try again later.');
    const response: IApiResponse = {
      success: false,
      message: error.message,
      error: {
        message: error.message,
        statusCode: error.statusCode,
      },
    };
    res.status(429).json(response);
  },
});

/**
 * Authentication rate limiter
 * Stricter limits for login attempts
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 login attempts per windowMs
  message: {
    success: false,
    message: 'Too many login attempts from this IP, please try again later.',
    error: {
      message: 'Too many login attempts from this IP, please try again later.',
      statusCode: 429,
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    logger.warn(`Authentication rate limit exceeded for IP: ${req.ip}`);
    const error = new RateLimitError('Too many login attempts from this IP, please try again later.');
    const response: IApiResponse = {
      success: false,
      message: error.message,
      error: {
        message: error.message,
        statusCode: error.statusCode,
      },
    };
    res.status(429).json(response);
  },
});

/**
 * User creation rate limiter
 * Moderate limits for user registration
 */
export const createUserLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // limit each IP to 10 user creations per hour
  message: {
    success: false,
    message: 'Too many accounts created from this IP, please try again later.',
    error: {
      message: 'Too many accounts created from this IP, please try again later.',
      statusCode: 429,
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    logger.warn(`User creation rate limit exceeded for IP: ${req.ip}`);
    const error = new RateLimitError('Too many accounts created from this IP, please try again later.');
    const response: IApiResponse = {
      success: false,
      message: error.message,
      error: {
        message: error.message,
        statusCode: error.statusCode,
      },
    };
    res.status(429).json(response);
  },
});

/**
 * Password reset rate limiter
 * Limits password reset attempts
 */
export const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // limit each IP to 3 password reset attempts per hour
  message: {
    success: false,
    message: 'Too many password reset attempts from this IP, please try again later.',
    error: {
      message: 'Too many password reset attempts from this IP, please try again later.',
      statusCode: 429,
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    logger.warn(`Password reset rate limit exceeded for IP: ${req.ip}`);
    const error = new RateLimitError('Too many password reset attempts from this IP, please try again later.');
    const response: IApiResponse = {
      success: false,
      message: error.message,
      error: {
        message: error.message,
        statusCode: error.statusCode,
      },
    };
    res.status(429).json(response);
  },
});

/**
 * API documentation rate limiter
 * Limits access to API documentation
 */
export const docsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // limit each IP to 50 documentation requests per windowMs
  message: {
    success: false,
    message: 'Too many documentation requests from this IP, please try again later.',
    error: {
      message: 'Too many documentation requests from this IP, please try again later.',
      statusCode: 429,
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    logger.warn(`Documentation rate limit exceeded for IP: ${req.ip}`);
    const error = new RateLimitError('Too many documentation requests from this IP, please try again later.');
    const response: IApiResponse = {
      success: false,
      message: error.message,
      error: {
        message: error.message,
        statusCode: error.statusCode,
      },
    };
    res.status(429).json(response);
  },
});

/**
 * Export rate limiter
 * Limits data export requests
 */
export const exportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // limit each IP to 5 export requests per hour
  message: {
    success: false,
    message: 'Too many export requests from this IP, please try again later.',
    error: {
      message: 'Too many export requests from this IP, please try again later.',
      statusCode: 429,
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    logger.warn(`Export rate limit exceeded for IP: ${req.ip}`);
    const error = new RateLimitError('Too many export requests from this IP, please try again later.');
    const response: IApiResponse = {
      success: false,
      message: error.message,
      error: {
        message: error.message,
        statusCode: error.statusCode,
      },
    };
    res.status(429).json(response);
  },
});

/**
 * Create custom rate limiter
 */
export const createCustomLimiter = (options: {
  windowMs: number;
  max: number;
  message: string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}) => {
  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    message: {
      success: false,
      message: options.message,
      error: {
        message: options.message,
        statusCode: 429,
      },
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: options.skipSuccessfulRequests || false,
    skipFailedRequests: options.skipFailedRequests || false,
    handler: (req: Request, res: Response) => {
      logger.warn(`Custom rate limit exceeded for IP: ${req.ip} - ${options.message}`);
      const error = new RateLimitError(options.message);
      const response: IApiResponse = {
        success: false,
        message: error.message,
        error: {
          message: error.message,
          statusCode: error.statusCode,
        },
      };
      res.status(429).json(response);
    },
  });
};