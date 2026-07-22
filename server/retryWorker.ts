import { getPagesReadyForRetry, markRetrySuccess, markRetryFailed } from "./retryService";
import { getPage } from "./db";
import { reRenderApprovedPage } from "./gatePipeline";
import { getDb } from "./db";
import { pages } from "../drizzle/schema";
import { eq } from "drizzle-orm";

/**
 * Retry Worker — re-renders FAILED images from the persisted approved prompt only.
 *
 * Functional bar §5 / audit C3: never rebuilds the story bible, never regenerates
 * prompts (that was the money-to-garbage + visual-drift path). If a page is not
 * promptStatus=approved or has no generatedPrompt, the retry is marked failed
 * permanently rather than falling back to processPagePipeline.
 *
 * Default-off at boot (RETRY_WORKER_ENABLED=true required). See _core/index.ts.
 */

interface RetryWorkerConfig {
  maxConcurrentRetries: number;
  pollIntervalMs: number;
  enabled: boolean;
}

const DEFAULT_CONFIG: RetryWorkerConfig = {
  maxConcurrentRetries: 3,
  pollIntervalMs: 30000,
  enabled: true,
};

let workerInterval: NodeJS.Timeout | null = null;
let isProcessing = false;

export function startRetryWorker(config: RetryWorkerConfig = DEFAULT_CONFIG) {
  if (!config.enabled) {
    console.log("[RetryWorker] Retry worker is disabled");
    return;
  }

  if (workerInterval) {
    console.warn("[RetryWorker] Retry worker is already running");
    return;
  }

  console.log(
    "[RetryWorker] Starting — re-render only from persisted approved prompts (no prompt regen)"
  );

  workerInterval = setInterval(async () => {
    if (isProcessing) {
      console.log("[RetryWorker] Previous batch still processing, skipping this cycle");
      return;
    }
    await processRetryBatch(config);
  }, config.pollIntervalMs);
}

export function stopRetryWorker() {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
    console.log("[RetryWorker] Retry worker stopped");
  }
}

async function processRetryBatch(config: RetryWorkerConfig) {
  isProcessing = true;
  try {
    const readyPages = await getPagesReadyForRetry();
    if (readyPages.length === 0) {
      isProcessing = false;
      return;
    }

    console.log(
      `[RetryWorker] Found ${readyPages.length} pages ready for retry, processing up to ${config.maxConcurrentRetries}`
    );

    const pagesToProcess = readyPages.slice(0, config.maxConcurrentRetries);
    const results = await Promise.allSettled(pagesToProcess.map((page) => retryFailedPage(page)));

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;
    console.log(`[RetryWorker] Batch complete: ${succeeded} succeeded, ${failed} failed`);
  } catch (error) {
    console.error("[RetryWorker] Error processing retry batch:", error);
  } finally {
    isProcessing = false;
  }
}

/**
 * Retry a single failed page by re-rendering its persisted approved prompt.
 */
async function retryFailedPage(page: typeof pages.$inferSelect) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  console.log(
    `[RetryWorker] Retrying page ${page.id} (attempt ${page.retryCount + 1}/${page.maxRetries})`
  );

  // Fresh read for gate fields (retry queue rows may be partial)
  const fresh = (await getPage(page.id)) ?? page;

  const attempt = (page.retryCount ?? 0) + 1;

  if (fresh.promptStatus !== "approved" || !fresh.generatedPrompt?.trim()) {
    const reason =
      `Cannot safe-retry page ${fresh.id}: promptStatus=${fresh.promptStatus} ` +
      `hasPrompt=${!!fresh.generatedPrompt?.trim()} — refusing to regenerate prompts (functional bar §5)`;
    console.warn(`[RetryWorker] ${reason}`);
    await markRetryFailed(page.id, attempt, reason);
    throw new Error(reason);
  }

  try {
    await db
      .update(pages)
      .set({
        processingStatus: "processing",
        imageStatus: "pending",
        updatedAt: new Date(),
      })
      .where(eq(pages.id, page.id));

    const result = await reRenderApprovedPage(page.id);

    await markRetrySuccess(page.id, attempt);
    console.log(
      `[RetryWorker] Page ${page.id} re-rendered key=${result.key} (prompt unchanged)`
    );
    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[RetryWorker] Page ${page.id} retry failed:`, msg);
    await markRetryFailed(page.id, attempt, msg);
    throw error;
  }
}

/** Exported for tests. */
export const _test = { retryFailedPage, processRetryBatch };
