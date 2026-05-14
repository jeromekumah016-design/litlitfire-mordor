/**
 * Database Connection Pooling Configuration
 * Manages connection pool for optimal database performance
 */

/**
 * Connection pool configuration
 */
export interface PoolConfig {
  min: number; // Minimum connections to maintain
  max: number; // Maximum connections allowed
  idleTimeoutMs: number; // Idle connection timeout
  acquireTimeoutMs: number; // Timeout for acquiring connection
  connectionTimeoutMs: number; // Timeout for establishing connection
  validationQuery?: string; // Query to validate connection health
  enableKeepAlive?: boolean; // Enable TCP keep-alive
  keepAliveIntervalMs?: number; // Keep-alive interval
}

/**
 * Default pool configuration optimized for production
 */
export const DEFAULT_POOL_CONFIG: PoolConfig = {
  min: 5, // Maintain 5 connections
  max: 20, // Allow up to 20 connections
  idleTimeoutMs: 30000, // 30 seconds
  acquireTimeoutMs: 10000, // 10 seconds
  connectionTimeoutMs: 5000, // 5 seconds
  validationQuery: "SELECT 1",
  enableKeepAlive: true,
  keepAliveIntervalMs: 30000, // 30 seconds
};

/**
 * Development pool configuration
 */
export const DEV_POOL_CONFIG: PoolConfig = {
  min: 2,
  max: 5,
  idleTimeoutMs: 60000,
  acquireTimeoutMs: 5000,
  connectionTimeoutMs: 3000,
  validationQuery: "SELECT 1",
  enableKeepAlive: false,
};

/**
 * High-load pool configuration
 */
export const HIGH_LOAD_POOL_CONFIG: PoolConfig = {
  min: 10,
  max: 50,
  idleTimeoutMs: 15000,
  acquireTimeoutMs: 20000,
  connectionTimeoutMs: 10000,
  validationQuery: "SELECT 1",
  enableKeepAlive: true,
  keepAliveIntervalMs: 15000,
};

/**
 * Connection pool statistics
 */
export interface PoolStats {
  activeConnections: number;
  idleConnections: number;
  totalConnections: number;
  waitingRequests: number;
  acquireCount: number;
  releaseCount: number;
  timeoutCount: number;
  errorCount: number;
  averageAcquireTimeMs: number;
  averageQueryTimeMs: number;
}

/**
 * Connection pool manager
 */
export class ConnectionPoolManager {
  private config: PoolConfig;
  private activeConnections = 0;
  private idleConnections = 0;
  private waitingRequests = 0;
  private stats = {
    acquireCount: 0,
    releaseCount: 0,
    timeoutCount: 0,
    errorCount: 0,
    totalAcquireTimeMs: 0,
    totalQueryTimeMs: 0,
    queryCount: 0,
  };

  constructor(config: PoolConfig = DEFAULT_POOL_CONFIG) {
    this.config = config;
    this.idleConnections = config.min;
  }

  /**
   * Get connection from pool
   */
  async acquireConnection(): Promise<any> {
    const startTime = Date.now();

    // Check if we can create new connection
    if (
      this.activeConnections + this.idleConnections < this.config.max &&
      this.idleConnections === 0
    ) {
      this.activeConnections++;
      this.stats.acquireCount++;
      return { id: `conn-${this.activeConnections}`, isNew: true };
    }

    // Wait for idle connection
    if (this.idleConnections > 0) {
      this.idleConnections--;
      this.activeConnections++;
      this.stats.acquireCount++;

      const acquireTime = Date.now() - startTime;
      this.stats.totalAcquireTimeMs += acquireTime;

      return { id: `conn-${this.activeConnections}`, isNew: false };
    }

    // Queue request
    this.waitingRequests++;

    // Simulate wait with timeout
    const timeout = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("Connection acquire timeout")),
        this.config.acquireTimeoutMs
      )
    );

    try {
      await timeout;
    } catch (error) {
      this.waitingRequests--;
      this.stats.timeoutCount++;
      this.stats.errorCount++;
      throw error;
    }

    this.waitingRequests--;
    this.activeConnections++;
    this.stats.acquireCount++;

    const acquireTime = Date.now() - startTime;
    this.stats.totalAcquireTimeMs += acquireTime;

    return { id: `conn-${this.activeConnections}`, isNew: false };
  }

  /**
   * Release connection back to pool
   */
  releaseConnection(connection: any): void {
    if (this.activeConnections > 0) {
      this.activeConnections--;
      this.idleConnections++;
      this.stats.releaseCount++;

      // Validate connection health
      if (this.config.validationQuery) {
        // In real implementation, run validation query
      }

      // Return to pool or discard if pool is full
      if (this.idleConnections > this.config.max) {
        this.idleConnections--;
      }
    }
  }

  /**
   * Track query execution time
   */
  trackQueryTime(timeMs: number): void {
    this.stats.totalQueryTimeMs += timeMs;
    this.stats.queryCount++;
  }

  /**
   * Get pool statistics
   */
  getStats(): PoolStats {
    const averageAcquireTime =
      this.stats.acquireCount > 0
        ? this.stats.totalAcquireTimeMs / this.stats.acquireCount
        : 0;

    const averageQueryTime =
      this.stats.queryCount > 0
        ? this.stats.totalQueryTimeMs / this.stats.queryCount
        : 0;

    return {
      activeConnections: this.activeConnections,
      idleConnections: this.idleConnections,
      totalConnections: this.activeConnections + this.idleConnections,
      waitingRequests: this.waitingRequests,
      acquireCount: this.stats.acquireCount,
      releaseCount: this.stats.releaseCount,
      timeoutCount: this.stats.timeoutCount,
      errorCount: this.stats.errorCount,
      averageAcquireTimeMs: Math.round(averageAcquireTime),
      averageQueryTimeMs: Math.round(averageQueryTime),
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      acquireCount: 0,
      releaseCount: 0,
      timeoutCount: 0,
      errorCount: 0,
      totalAcquireTimeMs: 0,
      totalQueryTimeMs: 0,
      queryCount: 0,
    };
  }

  /**
   * Drain all connections
   */
  drain(): void {
    this.activeConnections = 0;
    this.idleConnections = this.config.min;
    this.waitingRequests = 0;
  }
}

// Export singleton instance
export const connectionPoolManager = new ConnectionPoolManager(
  process.env.NODE_ENV === "production"
    ? DEFAULT_POOL_CONFIG
    : DEV_POOL_CONFIG
);
