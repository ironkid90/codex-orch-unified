import 'reflect-metadata';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';

import database from './config/database';
import userRoutes from './routes/userRoutes';
import { generalLimiter } from './middleware/rateLimiter';
import { globalErrorHandler, handleNotFound } from './utils/errors';
import logger from './utils/logger';
import { IApiResponse } from './types/User';

// Load environment variables
dotenv.config();

/**
 * Express application setup
 */
class App {
  public app: express.Application;
  private port: number;
  private server?: any;

  constructor() {
    this.app = express();
    this.port = parseInt(process.env.PORT || '3000', 10);
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  /**
   * Setup middleware
   */
  private setupMiddleware(): void {
    // Security middleware
    this.app.use(helmet());
    
    // CORS configuration
    this.app.use(cors({
      origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
      credentials: true,
    }));
    
    // Compression middleware
    this.app.use(compression());
    
    // Body parsing middleware
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    
    // Logging middleware
    this.app.use(morgan('combined', { stream: logger.stream }));
    
    // Rate limiting
    this.app.use(generalLimiter);
    
    // Request ID middleware
    this.app.use((req, res, next) => {
      (req as any).requestId = Math.random().toString(36).substr(2, 9);
      res.set('X-Request-ID', (req as any).requestId);
      next();
    });
    
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      const healthResponse: IApiResponse = {
        success: true,
        message: 'Service is healthy',
        data: {
          status: 'OK',
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          database: database.getConnectionStatus(),
          version: process.env.npm_package_version || '1.0.0',
          environment: process.env.NODE_ENV || 'development',
        },
      };
      res.json(healthResponse);
    });
  }

  /**
   * Setup routes
   */
  private setupRoutes(): void {
    // API routes
    this.app.use('/api/users', userRoutes);
    
    // Root endpoint
    this.app.get('/', (req, res) => {
      const rootResponse: IApiResponse = {
        success: true,
        message: 'User Management API - TypeScript Edition',
        data: {
          name: 'User Management API',
          version: '1.0.0',
          language: 'TypeScript',
          endpoints: {
            health: '/health',
            users: '/api/users',
            auth: '/api/users/auth',
            docs: '/api/docs',
          },
        },
      };
      res.json(rootResponse);
    });
  }

  /**
   * Setup error handling
   */
  private setupErrorHandling(): void {
    // Handle 404 for unknown routes
    this.app.use(handleNotFound);
    
    // Global error handler
    this.app.use(globalErrorHandler);
  }

  /**
   * Start the server
   */
  public async start(): Promise<void> {
    try {
      // Connect to database
      await database.connect();
      
      // Start server
      this.server = this.app.listen(this.port, () => {
        logger.info(`Server running on port ${this.port}`);
        logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
        logger.info(`Health check: http://localhost:${this.port}/health`);
        logger.info(`API documentation: http://localhost:${this.port}/api/docs`);
      });
      
      // Handle server errors
      this.server.on('error', (error: any) => {
        if (error.syscall !== 'listen') {
          throw error;
        }
        
        const bind = typeof this.port === 'string' ? `Pipe ${this.port}` : `Port ${this.port}`;
        
        switch (error.code) {
          case 'EACCES':
            logger.error(`${bind} requires elevated privileges`);
            process.exit(1);
            break;
          case 'EADDRINUSE':
            logger.error(`${bind} is already in use`);
            process.exit(1);
            break;
          default:
            throw error;
        }
      });
      
      // Graceful shutdown
      process.on('SIGTERM', () => this.gracefulShutdown('SIGTERM'));
      process.on('SIGINT', () => this.gracefulShutdown('SIGINT'));
      
    } catch (error) {
      logger.error('Failed to start server:', error as Error);
      process.exit(1);
    }
  }

  /**
   * Graceful shutdown
   */
  private async gracefulShutdown(signal: string): Promise<void> {
    logger.info(`Received ${signal}. Graceful shutdown...`);
    
    if (this.server) {
      this.server.close(async () => {
        logger.info('HTTP server closed');
        
        try {
          await database.disconnect();
          logger.info('Database disconnected');
          process.exit(0);
        } catch (error) {
          logger.error('Error during graceful shutdown:', error as Error);
          process.exit(1);
        }
      });
    }
  }

  /**
   * Get Express app instance
   */
  public getApp(): express.Application {
    return this.app;
  }
}

// Create and start the application
const app = new App();

// Start server if not in test environment
if (process.env.NODE_ENV !== 'test') {
  app.start().catch(error => {
    logger.error('Failed to start application:', error as Error);
    process.exit(1);
  });
}

// Export for testing
export default app.getApp();