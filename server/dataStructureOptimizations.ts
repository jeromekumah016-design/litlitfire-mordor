/**
 * Data Structure Optimization Utilities
 * Provides optimized data structures for common operations
 */

/**
 * Object Pool for frequently created objects
 * Reduces GC pressure by reusing object instances
 */
export class ObjectPool<T> {
  private available: T[] = [];
  private inUse: Set<T> = new Set();
  private factory: () => T;
  private reset: (obj: T) => void;
  private maxSize: number;

  constructor(
    factory: () => T,
    reset: (obj: T) => void,
    initialSize: number = 10,
    maxSize: number = 100
  ) {
    this.factory = factory;
    this.reset = reset;
    this.maxSize = maxSize;

    // Pre-allocate initial objects
    for (let i = 0; i < initialSize; i++) {
      this.available.push(factory());
    }
  }

  /**
   * Acquire an object from the pool
   */
  acquire(): T {
    let obj: T;
    if (this.available.length > 0) {
      obj = this.available.pop()!;
    } else {
      obj = this.factory();
    }
    this.inUse.add(obj);
    return obj;
  }

  /**
   * Release an object back to the pool
   */
  release(obj: T): void {
    if (!this.inUse.has(obj)) return;
    this.inUse.delete(obj);
    this.reset(obj);

    if (this.available.length < this.maxSize) {
      this.available.push(obj);
    }
  }

  /**
   * Get pool statistics
   */
  getStats() {
    return {
      available: this.available.length,
      inUse: this.inUse.size,
      total: this.available.length + this.inUse.size,
    };
  }

  /**
   * Clear the pool
   */
  clear(): void {
    this.available.length = 0;
    this.inUse.clear();
  }
}

/**
 * Efficient Map with TTL support
 * Automatically removes expired entries
 */
export class TTLMap<K, V> {
  private map: Map<K, { value: V; expiresAt: number }> = new Map();
  private ttl: number;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(ttlMs: number = 60000, autoCleanup: boolean = true) {
    this.ttl = ttlMs;

    if (autoCleanup) {
      this.cleanupInterval = setInterval(() => this.cleanup(), ttlMs / 2);
    }
  }

  /**
   * Set a value with TTL
   */
  set(key: K, value: V, ttl?: number): void {
    const expiresAt = Date.now() + (ttl || this.ttl);
    this.map.set(key, { value, expiresAt });
  }

  /**
   * Get a value if not expired
   */
  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }

    return entry.value;
  }

  /**
   * Check if key exists and is not expired
   */
  has(key: K): boolean {
    const entry = this.map.get(key);
    if (!entry) return false;

    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Delete a key
   */
  delete(key: K): boolean {
    return this.map.delete(key);
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.map.clear();
  }

  /**
   * Remove expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    const keysToDelete: K[] = [];
    this.map.forEach((entry, key) => {
      if (now > entry.expiresAt) {
        keysToDelete.push(key);
      }
    });
    keysToDelete.forEach((key) => this.map.delete(key));
  }

  /**
   * Get size
   */
  get size(): number {
    return this.map.size;
  }

  /**
   * Destroy the map and cleanup interval
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.clear();
  }
}

/**
 * Efficient Set with automatic size limits
 */
export class BoundedSet<T> {
  private set: Set<T>;
  private maxSize: number;

  constructor(maxSize: number = 1000) {
    this.set = new Set();
    this.maxSize = maxSize;
  }

  /**
   * Add an item, removing oldest if at capacity
   */
  add(item: T): void {
    if (this.set.has(item)) return;

    if (this.set.size >= this.maxSize) {
      const firstItem = this.set.values().next().value as T;
      if (firstItem !== undefined) {
        this.set.delete(firstItem);
      }
    }

    this.set.add(item);
  }

  /**
   * Check if item exists
   */
  has(item: T): boolean {
    return this.set.has(item);
  }

  /**
   * Delete an item
   */
  delete(item: T): boolean {
    return this.set.delete(item);
  }

  /**
   * Clear all items
   */
  clear(): void {
    this.set.clear();
  }

  /**
   * Get size
   */
  get size(): number {
    return this.set.size;
  }
}

/**
 * Efficient circular buffer for fixed-size data
 */
export class CircularBuffer<T> {
  private buffer: (T | undefined)[];
  private head: number = 0;
  private tail: number = 0;
  private size: number = 0;
  private capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
  }

  /**
   * Add an item to the buffer
   */
  push(item: T): void {
    this.buffer[this.tail] = item;
    this.tail = (this.tail + 1) % this.capacity;

    if (this.size < this.capacity) {
      this.size++;
    } else {
      this.head = (this.head + 1) % this.capacity;
    }
  }

  /**
   * Get an item from the buffer
   */
  get(index: number): T | undefined {
    if (index < 0 || index >= this.size) return undefined;
    return this.buffer[(this.head + index) % this.capacity];
  }

  /**
   * Get all items in order
   */
  toArray(): T[] {
    const result: T[] = [];
    for (let i = 0; i < this.size; i++) {
      result.push(this.buffer[(this.head + i) % this.capacity] as T);
    }
    return result;
  }

  /**
   * Clear the buffer
   */
  clear(): void {
    this.buffer.fill(undefined);
    this.head = 0;
    this.tail = 0;
    this.size = 0;
  }

  /**
   * Get size
   */
  getSize(): number {
    return this.size;
  }
}
