import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
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

  // Upsert by (bookId, pageNumber). Processing a page — whether the first run or
  // a retry — must update the existing row rather than insert a duplicate. The
  // schema has a (bookId, pageNumber) index but no DB-level unique constraint,
  // so we match in application code. Page processing for a given page is
  // sequential (the pipeline loops pages in order and the retry worker handles
  // distinct pages), so there is no concurrent-insert race to guard against.
  const existing = await db
    .select()
    .from(pages)
    .where(and(eq(pages.bookId, page.bookId), eq(pages.pageNumber, page.pageNumber)))
    .limit(1);

  if (existing.length > 0) {
    const { bookId: _bookId, pageNumber: _pageNumber, ...rest } = page;
    const updateSet: Record<string, unknown> = { updatedAt: new Date() };
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) updateSet[key] = value;
    }
    const updated = await db
      .update(pages)
      .set(updateSet)
      .where(eq(pages.id, existing[0].id))
      .returning();
    return updated[0] ?? null;
  }

  const result = await db.insert(pages).values(page).returning();
  return result[0] ?? null;
}

export async function getBookPages(bookId: number): Promise<Page[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(pages).where(eq(pages.bookId, bookId)).orderBy(pages.pageNumber);
}

export async function deleteBook(bookId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  // pages (and processing/retry rows referencing the book) cascade via the
  // onDelete: "cascade" FK on pages.bookId.
  await db.delete(books).where(eq(books.id, bookId));
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
