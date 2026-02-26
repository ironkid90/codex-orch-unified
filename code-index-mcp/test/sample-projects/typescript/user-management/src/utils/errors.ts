import { Request, Response, NextFunction } from 'express';
import { IApiResponse, IValidationError } from '../types/User';

/**
 * Base application error class
 */
export class AppError extends Error {
  public statusCode: number;
  public isOperational: boolean;
  public status: string;

  constructor(message: string, statusCode: number = 500, isOperational: boolean = true) {
    super(message);
    
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    
    // Capture stack trace
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Validation error class
 */
export class ValidationError extends AppError {
  public errors: IValidationError[];

  constructor(message: string, errors: IValidationError[] = []) {
    super(message, 400);
    this.errors = errors;
  }
}

/**
 * Authentication error class
 */
export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication failed') {
    super(message, 401);
  }
}

/**
 * Authorization error class
 */
export class AuthorizationError extends AppError {
  constructor(message: string = 'Access denied') {
    super(message, 403);
  }
}

/**
 * Not found error class
 */
export class NotFoundError extends AppError {
  constructor(message: string = 'Resource not found') {
    super(message, 404);
  }
}

/**
 * Conflict error class
 */
export class ConflictError extends AppError {
  constructor(message: string = 'Resource conflict') {
    super(message, 409);
  }
}

/**
 * Rate limit error class
 */
export class RateLimitError extends AppError {
  constructor(message: string = 'Too many requests') {
    super(message, 429);
  }
}

/**
 * Database error class
 */
export class DatabaseError extends AppError {
  constructor(message: string = 'Database error') {
    super(message, 500);
  }
}

/**
 * External service error class
 */
export class ExternalServiceError extends AppError {
  constructor(message: string = 'External service error') {
    super(message, 502);
  }
}

/**
 * Global error handler for Express
 */
export const globalErrorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Default error values
  let error = { ...err };
  error.message = err.message;

  // Log error
  console.error('Error:', err);

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    const message = 'Resource not found';
    error = new NotFoundError(message);
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const value = err.errmsg?.match(/(["'])(\\?.)*?\1/)?.[0] || 'unknown';
    const message = `Duplicate field value: ${value}. Please use another value`;
    error = new ConflictError(message);
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const errors: IValidationError[] = Object.values(err.errors).map(
      (val: any) => ({
        field: val.path,
        message: val.message,
        value: val.value,
      })
    );
    error = new ValidationError('Validation failed', errors);
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    error = new AuthenticationError('Invalid token');
  }

  if (err.name === 'TokenExpiredError') {
    error = new AuthenticationError('Token expired');
  }

  // Send error response
  const response: IApiResponse = {
    success: false,
    message: error.message,
    error: {
      message: error.message,
      statusCode: error.statusCode || 500,
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
      ...(error.errors && { errors: error.errors }),
    },
  };

  res.status(error.statusCode || 500).json(response);
};

/**
 * Async error handler wrapper
 */
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Create error response
 */
export const createErrorResponse = (
  message: string,
  statusCode: number = 500,
  errors: IValidationError[] | null = null
): IApiResponse => {
  const response: IApiResponse = {
    success: false,
    message,
    error: {
      message,
      statusCode,
    },
  };

  if (errors) {
    response.error!.errors = errors;
  }

  return response;
};

/**
 * Create success response
 */
export const createSuccessResponse = <T>(
  data: T,
  message: string = 'Success'
): IApiResponse<T> => {
  return {
    success: true,
    message,
    data,
  };
};

/**
 * Handle 404 for unknown routes
 */
export const handleNotFound = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const error = new NotFoundError(`Route ${req.originalUrl} not found`);
  next(error);
};

/**
 * Type guard for checking if error is operational
 */
export const isOperationalError = (error: any): error is AppError => {
  return error instanceof AppError && error.isOperational;
};

/**
 * Error logger utility
 */
export const logError = (error: Error, req?: Request): void => {
  const timestamp = new Date().toISOString();
  const method = req?.method || 'UNKNOWN';
  const url = req?.originalUrl || 'UNKNOWN';
  const userAgent = req?.get('User-Agent') || 'UNKNOWN';
  const ip = req?.ip || 'UNKNOWN';

  console.error(`[${timestamp}] ${method} ${url} - ${error.message}`);
  console.error(`User-Agent: ${userAgent}`);
  console.error(`IP: ${ip}`);
  console.error(`Stack: ${error.stack}`);
};

/**
 * Error response formatter
 */
export const formatErrorResponse = (error: AppError): IApiResponse => {
  return {
    success: false,
    message: error.message,
    error: {
      message: error.message,
      statusCode: error.statusCode,
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
      ...(error instanceof ValidationError && { errors: error.errors }),
    },
  };
};