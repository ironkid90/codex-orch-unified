require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

const database = require('./config/database');
const userRoutes = require('./routes/userRoutes');
const { generalLimiter } = require('./middleware/rateLimiter');
const { globalErrorHandler, handleNotFound } = require('./utils/errors');
const logger = require('./utils/logger');

/**
 * Express application setup
 */
class App {
  constructor() {
    this.app = express();
    this.port = process.env.PORT || 3000;
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  /**
   * Setup middleware
   */
  setupMiddleware() {
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
      req.requestId = Math.random().toString(36).substr(2, 9);
      res.set('X-Request-ID', req.requestId);
      next();
    });
    
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: database.getConnectionStatus(),
        version: process.env.npm_package_version || '1.0.0',
      });
    });
  }

  /**
   * Setup routes
   */
  setupRoutes() {
    // API routes
    this.app.use('/api/users', userRoutes);
    
    // Root endpoint
    this.app.get('/', (req, res) => {
      res.json({
        message: 'User Management API',
        version: '1.0.0',
        endpoints: {
          health: '/health',
          users: '/api/users',
          auth: '/api/users/auth',
        },
      });
    });
  }

  /**
   * Setup error handling
   */
  setupErrorHandling() {
    // Handle 404 for unknown routes
    this.app.use(handleNotFound);
    
    // Global error handler
    this.app.use(globalErrorHandler);
  }

  /**
   * Start the server
   */
  async start() {
    try {
      // Connect to database
      await database.connect();
      
      // Start server
      this.server = this.app.listen(this.port, () => {
        logger.info(`Server running on port ${this.port}`);
        logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
        logger.info(`Health check: http://localhost:${this.port}/health`);
      });
      
      // Handle server errors
      this.server.on('error', (error) => {
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
      process.on('SIGTERM', this.gracefulShutdown.bind(this));
      process.on('SIGINT', this.gracefulShutdown.bind(this));
      
    } catch (error) {
      logger.error('Failed to start server:', error);
      process.exit(1);
    }
  }

  /**
   * Graceful shutdown
   */
  async gracefulShutdown(signal) {
    logger.info(`Received ${signal}. Graceful shutdown...`);
    
    if (this.server) {
      this.server.close(async () => {
        logger.info('HTTP server closed');
        
        try {
          await database.disconnect();
          logger.info('Database disconnected');
          process.exit(0);
        } catch (error) {
          logger.error('Error during graceful shutdown:', error);
          process.exit(1);
        }
      });
    }
  }

  /**
   * Get Express app instance
   */
  getApp() {
    return this.app;
  }
}

// Create and start the application
const app = new App();

// Start server if not in test environment
if (process.env.NODE_ENV !== 'test') {
  app.start();
}

// Export for testing
module.exports = app.getApp();