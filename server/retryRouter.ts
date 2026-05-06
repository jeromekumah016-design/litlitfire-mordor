import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import {
  markPageForRetry,
  getPagesReadyForRetry,
  getRetryHistory,
  resetPageRetryCount,
} from "./retryService";
import { getDb } from "./db";
import { pages } from "../drizzle/schema";
import { eq } from "drizzle-orm";

/**
 * Retry Router: Handles manual retries and retry status queries
 */

export const retryRouter = router({
  /**
   * Get retry history for a specific page
   */
  getHistory: protectedProcedure
    .input(z.object({ pageId: z.number() }))
    .query(async ({ input }) => {
      const history = await getRetryHistory(input.pageId);
      return history;
    }),

  /**
   * Get pages ready for automatic retry
   */
  getReadyForRetry: protectedProcedure
    .input(z.object({ bookId: z.number() }).optional())
    .query(async ({ input }) => {
      const readyPages = await getPagesReadyForRetry(input?.bookId);
      return readyPages;
    }),

  /**
   * Manually retry a failed page (resets retry count)
   */
  manualRetry: protectedProcedure
    .input(z.object({ pageId: z.number(), bookId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        throw new Error("Database not available");
      }

      // Get page to verify it exists and belongs to user's book
      const pageData = await db
        .select()
        .from(pages)
        .where(eq(pages.id, input.pageId))
        .limit(1);

      if (!pageData.length) {
        throw new Error("Page not found");
      }

      const page = pageData[0];
      if (page.bookId !== input.bookId) {
        throw new Error("Page does not belong to this book");
      }

      // Reset retry count to allow retries again
      const success = await resetPageRetryCount(input.pageId);

      if (!success) {
        throw new Error("Failed to reset retry count");
      }

      return {
        success: true,
        message: `Page ${input.pageId} reset for retry`,
      };
    }),

  /**
   * Get retry statistics for a book
   */
  getStats: protectedProcedure
    .input(z.object({ bookId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        throw new Error("Database not available");
      }

      const bookPages = await db
        .select()
        .from(pages)
        .where(eq(pages.bookId, input.bookId));

      const stats = {
        total: bookPages.length,
        pending: bookPages.filter((p) => p.processingStatus === "pending").length,
        processing: bookPages.filter((p) => p.processingStatus === "processing").length,
        done: bookPages.filter((p) => p.processingStatus === "done").length,
        error: bookPages.filter((p) => p.processingStatus === "error").length,
        needsRetry: bookPages.filter(
          (p) => p.processingStatus === "error" && p.nextRetryAt && new Date(p.nextRetryAt) <= new Date()
        ).length,
        totalRetries: bookPages.reduce((sum, p) => sum + (p.retryCount || 0), 0),
      };

      return stats;
    }),
});
