/**
 * Per-user daily render cap helpers.
 *
 * Audit P0 (qc/AUDIT-RECONCILIATION-2026-07-17.md C1 remaining):
 * upload auto-triggers the full pipeline with no rate limit. This module
 * gates that auto-trigger by counting pipeline page-units already started
 * today for the user.
 *
 * Units: min(book.pageCount, PIPELINE_MAX_PAGES) — matches how many pages
 * processBookPipeline actually renders (MAX_PAGES=20).
 * Day boundary: UTC calendar day of book.createdAt.
 * Counted books: any non-pending processingStatus (processing|completed|failed)
 * created today — i.e. books whose pipeline was started.
 *
 * Default cap: DAILY_RENDER_PAGE_CAP env, or 40 (two full 20-page books).
 * Cap of 0 disables auto-trigger entirely. Negative / NaN falls back to default.
 */

export const PIPELINE_MAX_PAGES = 20;
export const DEFAULT_DAILY_RENDER_PAGE_CAP = 40;

export type CapBook = {
  pageCount: number;
  processingStatus: string;
  createdAt: Date | string;
};

export function getDailyRenderPageCap(
  envValue: string | undefined = process.env.DAILY_RENDER_PAGE_CAP
): number {
  if (envValue === undefined || envValue === "") return DEFAULT_DAILY_RENDER_PAGE_CAP;
  const n = Number.parseInt(envValue, 10);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_DAILY_RENDER_PAGE_CAP;
  return n;
}

export function startOfUtcDay(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function renderUnitsForBook(pageCount: number): number {
  if (!Number.isFinite(pageCount) || pageCount <= 0) return 0;
  return Math.min(Math.floor(pageCount), PIPELINE_MAX_PAGES);
}

/** True if this book has had its pipeline started (not merely uploaded). */
export function isPipelineStarted(status: string): boolean {
  return status !== "pending";
}

export function sumStartedRenderUnitsToday(
  books: CapBook[],
  now: Date = new Date()
): number {
  const dayStart = startOfUtcDay(now).getTime();
  let total = 0;
  for (const book of books) {
    const created =
      book.createdAt instanceof Date
        ? book.createdAt.getTime()
        : new Date(book.createdAt).getTime();
    if (Number.isNaN(created) || created < dayStart) continue;
    if (!isPipelineStarted(book.processingStatus)) continue;
    total += renderUnitsForBook(book.pageCount);
  }
  return total;
}

export type AutoStartDecision = {
  allowed: boolean;
  used: number;
  cap: number;
  bookUnits: number;
  remaining: number;
};

/**
 * Decide whether upload may fire-and-forget the render pipeline.
 * `used` = units already started today (exclude the book being uploaded if it
 * is still pending — callers should create the book as pending first, then
 * count, then optionally start).
 */
export function decideAutoStartRender(
  used: number,
  bookPageCount: number,
  cap: number = getDailyRenderPageCap()
): AutoStartDecision {
  const bookUnits = renderUnitsForBook(bookPageCount);
  const remaining = Math.max(0, cap - used);
  // Cap 0 = never auto-start. Book with 0 units never starts either.
  const allowed = bookUnits > 0 && used + bookUnits <= cap;
  return { allowed, used, cap, bookUnits, remaining };
}
