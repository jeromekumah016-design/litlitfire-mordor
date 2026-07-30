import { describe, it, expect, beforeEach } from "vitest";
import { ocrCacheService } from "./ocrCacheService";

describe("ocrCacheService", () => {
  beforeEach(() => {
    ocrCacheService.clearAll();
    ocrCacheService.resetStats();
  });

  it("returns undefined for a key that was never cached (miss)", () => {
    expect(ocrCacheService.getCachedResult("hash-a", "key-a")).toBeUndefined();
  });

  it("returns the cached text/confidence after cacheResult (hit)", () => {
    ocrCacheService.cacheResult("hash-a", "key-a", "Once upon a time", 0.91);
    const result = ocrCacheService.getCachedResult("hash-a", "key-a");
    expect(result).toBeDefined();
    expect(result?.text).toBe("Once upon a time");
    expect(result?.confidence).toBe(0.91);
    expect(result?.pageHash).toBe("hash-a");
  });

  it("defaults confidence to 0.95 when not provided", () => {
    ocrCacheService.cacheResult("hash-b", "key-b", "text");
    expect(ocrCacheService.getCachedResult("hash-b", "key-b")?.confidence).toBe(0.95);
  });

  it("treats identical hash with a different scope key as separate entries", () => {
    ocrCacheService.cacheResult("hash-c", "key-1", "text for key 1");
    expect(ocrCacheService.getCachedResult("hash-c", "key-2")).toBeUndefined();
  });

  it("treats identical scope key with a different hash as separate entries", () => {
    ocrCacheService.cacheResult("hash-d", "key-shared", "text d");
    expect(ocrCacheService.getCachedResult("hash-e", "key-shared")).toBeUndefined();
  });

  it("isCached reflects presence without affecting hit/miss stats", () => {
    expect(ocrCacheService.isCached("hash-f", "key-f")).toBe(false);
    ocrCacheService.cacheResult("hash-f", "key-f", "text f");
    expect(ocrCacheService.isCached("hash-f", "key-f")).toBe(true);
    expect(ocrCacheService.getStats().total).toBe(0); // isCached doesn't count as hit/miss
  });

  it("clearEntry removes a single cached result", () => {
    ocrCacheService.cacheResult("hash-g", "key-g", "text g");
    ocrCacheService.clearEntry("hash-g", "key-g");
    expect(ocrCacheService.getCachedResult("hash-g", "key-g")).toBeUndefined();
  });

  it("clearAll empties the whole cache", () => {
    ocrCacheService.cacheResult("hash-h", "key-h", "text h");
    ocrCacheService.cacheResult("hash-i", "key-i", "text i");
    ocrCacheService.clearAll();
    expect(ocrCacheService.getCachedResult("hash-h", "key-h")).toBeUndefined();
    expect(ocrCacheService.getCachedResult("hash-i", "key-i")).toBeUndefined();
  });

  it("tracks hit/miss counts and computes hit rate", () => {
    ocrCacheService.getCachedResult("hash-j", "key-j"); // miss
    ocrCacheService.cacheResult("hash-j", "key-j", "text j");
    ocrCacheService.getCachedResult("hash-j", "key-j"); // hit
    ocrCacheService.getCachedResult("hash-j", "key-j"); // hit
    const stats = ocrCacheService.getStats();
    expect(stats.missCount).toBe(1);
    expect(stats.hitCount).toBe(2);
    expect(stats.total).toBe(3);
    expect(stats.hitRate).toBe("66.67%");
  });

  it("resetStats zeroes hit/miss counters without clearing cached entries", () => {
    ocrCacheService.cacheResult("hash-k", "key-k", "text k");
    ocrCacheService.getCachedResult("hash-k", "key-k"); // hit
    ocrCacheService.resetStats();
    expect(ocrCacheService.getStats().total).toBe(0);
    expect(ocrCacheService.getCachedResult("hash-k", "key-k")?.text).toBe("text k");
  });
});
