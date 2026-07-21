import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { storagePut } from "./storage";
import { createBook, getUserBooks, getBook, getBookPages, getBookScenes, updateBook, updatePage, deleteBook } from "./db";
import { getPDFMetadata } from "./pdfService";
import { processBookPipeline } from "./pipelineService";
import { calculatePrice } from "./pricingService";
import {
  PIPELINE_MAX_PAGES,
  evaluateUserDailyRenderCap,
  type AutoStartDecision,
} from "./renderCap";
import { TRPCError } from "@trpc/server";

/** Per-user daily cap check. Always loads getUserBooks(userId) — never global. */
async function checkUserDailyRenderCap(
  userId: number,
  book: { id: number; pageCount: number }
): Promise<AutoStartDecision> {
  const userBooks = await getUserBooks(userId);
  return evaluateUserDailyRenderCap(userBooks, book.pageCount, {
    excludeBookId: book.id,
  });
}

function dailyRenderCapError(decision: AutoStartDecision, action: string): TRPCError {
  return new TRPCError({
    code: "TOO_MANY_REQUESTS",
    message:
      `Daily render cap exceeded for this account ` +
      `(used ${decision.used} + book ${decision.bookUnits} page-units > cap ${decision.cap}). ` +
      `${action} blocked. Wait for the next UTC day or raise DAILY_RENDER_PAGE_CAP.`,
  });
}

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

// ------------------------------------------------------------------
// Result shapes for cached procedures.
//
// getFromCache<T>'s T has no inference site when called as
// `getFromCache(cacheKey)` (nothing to infer it from), so it defaults to
// `unknown`; `if (cached) return cached;` then truthiness-narrows that
// `unknown` to `{}`, which silently erases every field from the
// procedure's inferred return type. Runtime is unaffected (this is a
// types-only issue), but it means callers -- e.g. `caller.books.list(...)`
// in tests -- lose all property typing on the result. `npm run check`
// never caught it because the root tsconfig excludes *.test.ts.
// Binding these type params explicitly (below) fixes it at the source.
// ------------------------------------------------------------------
type BookListItem = {
  id: number;
  title: string;
  description: string | null;
  pageCount: number;
  totalPrice: number;
  processingStatus: string;
  createdAt: Date;
};
type BooksListResult = {
  items: BookListItem[];
  pagination: { page: number; pageSize: number; totalCount: number; totalPages: number };
};

type BookDetailsPageItem = {
  id: number;
  pageNumber: number;
  thumbnailUrl: string | null;
  ocrText: string | null;
  generatedPrompt: string | null;
  generatedImageUrl: string | null;
  processingStatus: string;
  errorMessage: string | null;
  retryCount: number;
  maxRetries: number;
  lastRetryAt: Date | null;
  nextRetryAt: Date | null;
  // Scene-mode rows only (dual read path below).
  sceneTitle?: string;
  sourcePage?: number;
};
type BookDetailsResult = {
  id: number;
  title: string;
  description: string | null;
  pageCount: number;
  totalPrice: number;
  processingStatus: string;
  generationMode: string;
  pages: BookDetailsPageItem[];
  createdAt: Date;
};

// Render-side image-generation controls (aspect ratio / quality / style).
// Optional: anything omitted is defaulted downstream by normalizeImageParams.
// Validated here with strict enums so the API rejects unknown values at the
// boundary rather than relying on silent coercion. Decoupling invariant UPHELD:
// these are render-side knobs only -- never derived from OCR text or the bible.
const imageGenParamsSchema = z
  .object({
    aspectRatio: z.enum(["square", "portrait", "landscape"]).optional(),
    quality: z.enum(["standard", "hd"]).optional(),
    style: z.enum(["vivid", "natural"]).optional(),
  })
  .optional();

export const booksRouter = router({
  upload: protectedProcedure
    .input(z.object({ title: z.string().min(1).max(255), description: z.string().optional(), pdfData: z.string(), imageParams: imageGenParamsSchema }))
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

        // Always create as pending. Auto-start of the full render pipeline is
        // gated by the per-user daily render page-unit cap (audit P0 C1).
        const book = await createBook({ userId, title: input.title, description: input.description, pdfFileKey: pdfKey, pdfFileUrl: pdfUrl, pageCount: metadata.totalPages, processingStatus: "pending", totalPrice });
        if (!book) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Book record could not be created" });

        invalidateUserCache(userId);

        // Per-user only: checkUserDailyRenderCap → getUserBooks(userId).
        const autoStart = await checkUserDailyRenderCap(userId, {
          id: book.id,
          pageCount: metadata.totalPages,
        });

        let processingStatus: "pending" | "processing" = "pending";
        if (autoStart.allowed) {
          processBookPipeline(book.id, pdfBuffer, undefined, input.imageParams).catch((error) => {
            console.error("[Books Router] Background processing error:", error);
          });
          processingStatus = "processing";
        } else {
          console.warn(
            `[Books Router] Upload auto-render blocked for user ${userId}: used=${autoStart.used} + book=${autoStart.bookUnits} > cap=${autoStart.cap}. Book ${book.id} left pending. processPdf/retryFailedPages use the same per-user daily budget.`
          );
        }

        const pagesWillProcess = Math.min(metadata.totalPages, PIPELINE_MAX_PAGES);
        const pageCapWarning = metadata.totalPages > PIPELINE_MAX_PAGES ? `Only the first ${PIPELINE_MAX_PAGES} of ${metadata.totalPages} pages will be processed.` : undefined;

        return {
          bookId: book.id,
          title: book.title,
          pageCount: book.pageCount,
          pagesWillProcess,
          pageCapWarning,
          totalPrice: Number(book.totalPrice),
          processingStatus,
          autoRenderStarted: autoStart.allowed,
          dailyRender: {
            used: autoStart.used,
            cap: autoStart.cap,
            bookUnits: autoStart.bookUnits,
            remaining: autoStart.remaining,
          },
        };
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

        // Same per-user daily bucket as upload auto-trigger (exclude this book
        // so a reprocess of an already-started title is not double-counted).
        const capDecision = await checkUserDailyRenderCap(userId, {
          id: book.id,
          pageCount: book.pageCount,
        });
        if (!capDecision.allowed) {
          throw dailyRenderCapError(capDecision, "processPdf");
        }

        // H5: never mark "processing" until the PDF bytes are in hand. A prior
        // bug set processing first, then logged fetch failures and left the
        // book permanently stuck (re-trigger refused while status=processing).
        if (!book.pdfFileUrl) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Book has no pdfFileUrl; cannot start processing" });
        }
        let pdfBuffer: Buffer;
        try {
          const pdfResp = await fetch(book.pdfFileUrl);
          if (!pdfResp.ok) throw new Error(`Failed to fetch PDF (status ${pdfResp.status})`);
          pdfBuffer = Buffer.from(await pdfResp.arrayBuffer());
        } catch (fetchErr) {
          console.error("[Books Router] Could not re-fetch PDF:", fetchErr);
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: fetchErr instanceof Error ? `Could not fetch PDF: ${fetchErr.message}` : "Could not fetch PDF",
          });
        }
        await updateBook(input.bookId, { processingStatus: "processing" });
        processBookPipeline(book.id, pdfBuffer).catch((error) => {
          console.error("[Books Router] processPdf pipeline error:", error);
        });
        return {
          bookId: input.bookId,
          status: "processing",
          message: "PDF processing started",
          dailyRender: {
            used: capDecision.used,
            cap: capDecision.cap,
            bookUnits: capDecision.bookUnits,
            remaining: capDecision.remaining,
          },
        };
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
        const cached = getFromCache<BooksListResult>(cacheKey);
        if (cached) return cached;
        const offset = (input.page - 1) * input.pageSize;
        const userBooks = await getUserBooks(userId);
        const totalCount = userBooks.length;
        const paginatedBooks = userBooks.slice(offset, offset + input.pageSize);
        const result: BooksListResult = {
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
        const cached = getFromCache<BookDetailsResult>(cacheKey);
        if (cached) return cached;
        const book = await getBook(input.bookId);
        if (!book) throw new TRPCError({ code: "NOT_FOUND", message: "Book not found" });
        if (book.userId !== userId) throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to view this book" });
        // Dual read path: scene-mode books read from the scenes table (real
        // titles + source pages); page-mode books read from pages. Both are
        // normalised to the same page-shaped array the client already renders,
        // with scene rows carrying extra sceneTitle/sourcePage fields.
        const isSceneMode = (book as any).generationMode === "scene";
        let pageItems: BookDetailsPageItem[];
        if (isSceneMode) {
          const bookScenes = await getBookScenes(input.bookId);
          pageItems = bookScenes.map((sc) => ({
            id: sc.id,
            pageNumber: sc.sceneIndex + 1,
            thumbnailUrl: sc.thumbnailUrl,
            ocrText: sc.description,
            generatedPrompt: sc.prompt,
            generatedImageUrl: sc.generatedImageUrl,
            processingStatus: sc.processingStatus,
            errorMessage: sc.errorMessage,
            retryCount: sc.retryCount,
            maxRetries: sc.maxRetries,
            lastRetryAt: sc.lastRetryAt,
            nextRetryAt: sc.nextRetryAt,
            sceneTitle: sc.title,
            sourcePage: sc.sourcePage,
          }));
        } else {
          const bookPages = await getBookPages(input.bookId);
          pageItems = bookPages.map((page) => ({ id: page.id, pageNumber: page.pageNumber, thumbnailUrl: page.thumbnailUrl, ocrText: page.ocrText, generatedPrompt: page.generatedPrompt, generatedImageUrl: page.generatedImageUrl, processingStatus: page.processingStatus, errorMessage: page.errorMessage, retryCount: page.retryCount, maxRetries: page.maxRetries, lastRetryAt: page.lastRetryAt, nextRetryAt: page.nextRetryAt }));
        }
        const result: BookDetailsResult = {
          id: book.id, title: book.title, description: book.description, pageCount: book.pageCount,
          totalPrice: Number(book.totalPrice), processingStatus: book.processingStatus,
          generationMode: (book as any).generationMode ?? "page",
          pages: pageItems,
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
        // Scene-mode books write to the scenes table, not pages. Querying pages
        // for a scene-mode book always returns 0 rows → 0% progress. Use the
        // scenes table instead so the progress UI actually reflects reality.
        const isSceneMode = (book as any).generationMode === "scene";
        let items: { id: number; pageNumber: number; processingStatus: string; errorMessage: string | null; generatedImageUrl: string | null }[];
        if (isSceneMode) {
          const scenes = await getBookScenes(input.bookId);
          items = scenes.map((sc) => ({
            id: sc.id,
            pageNumber: sc.sceneIndex + 1,
            processingStatus: sc.processingStatus,
            errorMessage: sc.errorMessage,
            generatedImageUrl: sc.generatedImageUrl,
          }));
        } else {
          const pages = await getBookPages(input.bookId);
          items = pages.map((page) => ({
            id: page.id,
            pageNumber: page.pageNumber,
            processingStatus: page.processingStatus,
            errorMessage: page.errorMessage,
            generatedImageUrl: page.generatedImageUrl,
          }));
        }
        const totalPages = items.length;
        const completedPages = items.filter((p) => p.processingStatus === "done").length;
        const failedPages = items.filter((p) => p.processingStatus === "error").length;
        const processingPages = items.filter((p) => p.processingStatus === "processing").length;
        const pendingPages = items.filter((p) => p.processingStatus === "pending").length;
        return {
          bookId: input.bookId, totalPages, completedPages, failedPages, processingPages, pendingPages,
          progressPercentage: totalPages > 0 ? Math.round((completedPages / totalPages) * 100) : 0,
          bookStatus: book.processingStatus,
          pages: items,
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

        // Same per-user daily bucket as upload / processPdf.
        const capDecision = await checkUserDailyRenderCap(userId, {
          id: book.id,
          pageCount: book.pageCount,
        });
        if (!capDecision.allowed) {
          throw dailyRenderCapError(capDecision, "retryFailedPages");
        }

        // H5: fetch PDF first. Do not reset pages or mark book "processing"
        // until bytes are in hand — otherwise a fetch failure leaves pages
        // pending / book processing with no pipeline running.
        if (!book.pdfFileUrl) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Book has no pdfFileUrl; cannot retry pipeline",
          });
        }
        let pdfBuffer: Buffer;
        try {
          const res = await fetch(book.pdfFileUrl);
          if (!res.ok) throw new Error(`Failed to fetch PDF (status ${res.status})`);
          pdfBuffer = Buffer.from(await res.arrayBuffer());
        } catch (fetchErr) {
          console.error("[Books Router] retryFailedPages fetch error:", fetchErr);
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: fetchErr instanceof Error ? `Could not fetch PDF: ${fetchErr.message}` : "Could not fetch PDF",
          });
        }

        for (const page of failedPages) {
          // Reset retryCount to 0 so each page gets a fresh retry budget.
          // Incrementing it here would permanently exhaust auto-retry on pages
          // that have already hit maxRetries, making them unrecoverable.
          await updatePage(page.id, { processingStatus: "pending", errorMessage: null, retryCount: 0 });
        }
        await updateBook(input.bookId, { processingStatus: "processing" });
        invalidateUserCache(userId);

        processBookPipeline(book.id, pdfBuffer).catch((err) => {
          console.error("[Books Router] retryFailedPages pipeline error:", err);
        });

        return {
          success: true,
          message: `Retrying ${failedPages.length} failed page(s)`,
          retriedCount: failedPages.length,
          dailyRender: {
            used: capDecision.used,
            cap: capDecision.cap,
            bookUnits: capDecision.bookUnits,
            remaining: capDecision.remaining,
          },
        };
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
