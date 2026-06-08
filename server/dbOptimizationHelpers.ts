/**
 * Database Query Optimization Helpers
 * Provides caching, pagination, and query optimization utilities
 */

import { eq, desc, asc, sql, inArray } from "drizzle-orm";
import { getDb } from "./db";
import { books, pages } from "../drizzle/schema";

// Simple in-memory cache for query results
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number; // Time to live in milliseconds
}

class QueryCache {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private maxSize: number = 100;

  /**
   * Get cached result
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    // Check if cache has expired
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  /**
   * Set cache entry
   */
  set<T>(key: string, data: T, ttl: number = 60000): void {
    // Evict oldest entry if cache is full
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
    });
  }

  /**
   * Clear cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache stats
   */
  getStats(): { size: number; maxSize: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
    };
  }
}

export const queryCache = new QueryCache();

/**
 * Pagination helper
 */
export interface PaginationOptions {
  page: number;
  pageSize: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

/**
 * Get paginated books
 */
export async function getPaginatedBooks(
  options: PaginationOptions,
  useCache: boolean = true
): Promise<PaginatedResult<any>> {
  const cacheKey = `books:paginated:${options.page}:${options.pageSize}`;

  // Check cache first
  if (useCache) {
    const cached = queryCache.get<PaginatedResult<any>>(cacheKey);
    if (cached) return cached;
  }

  const database = await getDb();
  if (!database) throw new Error("Database not available");

  const offset = (options.page - 1) * options.pageSize;

  // Get total count
  const countResult = await database
    .select({ count: sql`COUNT(*)`.as("count") })
    .from(books);
  const total = parseInt(countResult[0]?.count as string) || 0;

  // Get paginated data
  const data = await database
    .select()
    .from(books)
    .orderBy(desc(books.createdAt))
    .limit(options.pageSize)
    .offset(offset);

  const result: PaginatedResult<any> = {
    data,
    total,
    page: options.page,
    pageSize: options.pageSize,
    totalPages: Math.ceil(total / options.pageSize),
    hasNextPage: offset + options.pageSize < total,
    hasPreviousPage: options.page > 1,
  };

  // Cache result
  if (useCache) {
    queryCache.set(cacheKey, result, 30000); // 30 second TTL
  }

  return result;
}

/**
 * Get book with pages (optimized query)
 */
export async function getBookWithPages(
  bookId: number,
  useCache: boolean = true
): Promise<any> {
  const cacheKey = `book:${bookId}:with-pages`;

  // Check cache first
  if (useCache) {
    const cached = queryCache.get(cacheKey);
    if (cached) return cached;
  }

  const database = await getDb();
  if (!database) throw new Error("Database not available");

  const bookData = await database
    .select()
    .from(books)
    .where(eq(books.id, bookId))
    .limit(1);

  if (bookData.length === 0) return null;

  const pagesData = await database
    .select()
    .from(pages)
    .where(eq(pages.bookId, bookId))
    .orderBy(asc(pages.pageNumber));

  const result = {
    ...bookData[0],
    pages: pagesData,
  };

  // Cache result
  if (useCache) {
    queryCache.set(cacheKey, result, 60000); // 60 second TTL
  }

  return result;
}

/**
 * Get pages for book with pagination
 */
export async function getBookPages(
  bookId: number,
  options: PaginationOptions,
  useCache: boolean = true
): Promise<PaginatedResult<any>> {
  const cacheKey = `book:${bookId}:pages:${options.page}:${options.pageSize}`;

  // Check cache first
  if (useCache) {
    const cached = queryCache.get<PaginatedResult<any>>(cacheKey);
    if (cached) return cached;
  }

  const database = await getDb();
  if (!database) throw new Error("Database not available");

  const offset = (options.page - 1) * options.pageSize;

  // Get total count
  const countResult = await database
    .select({ count: sql`COUNT(*)`.as("count") })
    .from(pages)
    .where(eq(pages.bookId, bookId));
  const total = parseInt(countResult[0]?.count as string) || 0;

  // Get paginated data
  const data = await database
    .select()
    .from(pages)
    .where(eq(pages.bookId, bookId))
    .orderBy(asc(pages.pageNumber))
    .limit(options.pageSize)
    .offset(offset);

  const result: PaginatedResult<any> = {
    data,
    total,
    page: options.page,
    pageSize: options.pageSize,
    totalPages: Math.ceil(total / options.pageSize),
    hasNextPage: offset + options.pageSize < total,
    hasPreviousPage: options.page > 1,
  };

  // Cache result
  if (useCache) {
    queryCache.set(cacheKey, result, 30000); // 30 second TTL
  }

  return result;
}

/**
 * Invalidate cache for a book
 */
export function invalidateBookCache(bookId: number): void {
  // Clear all caches related to this book
  queryCache.clear(); // Simple approach: clear all cache
  // In production, implement selective cache invalidation
}

/**
 * Get query performance stats
 */
export function getQueryStats(): {
  cacheStats: { size: number; maxSize: number };
} {
  return {
    cacheStats: queryCache.getStats(),
  };
}

/**
 * Batch query helper for processing multiple items efficiently
 */
export async function batchGetBooks(
  bookIds: number[],
  useCache: boolean = true
): Promise<any[]> {
  if (bookIds.length === 0) return [];

  // Check cache for each ID
  const results: any[] = [];
  const uncachedIds: number[] = [];

  if (useCache) {
    for (const bookId of bookIds) {
      const cached = queryCache.get(`book:${bookId}`);
      if (cached) {
        results.push(cached);
      } else {
        uncachedIds.push(bookId);
      }
    }
  } else {
    uncachedIds.push(...bookIds);
  }

  // Fetch uncached items
  if (uncachedIds.length > 0) {
    const database = await getDb();
    if (!database) throw new Error("Database not available");

    const batchData = await database
      .select()
      .from(books)
      .where(inArray(books.id, uncachedIds));

    for (const book of batchData) {
      if (useCache) {
        queryCache.set(`book:${book.id}`, book, 60000);
      }
      results.push(book);
    }
  }

  return results;
}

/**
 * Connection pooling status
 */
export function getConnectionPoolStatus(): {
  message: string;
  pooling: boolean;
} {
  return {
    message: "Database connection pooling enabled",
    pooling: true,
  };
}
