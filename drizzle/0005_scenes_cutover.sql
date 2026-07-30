-- Scene-mode cut-over: dedicated scenes table + book generation mode.
-- Apply via `pnpm db:push` (drizzle-kit diffs schema.ts -> DB) or run this SQL
-- directly. Additive + zero-downtime: no existing column is dropped or rewritten.

DO $$ BEGIN
  CREATE TYPE "generation_mode" AS ENUM ('page', 'scene');
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "books"
  ADD COLUMN IF NOT EXISTS "generationMode" "generation_mode" DEFAULT 'page' NOT NULL;

CREATE TABLE IF NOT EXISTS "scenes" (
  "id" serial PRIMARY KEY NOT NULL,
  "bookId" integer NOT NULL,
  "sceneIndex" integer NOT NULL,
  "title" varchar(255) NOT NULL,
  "rationale" text,
  "sourcePage" integer NOT NULL,
  "importance" integer DEFAULT 3 NOT NULL,
  "description" text,
  "prompt" text,
  "generationParams" text,
  "modelVersion" varchar(128),
  "thumbnailFileKey" varchar(255),
  "thumbnailUrl" varchar(1024),
  "generatedImageFileKey" varchar(255),
  "generatedImageUrl" varchar(1024),
  "processingStatus" "page_processing_status" DEFAULT 'pending' NOT NULL,
  "errorMessage" text,
  "retryCount" integer DEFAULT 0 NOT NULL,
  "maxRetries" integer DEFAULT 3 NOT NULL,
  "lastRetryAt" timestamp,
  "nextRetryAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "scenes" ADD CONSTRAINT "scenes_bookId_books_id_fk"
    FOREIGN KEY ("bookId") REFERENCES "books"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "scenes_bookId_idx" ON "scenes" ("bookId");
CREATE INDEX IF NOT EXISTS "scenes_status_idx" ON "scenes" ("processingStatus");
CREATE UNIQUE INDEX IF NOT EXISTS "scenes_bookScene_idx" ON "scenes" ("bookId","sceneIndex");
