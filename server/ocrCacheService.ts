/**
 * OCR Result Caching Service
 * Caches OCR results to avoid re-processing identical pages
 */

import { TTLMap } from "./dataStructureOptimizations";

interface OCRCacheEntry {
  text: string;
  confidence: number;
  timestamp: number;
  pageHash: string;
}

class OCRCacheService {
  private cache: TTLMap<string, OCRCacheEntry>;
  private readonly ttlMs = 24 * 60 * 60 * 1000; // 24 hours
  private hitCount = 0;
  private missCount = 0;

  constructor() {
    this.cache = new TTLMap(this.ttlMs, true);
  }

  /**
   * Generate cache key from page data
   */
  private generateKey(pageHash: string, imageUrl: string): string {
    return `ocr:${pageHash}:${imageUrl}`;
  }

  /**
   * Get cached OCR result
   */
  getCachedResult(
    pageHash: string,
    imageUrl: string
  ): OCRCacheEntry | undefined {
    const key = this.generateKey(pageHash, imageUrl);
    const result = this.cache.get(key);

    if (result) {
      this.hitCount++;
    } else {
      this.missCount++;
    }

    return result;
  }

  /**
   * Cache OCR result
   */
  cacheResult(
    pageHash: string,
    imageUrl: string,
    text: string,
    confidence: number = 0.95
  ): void {
    const key = this.generateKey(pageHash, imageUrl);
    const entry: OCRCacheEntry = {
      text,
      confidence,
      timestamp: Date.now(),
      pageHash,
    };

    this.cache.set(key, entry, this.ttlMs);
  }

  /**
   * Check if result is cached
   */
  isCached(pageHash: string, imageUrl: string): boolean {
    const key = this.generateKey(pageHash, imageUrl);
    return this.cache.has(key);
  }

  /**
   * Clear specific cache entry
   */
  clearEntry(pageHash: string, imageUrl: string): void {
    const key = this.generateKey(pageHash, imageUrl);
    this.cache.delete(key);
  }

  /**
   * Clear all cache
   */
  clearAll(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const total = this.hitCount + this.missCount;
    const hitRate = total > 0 ? (this.hitCount / total) * 100 : 0;

    return {
      hitCount: this.hitCount,
      missCount: this.missCount,
      total,
      hitRate: hitRate.toFixed(2) + "%",
      cacheSize: this.cache.size,
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.hitCount = 0;
    this.missCount = 0;
  }

  /**
   * Destroy cache
   */
  destroy(): void {
    this.cache.destroy();
  }
}

// Export singleton instance
export const ocrCacheService = new OCRCacheService();
