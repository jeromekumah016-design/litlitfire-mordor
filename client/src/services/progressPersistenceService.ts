/**
 * Progress Persistence Service
 * Persists processing progress to localStorage for recovery across page reloads
 */

export interface ProgressState {
  bookId: number;
  totalPages: number;
  processedPages: number;
  failedPages: number;
  currentPage: number;
  overallProgress: number;
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  startTime: number;
  lastUpdate: number;
  pageStatuses: Array<{
    pageNumber: number;
    status: "pending" | "processing" | "completed" | "error";
    progress: number;
    error?: string;
  }>;
}

const STORAGE_KEY_PREFIX = "progress:";
const STORAGE_EXPIRY_TIME = 24 * 60 * 60 * 1000; // 24 hours

class ProgressPersistenceService {
  /**
   * Save progress state
   */
  saveProgress(bookId: number, state: ProgressState): void {
    try {
      const key = `${STORAGE_KEY_PREFIX}${bookId}`;
      const data = {
        ...state,
        savedAt: Date.now(),
      };
      localStorage.setItem(key, JSON.stringify(data));
    } catch (error) {
      console.error("Error saving progress:", error);
    }
  }

  /**
   * Load progress state
   */
  loadProgress(bookId: number): ProgressState | null {
    try {
      const key = `${STORAGE_KEY_PREFIX}${bookId}`;
      const data = localStorage.getItem(key);

      if (!data) return null;

      const parsed = JSON.parse(data);

      // Check if data has expired
      if (Date.now() - parsed.savedAt > STORAGE_EXPIRY_TIME) {
        localStorage.removeItem(key);
        return null;
      }

      return parsed;
    } catch (error) {
      console.error("Error loading progress:", error);
      return null;
    }
  }

  /**
   * Clear progress state
   */
  clearProgress(bookId: number): void {
    try {
      const key = `${STORAGE_KEY_PREFIX}${bookId}`;
      localStorage.removeItem(key);
    } catch (error) {
      console.error("Error clearing progress:", error);
    }
  }

  /**
   * Get all saved progress states
   */
  getAllProgress(): Map<number, ProgressState> {
    const result = new Map<number, ProgressState>();

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(STORAGE_KEY_PREFIX)) continue;

        const bookId = parseInt(key.replace(STORAGE_KEY_PREFIX, ""));
        const progress = this.loadProgress(bookId);

        if (progress) {
          result.set(bookId, progress);
        }
      }
    } catch (error) {
      console.error("Error getting all progress:", error);
    }

    return result;
  }

  /**
   * Clear all expired progress states
   */
  clearExpiredProgress(): void {
    try {
      const keysToRemove: string[] = [];

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(STORAGE_KEY_PREFIX)) continue;

        const data = localStorage.getItem(key);
        if (!data) continue;

        try {
          const parsed = JSON.parse(data);
          if (Date.now() - parsed.savedAt > STORAGE_EXPIRY_TIME) {
            keysToRemove.push(key);
          }
        } catch (error) {
          keysToRemove.push(key);
        }
      }

      keysToRemove.forEach((key) => localStorage.removeItem(key));
    } catch (error) {
      console.error("Error clearing expired progress:", error);
    }
  }

  /**
   * Get storage usage stats
   */
  getStats(): {
    totalItems: number;
    totalSize: number;
    items: Array<{ bookId: number; size: number }>;
  } {
    const items: Array<{ bookId: number; size: number }> = [];
    let totalSize = 0;

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(STORAGE_KEY_PREFIX)) continue;

        const data = localStorage.getItem(key);
        if (!data) continue;

        const bookId = parseInt(key.replace(STORAGE_KEY_PREFIX, ""));
        const size = data.length;
        items.push({ bookId, size });
        totalSize += size;
      }
    } catch (error) {
      console.error("Error getting stats:", error);
    }

    return {
      totalItems: items.length,
      totalSize,
      items,
    };
  }
}

export const progressPersistenceService = new ProgressPersistenceService();

// Clear expired progress on initialization
progressPersistenceService.clearExpiredProgress();
