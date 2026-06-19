/**
 * localStorage Service for Hybrid Approach
 * Manages book data when database is unavailable
 * Automatically syncs to database when connection is restored
 */

export interface StoredBook {
  id: string;
  userId: number;
  title: string;
  description?: string;
  pdfFileKey: string;
  pdfFileUrl: string;
  pageCount: number;
  processingStatus: "pending" | "processing" | "completed" | "failed";
  totalPrice: number;
  createdAt: number;
  updatedAt: number;
  syncedToDb?: boolean; // Track if synced to database
}

const STORAGE_KEY = "literal_literature_books";
const SYNC_STATUS_KEY = "literal_literature_sync_status";

/**
 * Get all books from localStorage
 */
export function getStoredBooks(): StoredBook[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error("Error reading from localStorage:", error);
    return [];
  }
}

/**
 * Save a new book to localStorage
 */
export function saveBook(book: Omit<StoredBook, "id" | "createdAt" | "updatedAt">): StoredBook {
  try {
    const books = getStoredBooks();
    const now = Date.now();
    const newBook: StoredBook = {
      ...book,
      id: `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: now,
      updatedAt: now,
      syncedToDb: false,
    };
    books.push(newBook);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(books));
    return newBook;
  } catch (error) {
    console.error("Error saving to localStorage:", error);
    throw error;
  }
}

/**
 * Update a book in localStorage
 */
export function updateBook(id: string, updates: Partial<StoredBook>): StoredBook | null {
  try {
    const books = getStoredBooks();
    const index = books.findIndex((b) => b.id === id);
    if (index === -1) return null;

    const updated = {
      ...books[index],
      ...updates,
      updatedAt: Date.now(),
    };
    books[index] = updated;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(books));
    return updated;
  } catch (error) {
    console.error("Error updating localStorage:", error);
    throw error;
  }
}

/**
 * Get a single book by ID
 */
export function getBook(id: string): StoredBook | null {
  const books = getStoredBooks();
  return books.find((b) => b.id === id) || null;
}

/**
 * Delete a book from localStorage
 */
export function deleteBook(id: string): boolean {
  try {
    const books = getStoredBooks();
    const filtered = books.filter((b) => b.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    return true;
  } catch (error) {
    console.error("Error deleting from localStorage:", error);
    return false;
  }
}

/**
 * Get books that haven't been synced to database yet
 */
export function getUnsyncedBooks(): StoredBook[] {
  const books = getStoredBooks();
  return books.filter((b) => !b.syncedToDb);
}

/**
 * Mark a book as synced to database
 */
export function markBookAsSynced(id: string): void {
  updateBook(id, { syncedToDb: true });
}

/**
 * Clear all localStorage data (for testing/reset)
 */
export function clearAllBooks(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(SYNC_STATUS_KEY);
  } catch (error) {
    console.error("Error clearing localStorage:", error);
  }
}

/**
 * Get sync status
 */
export function getSyncStatus(): { lastSyncTime?: number; syncInProgress: boolean } {
  try {
    const data = localStorage.getItem(SYNC_STATUS_KEY);
    return data ? JSON.parse(data) : { syncInProgress: false };
  } catch {
    return { syncInProgress: false };
  }
}

/**
 * Set sync status
 */
export function setSyncStatus(status: { lastSyncTime?: number; syncInProgress: boolean }): void {
  try {
    localStorage.setItem(SYNC_STATUS_KEY, JSON.stringify(status));
  } catch (error) {
    console.error("Error setting sync status:", error);
  }
}
