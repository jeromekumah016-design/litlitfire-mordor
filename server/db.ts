import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
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

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

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

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// Book queries
export async function createBook(book: InsertBook): Promise<Book | null> {
  const db = await getDb();
  if (!db) {
    console.error("[Database] Cannot create book: database not available");
    return null;
  }

  try {
    const result = await db.insert(books).values(book);
    const bookId = (result as any)[0]?.insertId || (result as any).insertId;
    
    if (!bookId) {
      console.error("[Database] Failed to get insert ID", result);
      return null;
    }

    const created = await db.select().from(books).where(eq(books.id, bookId)).limit(1);
    return created.length > 0 ? created[0] : null;
  } catch (error) {
    console.error("[Database] Error creating book:", error);
    throw error;
  }
}

export async function getBook(bookId: number): Promise<Book | null> {
  const db = await getDb();
  if (!db) return null;

  const result = await db.select().from(books).where(eq(books.id, bookId)).limit(1);
  return result.length > 0 ? result[0] : null;
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

// Page queries
export async function createPage(page: InsertPage): Promise<Page | null> {
  const db = await getDb();
  if (!db) return null;

  const result = await db.insert(pages).values(page);
  const pageId = (result as any).insertId;
  const created = await db.select().from(pages).where(eq(pages.id, pageId)).limit(1);
  return created.length > 0 ? created[0] : null;
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

// Processing job queries
export async function createProcessingJob(job: InsertProcessingJob): Promise<ProcessingJob | null> {
  const db = await getDb();
  if (!db) return null;

  const result = await db.insert(processingJobs).values(job);
  const jobId = (result as any).insertId;
  const created = await db.select().from(processingJobs).where(eq(processingJobs.id, jobId)).limit(1);
  return created.length > 0 ? created[0] : null;
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
