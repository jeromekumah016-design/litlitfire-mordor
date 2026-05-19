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
    userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    pdfFileKey: varchar("pdfFileKey", { length: 255 }).notNull(), // S3 storage key
    pdfFileUrl: varchar("pdfFileUrl", { length: 1024 }).notNull(), // S3 presigned URL or storage path
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
    bookId: int("bookId").notNull().references(() => books.id, { onDelete: "cascade" }),
    pageNumber: int("pageNumber").notNull(), // 1-indexed page number
    thumbnailFileKey: varchar("thumbnailFileKey", { length: 255 }), // S3 key for thumbnail
    thumbnailUrl: varchar("thumbnailUrl", { length: 1024 }), // S3 URL for thumbnail
    ocrText: text("ocrText"), // Extracted text from OCR
    generatedPrompt: text("generatedPrompt"), // LLM-generated prompt
    generatedImageFileKey: varchar("generatedImageFileKey", { length: 255 }), // S3 key for generated image
    generatedImageUrl: varchar("generatedImageUrl", { length: 1024 }), // S3 URL for generated image
    processingStatus: mysqlEnum("processingStatus", ["pending", "processing", "done", "error"]).default("pending").notNull(),
    errorMessage: text("errorMessage"), // Error details if processing failed
    retryCount: int("retryCount").default(0).notNull(), // Number of retry attempts
    maxRetries: int("maxRetries").default(3).notNull(), // Maximum retry attempts allowed
    lastRetryAt: timestamp("lastRetryAt"), // Timestamp of last retry attempt
    nextRetryAt: timestamp("nextRetryAt"), // Scheduled time for next retry
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
 * Retry history table: tracks all retry attempts for failed pages
 */
export const retryHistory = mysqlTable(
  "retryHistory",
  {
    id: int("id").autoincrement().primaryKey(),
    pageId: int("pageId").notNull(),
    bookId: int("bookId").notNull(),
    attemptNumber: int("attemptNumber").notNull(),
    status: mysqlEnum("status", ["pending", "processing", "success", "failed"]).default("pending").notNull(),
    errorMessage: text("errorMessage"),
    retryReason: varchar("retryReason", { length: 255 }),
    backoffDelayMs: int("backoffDelayMs").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    completedAt: timestamp("completedAt"),
  },
  (table) => ({
    pageIdIdx: index("pageIdIdx").on(table.pageId),
    bookIdIdx: index("bookIdIdx").on(table.bookId),
    statusIdx: index("statusIdx").on(table.status),
  })
);

export type RetryHistory = typeof retryHistory.$inferSelect;
export type InsertRetryHistory = typeof retryHistory.$inferInsert;

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

export const retryHistoryRelations = relations(retryHistory, ({ one }) => ({
  page: one(pages, {
    fields: [retryHistory.pageId],
    references: [pages.id],
  }),
  book: one(books, {
    fields: [retryHistory.bookId],
    references: [books.id],
  }),
}));