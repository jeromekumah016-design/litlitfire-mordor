import { eq, and, lt, sql } from "drizzle-orm";
import { getDb } from "./db";
import { pages, scenes, retryHistory } from "../drizzle/schema";

/**
 * Retry Service: Manages retry logic for failed page processing with exponential backoff
 */

export interface RetryConfig {
  maxRetries: number; // Maximum number of retry attempts
  initialDelayMs: number; // Initial backoff delay in milliseconds
  maxDelayMs: number; // Maximum backoff delay
  backoffMultiplier: number; // Exponential backoff multiplier
}

const DEFAULT_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000, // 1 second
  maxDelayMs: 60000, // 1 minute
  backoffMultiplier: 2,
};

/**
 * Calculate exponential backoff delay
 */
export function calculateBackoffDelay(
  attemptNumber: number,
  config: RetryConfig = DEFAULT_CONFIG
): number {
  const delay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attemptNumber - 1);
  return Math.min(delay, config.maxDelayMs);
}

/**
 * Mark a page for retry with exponential backoff
 */
export async function markPageForRetry(
  pageId: number,
  bookId: number,
  errorMessage: string,
  retryReason: string = "Image generation failed",
  config: RetryConfig = DEFAULT_CONFIG
): Promise<boolean> {
  const db = await getDb();
  if (!db) {
    console.error("[RetryService] Database not available");
    return false;
  }

  try {
    // Get current page state
    const pageData = await db
      .select()
      .from(pages)
      .where(eq(pages.id, pageId))
      .limit(1);

    if (!pageData.length) {
      console.error(`[RetryService] Page ${pageId} not found`);
      return false;
    }

    const page = pageData[0];
    const currentRetryCount = page.retryCount || 0;

    // Check if we've exceeded max retries
    if (currentRetryCount >= config.maxRetries) {
      console.warn(
        `[RetryService] Page ${pageId} exceeded max retries (${config.maxRetries})`
      );
      return false;
    }

    // Calculate next retry time with exponential backoff
    const backoffDelayMs = calculateBackoffDelay(currentRetryCount + 1, config);
    const nextRetryAt = new Date(Date.now() + backoffDelayMs);

    // Update page with retry information
    await db
      .update(pages)
      .set({
        processingStatus: "error",
        errorMessage,
        retryCount: currentRetryCount + 1,
        lastRetryAt: new Date(),
        nextRetryAt,
        updatedAt: new Date(),
      })
      .where(eq(pages.id, pageId));

    // Record retry attempt in history
    await db.insert(retryHistory).values({
      pageId,
      bookId,
      attemptNumber: currentRetryCount + 1,
      status: "pending",
      errorMessage,
      retryReason,
      backoffDelayMs,
      createdAt: new Date(),
    });

    console.log(
      `[RetryService] Scheduled retry for page ${pageId}: attempt ${currentRetryCount + 1}/${config.maxRetries}, backoff: ${backoffDelayMs}ms`
    );

    return true;
  } catch (error) {
    console.error("[RetryService] Error marking page for retry:", error);
    return false;
  }
}

/**
 * Get pages ready for retry (nextRetryAt has passed)
 */
export async function getPagesReadyForRetry(
  bookId?: number
): Promise<typeof pages.$inferSelect[]> {
  const db = await getDb();
  if (!db) {
    console.error("[RetryService] Database not available");
    return [];
  }

  try {
    const now = new Date();
    const conditions = [
      eq(pages.processingStatus, "error"),
      lt(pages.nextRetryAt, now),
      // Exclude pages that have already exhausted their retry budget so the
      // worker never loops on them regardless of how nextRetryAt is set.
      sql`${pages.retryCount} < ${pages.maxRetries}`,
    ];

    if (bookId) {
      conditions.push(eq(pages.bookId, bookId));
    }

    const readyPages = await db
      .select()
      .from(pages)
      .where(and(...conditions));
    return readyPages;
  } catch (error) {
    console.error("[RetryService] Error getting pages ready for retry:", error);
    return [];
  }
}

/**
 * Mark retry attempt as successful
 */
export async function markRetrySuccess(
  pageId: number,
  retryAttemptNumber: number
): Promise<boolean> {
  const db = await getDb();
  if (!db) {
    console.error("[RetryService] Database not available");
    return false;
  }

  try {
    // Update retry history
    await db
      .update(retryHistory)
      .set({
        status: "success",
        completedAt: new Date(),
      })
      .where(
        and(
          eq(retryHistory.pageId, pageId),
          eq(retryHistory.attemptNumber, retryAttemptNumber)
        )
      );

    console.log(
      `[RetryService] Marked retry attempt ${retryAttemptNumber} for page ${pageId} as successful`
    );

    return true;
  } catch (error) {
    console.error("[RetryService] Error marking retry as successful:", error);
    return false;
  }
}

/**
 * Mark retry attempt as failed
 */
export async function markRetryFailed(
  pageId: number,
  retryAttemptNumber: number,
  errorMessage: string
): Promise<boolean> {
  const db = await getDb();
  if (!db) {
    console.error("[RetryService] Database not available");
    return false;
  }

  try {
    // Update retry history
    await db
      .update(retryHistory)
      .set({
        status: "failed",
        errorMessage,
        completedAt: new Date(),
      })
      .where(
        and(
          eq(retryHistory.pageId, pageId),
          eq(retryHistory.attemptNumber, retryAttemptNumber)
        )
      );

    console.log(
      `[RetryService] Marked retry attempt ${retryAttemptNumber} for page ${pageId} as failed`
    );

    return true;
  } catch (error) {
    console.error("[RetryService] Error marking retry as failed:", error);
    return false;
  }
}

/**
 * Get retry history for a page
 */
export async function getRetryHistory(pageId: number) {
  const db = await getDb();
  if (!db) {
    console.error("[RetryService] Database not available");
    return [];
  }

  try {
    const history = await db
      .select()
      .from(retryHistory)
      .where(eq(retryHistory.pageId, pageId));

    return history;
  } catch (error) {
    console.error("[RetryService] Error getting retry history:", error);
    return [];
  }
}

/**
 * Reset page retry count (for manual retry from UI)
 */
export async function resetPageRetryCount(pageId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) {
    console.error("[RetryService] Database not available");
    return false;
  }

  try {
    await db
      .update(pages)
      .set({
        processingStatus: "pending",
        errorMessage: null,
        retryCount: 0,
        lastRetryAt: null,
        nextRetryAt: null,
        updatedAt: new Date(),
      })
      .where(eq(pages.id, pageId));

    console.log(`[RetryService] Reset retry count for page ${pageId}`);
    return true;
  } catch (error) {
    console.error("[RetryService] Error resetting retry count:", error);
    return false;
  }
}

/**
 * Mark a scene for retry with exponential backoff (scene-mode equivalent of
 * markPageForRetry). Updates the scene row's retry fields and records the
 * attempt in retryHistory, keyed by the scene id in the pageId column so the
 * existing history table is reused without a schema change.
 */
export async function markSceneForRetry(
  sceneId: number,
  bookId: number,
  errorMessage: string,
  retryReason: string = "Scene image generation failed",
  config: RetryConfig = DEFAULT_CONFIG
): Promise<boolean> {
  const db = await getDb();
  if (!db) {
    console.error("[RetryService] Database not available");
    return false;
  }

  try {
    const sceneData = await db.select().from(scenes).where(eq(scenes.id, sceneId)).limit(1);
    if (!sceneData.length) {
      console.error(`[RetryService] Scene ${sceneId} not found`);
      return false;
    }

    const scene = sceneData[0];
    const currentRetryCount = scene.retryCount || 0;
    if (currentRetryCount >= config.maxRetries) {
      console.warn(`[RetryService] Scene ${sceneId} exceeded max retries (${config.maxRetries})`);
      return false;
    }

    const backoffDelayMs = calculateBackoffDelay(currentRetryCount + 1, config);
    const nextRetryAt = new Date(Date.now() + backoffDelayMs);

    await db
      .update(scenes)
      .set({
        processingStatus: "error",
        errorMessage,
        retryCount: currentRetryCount + 1,
        lastRetryAt: new Date(),
        nextRetryAt,
        updatedAt: new Date(),
      })
      .where(eq(scenes.id, sceneId));

    await db.insert(retryHistory).values({
      pageId: sceneId,
      bookId,
      attemptNumber: currentRetryCount + 1,
      status: "pending",
      errorMessage,
      retryReason,
      backoffDelayMs,
      createdAt: new Date(),
    });

    console.log(`[RetryService] Scheduled retry for scene ${sceneId}: attempt ${currentRetryCount + 1}/${config.maxRetries}, backoff: ${backoffDelayMs}ms`);
    return true;
  } catch (error) {
    console.error("[RetryService] Error marking scene for retry:", error);
    return false;
  }
}
