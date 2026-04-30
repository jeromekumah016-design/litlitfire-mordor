import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, decimal, boolean, index, foreignKey } from "drizzle-orm/mysql-core";
import { relations } from "drizzle-orm";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Books table: stores metadata about uploaded PDF books
 */
export const books = mysqlTable(
  "books",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    pdfFileKey: varchar("pdfFileKey", { length: 255 }).notNull(), // S3 storage key
    pdfFileUrl: varchar("pdfFileUrl", { length: 512 }).notNull(), // S3 presigned URL or storage path
    pageCount: int("pageCount").notNull(), // Total pages in PDF
    processingStatus: mysqlEnum("processingStatus", ["pending", "processing", "completed", "failed"]).default("pending").notNull(),
    totalPrice: decimal("totalPrice", { precision: 10, scale: 2 }).notNull(), // Calculated based on page count
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("userIdIdx").on(table.userId),
    statusIdx: index("statusIdx").on(table.processingStatus),
  })
);

export type Book = typeof books.$inferSelect;
export type InsertBook = typeof books.$inferInsert;

/**
 * Pages table: stores per-page data extracted from PDFs
 */
export const pages = mysqlTable(
  "pages",
  {
    id: int("id").autoincrement().primaryKey(),
    bookId: int("bookId").notNull(),
    pageNumber: int("pageNumber").notNull(), // 1-indexed page number
    thumbnailFileKey: varchar("thumbnailFileKey", { length: 255 }), // S3 key for thumbnail
    thumbnailUrl: varchar("thumbnailUrl", { length: 512 }), // S3 URL for thumbnail
    ocrText: text("ocrText"), // Extracted text from OCR
    generatedPrompt: text("generatedPrompt"), // LLM-generated prompt
    generatedImageFileKey: varchar("generatedImageFileKey", { length: 255 }), // S3 key for generated image
    generatedImageUrl: varchar("generatedImageUrl", { length: 512 }), // S3 URL for generated image
    processingStatus: mysqlEnum("processingStatus", ["pending", "processing", "done", "error"]).default("pending").notNull(),
    errorMessage: text("errorMessage"), // Error details if processing failed
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    bookIdIdx: index("bookIdIdx").on(table.bookId),
    statusIdx: index("statusIdx").on(table.processingStatus),
    bookPageIdx: index("bookPageIdx").on(table.bookId, table.pageNumber),
  })
);

export type Page = typeof pages.$inferSelect;
export type InsertPage = typeof pages.$inferInsert;

/**
 * Processing jobs table: tracks async processing tasks
 */
export const processingJobs = mysqlTable(
  "processingJobs",
  {
    id: int("id").autoincrement().primaryKey(),
    bookId: int("bookId").notNull(),
    pageId: int("pageId"),
    jobType: mysqlEnum("jobType", ["extract_pdf", "ocr", "generate_prompt", "generate_image"]).notNull(),
    status: mysqlEnum("status", ["pending", "processing", "completed", "failed"]).default("pending").notNull(),
    result: text("result"), // JSON result data
    errorMessage: text("errorMessage"),
    startedAt: timestamp("startedAt"),
    completedAt: timestamp("completedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    bookIdIdx: index("bookIdIdx").on(table.bookId),
    statusIdx: index("statusIdx").on(table.status),
    jobTypeIdx: index("jobTypeIdx").on(table.jobType),
  })
);

export type ProcessingJob = typeof processingJobs.$inferSelect;
export type InsertProcessingJob = typeof processingJobs.$inferInsert;

/**
 * Relations for Drizzle ORM
 */
export const booksRelations = relations(books, ({ many }) => ({
  pages: many(pages),
  jobs: many(processingJobs),
}));

export const pagesRelations = relations(pages, ({ one }) => ({
  book: one(books, {
    fields: [pages.bookId],
    references: [books.id],
  }),
}));

export const processingJobsRelations = relations(processingJobs, ({ one }) => ({
  book: one(books, {
    fields: [processingJobs.bookId],
    references: [books.id],
  }),
  page: one(pages, {
    fields: [processingJobs.pageId],
    references: [pages.id],
  }),
}));