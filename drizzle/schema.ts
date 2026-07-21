import {
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  varchar,
  numeric,
  index,
  uniqueIndex,
  serial,
  jsonb,
  boolean,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const roleEnum = pgEnum("role", ["user", "admin"]);
export const bookStatusEnum = pgEnum("book_processing_status", ["pending", "processing", "completed", "failed"]);
export const pageStatusEnum = pgEnum("page_processing_status", ["pending", "processing", "done", "error"]);
export const retryStatusEnum = pgEnum("retry_status", ["pending", "processing", "success", "failed"]);
export const jobTypeEnum = pgEnum("job_type", ["extract_pdf", "ocr", "generate_prompt", "generate_image"]);
export const jobStatusEnum = pgEnum("job_status", ["pending", "processing", "completed", "failed"]);
export const generationModeEnum = pgEnum("generation_mode", ["page", "scene"]);
// Two-phase review gate (port plan / functional bar): prompts and images split.
// "approved" is the only status that may enter renderApprovedImages.
export const promptStatusEnum = pgEnum("page_prompt_status", [
  "pending",
  "transcribing",
  "prompt_ready",
  "approved",
  "prompt_error",
]);
export const imageStatusEnum = pgEnum("page_image_status", [
  "pending",
  "generating",
  "image_ready",
  "image_error",
]);

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
    // Write-path selector: "page" = one image per page (pages table),
    // "scene" = multiple distinct scenes per book (scenes table). Controls
    // which table the pipeline writes to. No dual writes; no synthetic rows.
    generationMode: generationModeEnum("generationMode").default("page").notNull(),
    // Persisted visual bible (StoryContext JSON). Built once in transcribe; reused on render.
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
    // Split statuses for two-phase review gate (functional bar §2–3)
    promptStatus: promptStatusEnum("promptStatus").default("pending").notNull(),
    imageStatus: imageStatusEnum("imageStatus").default("pending").notNull(),
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
    index("pages_prompt_status_idx").on(table.promptStatus),
    index("pages_image_status_idx").on(table.imageStatus),
    index("pages_bookPage_idx").on(table.bookId, table.pageNumber),
  ]
);

export type Page = typeof pages.$inferSelect;
export type InsertPage = typeof pages.$inferInsert;

// ---------------------------------------------------------------------------
// Scenes: dedicated storage for scene-mode books (multiple distinct images per
// book). Replaces the interim approach of writing synthetic page rows. Captured
// at generation time while the prompt, narrative chunk, and scene boundaries are
// still in hand -- structured and lossless, not packed into ocrText strings.
// OCR transcription stays decoupled from image generation: the planner produces
// the scene + prompt, the pipeline renders it; this table just records the result.
// ---------------------------------------------------------------------------
export const scenes = pgTable(
  "scenes",
  {
    id: serial("id").primaryKey(),
    bookId: integer("bookId").notNull().references(() => books.id, { onDelete: "cascade" }),
    // 0-based ordering of the scene within the book (reading order).
    sceneIndex: integer("sceneIndex").notNull(),
    // The real scene title (e.g. "The parting of the sea") -- never "Page N".
    title: varchar("title", { length: 255 }).notNull(),
    // Why this moment was chosen (dev-mode transparency).
    rationale: text("rationale"),
    // 1-based source book page the scene was primarily drawn from.
    sourcePage: integer("sourcePage").notNull(),
    importance: integer("importance").default(3).notNull(),
    // Narrative chunk that drove this scene (the planner's scene description).
    description: text("description"),
    // Generation prompt + any structured generation parameters (JSON).
    prompt: text("prompt"),
    generationParams: text("generationParams"),
    modelVersion: varchar("modelVersion", { length: 128 }),
    thumbnailFileKey: varchar("thumbnailFileKey", { length: 255 }),
    thumbnailUrl: varchar("thumbnailUrl", { length: 1024 }),
    generatedImageFileKey: varchar("generatedImageFileKey", { length: 255 }),
    generatedImageUrl: varchar("generatedImageUrl", { length: 1024 }),
    processingStatus: pageStatusEnum("processingStatus").default("pending").notNull(),
    errorMessage: text("errorMessage"),
    retryCount: integer("retryCount").default(0).notNull(),
    maxRetries: integer("maxRetries").default(3).notNull(),
    lastRetryAt: timestamp("lastRetryAt"),
    nextRetryAt: timestamp("nextRetryAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (table) => [
    index("scenes_bookId_idx").on(table.bookId),
    index("scenes_status_idx").on(table.processingStatus),
    uniqueIndex("scenes_bookScene_idx").on(table.bookId, table.sceneIndex),
  ]
);

export type Scene = typeof scenes.$inferSelect;
export type InsertScene = typeof scenes.$inferInsert;

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
  scenes: many(scenes),
  jobs: many(processingJobs),
}));

export const scenesRelations = relations(scenes, ({ one }) => ({
  book: one(books, { fields: [scenes.bookId], references: [books.id] }),
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
