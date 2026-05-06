import { getPagesReadyForRetry, markRetrySuccess, markRetryFailed } from "./retryService";
import { processPagePipeline } from "./pipelineService";
import { getDb } from "./db";
import { pages } from "../drizzle/schema";
import { eq } from "drizzle-orm";

/**
 * Retry Worker: Automatically processes failed pages that are ready for retry
 * This worker should be called periodically (e.g., every 30 seconds)
 */

interface RetryWorkerConfig {
  maxConcurrentRetries: number; // Max number of retries to process simultaneously
  pollIntervalMs: number; // How often to check for ready pages
  enabled: boolean; // Whether the worker is enabled
}

const DEFAULT_CONFIG: RetryWorkerConfig = {
  maxConcurrentRetries: 3,
  pollIntervalMs: 30000, // 30 seconds
  enabled: true,
};

let workerInterval: NodeJS.Timeout | null = null;
let isProcessing = false;

/**
 * Start the automatic retry worker
 */
export function startRetryWorker(config: RetryWorkerConfig = DEFAULT_CONFIG) {
  if (!config.enabled) {
    console.log("[RetryWorker] Retry worker is disabled");
    return;
  }

  if (workerInterval) {
    console.warn("[RetryWorker] Retry worker is already running");
    return;
  }

  console.log("[RetryWorker] Starting automatic retry worker");

  workerInterval = setInterval(async () => {
    if (isProcessing) {
      console.log("[RetryWorker] Previous batch still processing, skipping this cycle");
      return;
    }

    await processRetryBatch(config);
  }, config.pollIntervalMs);
}

/**
 * Stop the automatic retry worker
 */
export function stopRetryWorker() {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
    console.log("[RetryWorker] Retry worker stopped");
  }
}

/**
 * Process a batch of failed pages ready for retry
 */
async function processRetryBatch(config: RetryWorkerConfig) {
  isProcessing = true;

  try {
    // Get pages ready for retry
    const readyPages = await getPagesReadyForRetry();

    if (readyPages.length === 0) {
      // No pages ready, skip
      isProcessing = false;
      return;
    }

    console.log(
      `[RetryWorker] Found ${readyPages.length} pages ready for retry, processing up to ${config.maxConcurrentRetries}`
    );

    // Process up to maxConcurrentRetries pages in parallel
    const pagesToProcess = readyPages.slice(0, config.maxConcurrentRetries);
    const retryPromises = pagesToProcess.map((page) =>
      retryFailedPage(page)
    );

    const results = await Promise.allSettled(retryPromises);

    // Log results
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

    console.log(
      `[RetryWorker] Batch complete: ${succeeded} succeeded, ${failed} failed`
    );
  } catch (error) {
    console.error("[RetryWorker] Error processing retry batch:", error);
  } finally {
    isProcessing = false;
  }
}

/**
 * Retry a single failed page
 */
async function retryFailedPage(page: typeof pages.$inferSelect) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  try {
    console.log(
      `[RetryWorker] Retrying page ${page.id} (attempt ${page.retryCount + 1}/${page.maxRetries})`
    );

    // Mark page as processing
    await db
      .update(pages)
      .set({
        processingStatus: "processing",
        updatedAt: new Date(),
      })
      .where(eq(pages.id, page.id));

    // Get the book's PDF to reprocess
    const { getBook } = await import("./db");
    const book = await getBook(page.bookId);

    if (!book) {
      throw new Error(`Book ${page.bookId} not found`);
    }

    // Fetch PDF from storage
    const pdfUrl = book.pdfFileUrl;
    const response = await fetch(pdfUrl);

    if (!response.ok) {
      throw new Error(`Failed to fetch PDF: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const pdfBuffer = Buffer.from(arrayBuffer);

    // Reprocess the page
    const result = await processPagePipeline(
      page.bookId,
      page.pageNumber,
      pdfBuffer
    );

    if (result) {
      // Update page with successful retry result
      await db
        .update(pages)
        .set({
          processingStatus: "done",
          generatedImageFileKey: result.generatedImageFileKey || undefined,
          generatedImageUrl: result.generatedImageUrl || undefined,
          errorMessage: null,
          updatedAt: new Date(),
        })
        .where(eq(pages.id, page.id));

      // Mark retry as successful
      await markRetrySuccess(page.id, page.retryCount + 1);

      console.log(
        `[RetryWorker] Successfully retried page ${page.id} on attempt ${page.retryCount + 1}`
      );
    } else {
      throw new Error("Page processing returned null");
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[RetryWorker] Failed to retry page ${page.id}:`, errorMsg);

    // Mark retry as failed
    await markRetryFailed(page.id, page.retryCount + 1, errorMsg);

    // Update page status to error
    await db
      .update(pages)
      .set({
        processingStatus: "error",
        errorMessage: `Retry attempt ${page.retryCount + 1} failed: ${errorMsg}`,
        updatedAt: new Date(),
      })
      .where(eq(pages.id, page.id));

    throw error;
  }
}

/**
 * Manually trigger a retry for a specific page
 */
export async function manualRetryPage(pageId: number) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  try {
    const pageData = await db
      .select()
      .from(pages)
      .where(eq(pages.id, pageId))
      .limit(1);

    if (!pageData.length) {
      throw new Error(`Page ${pageId} not found`);
    }

    const page = pageData[0];

    // Process immediately
    await retryFailedPage(page);

    return { success: true, message: `Page ${pageId} retried successfully` };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to manually retry page: ${errorMsg}`);
  }
}
