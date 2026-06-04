-- Migration: feat/prompt-transcription-gate
-- Split per-page status into promptStatus and imageStatus
-- Add promptApproved gate, promptStructured, skipSuggested, storyBible
-- Note: project uses PostgreSQL (drizzle config + db.ts + pg-core), but _journal/meta claim "mysql" dialect from early snapshots. This migration uses real pg syntax.

-- Create new enums (drizzle-kit would generate these)
CREATE TYPE "page_prompt_status" AS ENUM('pending', 'transcribing', 'prompt_ready', 'prompt_error');
CREATE TYPE "page_image_status" AS ENUM('pending', 'generating', 'image_ready', 'image_error');

-- Add to books
ALTER TABLE "books" ADD COLUMN "storyBible" jsonb;

-- Add to pages
ALTER TABLE "pages" ADD COLUMN "promptStatus" "page_prompt_status" DEFAULT 'pending' NOT NULL;
ALTER TABLE "pages" ADD COLUMN "imageStatus" "page_image_status" DEFAULT 'pending' NOT NULL;
ALTER TABLE "pages" ADD COLUMN "promptApproved" boolean DEFAULT false NOT NULL;
ALTER TABLE "pages" ADD COLUMN "promptStructured" jsonb;
ALTER TABLE "pages" ADD COLUMN "skipSuggested" boolean DEFAULT false NOT NULL;

-- Optional indexes for new status columns (for query perf in dashboard)
CREATE INDEX IF NOT EXISTS "pages_prompt_status_idx" ON "pages" ("promptStatus");
CREATE INDEX IF NOT EXISTS "pages_image_status_idx" ON "pages" ("imageStatus");
