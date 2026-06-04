import {
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  varchar,
  numeric,
  index,
  serial,
  boolean,
  jsonb,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const roleEnum = pgEnum("role", ["user", "admin"]);
export const bookStatusEnum = pgEnum("book_processing_status", ["pending", "processing", "completed", "failed"]);
export const pageStatusEnum = pgEnum("page_processing_status", ["pending", "processing", "done", "error"]);
export const retryStatusEnum = pgEnum("retry_status", ["pending", "processing", "success", "failed"]);
export const jobTypeEnum = pgEnum("job_type", ["extract_pdf", "ocr", "generate_prompt", "generate_image"]);
export const jobStatusEnum = pgEnum("job_status", ["pending", "processing", "completed", "failed"]);

// New for split pipeline with review gate
export const promptStatusEnum = pgEnum("page_prompt_status", ["pending", "transcribing", "prompt_ready", "prompt_error"]);
export const imageStatusEnum = pgEnum("page_image_status", ["pending", "generating", "image_ready", "image_error"]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: roleEnum("role").default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const books = pgTable(
  "books",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    pdfFileKey: varchar("pdfFileKey", { length: 255 }).notNull(),
    pdfFileUrl: varchar("pdfFileUrl", { length: 1024 }).notNull(),
    pageCount: integer("pageCount").notNull(),
    processingStatus: bookStatusEnum("processingStatus").default("pending").notNull(),
    storyBible: jsonb("storyBible"),
    totalPrice: numeric("totalPrice", { precision: 10, scale: 2 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (table) => [
    index("books_userId_idx").on(table.userId),
    index("books_status_idx").on(table.processingStatus),
  ]
);

export type Book = typeof books.$inferSelect;
export type InsertBook = typeof books.$inferInsert;

export const pages = pgTable(
  "pages",
  {
    id: serial("id").primaryKey(),
    bookId: integer("bookId").notNull().references(() => books.id, { onDelete: "cascade" }),
    pageNumber: integer("pageNumber").notNull(),
    thumbnailFileKey: varchar("thumbnailFileKey", { length: 255 }),
    thumbnailUrl: varchar("thumbnailUrl", { length: 1024 }),
    ocrText: text("ocrText"),
    generatedPrompt: text("generatedPrompt"),
    generatedImageFileKey: varchar("generatedImageFileKey", { length: 255 }),
    generatedImageUrl: varchar("generatedImageUrl", { length: 1024 }),
    processingStatus: pageStatusEnum("processingStatus").default("pending").notNull(),
    // split statuses for two-phase with review gate
    promptStatus: promptStatusEnum("promptStatus").default("pending").notNull(),
    imageStatus: imageStatusEnum("imageStatus").default("pending").notNull(),
    promptApproved: boolean("promptApproved").default(false).notNull(),
    promptStructured: jsonb("promptStructured"),
    skipSuggested: boolean("skipSuggested").default(false).notNull(),
    errorMessage: text("errorMessage"),
    retryCount: integer("retryCount").default(0).notNull(),
    maxRetries: integer("maxRetries").default(3).notNull(),
    lastRetryAt: timestamp("lastRetryAt"),
    nextRetryAt: timestamp("nextRetryAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (table) => [
    index("pages_bookId_idx").on(table.bookId),
    index("pages_status_idx").on(table.processingStatus),
    index("pages_bookPage_idx").on(table.bookId, table.pageNumber),
  ]
);

export type Page = typeof pages.$inferSelect;
export type InsertPage = typeof pages.$inferInsert;

export const retryHistory = pgTable(
  "retryHistory",
  {
    id: serial("id").primaryKey(),
    pageId: integer("pageId").notNull(),
    bookId: integer("bookId").notNull(),
    attemptNumber: integer("attemptNumber").notNull(),
    status: retryStatusEnum("status").default("pending").notNull(),
    errorMessage: text("errorMessage"),
    retryReason: varchar("retryReason", { length: 255 }),
    backoffDelayMs: integer("backoffDelayMs").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    completedAt: timestamp("completedAt"),
  },
  (table) => [
    index("retry_pageId_idx").on(table.pageId),
    index("retry_bookId_idx").on(table.bookId),
    index("retry_status_idx").on(table.status),
  ]
);

export type RetryHistory = typeof retryHistory.$inferSelect;
export type InsertRetryHistory = typeof retryHistory.$inferInsert;

export const processingJobs = pgTable(
  "processingJobs",
  {
    id: serial("id").primaryKey(),
    bookId: integer("bookId").notNull(),
    pageId: integer("pageId"),
    jobType: jobTypeEnum("jobType").notNull(),
    status: jobStatusEnum("status").default("pending").notNull(),
    result: text("result"),
    errorMessage: text("errorMessage"),
    startedAt: timestamp("startedAt"),
    completedAt: timestamp("completedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (table) => [
    index("jobs_bookId_idx").on(table.bookId),
    index("jobs_status_idx").on(table.status),
    index("jobs_type_idx").on(table.jobType),
  ]
);

export type ProcessingJob = typeof processingJobs.$inferSelect;
export type InsertProcessingJob = typeof processingJobs.$inferInsert;

export const booksRelations = relations(books, ({ many }) => ({
  pages: many(pages),
  jobs: many(processingJobs),
}));

export const pagesRelations = relations(pages, ({ one }) => ({
  book: one(books, { fields: [pages.bookId], references: [books.id] }),
}));

export const processingJobsRelations = relations(processingJobs, ({ one }) => ({
  book: one(books, { fields: [processingJobs.bookId], references: [books.id] }),
  page: one(pages, { fields: [processingJobs.pageId], references: [pages.id] }),
}));

export const retryHistoryRelations = relations(retryHistory, ({ one }) => ({
  page: one(pages, { fields: [retryHistory.pageId], references: [pages.id] }),
  book: one(books, { fields: [retryHistory.bookId], references: [books.id] }),
}));
