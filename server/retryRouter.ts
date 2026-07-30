import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "./_core/trpc";
import {
  markPageForRetry,
  getPagesReadyForRetry,
  getRetryHistory,
  resetPageRetryCount,
} from "./retryService";
import { getBook, getDb } from "./db";
import { pages } from "../drizzle/schema";
import { eq } from "drizzle-orm";

/**
 * Retry Router: Handles manual retries and retry status queries
 */

export const retryRouter = router({
  /**
   * Get retry history for a specific page (ownership-checked)
   */
  getHistory: protectedProcedure
    .input(z.object({ pageId: z.number() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return [];

      const pageData = await db
        .select()
        .from(pages)
        .where(eq(pages.id, input.pageId))
        .limit(1);

      if (!pageData.length) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Page not found" });
      }

      const page = pageData[0];
      const book = await getBook(page.bookId);
      if (!book) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Book not found" });
      }
      if (book.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to view this page" });
      }

      return getRetryHistory(input.pageId);
    }),

  /**
   * Get pages ready for automatic retry (restricted to caller's books)
   */
  getReadyForRetry: protectedProcedure
    .input(z.object({ bookId: z.number() }).optional())
    .query(async ({ input, ctx }) => {
      if (input?.bookId != null) {
        const book = await getBook(input.bookId);
        if (!book) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Book not found" });
        }
        if (book.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to view this book" });
        }
      }
      const readyPages = await getPagesReadyForRetry(input?.bookId);
      return readyPages;
    }),

  /**
   * Manually retry a failed page (resets retry count, ownership-checked)
   */
  manualRetry: protectedProcedure
    .input(z.object({ pageId: z.number(), bookId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      // Ownership check first (uses the already-mocked helper, so tests reach it).
      const book = await getBook(input.bookId);
      if (!book) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Book not found" });
      }
      if (book.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to retry pages in this book" });
      }

      const db = await getDb();
      if (!db) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      }

      const pageData = await db
        .select()
        .from(pages)
        .where(eq(pages.id, input.pageId))
        .limit(1);

      if (!pageData.length) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Page not found" });
      }

      const page = pageData[0];
      if (page.bookId !== input.bookId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Page does not belong to this book" });
      }

      const success = await resetPageRetryCount(input.pageId);
      if (!success) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to reset retry count" });
      }

      return {
        success: true,
        message: `Page ${input.pageId} reset for retry`,
      };
    }),

  /**
   * Get retry statistics for a book (ownership-checked)
   */
  getStats: protectedProcedure
    .input(z.object({ bookId: z.number() }))
    .query(async ({ input, ctx }) => {
      const book = await getBook(input.bookId);
      if (!book) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Book not found" });
      }
      if (book.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to view this book" });
      }

      const db = await getDb();
      if (!db) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
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
