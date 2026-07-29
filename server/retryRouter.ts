import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "./_core/trpc";
import { getPagesReadyForRetry, getRetryHistory } from "./retryService";
import { getBook, getDb, getPage, getUserBooks, updatePage } from "./db";
import { reRenderApprovedPage } from "./gatePipeline";
import { evaluateUserDailyRenderCap } from "./renderCap";
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
   * Manually retry a single failed page (ownership-checked).
   *
   * BUG FIX (2026-07-29): this used to call resetPageRetryCount and return
   * `{ success: true }` without ever re-rendering anything -- it only cleared
   * retryCount/errorMessage/nextRetryAt and set processingStatus back to
   * "pending". Since retryWorker/getPagesReadyForRetry only pick up rows with
   * processingStatus="error", that reset silently made the page *less*
   * discoverable than before the "retry": not re-rendered by this call, and
   * no longer eligible for the automatic worker either. Every caller (only
   * `server/core.test.ts`'s ownership-check tests before this fix -- no
   * client code calls this procedure) got a false-positive success. Fixed to
   * actually call `reRenderApprovedPage` (bar §5: re-render the persisted
   * approved prompt only, never regenerate it), gated behind the same daily
   * render cap as `retryFailedPages`/`renderApprovedImages` since a manual
   * retry still costs one real image-generation call in production.
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

      const page = await getPage(input.pageId);
      if (!page) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Page not found" });
      }
      if (page.bookId !== input.bookId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Page does not belong to this book" });
      }
      // Same guard reRenderApprovedPage enforces internally -- checked here
      // too so an ineligible page gets a clear PRECONDITION_FAILED instead of
      // silently doing nothing (the exact failure mode being fixed).
      if (page.promptStatus !== "approved" || !page.generatedPrompt?.trim()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            `Cannot retry page ${input.pageId}: promptStatus="${page.promptStatus}" ` +
            `(need "approved" with a persisted prompt) — refusing to regenerate prompts`,
        });
      }

      const userBooks = await getUserBooks(ctx.user.id);
      const capDecision = evaluateUserDailyRenderCap(userBooks, 1, { excludeBookId: book.id });
      if (!capDecision.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message:
            `Daily render cap exceeded for this account ` +
            `(used ${capDecision.used} + 1 page-unit > cap ${capDecision.cap}). ` +
            `manualRetry blocked. Wait for the next UTC day or raise DAILY_RENDER_PAGE_CAP.`,
        });
      }

      // Fresh retry budget for this attempt (mirrors retryFailedPages' per-page
      // reset) so a page that already exhausted its automatic-retry budget
      // still gets a real attempt from a manual click.
      await updatePage(input.pageId, {
        imageStatus: "pending",
        processingStatus: "pending",
        errorMessage: null,
        retryCount: 0,
      });

      try {
        const result = await reRenderApprovedPage(input.pageId);
        return {
          success: true,
          message: `Page ${input.pageId} re-rendered`,
          url: result.url,
          key: result.key,
        };
      } catch (error) {
        // reRenderApprovedPage already recorded image_error and scheduled an
        // automatic backoff retry (gatePipeline.ts) -- surface the failure to
        // the caller instead of masking it behind a false "success: true".
        const msg = error instanceof Error ? error.message : String(error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Manual retry failed for page ${input.pageId}: ${msg}`,
        });
      }
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
