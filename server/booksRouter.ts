import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { storagePut } from "./storage";
import { createBook, getUserBooks, getBook, getBookPages, updateBook } from "./db";
import { getPDFMetadata } from "./pdfService";
import { processBookPipeline } from "./pipelineService";
import { calculatePrice } from "./pricingService";
import { TRPCError } from "@trpc/server";

// Query result cache with TTL
const queryCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 30000; // 30 seconds

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
  queryCache.set(key, { data, timestamp: Date.now() });
}

function invalidateUserCache(userId: number): void {
  const prefix = `${userId}:`;
  const keysToDelete: string[] = [];
  queryCache.forEach((_, key) => {
    if (key.startsWith(prefix)) {
      keysToDelete.push(key);
    }
  });
  keysToDelete.forEach((key) => queryCache.delete(key));
}

export const booksRouter = router({
  /**
   * Upload a PDF file and create a book record
   */
  upload: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1).max(255),
        description: z.string().optional(),
        pdfData: z.string(), // base64 encoded PDF
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        // Convert base64 to Buffer
        const pdfBuffer = Buffer.from(input.pdfData, "base64");

        // Get PDF metadata
        const metadata = await getPDFMetadata(pdfBuffer);

        // Calculate price based on page count
        const totalPrice = calculatePrice(metadata.totalPages).toString();

        // Upload PDF to storage
        const pdfKey = `books/${ctx.user.id}/${Date.now()}-${input.title.replace(/\s+/g, "-")}.pdf`;
        const { url: pdfUrl } = await storagePut(pdfKey, pdfBuffer, "application/pdf");

        // Create book record — if this throws, tRPC will surface a 500 to the client
        const book = await createBook({
          userId: ctx.user.id,
          title: input.title,
          description: input.description,
          pdfFileKey: pdfKey,
          pdfFileUrl: pdfUrl,
          pageCount: metadata.totalPages,
          processingStatus: "pending",
          totalPrice,
        });

        // Guard against null case explicitly
        if (!book) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Book record could not be created",
          });
        }

        // Invalidate cache when new book is created
        invalidateUserCache(ctx.user.id);

        // Automatically trigger PDF processing in the background
        // Don't await this - let it run asynchronously
        processBookPipeline(book.id, pdfBuffer).catch((error) => {
          console.error("[Books Router] Background processing error:", error);
        });

        return {
          bookId: book.id,
          title: book.title,
          pageCount: book.pageCount,
          totalPrice: Number(book.totalPrice),
          processingStatus: "processing",
        };
      } catch (error) {
        console.error("[Books Router] Upload error:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to upload PDF",
        });
      }
    }),

  /**
   * Start processing a PDF book
   */
  processPdf: protectedProcedure
    .input(z.object({ bookId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      try {
        // Verify book ownership
        const book = await getBook(input.bookId);
        if (!book) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Book not found",
          });
        }

        if (book.userId !== ctx.user.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You do not have permission to process this book",
          });
        }

        // If already processing or done, return current status
        if (book.processingStatus === "processing" || book.processingStatus === "completed") {
          return {
            bookId: input.bookId,
            status: book.processingStatus,
            message: `PDF is ${book.processingStatus}`,
          };
        }

        // Mark as processing and trigger pipeline
        await updateBook(input.bookId, { processingStatus: "processing" });

        return {
          bookId: input.bookId,
          status: "processing",
          message: "PDF processing started",
        };
      } catch (error) {
        console.error("[Books Router] Process PDF error:", error);
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to process PDF",
        });
      }
    }),

  /**
   * Get user's books with pagination
   */
  list: protectedProcedure
    .input(
      z.object({
        page: z.number().int().positive().default(1),
        pageSize: z.number().int().min(1).max(100).default(10),
      })
    )
    .query(async ({ ctx, input }) => {
    try {
      // Check cache first
      const cacheKey = getCacheKey(ctx.user.id, `books.list.${input.page}.${input.pageSize}`);
      const cached = getFromCache(cacheKey);
      if (cached) {
        return cached;
      }

      // Calculate offset
      const offset = (input.page - 1) * input.pageSize;
      const userBooks = await getUserBooks(ctx.user.id);
      const totalCount = userBooks.length;
      const paginatedBooks = userBooks.slice(offset, offset + input.pageSize);

      const result = {
        items: paginatedBooks.map((book) => ({
          id: book.id,
          title: book.title,
          description: book.description,
          pageCount: book.pageCount,
          totalPrice: Number(book.totalPrice),
          processingStatus: book.processingStatus,
          createdAt: book.createdAt,
        })),
        pagination: {
          page: input.page,
          pageSize: input.pageSize,
          totalCount,
          totalPages: Math.ceil(totalCount / input.pageSize),
        },
      };

      // Store in cache
      setInCache(cacheKey, result);
      return result;
    } catch (error) {
      console.error("[Books Router] List error:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch books",
      });
    }
  }),

  /**
   * Get book details with pages
   */
  getDetails: protectedProcedure
    .input(z.object({ bookId: z.number() }))
    .query(async ({ input, ctx }) => {
      try {
        // Check cache first
        const cacheKey = getCacheKey(ctx.user.id, `books.getDetails.${input.bookId}`);
        const cached = getFromCache(cacheKey);
        if (cached) {
          return cached;
        }

        const book = await getBook(input.bookId);
        if (!book) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Book not found",
          });
        }

        if (book.userId !== ctx.user.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You do not have permission to view this book",
          });
        }

        const bookPages = await getBookPages(input.bookId);

        const result = {
          id: book.id,
          title: book.title,
          description: book.description,
          pageCount: book.pageCount,
          totalPrice: Number(book.totalPrice),
          processingStatus: book.processingStatus,
          pages: bookPages.map((page) => ({
            id: page.id,
            pageNumber: page.pageNumber,
            thumbnailUrl: page.thumbnailUrl,
            ocrText: page.ocrText,
            generatedPrompt: page.generatedPrompt,
            generatedImageUrl: page.generatedImageUrl,
            processingStatus: page.processingStatus,
            errorMessage: page.errorMessage,
            retryCount: page.retryCount,
            maxRetries: page.maxRetries,
            lastRetryAt: page.lastRetryAt,
            nextRetryAt: page.nextRetryAt,
          })),
          createdAt: book.createdAt,
        };

        // Store in cache
        setInCache(cacheKey, result);
        return result;
      } catch (error) {
        console.error("[Books Router] Get details error:", error);
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch book details",
        });
      }
    }),

  /**
   * Calculate price for a given page count
   */
  calculatePrice: protectedProcedure
    .input(z.object({ pageCount: z.number().min(1) }))
    .query(({ input }) => {
      const price = calculatePrice(input.pageCount);
      return {
        pageCount: input.pageCount,
        price,
        currency: "USD",
      };
    }),
});
