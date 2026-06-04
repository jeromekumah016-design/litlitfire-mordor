import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { desc, inArray, eq } from "drizzle-orm";
import {
  InsertUser,
  users,
  books,
  pages,
  processingJobs,
  type InsertBook,
  type Book,
  type InsertPage,
  type Page,
  type InsertProcessingJob,
  type ProcessingJob,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL.includes("neon.tech") ? { rejectUnauthorized: false } : undefined,
      });
      _db = drizzle(pool);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};

  const textFields = ["name", "email", "loginMethod"] as const;
  for (const field of textFields) {
    if (user[field] !== undefined) {
      values[field] = user[field] ?? null;
      updateSet[field] = user[field] ?? null;
    }
  }

  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }

  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

  await db
    .insert(users)
    .values(values)
    .onConflictDoUpdate({ target: users.openId, set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function createBook(book: InsertBook): Promise<Book | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(books).values(book).returning();
  return result[0] ?? null;
}

export async function getBook(bookId: number): Promise<Book | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(books).where(eq(books.id, bookId)).limit(1);
  return result[0] ?? null;
}

// Added for prompt gate review (setPromptApproved) - matches getBook pattern exactly
export async function getPage(pageId: number): Promise<Page | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(pages).where(eq(pages.id, pageId)).limit(1);
  return result[0] ?? null;
}

export async function getUserBooks(userId: number): Promise<Book[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(books).where(eq(books.userId, userId));
}

export async function updateBookStatus(bookId: number, status: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(books).set({ processingStatus: status as any }).where(eq(books.id, bookId));
}

export async function updateBook(bookId: number, updates: Partial<Book>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(books).set(updates).where(eq(books.id, bookId));
}

export async function createPage(page: InsertPage): Promise<Page | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(pages).values(page).returning();
  return result[0] ?? null;
}

export async function getBookPages(bookId: number): Promise<Page[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(pages).where(eq(pages.bookId, bookId)).orderBy(pages.pageNumber);
}

export async function updatePage(pageId: number, updates: Partial<Page>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(pages).set(updates).where(eq(pages.id, pageId));
}

export async function createProcessingJob(job: InsertProcessingJob): Promise<ProcessingJob | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(processingJobs).values(job).returning();
  return result[0] ?? null;
}

export async function getBookJobs(bookId: number): Promise<ProcessingJob[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(processingJobs).where(eq(processingJobs.bookId, bookId));
}

export async function updateProcessingJob(jobId: number, updates: Partial<ProcessingJob>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(processingJobs).set(updates).where(eq(processingJobs.id, jobId));
}

// Dashboard Statistics Queries
export async function getDashboardStats(userId: number) {
  const db = await getDb();
  if (!db) return null;

  const userBooks = await db
    .select()
    .from(books)
    .where(eq(books.userId, userId));

  const totalBooks = userBooks.length;
  const completedBooks = userBooks.filter(b => b.processingStatus === 'completed').length;
  const processingBooks = userBooks.filter(b => b.processingStatus === 'processing').length;
  const failedBooks = userBooks.filter(b => b.processingStatus === 'failed').length;

  // Get page statistics
  let totalPages = 0;
  let completedPages = 0;
  let failedPages = 0;

  for (const book of userBooks) {
    const bookPages = await db
      .select()
      .from(pages)
      .where(eq(pages.bookId, book.id));

    totalPages += bookPages.length;
    completedPages += bookPages.filter(p => p.processingStatus === 'done').length;
    failedPages += bookPages.filter(p => p.processingStatus === 'error').length;
  }

  return {
    totalBooks,
    completedBooks,
    processingBooks,
    failedBooks,
    totalPages,
    completedPages,
    failedPages,
    successRate: totalPages > 0 ? Math.round((completedPages / totalPages) * 100) : 0,
  };
}

export async function getRecentBooks(userId: number, limit: number = 10) {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(books)
    .where(eq(books.userId, userId))
    .orderBy(desc(books.createdAt))
    .limit(limit);
}

export async function getProcessingMetrics(userId: number) {
  const db = await getDb();
  if (!db) return null;

  const userBooks = await db
    .select()
    .from(books)
    .where(eq(books.userId, userId));

  const bookIds = userBooks.map(b => b.id);

  if (bookIds.length === 0) {
    return {
      avgProcessingTime: 0,
      totalProcessingTime: 0,
      pagesByStatus: { done: 0, error: 0, processing: 0, pending: 0 },
      recentErrors: [],
    };
  }

  const allPages = await db
    .select()
    .from(pages)
    .where(inArray(pages.bookId, bookIds));

  const pagesByStatus = {
    done: allPages.filter(p => p.processingStatus === 'done').length,
    error: allPages.filter(p => p.processingStatus === 'error').length,
    processing: allPages.filter(p => p.processingStatus === 'processing').length,
    pending: allPages.filter(p => p.processingStatus === 'pending').length,
  };

  const recentErrors = allPages
    .filter(p => p.errorMessage && p.processingStatus === 'error')
    .slice(0, 5)
    .map(p => ({
      pageId: p.id,
      pageNumber: p.pageNumber,
      error: p.errorMessage,
      timestamp: p.updatedAt,
    }));

  // Calculate average processing time for completed pages
  const completedPages = allPages.filter(p => p.processingStatus === 'done');
  const avgProcessingTime = completedPages.length > 0
    ? completedPages.reduce((sum, p) => {
        const createdAt = p.createdAt?.getTime() || 0;
        const updatedAt = p.updatedAt?.getTime() || 0;
        return sum + (updatedAt - createdAt);
      }, 0) / completedPages.length / 1000 // Convert to seconds
    : 0;

  return {
    avgProcessingTime: Math.round(avgProcessingTime),
    totalProcessingTime: completedPages.length,
    pagesByStatus,
    recentErrors,
  };
}

export async function getLibraryOverview(userId: number) {
  const db = await getDb();
  if (!db) return null;

  const stats = await getDashboardStats(userId);
  const recentBooks = await getRecentBooks(userId, 5);
  const metrics = await getProcessingMetrics(userId);

  return {
    stats,
    recentBooks,
    metrics,
  };
}
