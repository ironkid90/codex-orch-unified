const mongoose = require('mongoose');
const logger = require('../utils/logger');

/**
 * Database connection configuration
 */
class Database {
  constructor() {
    this.mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/user-management';
    this.options = {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      family: 4,
    };
  }

  /**
   * Connect to MongoDB
   */
  async connect() {
    try {
      await mongoose.connect(this.mongoURI, this.options);
      logger.info('MongoDB connected successfully');
      
      // Handle connection events
      mongoose.connection.on('error', (err) => {
        logger.error('MongoDB connection error:', err);
      });

      mongoose.connection.on('disconnected', () => {
        logger.warn('MongoDB disconnected');
      });

      mongoose.connection.on('reconnected', () => {
        logger.info('MongoDB reconnected');
      });

      // Handle process termination
      process.on('SIGINT', this.gracefulShutdown.bind(this));
      process.on('SIGTERM', this.gracefulShutdown.bind(this));
      
    } catch (error) {
      logger.error('MongoDB connection failed:', error);
      process.exit(1);
    }
  }

  /**
   * Disconnect from MongoDB
   */
  async disconnect() {
    try {
      await mongoose.disconnect();
      logger.info('MongoDB disconnected successfully');
    } catch (error) {
      logger.error('MongoDB disconnection error:', error);
    }
  }

  /**
   * Graceful shutdown
   */
  async gracefulShutdown(signal) {
    logger.info(`Received ${signal}. Graceful shutdown...`);
    try {
      await this.disconnect();
      process.exit(0);
    } catch (error) {
      logger.error('Error during graceful shutdown:', error);
      process.exit(1);
    }
  }

  /**
   * Get connection status
   */
  getConnectionStatus() {
    const states = {
      0: 'disconnected',
      1: 'connected',
      2: 'connecting',
      3: 'disconnecting',
    };
    return states[mongoose.connection.readyState] || 'unknown';
  }

  /**
   * Check if database is connected
   */
  isConnected() {
    return mongoose.connection.readyState === 1;
  }

  /**
   * Drop database (for testing)
   */
  async dropDatabase() {
    if (process.env.NODE_ENV === 'test') {
      try {
        await mongoose.connection.db.dropDatabase();
        logger.info('Test database dropped');
      } catch (error) {
        logger.error('Error dropping test database:', error);
      }
    } else {
      logger.warn('Database drop attempted in non-test environment');
    }
  }

  /**
   * Get database statistics
   */
  async getStats() {
    try {
      const stats = await mongoose.connection.db.stats();
      return {
        database: mongoose.connection.name,
        collections: stats.collections,
        dataSize: stats.dataSize,
        storageSize: stats.storageSize,
        indexes: stats.indexes,
        indexSize: stats.indexSize,
        objects: stats.objects,
      };
    } catch (error) {
      logger.error('Error getting database stats:', error);
      return null;
    }
  }
}

// Create singleton instance
const database = new Database();

module.exports = database;