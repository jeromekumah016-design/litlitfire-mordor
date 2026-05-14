/**
 * Performance Monitoring Service
 * Tracks API response times, database query performance, and system metrics
 */

interface PerformanceMetric {
  name: string;
  duration: number; // milliseconds
  timestamp: number;
  status: "success" | "error";
  metadata?: Record<string, any>;
}

interface PerformanceStats {
  count: number;
  avgDuration: number;
  minDuration: number;
  maxDuration: number;
  p95Duration: number;
  p99Duration: number;
  errorRate: number;
}

class PerformanceMonitor {
  private metrics: Map<string, PerformanceMetric[]> = new Map();
  private maxMetricsPerName = 1000; // Keep last 1000 metrics per endpoint

  /**
   * Record a performance metric
   */
  recordMetric(
    name: string,
    duration: number,
    status: "success" | "error" = "success",
    metadata?: Record<string, any>
  ): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }

    const metricsArray = this.metrics.get(name)!;
    metricsArray.push({
      name,
      duration,
      timestamp: Date.now(),
      status,
      metadata,
    });

    // Keep only recent metrics to prevent memory bloat
    if (metricsArray.length > this.maxMetricsPerName) {
      metricsArray.shift();
    }
  }

  /**
   * Get performance statistics for a specific endpoint
   */
  getStats(name: string): PerformanceStats | null {
    const metricsArray = this.metrics.get(name);
    if (!metricsArray || metricsArray.length === 0) {
      return null;
    }

    const durations = metricsArray.map((m) => m.duration).sort((a, b) => a - b);
    const errorCount = metricsArray.filter((m) => m.status === "error").length;

    return {
      count: metricsArray.length,
      avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
      minDuration: durations[0],
      maxDuration: durations[durations.length - 1],
      p95Duration: durations[Math.floor(durations.length * 0.95)],
      p99Duration: durations[Math.floor(durations.length * 0.99)],
      errorRate: errorCount / metricsArray.length,
    };
  }

  /**
   * Get all performance statistics
   */
  getAllStats(): Record<string, PerformanceStats> {
    const stats: Record<string, PerformanceStats> = {};
    this.metrics.forEach((_, name) => {
      const stat = this.getStats(name);
      if (stat) {
        stats[name] = stat;
      }
    });
    return stats;
  }

  /**
   * Clear metrics for a specific endpoint
   */
  clearMetrics(name: string): void {
    this.metrics.delete(name);
  }

  /**
   * Clear all metrics
   */
  clearAllMetrics(): void {
    this.metrics.clear();
  }

  /**
   * Get recent metrics for debugging
   */
  getRecentMetrics(name: string, limit: number = 10): PerformanceMetric[] {
    const metricsArray = this.metrics.get(name) || [];
    return metricsArray.slice(Math.max(0, metricsArray.length - limit));
  }
}

export const performanceMonitor = new PerformanceMonitor();

/**
 * Middleware to track API response times
 */
export function createPerformanceMiddleware(name: string) {
  return (startTime: number, duration: number, status: "success" | "error" = "success") => {
    performanceMonitor.recordMetric(name, duration, status);
  };
}

/**
 * Decorator to track function execution time
 */
export function trackPerformance(name: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const startTime = Date.now();
      try {
        const result = await originalMethod.apply(this, args);
        const duration = Date.now() - startTime;
        performanceMonitor.recordMetric(name, duration, "success");
        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        performanceMonitor.recordMetric(name, duration, "error", {
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    };

    return descriptor;
  };
}
