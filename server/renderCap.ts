/**
 * Per-user daily render cap helpers.
 *
 * SCOPE: always per authenticated user. Callers MUST pass only that user's
 * books (e.g. getUserBooks(userId)). There is no system-wide aggregate — one
 * account cannot exhaust another account's budget.
 *
 * Applied to: upload auto-trigger, processPdf, retryFailedPages (same bucket).
 *
 * Units: min(book.pageCount, PIPELINE_MAX_PAGES) — matches how many pages
 * processBookPipeline actually renders (MAX_PAGES=20).
 * Day boundary: UTC calendar day of book.createdAt.
 * Counted books: any non-pending processingStatus (processing|completed|failed)
 * created today — i.e. books whose pipeline was started.
 *
 * When evaluating a specific book, pass excludeBookId so a reprocess/retry of a
 * book already in today's "started" set is not double-counted (its slot is
 * already reserved; other books still compete for remaining capacity).
 *
 * Default cap: DAILY_RENDER_PAGE_CAP env, or 40 (two full 20-page books).
 * Cap of 0 blocks all starts. Negative / NaN falls back to default.
 */

export const PIPELINE_MAX_PAGES = 20;
export const DEFAULT_DAILY_RENDER_PAGE_CAP = 40;

export type CapBook = {
  id?: number;
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

export type SumRenderUnitsOptions = {
  /** Omit this book from the sum (reprocess/retry without double-counting). */
  excludeBookId?: number;
};

export function sumStartedRenderUnitsToday(
  books: CapBook[],
  now: Date = new Date(),
  options: SumRenderUnitsOptions = {}
): number {
  const dayStart = startOfUtcDay(now).getTime();
  const excludeId = options.excludeBookId;
  let total = 0;
  for (const book of books) {
    if (excludeId != null && book.id === excludeId) continue;
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
 * Decide whether a pipeline start is allowed under the daily cap.
 * `used` = other page-units already started today for this user (caller should
 * exclude the book under consideration when it may already be non-pending).
 */
export function decideAutoStartRender(
  used: number,
  bookPageCount: number,
  cap: number = getDailyRenderPageCap()
): AutoStartDecision {
  const bookUnits = renderUnitsForBook(bookPageCount);
  const remaining = Math.max(0, cap - used);
  // Cap 0 = never start. Book with 0 units never starts either.
  const allowed = bookUnits > 0 && used + bookUnits <= cap;
  return { allowed, used, cap, bookUnits, remaining };
}

/**
 * Full per-user evaluation: sum this user's books (optionally excluding one),
 * then decide whether `bookPageCount` fits under the cap.
 */
export function evaluateUserDailyRenderCap(
  userBooks: CapBook[],
  bookPageCount: number,
  options: SumRenderUnitsOptions & { now?: Date; cap?: number } = {}
): AutoStartDecision {
  const { now = new Date(), cap = getDailyRenderPageCap(), excludeBookId } = options;
  const used = sumStartedRenderUnitsToday(userBooks, now, { excludeBookId });
  return decideAutoStartRender(used, bookPageCount, cap);
}
