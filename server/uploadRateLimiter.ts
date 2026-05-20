export interface RateLimitResult {
  allowed: boolean;
  reason?: string;
  retryAfterMs?: number;
}

interface UserWindow {
  uploads: number;
  uploadWindowStart: number;
  pagesProcessed: number;
  pagesWindowStart: number;
}

const MAX_UPLOADS_PER_HOUR = 5;
const MAX_PAGES_PER_DAY = 100;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const state = new Map<number, UserWindow>();

function getOrCreate(userId: number): UserWindow {
  let entry = state.get(userId);
  if (!entry) {
    const now = Date.now();
    entry = {
      uploads: 0,
      uploadWindowStart: now,
      pagesProcessed: 0,
      pagesWindowStart: now,
    };
    state.set(userId, entry);
  }
  return entry;
}

function refreshWindows(entry: UserWindow): void {
  const now = Date.now();

  if (now - entry.uploadWindowStart >= HOUR_MS) {
    entry.uploads = 0;
    entry.uploadWindowStart = now;
  }

  if (now - entry.pagesWindowStart >= DAY_MS) {
    entry.pagesProcessed = 0;
    entry.pagesWindowStart = now;
  }
}

export function checkUploadRateLimit(userId: number): RateLimitResult {
  const entry = getOrCreate(userId);
  refreshWindows(entry);

  if (entry.uploads >= MAX_UPLOADS_PER_HOUR) {
    const retryAfterMs = HOUR_MS - (Date.now() - entry.uploadWindowStart);
    return {
      allowed: false,
      reason: `Upload limit reached: maximum ${MAX_UPLOADS_PER_HOUR} PDF uploads per hour.`,
      retryAfterMs: Math.max(retryAfterMs, 0),
    };
  }

  return { allowed: true };
}

export function recordUpload(userId: number): void {
  const entry = getOrCreate(userId);
  refreshWindows(entry);
  entry.uploads += 1;
}

export function checkPageRateLimit(userId: number, pageCount: number): RateLimitResult {
  const entry = getOrCreate(userId);
  refreshWindows(entry);

  if (entry.pagesProcessed + pageCount > MAX_PAGES_PER_DAY) {
    const remaining = Math.max(MAX_PAGES_PER_DAY - entry.pagesProcessed, 0);
    const retryAfterMs = DAY_MS - (Date.now() - entry.pagesWindowStart);
    return {
      allowed: false,
      reason: `Page limit reached: this upload would process ${pageCount} pages but only ${remaining} of ${MAX_PAGES_PER_DAY} daily pages remain.`,
      retryAfterMs: Math.max(retryAfterMs, 0),
    };
  }

  return { allowed: true };
}

export function recordPages(userId: number, pageCount: number): void {
  const entry = getOrCreate(userId);
  refreshWindows(entry);
  entry.pagesProcessed += pageCount;
}
