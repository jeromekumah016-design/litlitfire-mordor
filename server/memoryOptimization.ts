/**
 * Memory Optimization & Profiling Utilities
 * Monitors and optimizes memory usage
 */

/**
 * Memory snapshot for profiling
 */
export interface MemorySnapshot {
  timestamp: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
  arrayBuffers: number;
}

/**
 * Memory profiler
 */
export class MemoryProfiler {
  private snapshots: MemorySnapshot[] = [];
  private readonly maxSnapshots = 1000;
  private gcCount = 0;
  private lastGCTime = 0;

  /**
   * Take memory snapshot
   */
  snapshot(): MemorySnapshot {
    const memUsage = process.memoryUsage();

    const snapshot: MemorySnapshot = {
      timestamp: Date.now(),
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external,
      rss: memUsage.rss,
      arrayBuffers: memUsage.arrayBuffers || 0,
    };

    this.snapshots.push(snapshot);

    // Keep only recent snapshots
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }

    return snapshot;
  }

  /**
   * Get memory usage trend
   */
  getTrend(windowMs: number = 60000): {
    current: MemorySnapshot;
    previous: MemorySnapshot | null;
    delta: number;
    trend: "increasing" | "stable" | "decreasing";
  } {
    const now = Date.now();
    const current = this.snapshot();
    const threshold = now - windowMs;

    // Find previous snapshot within window
    let previous: MemorySnapshot | null = null;
    for (let i = this.snapshots.length - 2; i >= 0; i--) {
      if (this.snapshots[i].timestamp >= threshold) {
        previous = this.snapshots[i];
      } else {
        break;
      }
    }

    const delta = previous ? current.heapUsed - previous.heapUsed : 0;
    let trend: "increasing" | "stable" | "decreasing" = "stable";

    if (delta > 10 * 1024 * 1024) {
      // > 10MB increase
      trend = "increasing";
    } else if (delta < -5 * 1024 * 1024) {
      // > 5MB decrease
      trend = "decreasing";
    }

    return { current, previous, delta, trend };
  }

  /**
   * Get memory statistics
   */
  getStats() {
    const current = this.snapshots[this.snapshots.length - 1];
    if (!current) return null;

    const heapUsedMB = (current.heapUsed / 1024 / 1024).toFixed(2);
    const heapTotalMB = (current.heapTotal / 1024 / 1024).toFixed(2);
    const rssMB = (current.rss / 1024 / 1024).toFixed(2);
    const externalMB = (current.external / 1024 / 1024).toFixed(2);

    return {
      heapUsedMB,
      heapTotalMB,
      rssMB,
      externalMB,
      heapUsagePercent: (
        (current.heapUsed / current.heapTotal) *
        100
      ).toFixed(2),
      snapshotCount: this.snapshots.length,
      gcCount: this.gcCount,
    };
  }

  /**
   * Detect memory leaks
   */
  detectMemoryLeak(
    windowMs: number = 300000,
    threshold: number = 50 * 1024 * 1024
  ): boolean {
    const trend = this.getTrend(windowMs);

    if (trend.delta > threshold && trend.trend === "increasing") {
      return true;
    }

    return false;
  }

  /**
   * Get memory timeline
   */
  getTimeline(limit: number = 100) {
    const start = Math.max(0, this.snapshots.length - limit);
    return this.snapshots.slice(start).map((s) => ({
      timestamp: s.timestamp,
      heapUsedMB: (s.heapUsed / 1024 / 1024).toFixed(2),
      rssMB: (s.rss / 1024 / 1024).toFixed(2),
    }));
  }

  /**
   * Record GC event
   */
  recordGC(): void {
    this.gcCount++;
    this.lastGCTime = Date.now();
  }

  /**
   * Clear snapshots
   */
  clear(): void {
    this.snapshots = [];
    this.gcCount = 0;
  }
}

/**
 * Cleanup handler registry
 */
export class CleanupRegistry {
  private handlers: Array<() => void | Promise<void>> = [];
  private isRunning = false;

  /**
   * Register cleanup handler
   */
  register(handler: () => void | Promise<void>): void {
    this.handlers.push(handler);
  }

  /**
   * Unregister cleanup handler
   */
  unregister(handler: () => void | Promise<void>): void {
    const index = this.handlers.indexOf(handler);
    if (index > -1) {
      this.handlers.splice(index, 1);
    }
  }

  /**
   * Run all cleanup handlers
   */
  async cleanup(): Promise<void> {
    if (this.isRunning) return;

    this.isRunning = true;

    try {
      for (const handler of this.handlers) {
        try {
          const result = handler();
          if (result instanceof Promise) {
            await result;
          }
        } catch (error) {
          console.error("Cleanup handler error:", error);
        }
      }
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Get handler count
   */
  getCount(): number {
    return this.handlers.length;
  }

  /**
   * Clear all handlers
   */
  clear(): void {
    this.handlers = [];
  }
}

/**
 * Typed array utilities for efficient binary data handling
 */
export class TypedArrayPool {
  private pools: Map<string, Uint8Array[]> = new Map();
  private readonly maxPoolSize = 100;

  /**
   * Acquire typed array
   */
  acquire(size: number): Uint8Array {
    const key = `uint8:${size}`;
    const pool = this.pools.get(key) || [];

    if (pool.length > 0) {
      return pool.pop()!;
    }

    return new Uint8Array(size);
  }

  /**
   * Release typed array back to pool
   */
  release(array: Uint8Array): void {
    const key = `uint8:${array.length}`;
    let pool = this.pools.get(key);

    if (!pool) {
      pool = [];
      this.pools.set(key, pool);
    }

    if (pool.length < this.maxPoolSize) {
      // Clear array before returning to pool
      array.fill(0);
      pool.push(array);
    }
  }

  /**
   * Get pool statistics
   */
  getStats() {
    const stats: Record<string, number> = {};
    let totalArrays = 0;

    this.pools.forEach((pool, key) => {
      stats[key] = pool.length;
      totalArrays += pool.length;
    });

    return {
      totalArrays,
      pools: stats,
      maxPoolSize: this.maxPoolSize,
    };
  }

  /**
   * Clear all pools
   */
  clear(): void {
    this.pools.clear();
  }
}

// Export singleton instances
export const memoryProfiler = new MemoryProfiler();
export const cleanupRegistry = new CleanupRegistry();
export const typedArrayPool = new TypedArrayPool();

/**
 * Initialize memory monitoring
 */
export function initializeMemoryMonitoring(): void {
  // Take snapshot every 10 seconds
  setInterval(() => {
    memoryProfiler.snapshot();

    // Check for memory leaks
    if (memoryProfiler.detectMemoryLeak()) {
      console.warn("Potential memory leak detected");
    }
  }, 10000);

  // Cleanup on process exit
  process.on("exit", async () => {
    await cleanupRegistry.cleanup();
  });

  process.on("SIGTERM", async () => {
    await cleanupRegistry.cleanup();
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    await cleanupRegistry.cleanup();
    process.exit(0);
  });
}
