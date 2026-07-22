import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { storagePut } from "./storage";
import { createBook, getUserBooks, getBook, getBookPages, getBookScenes, getPage, updateBook, updatePage, deleteBook } from "./db";
import { getPDFMetadata } from "./pdfService";
import {
  extractAndStorePages,
  transcribeBook,
  setPagePromptApproval,
  renderApprovedImages,
} from "./gatePipeline";
import { derivePipelinePhase, type PipelinePhase } from "./readingPipeline";
import { calculatePrice, calculateLiteDisplayPrice } from "./pricingService";
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
  packageTier: "lite" | "upgraded";
  chapterCount: number;
  mainChapterCount: number;
  liteDisplayPrice: number;
  pipelinePhase: PipelinePhase;
  pipelineLabel: string;
  promptReadyCount: number;
  approvedCount: number;
  imageReadyCount: number;
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
  generatedImageFileKey?: string | null;
  processingStatus: string;
  promptStatus?: string;
  imageStatus?: string;
  skipSuggested?: boolean;
  errorMessage: string | null;
  retryCount: number;
  maxRetries: number;
  lastRetryAt: Date | null;
  nextRetryAt: Date | null;
  // Scene-mode rows only (dual read path below).
  sceneTitle?: string;
  sourcePage?: number;
  promptStructured?: unknown;
};
type BookDetailsResult = {
  id: number;
  title: string;
  description: string | null;
  pageCount: number;
  totalPrice: number;
  processingStatus: string;
  generationMode: string;
  packageTier: "lite" | "upgraded";
  chapterCount: number;
  mainChapterCount: number;
  liteDisplayPrice: number;
  storyBible?: unknown;
  readingProfile?: unknown;
  pipelinePhase: PipelinePhase;
  pipelineLabel: string;
  promptReadyCount: number;
  approvedCount: number;
  imageReadyCount: number;
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

        // Functional bar §1: upload stores PDF + extracts/OCRs page text ONLY.
        // Lite package only (chapters). Upgraded (pages) is paid framing — not selectable.
        const book = await createBook({
          userId,
          title: input.title,
          description: input.description,
          pdfFileKey: pdfKey,
          pdfFileUrl: pdfUrl,
          pageCount: metadata.totalPages,
          processingStatus: "pending",
          packageTier: "lite",
          totalPrice,
        } as any);
        if (!book) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Book record could not be created" });

        invalidateUserCache(userId);

        let extracted = 0;
        try {
          const result = await extractAndStorePages(book.id, pdfBuffer);
          extracted = result.extracted;
        } catch (extractErr) {
          console.error("[Books Router] Extract/OCR failed:", extractErr);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: extractErr instanceof Error ? extractErr.message : "Failed to extract PDF text",
          });
        }

        // Stash optional render params on the book description side-channel is wrong;
        // client will pass imageParams to renderApprovedImages when rendering.
        void input.imageParams;

        // Auto Stage 1: lite multi-pass (genre → chapters → prompts). Does NOT
        // auto-approve or auto-render — human gate stays before generate.
        await updateBook(book.id, { processingStatus: "processing", packageTier: "lite" } as any);
        void transcribeBook(book.id)
          .then((r) => {
            console.log(
              `[Books Router] auto multi-pass done book=${book.id} chapters=${r.chapterCount ?? "?"} prompts=${r.transcribed} genres=${(r.genres || []).join(",")}`
            );
            invalidateUserCache(userId);
          })
          .catch((err) => {
            console.error(`[Books Router] auto multi-pass failed book=${book.id}:`, err);
            void updateBook(book.id, { processingStatus: "pending" } as any).catch(() => {});
            invalidateUserCache(userId);
          });

        const pagesWillProcess = Math.min(metadata.totalPages, PIPELINE_MAX_PAGES);
        const pageCapWarning = metadata.totalPages > PIPELINE_MAX_PAGES ? `Only the first ${PIPELINE_MAX_PAGES} of ${metadata.totalPages} pages will be processed.` : undefined;

        return {
          bookId: book.id,
          title: book.title,
          pageCount: book.pageCount,
          pagesWillProcess,
          pagesExtracted: extracted,
          pageCapWarning,
          totalPrice: Number(book.totalPrice),
          processingStatus: "processing" as const,
          packageTier: "lite" as const,
          autoRenderStarted: false,
          phase: "reading" as const,
          message:
            "PDF stored (Lite package). Reading chapters — approve chapter prompts, then generate photos. Upgraded (per-page) is a paid package later.",
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
        // Re-extract only — does NOT bypass the approve gate (no full pipeline).
        if (!book.pdfFileUrl) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Book has no pdfFileUrl; cannot extract" });
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
        const extracted = await extractAndStorePages(book.id, pdfBuffer);
        invalidateUserCache(userId);
        return {
          bookId: input.bookId,
          status: "pending",
          message: `Extracted ${extracted.extracted} page(s). Run Stage 1 (transcribe) next.`,
          pagesExtracted: extracted.extracted,
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
        const items: BookListItem[] = await Promise.all(
          paginatedBooks.map(async (book) => {
            const pages = (await getBookPages(book.id)) || [];
            const phase = derivePipelinePhase(book.processingStatus, pages);
            const profile = (book as any).readingProfile as
              | { chapters?: Array<{ role?: string }> }
              | null
              | undefined;
            const chapters = Array.isArray(profile?.chapters) ? profile!.chapters! : [];
            const chapterCount = chapters.length;
            const mainChapterCount =
              chapters.filter((c) => c.role === "main").length || phase.promptReadyCount || 0;
            const liteDisplayPrice = calculateLiteDisplayPrice(
              mainChapterCount > 0 ? mainChapterCount : 1
            );
            return {
              id: book.id,
              title: book.title,
              description: book.description,
              pageCount: book.pageCount,
              totalPrice: Number(book.totalPrice),
              processingStatus: book.processingStatus,
              createdAt: book.createdAt,
              packageTier: ((book as any).packageTier === "upgraded" ? "upgraded" : "lite") as
                | "lite"
                | "upgraded",
              chapterCount,
              mainChapterCount,
              liteDisplayPrice,
              pipelinePhase: phase.phase,
              pipelineLabel: phase.label,
              promptReadyCount: phase.promptReadyCount,
              approvedCount: phase.approvedCount,
              imageReadyCount: phase.imageReadyCount,
            };
          })
        );
        const result: BooksListResult = {
          items,
          pagination: {
            page: input.page,
            pageSize: input.pageSize,
            totalCount,
            totalPages: Math.ceil(totalCount / input.pageSize),
          },
        };
        // Skip long cache while any book is still reading/extracting so UI advances.
        const anyActive = items.some(
          (b) => b.pipelinePhase === "reading" || b.pipelinePhase === "extracted"
        );
        if (!anyActive) setInCache(cacheKey, result);
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
            generatedImageFileKey: sc.generatedImageFileKey,
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
          pageItems = bookPages.map((page) => ({
            id: page.id,
            pageNumber: page.pageNumber,
            thumbnailUrl: page.thumbnailUrl,
            ocrText: page.ocrText,
            generatedPrompt: page.generatedPrompt,
            generatedImageUrl: page.generatedImageUrl,
            generatedImageFileKey: page.generatedImageFileKey,
            processingStatus: page.processingStatus,
            promptStatus: page.promptStatus,
            imageStatus: page.imageStatus,
            skipSuggested: page.skipSuggested,
            errorMessage: page.errorMessage,
            retryCount: page.retryCount,
            maxRetries: page.maxRetries,
            lastRetryAt: page.lastRetryAt,
            nextRetryAt: page.nextRetryAt,
            promptStructured: (page as any).promptStructured ?? null,
          }));
        }
        const phase = derivePipelinePhase(book.processingStatus, pageItems);
        const profile = (book as any).readingProfile as
          | { chapters?: Array<{ role?: string }> }
          | null
          | undefined;
        const chapters = Array.isArray(profile?.chapters) ? profile!.chapters! : [];
        const chapterCount = chapters.length;
        const mainChapterCount =
          chapters.filter((c) => c.role === "main").length || phase.promptReadyCount || 0;
        const liteDisplayPrice = calculateLiteDisplayPrice(
          mainChapterCount > 0 ? mainChapterCount : 1
        );
        const result: BookDetailsResult = {
          id: book.id, title: book.title, description: book.description, pageCount: book.pageCount,
          totalPrice: Number(book.totalPrice), processingStatus: book.processingStatus,
          generationMode: (book as any).generationMode ?? "page",
          packageTier: (book as any).packageTier === "upgraded" ? "upgraded" : "lite",
          chapterCount,
          mainChapterCount,
          liteDisplayPrice,
          storyBible: (book as any).storyBible ?? null,
          readingProfile: (book as any).readingProfile ?? null,
          pipelinePhase: phase.phase,
          pipelineLabel: phase.label,
          promptReadyCount: phase.promptReadyCount,
          approvedCount: phase.approvedCount,
          imageReadyCount: phase.imageReadyCount,
          pages: pageItems,
          createdAt: book.createdAt,
        };
        // Don't cache mid-pipeline so Stage 1 / approve / render show up immediately.
        if (
          phase.phase !== "reading" &&
          phase.phase !== "extracted"
        ) {
          setInCache(cacheKey, result);
        }
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
        // Re-render only: approved pages with image errors, using persisted prompts.
        // Does NOT re-run OCR/transcribe or regenerate prompts (audit C4 root defect).
        const failedPages = pages.filter(
          (p) =>
            p.promptStatus === "approved" &&
            (p.imageStatus === "image_error" || p.processingStatus === "error")
        );
        if (failedPages.length === 0) {
          return { success: true, message: "No approved failed pages to re-render", retriedCount: 0 };
        }

        const capDecision = await checkUserDailyRenderCap(userId, {
          id: book.id,
          pageCount: failedPages.length,
        });
        if (!capDecision.allowed) {
          throw dailyRenderCapError(capDecision, "retryFailedPages");
        }

        for (const page of failedPages) {
          await updatePage(page.id, {
            imageStatus: "pending",
            processingStatus: "pending",
            errorMessage: null,
            retryCount: 0,
          });
        }
        invalidateUserCache(userId);

        const result = await renderApprovedImages(book.id);
        return {
          success: true,
          message: `Re-rendered ${result.rendered} approved page(s)`,
          retriedCount: result.rendered,
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

  /**
   * Stage 1 — Transcribe: build+persist storyBible once, generate per-page prompts.
   * Does NOT call DALL·E.
   */
  transcribePages: protectedProcedure
    .input(z.object({ bookId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const userId = ctx.user.id;
        const book = await getBook(input.bookId);
        if (!book) throw new TRPCError({ code: "NOT_FOUND", message: "Book not found" });
        if (book.userId !== userId) throw new TRPCError({ code: "FORBIDDEN", message: "Not your book" });

        // Ensure pages exist (upload may have failed mid-extract)
        let pages = await getBookPages(input.bookId);
        if (pages.length === 0 && book.pdfFileUrl) {
          const pdfResp = await fetch(book.pdfFileUrl);
          if (!pdfResp.ok) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Could not re-fetch PDF for extract" });
          const buf = Buffer.from(await pdfResp.arrayBuffer());
          await extractAndStorePages(book.id, buf);
          pages = await getBookPages(input.bookId);
        }
        if (pages.length === 0) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No pages to transcribe" });
        }

        const result = await transcribeBook(input.bookId);
        invalidateUserCache(userId);
        return {
          ...result,
          message: `Lite package: ${result.chapterCount ?? result.transcribed} chapter unit(s) ready — approve, then generate. (Per-page is the paid upgraded package.)`,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Transcribe failed",
        });
      }
    }),

  /**
   * Human review gate — sets promptStatus to "approved" (or back to prompt_ready).
   * Server-side only; render refuses anything not approved.
   */
  setPromptApproved: protectedProcedure
    .input(z.object({ pageId: z.number(), approved: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const userId = ctx.user.id;
        const page = await getPage(input.pageId);
        if (!page) throw new TRPCError({ code: "NOT_FOUND", message: "Page not found" });
        const book = await getBook(page.bookId);
        if (!book) throw new TRPCError({ code: "NOT_FOUND", message: "Book not found" });
        if (book.userId !== userId) throw new TRPCError({ code: "FORBIDDEN", message: "Not your book" });

        const result = await setPagePromptApproval(input.pageId, input.approved);
        invalidateUserCache(userId);
        return result;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Approve failed",
        });
      }
    }),

  /**
   * Approve every prompt_ready page with a non-empty prompt (bulk human gate).
   * Does not render — Stage 2 remains explicit.
   */
  approveAllPrompts: protectedProcedure
    .input(z.object({ bookId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const userId = ctx.user.id;
        const book = await getBook(input.bookId);
        if (!book) throw new TRPCError({ code: "NOT_FOUND", message: "Book not found" });
        if (book.userId !== userId) throw new TRPCError({ code: "FORBIDDEN", message: "Not your book" });

        const pages = (await getBookPages(input.bookId)) || [];
        let approved = 0;
        let skipped = 0;
        for (const page of pages) {
          if (page.promptStatus === "approved") {
            skipped++;
            continue;
          }
          if (page.promptStatus !== "prompt_ready" || !page.generatedPrompt?.trim()) {
            skipped++;
            continue;
          }
          await setPagePromptApproval(page.id, true);
          approved++;
        }
        invalidateUserCache(userId);
        return {
          bookId: input.bookId,
          approved,
          skipped,
          message:
            approved > 0
              ? `Approved ${approved} prompt(s) — ready for Stage 2 generate`
              : "No prompt_ready pages to approve",
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Approve-all failed",
        });
      }
    }),

  /**
   * Stage 2 — Render: DALL·E only for pages with promptStatus === "approved".
   * Records real generatedImageFileKey. Subject to daily render cap.
   */
  renderApprovedImages: protectedProcedure
    .input(z.object({ bookId: z.number(), imageParams: imageGenParamsSchema }))
    .mutation(async ({ input, ctx }) => {
      try {
        const userId = ctx.user.id;
        const book = await getBook(input.bookId);
        if (!book) throw new TRPCError({ code: "NOT_FOUND", message: "Book not found" });
        if (book.userId !== userId) throw new TRPCError({ code: "FORBIDDEN", message: "Not your book" });

        const pages = await getBookPages(input.bookId);
        const approvedCount = pages.filter((p) => p.promptStatus === "approved").length;
        if (approvedCount === 0) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "No approved pages — approve at least one prompt before render",
          });
        }

        const capDecision = await checkUserDailyRenderCap(userId, {
          id: book.id,
          pageCount: approvedCount,
        });
        if (!capDecision.allowed) throw dailyRenderCapError(capDecision, "renderApprovedImages");

        const result = await renderApprovedImages(input.bookId, input.imageParams);
        invalidateUserCache(userId);
        return {
          ...result,
          dailyRender: {
            used: capDecision.used,
            cap: capDecision.cap,
            bookUnits: capDecision.bookUnits,
            remaining: capDecision.remaining,
          },
          message: `Rendered ${result.rendered} approved page(s)`,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Render failed",
        });
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
