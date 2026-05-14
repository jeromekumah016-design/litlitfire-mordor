/**
 * Database Performance Tracking Wrapper
 * Wraps database operations to track query performance
 */

import { performanceMonitor } from "./performanceMonitor";

interface DbOperation<T> {
  name: string;
  operation: () => Promise<T>;
}

/**
 * Track database operation performance
 */
export async function trackDbOperation<T>(
  operationName: string,
  operation: () => Promise<T>
): Promise<T> {
  const startTime = Date.now();

  try {
    const result = await operation();
    const duration = Date.now() - startTime;

    performanceMonitor.recordMetric(`db.${operationName}`, duration, "success", {
      operation: operationName,
    });

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;

    performanceMonitor.recordMetric(`db.${operationName}`, duration, "error", {
      operation: operationName,
      error: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
}

/**
 * Create a tracked database query function
 */
export function createTrackedDbQuery<T>(
  operationName: string,
  queryFn: () => Promise<T>
) {
  return () => trackDbOperation(operationName, queryFn);
}

/**
 * Batch track multiple database operations
 */
export async function trackBatchDbOperations<T>(
  operations: DbOperation<T>[]
): Promise<T[]> {
  return Promise.all(
    operations.map((op) => trackDbOperation(op.name, op.operation))
  );
}
