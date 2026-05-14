/**
 * Metrics Router
 * Exposes performance metrics and monitoring data via tRPC
 */

import { router, adminProcedure } from "./_core/trpc";
import { performanceMonitor } from "./performanceMonitor";
import { z } from "zod";

export const metricsRouter = router({
  /**
   * Get all performance metrics (admin only)
   */
  getAll: adminProcedure.query(() => {
    return performanceMonitor.getAllStats();
  }),

  /**
   * Get metrics for a specific endpoint
   */
  getEndpoint: adminProcedure
    .input(z.object({ endpoint: z.string() }))
    .query(({ input }) => {
      return performanceMonitor.getStats(input.endpoint);
    }),

  /**
   * Get recent metrics for debugging
   */
  getRecent: adminProcedure
    .input(
      z.object({
        endpoint: z.string(),
        limit: z.number().int().min(1).max(100).default(10),
      })
    )
    .query(({ input }) => {
      return performanceMonitor.getRecentMetrics(input.endpoint, input.limit);
    }),

  /**
   * Clear metrics for an endpoint
   */
  clearEndpoint: adminProcedure
    .input(z.object({ endpoint: z.string() }))
    .mutation(({ input }) => {
      performanceMonitor.clearMetrics(input.endpoint);
      return { success: true, message: `Cleared metrics for ${input.endpoint}` };
    }),

  /**
   * Clear all metrics
   */
  clearAll: adminProcedure.mutation(() => {
    performanceMonitor.clearAllMetrics();
    return { success: true, message: "Cleared all metrics" };
  }),
});
