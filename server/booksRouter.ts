import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { storagePut } from "./storage";
import { createBook, getUserBooks, getBook, getBookPages, updateBook, updatePage, deleteBook } from "./db";
import { getPDFMetadata } from "./pdfService";
import { processBookPipeline } from "./pipelineService";
import { calculatePrice } from "./pricingService";
import { TRPCError } from "@trpc/server";

// ------------------------------------------------------------------
// In-memory query cache with TTL + size cap
// ------------------------------------------------------------------
const queryCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 30_000; // 30 seconds
const MAX_CACHE_SIZE = 500;

function getCacheKey(userId: number, query: string): string {
  return `${userId}:${query}`;
}

function getFromCache<T>(key: string): T | null {
  const cached = queryCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > CACHE_TTL) {
    queryCache.delete(key);
    return null;
  }
  return cached.data;
}

function setInCache(key: string, data: any): void {
  if (queryCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = queryCache.keys().next().value;
    if (oldestKey) queryCache.delete(oldestKey);
  }
  queryCache.set(key, { data, timestamp: Date.now() });
}

function invalidateUserCache(userId: number): void {
  const prefix = `${userId}:`;
  const keysToDelete: string[] = [];
  queryCache.forEach((_, key) => {
    if (key.startsWith(prefix)) keysToDelete.push(key);
  });
  keysToDelete.forEach((key) => queryCache.delete(key));
}

const PIPELINE_MAX_PAGES = 20;

export const booksRouter = router({
  upload: protectedProcedure
    .input(z.object({ title: z.string().min(1).max(255), description: z.string().optional(), pdfData: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const userId = ctx.user.id;
        const pdfBuffer = Buffer.from(input.pdfData, "base64");

        const MAX_FILE_SIZE = 100 * 1024 * 1024;
        if (pdfBuffer.length > MAX_FILE_SIZE) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `PDF file too large. Maximum size is 100MB, got ${(pdfBuffer.length / 1024 / 1024).toFixed(2)}MB` });
        }

        const metadata = await getPDFMetadata(pdfBuffer);
        const MAX_PAGES = 500;
        if (metadata.totalPages > MAX_PAGES) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `PDF has too many pages. Maximum is ${MAX_PAGES} pages, got ${metadata.totalPages}` });
        }

        const totalPrice = calculatePrice(metadata.totalPages).toString();
        const pdfKey = `books/${userId}/${Date.now()}-${input.title.replace(/\s+/g, "-")}.pdf`;
        const { url: pdfUrl } = await storagePut(pdfKey, pdfBuffer, "application/pdf");

        const book = await createBook({ userId, title: input.title, description: input.description, pdfFileKey: pdfKey, pdfFileUrl: pdfUrl, pageCount: metadata.totalPages, processingStatus: "pending", totalPrice });
        if (!book) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Book record could not be created" });

        invalidateUserCache(userId);
        processBookPipeline(book.id, pdfBuffer).catch((error) => { console.error("[Books Router] Background processing error:", error); });

        const pagesWillProcess = Math.min(metadata.totalPages, PIPELINE_MAX_PAGES);
        const pageCapWarning = metadata.totalPages > PIPELINE_MAX_PAGES ? `Only the first ${PIPELINE_MAX_PAGES} of ${metadata.totalPages} pages will be processed.` : undefined;

        return { bookId: book.id, title: book.title, pageCount: book.pageCount, pagesWillProcess, pageCapWarning, totalPrice: Number(book.totalPrice), processingStatus: "processing" };
      } catch (error) {
        console.error("[Books Router] Upload error:", error);
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error instanceof Error ? error.message : "Failed to upload PDF" });
      }
    }),

  processPdf: protectedProcedure
    .input(z.object({ bookId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const userId = ctx.user.id;
        const book = await getBook(input.bookId);
        if (!book) throw new TRPCError({ code: "NOT_FOUND", message: "Book not found" });
        if (book.userId !== userId) throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to process this book" });
        if (book.processingStatus === "processing" || book.processingStatus === "completed") {
          return { bookId: input.bookId, status: book.processingStatus, message: `PDF is ${book.processingStatus}` };
        }
        await updateBook(input.bookId, { processingStatus: "processing" });
        if (book.pdfFileUrl) {
          try {
            const pdfResp = await fetch(book.pdfFileUrl);
            if (!pdfResp.ok) throw new Error(`Failed to fetch PDF (status ${pdfResp.status})`);
            const pdfBuffer = Buffer.from(await pdfResp.arrayBuffer());
            processBookPipeline(book.id, pdfBuffer).catch((error) => { console.error("[Books Router] processPdf pipeline error:", error); });
          } catch (fetchErr) { console.error("[Books Router] Could not re-fetch PDF:", fetchErr); }
        } else { console.warn("[Books Router] Book has no pdfFileUrl, cannot re-trigger pipeline"); }
        return { bookId: input.bookId, status: "processing", message: "PDF processing started" };
      } catch (error) {
        console.error("[Books Router] Process PDF error:", error);
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error instanceof Error ? error.message : "Failed to process PDF" });
      }
    }),

  list: protectedProcedure
    .input(z.object({ page: z.number().int().positive().default(1), pageSize: z.number().int().min(1).max(100).default(10) }))
    .query(async ({ ctx, input }) => {
      try {
        const userId = ctx.user.id;
        const cacheKey = getCacheKey(userId, `books.list.${input.page}.${input.pageSize}`);
        const cached = getFromCache(cacheKey);
        if (cached) return cached;
        const offset = (input.page - 1) * input.pageSize;
        const userBooks = await getUserBooks(userId);
        const totalCount = userBooks.length;
        const paginatedBooks = userBooks.slice(offset, offset + input.pageSize);
        const result = {
          items: paginatedBooks.map((book) => ({ id: book.id, title: book.title, description: book.description, pageCount: book.pageCount, totalPrice: Number(book.totalPrice), processingStatus: book.processingStatus, createdAt: book.createdAt })),
          pagination: { page: input.page, pageSize: input.pageSize, totalCount, totalPages: Math.ceil(totalCount / input.pageSize) },
        };
        setInCache(cacheKey, result);
        return result;
      } catch (error) {
        console.error("[Books Router] List error:", error);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to fetch books" });
      }
    }),

  getDetails: protectedProcedure
    .input(z.object({ bookId: z.number() }))
    .query(async ({ input, ctx }) => {
      try {
        const userId = ctx.user.id;
        const cacheKey = getCacheKey(userId, `books.getDetails.${input.bookId}`);
        const cached = getFromCache(cacheKey);
        if (cached) return cached;
        const book = await getBook(input.bookId);
        if (!book) throw new TRPCError({ code: "NOT_FOUND", message: "Book not found" });
        if (book.userId !== userId) throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to view this book" });
        const bookPages = await getBookPages(input.bookId);
        const result = {
          id: book.id, title: book.title, description: book.description, pageCount: book.pageCount,
          totalPrice: Number(book.totalPrice), processingStatus: book.processingStatus,
          pages: bookPages.map((page) => ({ id: page.id, pageNumber: page.pageNumber, thumbnailUrl: page.thumbnailUrl, ocrText: page.ocrText, generatedPrompt: page.generatedPrompt, generatedImageUrl: page.generatedImageUrl, processingStatus: page.processingStatus, errorMessage: page.errorMessage, retryCount: page.retryCount, maxRetries: page.maxRetries, lastRetryAt: page.lastRetryAt, nextRetryAt: page.nextRetryAt })),
          createdAt: book.createdAt,
        };
        setInCache(cacheKey, result);
        return result;
      } catch (error) {
        console.error("[Books Router] Get details error:", error);
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to fetch book details" });
      }
    }),

  getProgress: protectedProcedure
    .input(z.object({ bookId: z.number() }))
    .query(async ({ input, ctx }) => {
      try {
        const userId = ctx.user.id;
        const book = await getBook(input.bookId);
        if (!book) throw new TRPCError({ code: "NOT_FOUND", message: "Book not found" });
        if (book.userId !== userId) throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to view this book" });
        const pages = await getBookPages(input.bookId);
        const totalPages = pages.length;
        const completedPages = pages.filter((p) => p.processingStatus === "done").length;
        const failedPages = pages.filter((p) => p.processingStatus === "error").length;
        const processingPages = pages.filter((p) => p.processingStatus === "processing").length;
        const pendingPages = pages.filter((p) => p.processingStatus === "pending").length;
        return {
          bookId: input.bookId, totalPages, completedPages, failedPages, processingPages, pendingPages,
          progressPercentage: totalPages > 0 ? Math.round((completedPages / totalPages) * 100) : 0,
          bookStatus: book.processingStatus,
          pages: pages.map((page) => ({ id: page.id, pageNumber: page.pageNumber, processingStatus: page.processingStatus, errorMessage: page.errorMessage, generatedImageUrl: page.generatedImageUrl })),
        };
      } catch (error) {
        console.error("[Books Router] Get progress error:", error);
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to fetch progress" });
      }
    }),

  retryFailedPages: protectedProcedure
    .input(z.object({ bookId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const userId = ctx.user.id;
        const book = await getBook(input.bookId);
        if (!book) throw new TRPCError({ code: "NOT_FOUND", message: "Book not found" });
        if (book.userId !== userId) throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to retry this book" });
        const pages = await getBookPages(input.bookId);
        const failedPages = pages.filter((p) => p.processingStatus === "error");
        if (failedPages.length === 0) return { success: true, message: "No failed pages to retry", retriedCount: 0 };

        for (const page of failedPages) {
          // Reset retryCount to 0 so each page gets a fresh retry budget.
          // Incrementing it here would permanently exhaust auto-retry on pages
          // that have already hit maxRetries, making them unrecoverable.
          await updatePage(page.id, { processingStatus: "pending", errorMessage: null, retryCount: 0 });
        }
        await updateBook(input.bookId, { processingStatus: "processing" });
        invalidateUserCache(userId);

        if (book.pdfFileUrl) {
          fetch(book.pdfFileUrl)
            .then((res) => { if (!res.ok) throw new Error(`Failed to fetch PDF (status ${res.status})`); return res.arrayBuffer(); })
            .then((buf) => processBookPipeline(book.id, Buffer.from(buf)))
            .catch((err) => console.error("[Books Router] retryFailedPages pipeline error:", err));
        } else { console.warn("[Books Router] retryFailedPages: book has no pdfFileUrl, pipeline not re-triggered"); }

        return { success: true, message: `Retrying ${failedPages.length} failed page(s)`, retriedCount: failedPages.length };
      } catch (error) {
        console.error("[Books Router] Retry failed pages error:", error);
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to retry pages" });
      }
    }),

  delete: protectedProcedure
    .input(z.object({ bookId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const userId = ctx.user.id;
        const book = await getBook(input.bookId);
        if (!book) throw new TRPCError({ code: "NOT_FOUND", message: "Book not found" });
        if (book.userId !== userId) throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to delete this book" });
        await deleteBook(input.bookId);
        invalidateUserCache(userId);
        return { success: true, bookId: input.bookId };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error instanceof Error ? error.message : "Failed to delete book" });
      }
    }),

  calculatePrice: protectedProcedure
    .input(z.object({ pageCount: z.number().int().min(1) }))
    .query(({ input }) => { const price = calculatePrice(input.pageCount); return { pageCount: input.pageCount, price, currency: "USD" }; }),

  getDashboardStats: protectedProcedure.query(async ({ ctx }) => {
    try {
      const userId = ctx.user.id;
      const cacheKey = getCacheKey(userId, "dashboardStats");
      const cached = getFromCache(cacheKey);
      if (cached) return cached;
      const { getDashboardStats } = await import("./db");
      const stats = await getDashboardStats(userId);
      if (stats) setInCache(cacheKey, stats);
      return stats;
    } catch (error) {
      console.error("[Books Router] Get dashboard stats error:", error);
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to fetch dashboard statistics" });
    }
  }),

  getLibraryOverview: protectedProcedure.query(async ({ ctx }) => {
    try {
      const userId = ctx.user.id;
      const cacheKey = getCacheKey(userId, "libraryOverview");
      const cached = getFromCache(cacheKey);
      if (cached) return cached;
      const { getLibraryOverview } = await import("./db");
      const overview = await getLibraryOverview(userId);
      if (overview) setInCache(cacheKey, overview);
      return overview;
    } catch (error) {
      console.error("[Books Router] Get library overview error:", error);
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to fetch library overview" });
    }
  }),

  getProcessingMetrics: protectedProcedure.query(async ({ ctx }) => {
    try {
      const userId = ctx.user.id;
      const cacheKey = getCacheKey(userId, "processingMetrics");
      const cached = getFromCache(cacheKey);
      if (cached) return cached;
      const { getProcessingMetrics } = await import("./db");
      const metrics = await getProcessingMetrics(userId);
      if (metrics) setInCache(cacheKey, metrics);
      return metrics;
    } catch (error) {
      console.error("[Books Router] Get processing metrics error:", error);
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to fetch processing metrics" });
    }
  }),
});
