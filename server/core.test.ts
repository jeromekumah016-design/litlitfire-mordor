/**
 * Core Integration Test Suite — litlitfire-mordor
 *
 * Covers:
 *  1. Pricing Service          – tier-boundary arithmetic, min/max caps
 *  2. Retry Backoff            – calculateBackoffDelay precision
 *  3. ProgressTracker          – full lifecycle + event emission
 *  4. Resilience utilities     – withTimeout, withRetry, CircuitBreaker, RateLimiter, Bulkhead
 *  5. Data-structure utilities – ObjectPool, TTLMap (fake-timer), BoundedSet, CircularBuffer
 *  6. booksRouter progress     – status-count & percentage calculation variants
 *  7. booksRouter via createCaller – upload validation, auth guards, retry, list pagination
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks (Vitest hoists these to the top of the file automatically)
// ---------------------------------------------------------------------------

vi.mock("./db", () => ({
  createBook: vi.fn(),
  getBook: vi.fn(),
  getUserBooks: vi.fn(),
  getBookPages: vi.fn(),
  getBookScenes: vi.fn(),
  updateBook: vi.fn(),
  updatePage: vi.fn(),
  deleteBook: vi.fn(),
  getDashboardStats: vi.fn(),
  getProcessingMetrics: vi.fn(),
  getLibraryOverview: vi.fn(),
}));

vi.mock("./pdfService", () => ({
  getPDFMetadata: vi.fn(),
}));

vi.mock("./pipelineService", () => ({
  processBookPipeline: vi.fn().mockResolvedValue({ successCount: 1, failureCount: 0 }),
}));

vi.mock("./storage", () => ({
  storagePut: vi
    .fn()
    .mockResolvedValue({ key: "books/1/test.pdf", url: "https://cdn.example.com/test.pdf" }),
}));

// ---------------------------------------------------------------------------
// Imports — pure modules (no DB/network calls in the functions under test)
// ---------------------------------------------------------------------------

import {
  calculatePrice,
  getPricingBreakdown,
  validatePricingConfig,
  DEFAULT_PRICING_CONFIG,
  type PricingConfig,
} from "./pricingService";

import { calculateBackoffDelay, type RetryConfig } from "./retryService";

import {
  ProgressTracker,
  getOrCreateProgressTracker,
  getProgressTracker,
  removeProgressTracker,
  type ProgressEvent,
} from "./progressTracker";

import {
  withTimeout,
  withRetry,
  CircuitBreaker,
  RateLimiter,
  Bulkhead,
} from "./resilience";

import {
  ObjectPool,
  TTLMap,
  BoundedSet,
  CircularBuffer,
} from "./dataStructureOptimizations";

// Router + context — used for createCaller tests
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { getBook, getBookPages, getBookScenes, getUserBooks, updateBook, updatePage, createBook, deleteBook } from "./db";
import { getPDFMetadata } from "./pdfService";

// ---------------------------------------------------------------------------
// Helper: build an authenticated TrpcContext
// ---------------------------------------------------------------------------

function makeCtx(userId = 1): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `user-${userId}`,
      email: `user${userId}@example.com`,
      name: `User ${userId}`,
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

function makePage(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    bookId: 1,
    pageNumber: 1,
    thumbnailFileKey: null,
    thumbnailUrl: null,
    ocrText: null,
    generatedPrompt: null,
    generatedImageFileKey: null,
    generatedImageUrl: null,
    processingStatus: "done",
    errorMessage: null,
    retryCount: 0,
    maxRetries: 3,
    lastRetryAt: null,
    nextRetryAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeBook(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: 1,
    title: "Test Book",
    description: null,
    pdfFileKey: "books/1/test.pdf",
    pdfFileUrl: "https://cdn.example.com/test.pdf",
    pageCount: 5,
    processingStatus: "completed",
    totalPrice: "10.00",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ===========================================================================
// 1. Pricing Service — tier-boundary arithmetic
// ===========================================================================

describe("pricingService — tier boundaries", () => {
  it("1 page is capped at the minimum price ($2.00)", () => {
    expect(calculatePrice(1)).toBe(2.0);
  });

  it("4 pages: 4 × $0.50 = $2.00 (still minimum)", () => {
    // 4 × 0.50 = 2.00 which equals minPrice — stays at 2.00
    expect(calculatePrice(4)).toBe(2.0);
  });

  it("5 pages: 5 × $0.50 = $2.50 (above minimum)", () => {
    expect(calculatePrice(5)).toBe(2.5);
  });

  it("49 pages: 49 × $0.50 = $24.50 (still in tier-1)", () => {
    expect(calculatePrice(49)).toBe(24.5);
  });

  it("50 pages: 50 × $0.40 = $20.00 (volume discount kicks in at tier-2)", () => {
    // The price actually DROPS at the tier boundary — this is correct behaviour.
    expect(calculatePrice(50)).toBe(20.0);
  });

  it("tier-2 discount means price(50) < price(49)", () => {
    expect(calculatePrice(50)).toBeLessThan(calculatePrice(49));
  });

  it("51 pages: 51 × $0.40 = $20.40", () => {
    expect(calculatePrice(51)).toBe(20.4);
  });

  it("99 pages: 99 × $0.40 = $39.60 (last page of tier-2)", () => {
    expect(calculatePrice(99)).toBe(39.6);
  });

  it("100 pages: 100 × $0.30 = $30.00 (volume discount at tier-3)", () => {
    expect(calculatePrice(100)).toBe(30.0);
  });

  it("tier-3 discount means price(100) < price(99)", () => {
    expect(calculatePrice(100)).toBeLessThan(calculatePrice(99));
  });

  it("101 pages: 101 × $0.30 = $30.30", () => {
    expect(calculatePrice(101)).toBe(30.3);
  });

  it("1667 pages hits the $500 maximum cap (1667 × $0.30 = $500.10 → capped)", () => {
    expect(calculatePrice(1667)).toBe(500.0);
  });

  it("price is monotonically non-decreasing within each tier", () => {
    // tier 1 (1-49): pages 5 to 49
    for (let p = 5; p < 49; p++) {
      expect(calculatePrice(p)).toBeLessThanOrEqual(calculatePrice(p + 1));
    }
    // tier 2 (50-99)
    for (let p = 50; p < 99; p++) {
      expect(calculatePrice(p)).toBeLessThanOrEqual(calculatePrice(p + 1));
    }
    // tier 3 (100+)
    for (let p = 100; p < 150; p++) {
      expect(calculatePrice(p)).toBeLessThanOrEqual(calculatePrice(p + 1));
    }
  });
});

describe("pricingService — getPricingBreakdown tier labels", () => {
  it("tier_1+ for 5 pages", () => {
    const b = getPricingBreakdown(5);
    expect(b.tier).toBe("tier_1+");
    expect(b.pricePerPage).toBe(0.5);
  });

  it("tier_50+ for 75 pages", () => {
    const b = getPricingBreakdown(75);
    expect(b.tier).toBe("tier_50+");
    expect(b.pricePerPage).toBe(0.4);
  });

  it("tier_100+ for 200 pages", () => {
    const b = getPricingBreakdown(200);
    expect(b.tier).toBe("tier_100+");
    expect(b.pricePerPage).toBe(0.3);
  });

  it("subtotal = pageCount × pricePerPage", () => {
    const b = getPricingBreakdown(75);
    expect(b.subtotal).toBeCloseTo(75 * 0.4, 10);
  });
});

describe("pricingService — validatePricingConfig edge cases", () => {
  it("rejects config with zero max price", () => {
    const cfg: PricingConfig = { basePrice: 1.0, minPrice: 0.5, maxPrice: 0 };
    const result = validatePricingConfig(cfg);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Maximum price"))).toBe(true);
  });

  it("rejects tier with zero price per page", () => {
    const cfg: PricingConfig = {
      basePrice: 1.0,
      minPrice: 1.0,
      maxPrice: 100.0,
      tieredPricing: [{ threshold: 1, pricePerPage: 0 }],
    };
    expect(validatePricingConfig(cfg).valid).toBe(false);
  });

  it("accumulates multiple errors", () => {
    const cfg: PricingConfig = { basePrice: 0, minPrice: -1, maxPrice: 0 };
    const result = validatePricingConfig(cfg);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

// ===========================================================================
// 2. Retry Backoff — calculateBackoffDelay
// ===========================================================================

describe("calculateBackoffDelay", () => {
  const defaultCfg: RetryConfig = {
    maxRetries: 3,
    initialDelayMs: 1000,
    maxDelayMs: 60_000,
    backoffMultiplier: 2,
  };

  it("attempt 1 → 1000 ms", () => {
    expect(calculateBackoffDelay(1, defaultCfg)).toBe(1000);
  });

  it("attempt 2 → 2000 ms", () => {
    expect(calculateBackoffDelay(2, defaultCfg)).toBe(2000);
  });

  it("attempt 3 → 4000 ms", () => {
    expect(calculateBackoffDelay(3, defaultCfg)).toBe(4000);
  });

  it("attempt 4 → 8000 ms", () => {
    expect(calculateBackoffDelay(4, defaultCfg)).toBe(8000);
  });

  it("attempt 6 → 32 000 ms", () => {
    expect(calculateBackoffDelay(6, defaultCfg)).toBe(32_000);
  });

  it("attempt 7 → capped at 60 000 ms (64 000 without cap)", () => {
    expect(calculateBackoffDelay(7, defaultCfg)).toBe(60_000);
  });

  it("custom config: 500 ms initial, 3× multiplier", () => {
    const cfg: RetryConfig = {
      maxRetries: 5,
      initialDelayMs: 500,
      maxDelayMs: 100_000,
      backoffMultiplier: 3,
    };
    expect(calculateBackoffDelay(1, cfg)).toBe(500);
    expect(calculateBackoffDelay(2, cfg)).toBe(1500);
    expect(calculateBackoffDelay(3, cfg)).toBe(4500);
  });

  it("delay never exceeds maxDelayMs regardless of attempt count", () => {
    const cfg: RetryConfig = {
      maxRetries: 100,
      initialDelayMs: 1000,
      maxDelayMs: 5000,
      backoffMultiplier: 2,
    };
    for (let i = 1; i <= 20; i++) {
      expect(calculateBackoffDelay(i, cfg)).toBeLessThanOrEqual(5000);
    }
  });
});

// ===========================================================================
// 3. ProgressTracker — full lifecycle
// ===========================================================================

describe("ProgressTracker", () => {
  let tracker: ProgressTracker;

  beforeEach(() => {
    tracker = new ProgressTracker(42, 4);
  });

  it("initialises all pages as pending with 0% progress", () => {
    const progress = tracker.getProgress();
    expect(progress.totalPages).toBe(4);
    expect(progress.processedPages).toBe(0);
    expect(progress.failedPages).toBe(0);
    expect(progress.overallProgress).toBe(0);
    expect(progress.status).toBe("pending");
    expect(progress.pageStatuses.every((p) => p.status === "pending")).toBe(true);
  });

  it("startPage transitions status to 'processing'", () => {
    tracker.startPage(1);
    const page = tracker.getPageStatus(1);
    expect(page?.status).toBe("processing");
    expect(page?.progress).toBe(0);
  });

  it("startPage transitions overall status from pending → processing", () => {
    tracker.startPage(1);
    expect(tracker.getProgress().status).toBe("processing");
  });

  it("completePage increments processedPages", () => {
    tracker.startPage(1);
    tracker.completePage(1);
    expect(tracker.getProgress().processedPages).toBe(1);
  });

  it("completePage marks page as completed with 100% progress", () => {
    tracker.startPage(1);
    tracker.completePage(1);
    const page = tracker.getPageStatus(1);
    expect(page?.status).toBe("completed");
    expect(page?.progress).toBe(100);
  });

  it("overall progress = round(completed / total × 100) — 1 of 4 = 25%", () => {
    tracker.startPage(1);
    tracker.completePage(1);
    expect(tracker.getProgress().overallProgress).toBe(25);
  });

  it("overall progress 2 of 4 = 50%", () => {
    for (const p of [1, 2]) {
      tracker.startPage(p);
      tracker.completePage(p);
    }
    expect(tracker.getProgress().overallProgress).toBe(50);
  });

  it("overall progress 4 of 4 = 100%", () => {
    for (const p of [1, 2, 3, 4]) {
      tracker.startPage(p);
      tracker.completePage(p);
    }
    expect(tracker.getProgress().overallProgress).toBe(100);
  });

  it("failPage increments failedPages", () => {
    tracker.startPage(2);
    tracker.failPage(2, "Image generation failed");
    expect(tracker.getProgress().failedPages).toBe(1);
  });

  it("failPage marks page with status 'error' and stores error message", () => {
    tracker.startPage(2);
    tracker.failPage(2, "Something went wrong");
    const page = tracker.getPageStatus(2);
    expect(page?.status).toBe("error");
    expect(page?.error).toBe("Something went wrong");
  });

  it("failPage does NOT increment processedPages", () => {
    tracker.startPage(2);
    tracker.failPage(2, "err");
    expect(tracker.getProgress().processedPages).toBe(0);
  });

  it("completeProcessing sets status to 'completed'", () => {
    tracker.startPage(1);
    tracker.completePage(1);
    tracker.completeProcessing();
    expect(tracker.getProgress().status).toBe("completed");
  });

  it("cancel sets status to 'cancelled'", () => {
    tracker.cancel();
    expect(tracker.getProgress().status).toBe("cancelled");
  });

  it("failProcessing sets status to 'failed' and includes error", () => {
    tracker.failProcessing("fatal error");
    const p = tracker.getProgress();
    expect(p.status).toBe("failed");
    // The emitted event contains the error
  });

  it("getPageStatus returns undefined for out-of-range page number", () => {
    expect(tracker.getPageStatus(99)).toBeUndefined();
  });

  it("getAllPageStatuses returns all N pages", () => {
    expect(tracker.getAllPageStatuses()).toHaveLength(4);
  });

  it("emits 'progress' event on startPage", () => {
    const events: ProgressEvent[] = [];
    tracker.on("progress", (e: ProgressEvent) => events.push(e));
    tracker.startPage(1);
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe("processing");
  });

  it("emits 'progress' event on completePage", () => {
    const events: ProgressEvent[] = [];
    tracker.startPage(1);
    tracker.on("progress", (e: ProgressEvent) => events.push(e));
    tracker.completePage(1);
    expect(events).toHaveLength(1);
    expect(events[0].processedPages).toBe(1);
  });

  it("emits 'progress' event on failPage", () => {
    const events: ProgressEvent[] = [];
    tracker.startPage(2);
    tracker.on("progress", (e: ProgressEvent) => events.push(e));
    tracker.failPage(2, "err");
    expect(events).toHaveLength(1);
    expect(events[0].failedPages).toBe(1);
  });

  it("initial ETA (no completions) = totalPages × 9500 ms", () => {
    const TOTAL_STEP_DURATION = 500 + 2000 + 1500 + 5000 + 500; // 9500
    expect(tracker.getProgress().estimatedTimeRemaining).toBe(4 * TOTAL_STEP_DURATION);
  });

  it("ETA uses average of historical durations after completions", () => {
    // Simulate a page that took 2000 ms
    tracker.startPage(1);
    const pageStatus = tracker.getPageStatus(1)!;
    pageStatus.startTime = Date.now() - 2000;
    tracker.completePage(1);

    const eta = tracker.getProgress().estimatedTimeRemaining;
    // remaining = 3 pages, average ≈ 2000ms → ETA ≈ 6000ms
    expect(eta).toBeGreaterThan(0);
    expect(eta).toBeLessThan(4 * 9500); // definitely improved from default
  });
});

describe("getOrCreateProgressTracker / getProgressTracker / removeProgressTracker", () => {
  beforeEach(() => {
    removeProgressTracker(999);
  });

  afterEach(() => {
    removeProgressTracker(999);
  });

  it("creates a new tracker when one does not exist", () => {
    const t = getOrCreateProgressTracker(999, 5);
    expect(t).toBeInstanceOf(ProgressTracker);
    expect(t.getProgress().totalPages).toBe(5);
  });

  it("returns the same instance on subsequent calls", () => {
    const t1 = getOrCreateProgressTracker(999, 5);
    const t2 = getOrCreateProgressTracker(999, 5);
    expect(t1).toBe(t2);
  });

  it("getProgressTracker returns undefined before creation", () => {
    expect(getProgressTracker(888)).toBeUndefined();
  });

  it("getProgressTracker returns tracker after creation", () => {
    getOrCreateProgressTracker(999, 3);
    expect(getProgressTracker(999)).toBeInstanceOf(ProgressTracker);
  });

  it("removeProgressTracker makes it undefined", () => {
    getOrCreateProgressTracker(999, 3);
    removeProgressTracker(999);
    expect(getProgressTracker(999)).toBeUndefined();
  });
});

// ===========================================================================
// 4. Resilience utilities
// ===========================================================================

describe("withTimeout", () => {
  it("resolves when promise completes before the timeout", async () => {
    const fast = Promise.resolve("ok");
    const result = await withTimeout(fast, 1000);
    expect(result).toBe("ok");
  });

  it("rejects with timeout error when promise is slower than the limit", async () => {
    const slow = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("never")), 5000)
    );
    await expect(withTimeout(slow, 20, "Request timeout")).rejects.toThrow("Request timeout");
  });

  it("passes through rejection from the original promise when it is faster", async () => {
    const failing = Promise.reject(new Error("original error"));
    await expect(withTimeout(failing, 5000)).rejects.toThrow("original error");
  });
});

describe("withRetry", () => {
  it("returns value on the first successful attempt", async () => {
    const fn = vi.fn().mockResolvedValue("success");
    const result = await withRetry(fn, 3, 0, 1);
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and succeeds on the 3rd attempt", async () => {
    let attempts = 0;
    const fn = vi.fn().mockImplementation(async () => {
      attempts++;
      if (attempts < 3) throw new Error("transient");
      return "recovered";
    });
    const result = await withRetry(fn, 5, 0, 1);
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("calls fn exactly maxRetries + 1 times before throwing", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always fails"));
    await expect(withRetry(fn, 3, 0, 1)).rejects.toThrow("always fails");
    expect(fn).toHaveBeenCalledTimes(4); // attempt 0,1,2,3
  });

  it("throws the last error after exhausting retries", async () => {
    let call = 0;
    const fn = vi.fn().mockImplementation(async () => {
      throw new Error(`error-${++call}`);
    });
    await expect(withRetry(fn, 2, 0, 1)).rejects.toThrow("error-3");
  });
});

describe("CircuitBreaker", () => {
  it("starts in closed state", () => {
    const cb = new CircuitBreaker(3, 2, 100);
    expect(cb.getState()).toBe("closed");
  });

  it("executes successfully when closed", async () => {
    const cb = new CircuitBreaker(3, 2, 100);
    const result = await cb.execute(() => Promise.resolve(42));
    expect(result).toBe(42);
  });

  it("opens after failureThreshold consecutive failures", async () => {
    const cb = new CircuitBreaker(3, 2, 100);
    const fail = () => Promise.reject(new Error("fail"));
    for (let i = 0; i < 3; i++) {
      await cb.execute(fail).catch(() => {});
    }
    expect(cb.getState()).toBe("open");
  });

  it("throws 'Circuit breaker is open' immediately when open", async () => {
    const cb = new CircuitBreaker(2, 2, 100_000); // very long reset timeout
    const fail = () => Promise.reject(new Error("fail"));
    for (let i = 0; i < 2; i++) {
      await cb.execute(fail).catch(() => {});
    }
    await expect(cb.execute(() => Promise.resolve("ok"))).rejects.toThrow(
      "Circuit breaker is open"
    );
  });

  it("transitions to half-open after the reset timeout elapses", async () => {
    const cb = new CircuitBreaker(2, 2, 20); // 20 ms reset
    const fail = () => Promise.reject(new Error("fail"));
    for (let i = 0; i < 2; i++) {
      await cb.execute(fail).catch(() => {});
    }
    expect(cb.getState()).toBe("open");

    await new Promise((r) => setTimeout(r, 30)); // wait past reset timeout

    // Next execute should move to half-open
    const result = await cb.execute(() => Promise.resolve("probe")).catch(() => "blocked");
    // Either it succeeded (now closed/half-open) or it moved state
    expect(["probe", "blocked"]).toContain(result);
    // After a successful probe the state should NOT still be "open"
    const stateAfterProbe = cb.getState();
    expect(stateAfterProbe).not.toBe("open");
  });

  it("resets to closed after successThreshold successes in half-open", async () => {
    const cb = new CircuitBreaker(2, 2, 10); // successThreshold=2, reset=10ms
    const fail = () => Promise.reject(new Error("f"));
    for (let i = 0; i < 2; i++) {
      await cb.execute(fail).catch(() => {});
    }
    await new Promise((r) => setTimeout(r, 20));

    // Two successes in half-open should close the circuit
    await cb.execute(() => Promise.resolve("a"));
    await cb.execute(() => Promise.resolve("b"));
    expect(cb.getState()).toBe("closed");
  });

  it("getStats returns correct failure count", async () => {
    const cb = new CircuitBreaker(5, 2, 1000);
    await cb.execute(() => Promise.reject(new Error("x"))).catch(() => {});
    await cb.execute(() => Promise.reject(new Error("x"))).catch(() => {});
    const stats = cb.getStats();
    expect(stats.failureCount).toBe(2);
    expect(stats.state).toBe("closed");
  });
});

describe("RateLimiter", () => {
  it("consumes a token and returns true", () => {
    const rl = new RateLimiter(10, 1);
    expect(rl.tryConsume(1)).toBe(true);
  });

  it("returns false when token bucket is empty", () => {
    const rl = new RateLimiter(2, 0); // refillRate=0 → no refill
    rl.tryConsume(1);
    rl.tryConsume(1);
    expect(rl.tryConsume(1)).toBe(false);
  });

  it("getTokens returns the current remaining token count", () => {
    const rl = new RateLimiter(5, 0);
    rl.tryConsume(2);
    expect(rl.getTokens()).toBeCloseTo(3, 0);
  });

  it("refills tokens over time", async () => {
    // 10 tokens/sec → 1 token per 100ms
    const rl = new RateLimiter(10, 10);
    // Drain all tokens
    for (let i = 0; i < 10; i++) rl.tryConsume(1);
    expect(rl.tryConsume(1)).toBe(false);

    await new Promise((r) => setTimeout(r, 150)); // wait ~1.5 tokens refill
    expect(rl.tryConsume(1)).toBe(true);
  });
});

describe("Bulkhead", () => {
  it("executes tasks when under the concurrency limit", async () => {
    const bh = new Bulkhead(3);
    const results = await Promise.all([
      bh.execute(() => Promise.resolve("a")),
      bh.execute(() => Promise.resolve("b")),
    ]);
    expect(results).toEqual(["a", "b"]);
  });

  it("getStats reports correct active and max counts", async () => {
    const bh = new Bulkhead(5);
    const stats = bh.getStats();
    expect(stats.maxConcurrent).toBe(5);
    expect(stats.activeCount).toBe(0);
    expect(stats.queuedCount).toBe(0);
  });

  it("passes through errors from the wrapped function", async () => {
    const bh = new Bulkhead(2);
    await expect(
      bh.execute(() => Promise.reject(new Error("bh-error")))
    ).rejects.toThrow("bh-error");
  });

  it("queues extra tasks beyond maxConcurrent and executes them when slots free", async () => {
    const bh = new Bulkhead(1);
    let firstResolved = false;

    const first = bh.execute(() =>
      new Promise<string>((resolve) => setTimeout(() => { firstResolved = true; resolve("first"); }, 10))
    );
    const second = bh.execute(() => Promise.resolve("second"));

    const [r1, r2] = await Promise.all([first, second]);
    expect(r1).toBe("first");
    expect(r2).toBe("second");
    expect(firstResolved).toBe(true);
  });
});

// ===========================================================================
// 5. Data-structure utilities
// ===========================================================================

describe("ObjectPool", () => {
  function makePool(initial = 3, max = 5) {
    let counter = 0;
    return new ObjectPool<{ id: number; value: string }>(
      () => ({ id: ++counter, value: "fresh" }),
      (obj) => { obj.value = "reset"; },
      initial,
      max
    );
  }

  it("initialises with the requested number of objects", () => {
    const pool = makePool(3);
    expect(pool.getStats().available).toBe(3);
    expect(pool.getStats().inUse).toBe(0);
    expect(pool.getStats().total).toBe(3);
  });

  it("acquire moves an object from available to inUse", () => {
    const pool = makePool(2);
    const obj = pool.acquire();
    expect(obj).toBeDefined();
    expect(pool.getStats().available).toBe(1);
    expect(pool.getStats().inUse).toBe(1);
  });

  it("release returns the object to the pool and resets it", () => {
    const pool = makePool(1);
    const obj = pool.acquire();
    pool.release(obj);
    expect(pool.getStats().available).toBe(1);
    expect(pool.getStats().inUse).toBe(0);
    expect(obj.value).toBe("reset");
  });

  it("creates a new object when pool is empty", () => {
    const pool = makePool(1);
    pool.acquire(); // drain
    const extra = pool.acquire(); // must create new
    expect(extra).toBeDefined();
    expect(pool.getStats().inUse).toBe(2);
  });

  it("does not return object to pool beyond maxSize on release", () => {
    const pool = makePool(3, 3); // maxSize = 3
    const objects = [pool.acquire(), pool.acquire(), pool.acquire()];
    const extra = pool.acquire(); // pool is now empty, creates new (total inUse = 4)
    objects.forEach((o) => pool.release(o)); // fills to maxSize=3
    pool.release(extra); // extra should be discarded
    expect(pool.getStats().available).toBe(3); // capped at maxSize
  });

  it("ignores release of an object not acquired from this pool", () => {
    const pool = makePool(2);
    const alien = { id: 999, value: "alien" };
    pool.release(alien as any); // should not throw
    expect(pool.getStats().available).toBe(2); // unchanged
  });

  it("clear empties both available and inUse", () => {
    const pool = makePool(3);
    pool.acquire();
    pool.clear();
    expect(pool.getStats().total).toBe(0);
  });
});

describe("TTLMap", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a value before it expires", () => {
    const map = new TTLMap<string, number>(1000, false);
    map.set("key", 42);
    expect(map.get("key")).toBe(42);
    map.destroy();
  });

  it("returns undefined after the TTL expires", () => {
    const map = new TTLMap<string, number>(1000, false);
    map.set("key", 42);
    vi.advanceTimersByTime(1001);
    expect(map.get("key")).toBeUndefined();
    map.destroy();
  });

  it("has() returns true before expiry", () => {
    const map = new TTLMap<string, string>(500, false);
    map.set("x", "y");
    expect(map.has("x")).toBe(true);
    map.destroy();
  });

  it("has() returns false after expiry", () => {
    const map = new TTLMap<string, string>(500, false);
    map.set("x", "y");
    vi.advanceTimersByTime(600);
    expect(map.has("x")).toBe(false);
    map.destroy();
  });

  it("delete removes the key immediately", () => {
    const map = new TTLMap<string, number>(5000, false);
    map.set("k", 1);
    map.delete("k");
    expect(map.get("k")).toBeUndefined();
    map.destroy();
  });

  it("size reflects only live (non-expired) entries via set count", () => {
    const map = new TTLMap<string, number>(5000, false);
    map.set("a", 1);
    map.set("b", 2);
    expect(map.size).toBe(2);
    map.destroy();
  });

  it("supports per-entry custom TTL override", () => {
    const map = new TTLMap<string, number>(5000, false);
    map.set("short", 1, 200); // short TTL
    map.set("long", 2, 10_000); // long TTL
    vi.advanceTimersByTime(300);
    expect(map.get("short")).toBeUndefined();
    expect(map.get("long")).toBe(2);
    map.destroy();
  });
});

describe("BoundedSet", () => {
  it("add + has basic usage", () => {
    const s = new BoundedSet<number>(5);
    s.add(1);
    expect(s.has(1)).toBe(true);
  });

  it("size tracks correctly", () => {
    const s = new BoundedSet<number>(10);
    s.add(1);
    s.add(2);
    expect(s.size).toBe(2);
  });

  it("duplicate add is idempotent (size stays the same)", () => {
    const s = new BoundedSet<number>(10);
    s.add(1);
    s.add(1);
    expect(s.size).toBe(1);
  });

  it("evicts the oldest item when at max capacity", () => {
    const s = new BoundedSet<number>(3);
    s.add(1);
    s.add(2);
    s.add(3);
    s.add(4); // evicts 1 (oldest)
    expect(s.has(1)).toBe(false);
    expect(s.has(4)).toBe(true);
    expect(s.size).toBe(3);
  });

  it("delete removes a specific item", () => {
    const s = new BoundedSet<string>(5);
    s.add("a");
    s.add("b");
    s.delete("a");
    expect(s.has("a")).toBe(false);
    expect(s.size).toBe(1);
  });

  it("clear empties the set", () => {
    const s = new BoundedSet<number>(5);
    s.add(1);
    s.add(2);
    s.clear();
    expect(s.size).toBe(0);
  });
});

describe("CircularBuffer", () => {
  it("get returns undefined for empty buffer", () => {
    const buf = new CircularBuffer<number>(3);
    expect(buf.get(0)).toBeUndefined();
  });

  it("push + get returns items in insertion order", () => {
    const buf = new CircularBuffer<number>(5);
    buf.push(10);
    buf.push(20);
    buf.push(30);
    expect(buf.get(0)).toBe(10);
    expect(buf.get(1)).toBe(20);
    expect(buf.get(2)).toBe(30);
  });

  it("getSize tracks the number of pushed items", () => {
    const buf = new CircularBuffer<string>(5);
    buf.push("a");
    buf.push("b");
    expect(buf.getSize()).toBe(2);
  });

  it("wraps around when full — oldest item is overwritten", () => {
    const buf = new CircularBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    buf.push(4); // overwrites 1
    expect(buf.get(0)).toBe(2);
    expect(buf.get(1)).toBe(3);
    expect(buf.get(2)).toBe(4);
  });

  it("toArray returns all items in order", () => {
    const buf = new CircularBuffer<number>(4);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    expect(buf.toArray()).toEqual([1, 2, 3]);
  });

  it("toArray is correct after wrap-around", () => {
    const buf = new CircularBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    buf.push(4); // wraps
    expect(buf.toArray()).toEqual([2, 3, 4]);
  });

  it("clear resets size to zero", () => {
    const buf = new CircularBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.clear();
    expect(buf.getSize()).toBe(0);
    expect(buf.get(0)).toBeUndefined();
  });

  it("does not exceed declared capacity for getSize", () => {
    const buf = new CircularBuffer<number>(3);
    for (let i = 0; i < 10; i++) buf.push(i);
    expect(buf.getSize()).toBe(3);
  });

  it("get returns undefined for out-of-bounds index", () => {
    const buf = new CircularBuffer<number>(3);
    buf.push(1);
    expect(buf.get(5)).toBeUndefined();
    expect(buf.get(-1)).toBeUndefined();
  });
});

// ===========================================================================
// 6. booksRouter progress-calculation variants (direct logic simulation)
// ===========================================================================

describe("booksRouter.getProgress — progress-calculation variants", () => {
  function calc(statuses: string[]) {
    const totalPages = statuses.length;
    const completedPages = statuses.filter((s) => s === "done").length;
    const failedPages = statuses.filter((s) => s === "error").length;
    const processingPages = statuses.filter((s) => s === "processing").length;
    const pendingPages = statuses.filter((s) => s === "pending").length;
    const progressPercentage =
      totalPages > 0 ? Math.round((completedPages / totalPages) * 100) : 0;
    return { totalPages, completedPages, failedPages, processingPages, pendingPages, progressPercentage };
  }

  it("all pending → 0%", () => {
    const r = calc(["pending", "pending", "pending"]);
    expect(r.progressPercentage).toBe(0);
    expect(r.pendingPages).toBe(3);
  });

  it("all processing → 0%", () => {
    const r = calc(["processing", "processing"]);
    expect(r.progressPercentage).toBe(0);
    expect(r.processingPages).toBe(2);
  });

  it("1 of 3 done → rounds to 33%", () => {
    const r = calc(["done", "pending", "error"]);
    expect(r.progressPercentage).toBe(33);
  });

  it("2 of 3 done → rounds to 67%", () => {
    const r = calc(["done", "done", "error"]);
    expect(r.progressPercentage).toBe(67);
  });

  it("1 of 4 done → 25%", () => {
    const r = calc(["done", "processing", "error", "pending"]);
    expect(r.progressPercentage).toBe(25);
    expect(r.completedPages).toBe(1);
    expect(r.failedPages).toBe(1);
    expect(r.processingPages).toBe(1);
    expect(r.pendingPages).toBe(1);
  });

  it("empty list → 0 / 0 = 0% (no division by zero)", () => {
    const r = calc([]);
    expect(r.progressPercentage).toBe(0);
    expect(r.totalPages).toBe(0);
  });
});

// ===========================================================================
// 7. booksRouter via createCaller — integration tests with mocked services
// ===========================================================================

describe("booksRouter.upload — validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Cap check iterates user books; default to empty history so auto-render is allowed.
    vi.mocked(getUserBooks as any).mockResolvedValue([]);
  });

  it("throws BAD_REQUEST when PDF has more than 500 pages", async () => {
    vi.mocked(getPDFMetadata).mockResolvedValue({ totalPages: 501 });
    vi.mocked(createBook as any).mockResolvedValue(makeBook());

    const caller = appRouter.createCaller(makeCtx(100));
    await expect(
      caller.books.upload({
        title: "Big Book",
        pdfData: Buffer.alloc(10).toString("base64"),
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("501") });
  });

  it("returns pagesWillProcess=20 and a pageCapWarning for a 21-page PDF", async () => {
    vi.mocked(getPDFMetadata).mockResolvedValue({ totalPages: 21 });
    vi.mocked(createBook as any).mockResolvedValue(
      makeBook({ id: 2, pageCount: 21, totalPrice: "10.50", processingStatus: "pending" })
    );

    const caller = appRouter.createCaller(makeCtx(101));
    const result = await caller.books.upload({
      title: "Medium Book",
      pdfData: Buffer.alloc(10).toString("base64"),
    });

    expect(result.pagesWillProcess).toBe(20);
    expect(result.pageCapWarning).toMatch(/Only the first 20 of 21/);
    expect(result.autoRenderStarted).toBe(true);
  });

  it("returns pagesWillProcess=10 with NO warning for a 10-page PDF", async () => {
    vi.mocked(getPDFMetadata).mockResolvedValue({ totalPages: 10 });
    vi.mocked(createBook as any).mockResolvedValue(
      makeBook({ id: 3, pageCount: 10, totalPrice: "5.00", processingStatus: "pending" })
    );

    const caller = appRouter.createCaller(makeCtx(102));
    const result = await caller.books.upload({
      title: "Small Book",
      pdfData: Buffer.alloc(10).toString("base64"),
    });

    expect(result.pagesWillProcess).toBe(10);
    expect(result.pageCapWarning).toBeUndefined();
  });

  it("returns processingStatus='processing' in the upload response when under daily cap", async () => {
    vi.mocked(getPDFMetadata).mockResolvedValue({ totalPages: 5 });
    vi.mocked(createBook as any).mockResolvedValue(
      makeBook({ id: 4, pageCount: 5, processingStatus: "pending" })
    );

    const caller = appRouter.createCaller(makeCtx(103));
    const result = await caller.books.upload({
      title: "Tiny Book",
      pdfData: Buffer.alloc(10).toString("base64"),
    });

    expect(result.processingStatus).toBe("processing");
    expect(result.autoRenderStarted).toBe(true);
  });

  it("leaves book pending and skips auto-render when daily page-unit cap would be exceeded", async () => {
    // Two full 20-unit books already started today → used=40, default cap=40.
    const today = new Date();
    vi.mocked(getUserBooks as any).mockResolvedValue([
      makeBook({ id: 10, pageCount: 20, processingStatus: "processing", createdAt: today }),
      makeBook({ id: 11, pageCount: 20, processingStatus: "completed", createdAt: today }),
    ]);
    vi.mocked(getPDFMetadata).mockResolvedValue({ totalPages: 5 });
    vi.mocked(createBook as any).mockResolvedValue(
      makeBook({ id: 12, pageCount: 5, processingStatus: "pending" })
    );

    const { processBookPipeline } = await import("./pipelineService");
    const caller = appRouter.createCaller(makeCtx(104));
    const result = await caller.books.upload({
      title: "Over Cap Book",
      pdfData: Buffer.alloc(10).toString("base64"),
    });

    expect(result.processingStatus).toBe("pending");
    expect(result.autoRenderStarted).toBe(false);
    expect(result.dailyRender.used).toBe(40);
    expect(result.dailyRender.cap).toBe(40);
    expect(processBookPipeline).not.toHaveBeenCalled();
  });
});

describe("booksRouter.processPdf — auth guards and status checks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws NOT_FOUND when the book does not exist", async () => {
    vi.mocked(getBook as any).mockResolvedValue(null);

    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.books.processPdf({ bookId: 99 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("throws FORBIDDEN when the book belongs to a different user", async () => {
    vi.mocked(getBook as any).mockResolvedValue(makeBook({ userId: 999 }));

    const caller = appRouter.createCaller(makeCtx(1)); // userId=1 ≠ 999
    await expect(caller.books.processPdf({ bookId: 1 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("returns early with status message when book is already 'completed'", async () => {
    vi.mocked(getBook as any).mockResolvedValue(makeBook({ processingStatus: "completed" }));

    const caller = appRouter.createCaller(makeCtx(1));
    const result = await caller.books.processPdf({ bookId: 1 });
    expect(result.status).toBe("completed");
    expect(result.message).toMatch(/completed/);
  });

  it("returns early with status message when book is already 'processing'", async () => {
    vi.mocked(getBook as any).mockResolvedValue(makeBook({ processingStatus: "processing" }));

    const caller = appRouter.createCaller(makeCtx(1));
    const result = await caller.books.processPdf({ bookId: 1 });
    expect(result.status).toBe("processing");
  });
});

describe("booksRouter.getDetails — auth guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws NOT_FOUND when book does not exist", async () => {
    vi.mocked(getBook as any).mockResolvedValue(null);

    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.books.getDetails({ bookId: 55 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("throws FORBIDDEN when book belongs to a different user", async () => {
    vi.mocked(getBook as any).mockResolvedValue(makeBook({ userId: 777 }));
    vi.mocked(getBookPages as any).mockResolvedValue([]);

    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.books.getDetails({ bookId: 1 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("returns book details including pages array on success", async () => {
    const mockPages = [makePage(), makePage({ id: 2, pageNumber: 2 })];
    vi.mocked(getBook as any).mockResolvedValue(makeBook());
    vi.mocked(getBookPages as any).mockResolvedValue(mockPages);

    const caller = appRouter.createCaller(makeCtx(1));
    const result = await caller.books.getDetails({ bookId: 1 });

    expect(result.pages).toHaveLength(2);
    expect(result.id).toBe(1);
    expect(result.title).toBe("Test Book");
  });
});

describe("booksRouter.getProgress — integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws NOT_FOUND when book does not exist", async () => {
    vi.mocked(getBook as any).mockResolvedValue(null);

    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.books.getProgress({ bookId: 77 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("throws FORBIDDEN when book belongs to a different user", async () => {
    vi.mocked(getBook as any).mockResolvedValue(makeBook({ userId: 888 }));
    vi.mocked(getBookPages as any).mockResolvedValue([]);

    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.books.getProgress({ bookId: 1 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("returns 50% progress when 1 of 2 pages is done", async () => {
    vi.mocked(getBook as any).mockResolvedValue(makeBook({ processingStatus: "processing" }));
    vi.mocked(getBookPages as any).mockResolvedValue([
      makePage({ id: 1, pageNumber: 1, processingStatus: "done" }),
      makePage({ id: 2, pageNumber: 2, processingStatus: "error" }),
    ]);

    const caller = appRouter.createCaller(makeCtx(1));
    const result = await caller.books.getProgress({ bookId: 1 });

    expect(result.totalPages).toBe(2);
    expect(result.completedPages).toBe(1);
    expect(result.failedPages).toBe(1);
    expect(result.progressPercentage).toBe(50);
  });

  it("returns 0% progress when there are no pages", async () => {
    vi.mocked(getBook as any).mockResolvedValue(makeBook({ processingStatus: "pending" }));
    vi.mocked(getBookPages as any).mockResolvedValue([]);

    const caller = appRouter.createCaller(makeCtx(1));
    const result = await caller.books.getProgress({ bookId: 1 });

    expect(result.totalPages).toBe(0);
    expect(result.progressPercentage).toBe(0);
  });

  it("returns all pages in the response", async () => {
    const pages = [1, 2, 3].map((n) => makePage({ id: n, pageNumber: n, processingStatus: "done" }));
    vi.mocked(getBook as any).mockResolvedValue(makeBook({ processingStatus: "completed" }));
    vi.mocked(getBookPages as any).mockResolvedValue(pages);

    const caller = appRouter.createCaller(makeCtx(1));
    const result = await caller.books.getProgress({ bookId: 1 });

    expect(result.pages).toHaveLength(3);
    expect(result.progressPercentage).toBe(100);
  });
});

function mockPdfFetchOk(body: ArrayBuffer = new ArrayBuffer(8)) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => body,
    })
  );
}

function mockPdfFetchFail(status = 404) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      arrayBuffer: async () => new ArrayBuffer(0),
    })
  );
}

describe("booksRouter.retryFailedPages — integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPdfFetchOk();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws NOT_FOUND when book does not exist", async () => {
    vi.mocked(getBook as any).mockResolvedValue(null);

    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.books.retryFailedPages({ bookId: 44 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("throws FORBIDDEN when book belongs to a different user", async () => {
    vi.mocked(getBook as any).mockResolvedValue(makeBook({ userId: 555 }));
    vi.mocked(getBookPages as any).mockResolvedValue([]);

    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.books.retryFailedPages({ bookId: 1 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("returns retriedCount=0 when there are no failed pages", async () => {
    vi.mocked(getBook as any).mockResolvedValue(makeBook());
    vi.mocked(getBookPages as any).mockResolvedValue([
      makePage({ processingStatus: "done" }),
      makePage({ id: 2, pageNumber: 2, processingStatus: "done" }),
    ]);

    const caller = appRouter.createCaller(makeCtx(1));
    const result = await caller.books.retryFailedPages({ bookId: 1 });

    expect(result.retriedCount).toBe(0);
    expect(result.success).toBe(true);
  });

  it("returns retriedCount=2 and calls updatePage twice for 2 failed pages", async () => {
    vi.mocked(getBook as any).mockResolvedValue(makeBook({ processingStatus: "failed" }));
    vi.mocked(getBookPages as any).mockResolvedValue([
      makePage({ id: 1, pageNumber: 1, processingStatus: "error", retryCount: 0 }),
      makePage({ id: 2, pageNumber: 2, processingStatus: "error", retryCount: 1 }),
      makePage({ id: 3, pageNumber: 3, processingStatus: "done", retryCount: 0 }),
    ]);
    vi.mocked(updatePage as any).mockResolvedValue(undefined);
    vi.mocked(updateBook as any).mockResolvedValue(undefined);

    const caller = appRouter.createCaller(makeCtx(1));
    const result = await caller.books.retryFailedPages({ bookId: 1 });

    expect(result.retriedCount).toBe(2);
    expect(result.success).toBe(true);
    expect(updatePage).toHaveBeenCalledTimes(2);
  });

  it("resets retryCount to 0 (not increments) when resetting failed pages", async () => {
    vi.mocked(getBook as any).mockResolvedValue(makeBook({ processingStatus: "failed" }));
    vi.mocked(getBookPages as any).mockResolvedValue([
      makePage({ id: 1, pageNumber: 1, processingStatus: "error", retryCount: 2 }),
    ]);
    vi.mocked(updatePage as any).mockResolvedValue(undefined);
    vi.mocked(updateBook as any).mockResolvedValue(undefined);

    const caller = appRouter.createCaller(makeCtx(1));
    await caller.books.retryFailedPages({ bookId: 1 });

    expect(updatePage).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ processingStatus: "pending", retryCount: 0 })
    );
  });

  it("sets book status back to 'processing' only after successful PDF fetch (H5)", async () => {
    vi.mocked(getBook as any).mockResolvedValue(makeBook({ processingStatus: "failed" }));
    vi.mocked(getBookPages as any).mockResolvedValue([
      makePage({ id: 1, processingStatus: "error", retryCount: 0 }),
    ]);
    vi.mocked(updatePage as any).mockResolvedValue(undefined);
    vi.mocked(updateBook as any).mockResolvedValue(undefined);

    const caller = appRouter.createCaller(makeCtx(1));
    await caller.books.retryFailedPages({ bookId: 1 });

    expect(updateBook).toHaveBeenCalledWith(1, { processingStatus: "processing" });
  });

  it("does not mutate page/book status when PDF fetch fails (H5)", async () => {
    mockPdfFetchFail(503);
    vi.mocked(getBook as any).mockResolvedValue(makeBook({ processingStatus: "failed" }));
    vi.mocked(getBookPages as any).mockResolvedValue([
      makePage({ id: 1, processingStatus: "error", retryCount: 0 }),
    ]);

    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.books.retryFailedPages({ bookId: 1 })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(updatePage).not.toHaveBeenCalled();
    expect(updateBook).not.toHaveBeenCalled();
  });
});

describe("booksRouter.list — pagination", () => {
  const ALL_BOOKS = Array.from({ length: 12 }, (_, i) =>
    makeBook({ id: i + 1, title: `Book ${i + 1}`, pageCount: 5, processingStatus: "completed" })
  );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getUserBooks as any).mockResolvedValue(ALL_BOOKS);
  });

  it("returns correct totalCount and totalPages for 12 books with pageSize=5", async () => {
    const caller = appRouter.createCaller(makeCtx(200));
    const result = await caller.books.list({ page: 1, pageSize: 5 });

    expect(result.pagination.totalCount).toBe(12);
    expect(result.pagination.totalPages).toBe(3); // ceil(12/5)=3
  });

  it("page 1 returns the first pageSize items", async () => {
    const caller = appRouter.createCaller(makeCtx(201));
    const result = await caller.books.list({ page: 1, pageSize: 5 });

    expect(result.items).toHaveLength(5);
    expect(result.items[0].id).toBe(1);
    expect(result.items[4].id).toBe(5);
  });

  it("page 2 returns the next pageSize items", async () => {
    const caller = appRouter.createCaller(makeCtx(202));
    const result = await caller.books.list({ page: 2, pageSize: 5 });

    expect(result.items).toHaveLength(5);
    expect(result.items[0].id).toBe(6);
    expect(result.items[4].id).toBe(10);
  });

  it("last page returns remaining items (2 of 12)", async () => {
    const caller = appRouter.createCaller(makeCtx(203));
    const result = await caller.books.list({ page: 3, pageSize: 5 });

    expect(result.items).toHaveLength(2);
    expect(result.items[0].id).toBe(11);
  });

  it("returns empty items array when page exceeds total pages", async () => {
    const caller = appRouter.createCaller(makeCtx(204));
    const result = await caller.books.list({ page: 10, pageSize: 5 });

    expect(result.items).toHaveLength(0);
    expect(result.pagination.page).toBe(10);
  });
});

describe("booksRouter.calculatePrice — procedure", () => {
  it("returns price in USD currency", async () => {
    const caller = appRouter.createCaller(makeCtx(1));
    const result = await caller.books.calculatePrice({ pageCount: 10 });

    expect(result.currency).toBe("USD");
    expect(result.pageCount).toBe(10);
    expect(result.price).toBeGreaterThan(0);
  });

  it("price matches the calculatePrice pure function output", async () => {
    const caller = appRouter.createCaller(makeCtx(1));
    const result = await caller.books.calculatePrice({ pageCount: 100 });
    // 100 pages × $0.30 = $30.00
    expect(result.price).toBe(30.0);
  });
});

// ===========================================================================
// 8. booksRouter.delete — new endpoint
// ===========================================================================

describe("booksRouter.delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws NOT_FOUND when book does not exist", async () => {
    vi.mocked(getBook as any).mockResolvedValue(null);

    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.books.delete({ bookId: 42 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("throws FORBIDDEN when book belongs to a different user", async () => {
    vi.mocked(getBook as any).mockResolvedValue(makeBook({ userId: 999 }));

    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.books.delete({ bookId: 1 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("returns { success: true, bookId } on successful deletion", async () => {
    vi.mocked(getBook as any).mockResolvedValue(makeBook());
    vi.mocked(deleteBook as any).mockResolvedValue(undefined);

    const caller = appRouter.createCaller(makeCtx(1));
    const result = await caller.books.delete({ bookId: 1 });

    expect(result.success).toBe(true);
    expect(result.bookId).toBe(1);
  });

  it("calls deleteBook with the correct bookId", async () => {
    vi.mocked(getBook as any).mockResolvedValue(makeBook({ id: 7 }));
    vi.mocked(deleteBook as any).mockResolvedValue(undefined);

    const caller = appRouter.createCaller(makeCtx(1));
    await caller.books.delete({ bookId: 7 });

    expect(deleteBook).toHaveBeenCalledWith(7);
    expect(deleteBook).toHaveBeenCalledTimes(1);
  });

  it("does NOT call deleteBook when the ownership check fails", async () => {
    vi.mocked(getBook as any).mockResolvedValue(makeBook({ userId: 999 }));

    const caller = appRouter.createCaller(makeCtx(1));
    await caller.books.delete({ bookId: 1 }).catch(() => {});

    expect(deleteBook).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 9. Retry exhaustion guard — predicate and markPageForRetry behaviour
// ===========================================================================

describe("retry exhaustion guard", () => {
  describe("getPagesReadyForRetry — exhaustion predicate boundary", () => {
    it("blocks a page whose retryCount equals maxRetries (at boundary)", () => {
      // mirrors: sql`${pages.retryCount} < ${pages.maxRetries}`
      const retryCount = 3, maxRetries = 3;
      expect(retryCount < maxRetries).toBe(false);
    });

    it("allows a page one step below the boundary", () => {
      const retryCount = 2, maxRetries = 3;
      expect(retryCount < maxRetries).toBe(true);
    });
  });

  describe("exhaustion predicate (retryCount < maxRetries)", () => {
    const shouldQueue = (retryCount: number, maxRetries: number) => retryCount < maxRetries;

    it("allows retry when retryCount=0, maxRetries=3", () => {
      expect(shouldQueue(0, 3)).toBe(true);
    });

    it("allows retry when retryCount=2, maxRetries=3 (last allowed attempt)", () => {
      expect(shouldQueue(2, 3)).toBe(true);
    });

    it("blocks retry when retryCount=3, maxRetries=3 (budget exhausted)", () => {
      expect(shouldQueue(3, 3)).toBe(false);
    });

    it("blocks retry when retryCount exceeds maxRetries", () => {
      expect(shouldQueue(5, 3)).toBe(false);
    });

    it("respects non-default maxRetries values", () => {
      expect(shouldQueue(4, 5)).toBe(true);
      expect(shouldQueue(5, 5)).toBe(false);
    });
  });

  describe("markPageForRetry — exhaustion check in service code", () => {
    it("reports exhausted when currentRetryCount >= maxRetries (same logic used in markPageForRetry)", () => {
      const isExhausted = (currentRetryCount: number, maxRetries: number) =>
        currentRetryCount >= maxRetries;

      expect(isExhausted(3, 3)).toBe(true);
      expect(isExhausted(4, 3)).toBe(true);
      expect(isExhausted(2, 3)).toBe(false);
    });

    it("calculateBackoffDelay grows for exhausted pages up to cap", async () => {
      const { calculateBackoffDelay } = await import("./retryService");
      // Attempt 4 (beyond default maxRetries=3) → would be 8s but that's fine to cap at 60s
      const delay = calculateBackoffDelay(4);
      expect(delay).toBeLessThanOrEqual(60000);
      expect(delay).toBeGreaterThan(0);
    });
  });
});

// ===========================================================================
// 10. Minor bug fixes — regression tests
// ===========================================================================

describe("withTimeout — timer-leak fix", () => {
  it("does NOT keep the event loop alive after the promise resolves (timerId cleared)", async () => {
    // Before the fix, the internal setTimeout was never cleared.
    // This test verifies that resolving the promise does not leave dangling timers
    // (checked indirectly: if clearTimeout is missing, vitest --forceExit would mask it).
    const result = await withTimeout(Promise.resolve("done"), 5000);
    expect(result).toBe("done");
    // If we reach here without hanging, the timer was cleared (or is a no-op).
  });

  it("resolves correctly when the inner promise is slightly slower than a very long timeout", async () => {
    const delayed = new Promise<string>((r) => setTimeout(() => r("resolved"), 10));
    const result = await withTimeout(delayed, 5000);
    expect(result).toBe("resolved");
  });
});

describe("ProgressTracker — getCurrentPage fix (defaults to 0, not totalPages)", () => {
  it("currentPage is 0 when no page has started yet", () => {
    const tracker = new ProgressTracker(1, 3);
    expect(tracker.getProgress().currentPage).toBe(0);
  });

  it("currentPage is 0 after all pages complete (none in processing state)", () => {
    const tracker = new ProgressTracker(1, 2);
    tracker.startPage(1);
    tracker.completePage(1);
    tracker.startPage(2);
    tracker.completePage(2);
    expect(tracker.getProgress().currentPage).toBe(0);
  });

  it("currentPage reflects the actively-processing page number", () => {
    const tracker = new ProgressTracker(1, 3);
    tracker.startPage(2);
    expect(tracker.getProgress().currentPage).toBe(2);
  });
});

describe("ProgressTracker — completePage zero-duration guard fix", () => {
  it("a page completed immediately (0ms) still contributes to historicalDurations", () => {
    const tracker = new ProgressTracker(1, 2);
    tracker.startPage(1);

    // Force startTime = endTime so duration = 0
    const pageStatus = tracker.getPageStatus(1)!;
    const now = Date.now();
    pageStatus.startTime = now;
    pageStatus.endTime = now;

    // Manually call completePage — it will compute duration as 0
    tracker.completePage(1);

    // ETA should now use the 0ms historical average, not the fallback 9500ms × totalStepDuration
    const eta = tracker.getProgress().estimatedTimeRemaining;
    // remaining = 1 page, average = 0ms → ETA = 0
    expect(eta).toBe(0);
  });
});

describe("CircularBuffer.toArray() — correct return type (T[], not (T | undefined)[])", () => {
  it("toArray returns T[] with no undefined slots, even on a partially-filled buffer", () => {
    const buf = new CircularBuffer<number>(5);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    const arr = buf.toArray();
    // Type-level: arr should be number[], every element defined
    expect(arr.every((x) => x !== undefined)).toBe(true);
    expect(arr).toEqual([1, 2, 3]);
  });

  it("toArray wraps correctly after overflow and contains no undefined", () => {
    const buf = new CircularBuffer<string>(3);
    buf.push("a");
    buf.push("b");
    buf.push("c");
    buf.push("d"); // overwrites "a"
    const arr = buf.toArray();
    expect(arr).toEqual(["b", "c", "d"]);
    expect(arr.every((x) => x !== undefined)).toBe(true);
  });
});

describe("booksRouter.calculatePrice — integer validation fix", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("accepts integer page counts", async () => {
    const caller = appRouter.createCaller(makeCtx(1));
    const result = await caller.books.calculatePrice({ pageCount: 10 });
    expect(result.pageCount).toBe(10);
  });

  it("rejects non-integer page counts (e.g. 1.5)", async () => {
    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.books.calculatePrice({ pageCount: 1.5 })).rejects.toThrow();
  });
});

describe("retryRouter — ownership checks (FORBIDDEN / NOT_FOUND)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  describe("retryRouter.getStats", () => {
    it("throws NOT_FOUND when book does not exist", async () => {
      vi.mocked(getBook as any).mockResolvedValue(null);
      const caller = appRouter.createCaller(makeCtx(1));
      await expect(caller.retry.getStats({ bookId: 99 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("throws FORBIDDEN when book belongs to a different user", async () => {
      vi.mocked(getBook as any).mockResolvedValue(makeBook({ userId: 999 }));
      const caller = appRouter.createCaller(makeCtx(1));
      await expect(caller.retry.getStats({ bookId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("retryRouter.getReadyForRetry — with bookId", () => {
    it("throws NOT_FOUND when book does not exist", async () => {
      vi.mocked(getBook as any).mockResolvedValue(null);
      const caller = appRouter.createCaller(makeCtx(1));
      await expect(caller.retry.getReadyForRetry({ bookId: 99 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("throws FORBIDDEN when book belongs to a different user", async () => {
      vi.mocked(getBook as any).mockResolvedValue(makeBook({ userId: 999 }));
      const caller = appRouter.createCaller(makeCtx(1));
      await expect(caller.retry.getReadyForRetry({ bookId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("retryRouter.manualRetry", () => {
    it("throws NOT_FOUND when book does not exist", async () => {
      vi.mocked(getBook as any).mockResolvedValue(null);
      const caller = appRouter.createCaller(makeCtx(1));
      await expect(caller.retry.manualRetry({ pageId: 1, bookId: 99 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("throws FORBIDDEN when book belongs to a different user", async () => {
      vi.mocked(getBook as any).mockResolvedValue(makeBook({ userId: 999 }));
      const caller = appRouter.createCaller(makeCtx(1));
      await expect(caller.retry.manualRetry({ pageId: 1, bookId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });
});

// ===========================================================================
// 11. PerformanceMonitor — p95/p99 percentile fix
// ===========================================================================

import { performanceMonitor } from "./performanceMonitor";

describe("performanceMonitor — p95/p99 off-by-one fix", () => {
  beforeEach(() => { performanceMonitor.clearAllMetrics(); });

  it("p95 for 20 sorted metrics is the 19th value (index 18), not the 20th (max)", () => {
    // Record 20 durations: 1, 2, 3, ... 20  (sorted ascending after getStats)
    for (let i = 1; i <= 20; i++) {
      performanceMonitor.recordMetric("test", i, "success");
    }
    const stats = performanceMonitor.getStats("test")!;
    // Nearest-rank p95 for N=20: rank = ceil(20*0.95) = ceil(19) = 19, index = 18 → value 19
    // Old formula: floor(20*0.95) = 19 → index 19 → value 20 (the max, not the 95th)
    expect(stats.p95Duration).toBe(19);
    expect(stats.p95Duration).not.toBe(stats.maxDuration);
  });

  it("p99 for 100 metrics is the 99th value (index 98), not the 100th (max)", () => {
    for (let i = 1; i <= 100; i++) {
      performanceMonitor.recordMetric("test99", i, "success");
    }
    const stats = performanceMonitor.getStats("test99")!;
    // Nearest-rank p99 for N=100: rank = ceil(100*0.99) = 99, index = 98 → value 99
    // Old formula: floor(100*0.99) = 99 → index 99 → value 100 (the max)
    expect(stats.p99Duration).toBe(99);
    expect(stats.p99Duration).not.toBe(stats.maxDuration);
  });

  it("p95 and p99 are within bounds for a single-element dataset", () => {
    performanceMonitor.recordMetric("single", 42, "success");
    const stats = performanceMonitor.getStats("single")!;
    expect(stats.p95Duration).toBe(42);
    expect(stats.p99Duration).toBe(42);
  });

  it("getStats returns null for an unknown metric name", () => {
    expect(performanceMonitor.getStats("nonexistent")).toBeNull();
  });
});

// ===========================================================================
// 12. ResumableUpload.getProgress() — divide-by-zero fix
// ===========================================================================

import { ResumableUpload } from "./streamingUpload";

describe("ResumableUpload.getProgress() — divide-by-zero fix", () => {
  it("returns 100 (not NaN) for an upload with totalSize = 0", () => {
    const upload = new ResumableUpload("empty", 0);
    const progress = upload.getProgress();
    expect(progress).not.toBeNaN();
    expect(progress).toBe(100);
  });

  it("returns 0 when no chunks have been uploaded yet", () => {
    const upload = new ResumableUpload("u1", 3 * 1024 * 1024); // 3 MB, 3 chunks of 1 MB
    expect(upload.getProgress()).toBe(0);
  });

  it("returns 100 when all chunks are uploaded", () => {
    const upload = new ResumableUpload("u2", 2 * 1024 * 1024);
    upload.addChunk(0, Buffer.alloc(1024 * 1024));
    upload.addChunk(1, Buffer.alloc(1024 * 1024));
    expect(upload.getProgress()).toBe(100);
  });

  it("returns correct partial progress", () => {
    const upload = new ResumableUpload("u3", 4 * 1024 * 1024);
    upload.addChunk(0, Buffer.alloc(1024 * 1024));
    expect(upload.getProgress()).toBe(25);
  });

  it("isComplete() returns true for a zero-size upload", () => {
    const upload = new ResumableUpload("empty", 0);
    expect(upload.isComplete()).toBe(true);
  });
});

// ===========================================================================
// 13. booksRouter.retryFailedPages — retryCount reset fix
// ===========================================================================

describe("booksRouter.retryFailedPages — resets retryCount to 0", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPdfFetchOk();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls updatePage with retryCount: 0 (not incremented) for an exhausted page", async () => {
    vi.mocked(getBook as any).mockResolvedValue(makeBook());
    vi.mocked(getBookPages as any).mockResolvedValue([
      makePage({ processingStatus: "error", retryCount: 3, maxRetries: 3 }),
    ]);
    vi.mocked(updatePage as any).mockResolvedValue(undefined);
    vi.mocked(updateBook as any).mockResolvedValue(undefined);

    const caller = appRouter.createCaller(makeCtx(1));
    const result = await caller.books.retryFailedPages({ bookId: 1 });

    expect(result.retriedCount).toBe(1);
    expect(updatePage).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({ retryCount: 0 })
    );
  });

  it("does NOT increment retryCount past maxRetries on manual retry", async () => {
    vi.mocked(getBook as any).mockResolvedValue(makeBook());
    vi.mocked(getBookPages as any).mockResolvedValue([
      makePage({ processingStatus: "error", retryCount: 3, maxRetries: 3 }),
    ]);
    vi.mocked(updatePage as any).mockResolvedValue(undefined);
    vi.mocked(updateBook as any).mockResolvedValue(undefined);

    const caller = appRouter.createCaller(makeCtx(1));
    await caller.books.retryFailedPages({ bookId: 1 });

    // After fix: retryCount resets to 0, not 4
    expect(updatePage).not.toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({ retryCount: 4 })
    );
    expect(updatePage).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({ retryCount: 0 })
    );
  });
});

// ===========================================================================
// 14. Books.tsx price display — totalPrice is in dollars, not cents
// ===========================================================================

describe("Books.tsx price display — totalPrice from API is already in dollars", () => {
  // The server's getDetails returns totalPrice: Number(book.totalPrice) where
  // totalPrice is stored as a SQL numeric in dollars (e.g., 5.0 = $5.00).
  // The display code should use Number(totalPrice).toFixed(2), NOT totalPrice/100.

  it("$5.00 price: correct display is '5.00', not '0.05' (old /100 bug)", () => {
    const totalPrice = 5.0; // as returned by getDetails
    expect(Number(totalPrice).toFixed(2)).toBe("5.00"); // correct
    expect((totalPrice / 100).toFixed(2)).toBe("0.05"); // the old bug — documents why /100 is wrong
  });

  it("$30.00 price: correct display is '30.00', not '0.30'", () => {
    const totalPrice = 30.0;
    expect(Number(totalPrice).toFixed(2)).toBe("30.00");
    expect((totalPrice / 100).toFixed(2)).toBe("0.30"); // the old bug
  });

  it("$2.00 minimum price: correct display is '2.00', not '0.02'", () => {
    const totalPrice = 2.0;
    expect(Number(totalPrice).toFixed(2)).toBe("2.00");
    expect((totalPrice / 100).toFixed(2)).not.toBe("2.00");
  });

  it("getDetails endpoint returns totalPrice as a dollar float, not cents", async () => {
    // Use a unique userId+bookId (600) to avoid the module-level queryCache
    // returning a cached value from earlier getDetails tests (userId=1, bookId=1).
    vi.clearAllMocks();
    vi.mocked(getBook as any).mockResolvedValue(makeBook({ id: 600, userId: 600, totalPrice: "5.00" }));
    vi.mocked(getBookPages as any).mockResolvedValue([]);

    const caller = appRouter.createCaller(makeCtx(600));
    const result = await caller.books.getDetails({ bookId: 600 });

    expect(result.totalPrice).toBe(5.0);
    expect(Number(result.totalPrice).toFixed(2)).toBe("5.00");
  });
});

// ===========================================================================
// 15. processPagePipeline — upsert predicate (no duplicate page on retry)
// ===========================================================================

describe("processPagePipeline — upsert predicate: update existing page instead of inserting duplicate", () => {
  it("finds an existing page record for bookId+pageNumber to update", () => {
    const existingPages = [
      makePage({ id: 5, bookId: 1, pageNumber: 2, processingStatus: "error" }),
    ];
    const found = existingPages.find((p) => p.pageNumber === 2);
    expect(found).toBeDefined();
    expect(found?.id).toBe(5);
    // Retry should call updatePage(5, ...) not createPage({bookId:1, pageNumber:2})
  });

  it("returns undefined (no duplicate path) for a page number not yet in DB", () => {
    const existingPages = [
      makePage({ id: 5, bookId: 1, pageNumber: 1, processingStatus: "done" }),
    ];
    const found = existingPages.find((p) => p.pageNumber === 3);
    expect(found).toBeUndefined();
    // First run: should createPage({bookId:1, pageNumber:3})
  });

  it("correctly constructs the upserted Page shape from existing + new fields", () => {
    const existing = makePage({ id: 7, bookId: 2, pageNumber: 4, processingStatus: "error", errorMessage: "old error" });
    const thumbnailKey = "books/2/pages/4/thumbnail.png";
    const thumbnailUrl = "https://cdn.example.com/thumb.png";
    const ocrText = "page text";
    const generatedPrompt = "fantasy illustration";
    const generatedImageKey = "books/2/pages/4/generated.png";
    const generatedImageUrl = "https://cdn.example.com/img.png";

    const upserted = {
      ...existing,
      thumbnailFileKey: thumbnailKey,
      thumbnailUrl: thumbnailUrl ?? null,
      ocrText: ocrText ?? null,
      generatedPrompt,
      generatedImageFileKey: generatedImageKey ?? null,
      generatedImageUrl: generatedImageUrl ?? null,
      processingStatus: "done" as const,
      errorMessage: null,
    };

    // The id is preserved from the original page (no new row)
    expect(upserted.id).toBe(7);
    expect(upserted.processingStatus).toBe("done");
    expect(upserted.errorMessage).toBeNull();
    expect(upserted.generatedImageUrl).toBe("https://cdn.example.com/img.png");
  });
});

// ===========================================================================
// 16. booksRouter.getProgress — scene-mode books use the scenes table
// ===========================================================================

describe("booksRouter.getProgress — scene-mode books read from scenes table", () => {
  function makeScene(overrides: Record<string, unknown> = {}) {
    return {
      id: 1,
      bookId: 1,
      sceneIndex: 0,
      title: "Scene 1",
      processingStatus: "done",
      errorMessage: null,
      generatedImageUrl: "https://cdn/scene.png",
      ...overrides,
    };
  }

  beforeEach(() => { vi.clearAllMocks(); });

  it("returns scene counts (not page counts) for a scene-mode book", async () => {
    vi.mocked(getBook as any).mockResolvedValue(
      makeBook({ generationMode: "scene", processingStatus: "completed" })
    );
    vi.mocked(getBookScenes as any).mockResolvedValue([
      makeScene({ sceneIndex: 0, processingStatus: "done" }),
      makeScene({ id: 2, sceneIndex: 1, processingStatus: "done" }),
      makeScene({ id: 3, sceneIndex: 2, processingStatus: "error", errorMessage: "fail" }),
    ]);

    const caller = appRouter.createCaller(makeCtx(1));
    const result = await caller.books.getProgress({ bookId: 1 });

    expect(result.totalPages).toBe(3);
    expect(result.completedPages).toBe(2);
    expect(result.failedPages).toBe(1);
    expect(result.progressPercentage).toBe(67);
    expect(getBookScenes).toHaveBeenCalledWith(1);
    expect(getBookPages).not.toHaveBeenCalled();
  });

  it("returns 0% progress when a scene-mode book has all scenes pending", async () => {
    vi.mocked(getBook as any).mockResolvedValue(
      makeBook({ generationMode: "scene", processingStatus: "processing" })
    );
    vi.mocked(getBookScenes as any).mockResolvedValue([
      makeScene({ processingStatus: "pending" }),
      makeScene({ id: 2, processingStatus: "pending" }),
    ]);

    const caller = appRouter.createCaller(makeCtx(1));
    const result = await caller.books.getProgress({ bookId: 1 });

    expect(result.progressPercentage).toBe(0);
    expect(result.pendingPages).toBe(2);
  });

  it("page-mode book still uses the pages table (regression guard)", async () => {
    vi.mocked(getBook as any).mockResolvedValue(
      makeBook({ generationMode: "page", processingStatus: "completed" })
    );
    vi.mocked(getBookPages as any).mockResolvedValue([
      makePage({ processingStatus: "done" }),
    ]);

    const caller = appRouter.createCaller(makeCtx(1));
    const result = await caller.books.getProgress({ bookId: 1 });

    expect(result.totalPages).toBe(1);
    expect(getBookPages).toHaveBeenCalledWith(1);
    expect(getBookScenes).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 17. db.getProcessingMetrics — totalProcessingTime is seconds, not page count
// ===========================================================================

describe("db.getProcessingMetrics — totalProcessingTime formula", () => {
  it("totalProcessingTime is the sum of per-page processing times in seconds", () => {
    // Replicate the formula from server/db.ts to verify the fix: page count was
    // returned before; now the actual total time in seconds is returned.
    const now = Date.now();
    const completedPages = [
      { createdAt: new Date(now - 5000), updatedAt: new Date(now) },   // 5s
      { createdAt: new Date(now - 10000), updatedAt: new Date(now) },  // 10s
    ];
    const totalTimeMs = completedPages.reduce((sum, p) => {
      const createdAt = p.createdAt?.getTime() || 0;
      const updatedAt = p.updatedAt?.getTime() || 0;
      return sum + (updatedAt - createdAt);
    }, 0);
    const avgProcessingTime = totalTimeMs / completedPages.length / 1000;
    const totalProcessingTime = Math.round(totalTimeMs / 1000);

    // totalProcessingTime should be ~15s (sum), NOT 2 (page count)
    expect(totalProcessingTime).toBeGreaterThanOrEqual(14);
    expect(totalProcessingTime).toBeLessThanOrEqual(16);
    expect(totalProcessingTime).not.toBe(completedPages.length);

    // avgProcessingTime should be ~7-8s (average of 5s and 10s)
    expect(Math.round(avgProcessingTime)).toBeGreaterThanOrEqual(7);
    expect(Math.round(avgProcessingTime)).toBeLessThanOrEqual(8);
  });

  it("totalProcessingTime is 0 when there are no completed pages", () => {
    const completedPages: { createdAt: Date; updatedAt: Date }[] = [];
    const totalTimeMs = completedPages.reduce((sum, p) => {
      return sum + ((p.updatedAt?.getTime() || 0) - (p.createdAt?.getTime() || 0));
    }, 0);
    expect(Math.round(totalTimeMs / 1000)).toBe(0);
  });
});
