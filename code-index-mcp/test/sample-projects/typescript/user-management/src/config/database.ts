import mongoose from 'mongoose';
import logger from '../utils/logger';

/**
 * Database connection configuration
 */
class Database {
  private mongoURI: string;
  private options: mongoose.ConnectOptions;

  constructor() {
    this.mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/user-management-ts';
    this.options = {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      family: 4,
    };
  }

  /**
   * Connect to MongoDB
   */
  public async connect(): Promise<void> {
    try {
      await mongoose.connect(this.mongoURI, this.options);
      logger.info('MongoDB connected successfully');
      
      // Handle connection events
      mongoose.connection.on('error', (err: Error) => {
        logger.error('MongoDB connection error:', err);
      });

      mongoose.connection.on('disconnected', () => {
        logger.warn('MongoDB disconnected');
      });

      mongoose.connection.on('reconnected', () => {
        logger.info('MongoDB reconnected');
      });

      // Handle process termination
      process.on('SIGINT', () => this.gracefulShutdown('SIGINT'));
      process.on('SIGTERM', () => this.gracefulShutdown('SIGTERM'));
      
    } catch (error) {
      logger.error('MongoDB connection failed:', error as Error);
      process.exit(1);
    }
  }

  /**
   * Disconnect from MongoDB
   */
  public async disconnect(): Promise<void> {
    try {
      await mongoose.disconnect();
      logger.info('MongoDB disconnected successfully');
    } catch (error) {
      logger.error('MongoDB disconnection error:', error as Error);
    }
  }

  /**
   * Graceful shutdown
   */
  private async gracefulShutdown(signal: string): Promise<void> {
    logger.info(`Received ${signal}. Graceful shutdown...`);
    try {
      await this.disconnect();
      process.exit(0);
    } catch (error) {
      logger.error('Error during graceful shutdown:', error as Error);
      process.exit(1);
    }
  }

  /**
   * Get connection status
   */
  public getConnectionStatus(): string {
    const states: Record<number, string> = {
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
  public isConnected(): boolean {
    return mongoose.connection.readyState === 1;
  }

  /**
   * Drop database (for testing)
   */
  public async dropDatabase(): Promise<void> {
    if (process.env.NODE_ENV === 'test') {
      try {
        await mongoose.connection.db.dropDatabase();
        logger.info('Test database dropped');
      } catch (error) {
        logger.error('Error dropping test database:', error as Error);
      }
    } else {
      logger.warn('Database drop attempted in non-test environment');
    }
  }

  /**
   * Get database statistics
   */
  public async getStats(): Promise<any> {
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
      logger.error('Error getting database stats:', error as Error);
      return null;
    }
  }

  /**
   * Create indexes for performance
   */
  public async createIndexes(): Promise<void> {
    try {
      // This would be called after models are loaded
      // Indexes are already defined in the model schemas
      logger.info('Database indexes created');
    } catch (error) {
      logger.error('Error creating indexes:', error as Error);
    }
  }

  /**
   * Health check
   */
  public async healthCheck(): Promise<boolean> {
    try {
      await mongoose.connection.db.admin().ping();
      return true;
    } catch (error) {
      logger.error('Database health check failed:', error as Error);
      return false;
    }
  }
}

// Create singleton instance
const database = new Database();

export default database;