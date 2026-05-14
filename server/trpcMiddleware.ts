/**
 * tRPC Middleware for Performance Monitoring
 * Automatically tracks all tRPC procedure execution times and errors
 */

import { TRPCError } from "@trpc/server";
import { performanceMonitor } from "./performanceMonitor";

/**
 * Middleware to track tRPC procedure performance
 */
export function createPerformanceTrackingMiddleware() {
  return async (opts: any) => {
    const startTime = Date.now();
    const procedurePath = opts.path;

    try {
      const result = await opts.next();
      const duration = Date.now() - startTime;
      performanceMonitor.recordMetric(
        `trpc.${procedurePath}`,
        duration,
        "success",
        {
          path: procedurePath,
          type: opts.type,
        }
      );
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      performanceMonitor.recordMetric(
        `trpc.${procedurePath}`,
        duration,
        "error",
        {
          path: procedurePath,
          type: opts.type,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw error;
    }
  };
}

/**
 * Middleware to add performance metrics to context
 */
export function createMetricsContextMiddleware() {
  return async (opts: any) => {
    const ctx = await opts.next();
    return {
      ...ctx,
      metrics: {
        recordMetric: performanceMonitor.recordMetric.bind(performanceMonitor),
        getStats: performanceMonitor.getStats.bind(performanceMonitor),
        getAllStats: performanceMonitor.getAllStats.bind(performanceMonitor),
      },
    };
  };
}
