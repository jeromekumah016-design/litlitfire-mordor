-- Two-phase review gate: persist story bible + split prompt/image statuses.
-- Additive; does not drop columns. Migration id 0006 (0005 is scenes cut-over).

DO $$ BEGIN
  CREATE TYPE "page_prompt_status" AS ENUM(
    'pending', 'transcribing', 'prompt_ready', 'approved', 'prompt_error'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "page_image_status" AS ENUM(
    'pending', 'generating', 'image_ready', 'image_error'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "books" ADD COLUMN IF NOT EXISTS "storyBible" jsonb;

ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "promptStatus" "page_prompt_status" DEFAULT 'pending' NOT NULL;
ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "imageStatus" "page_image_status" DEFAULT 'pending' NOT NULL;
ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "promptStructured" jsonb;
ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "skipSuggested" boolean DEFAULT false NOT NULL;

CREATE INDEX IF NOT EXISTS "pages_prompt_status_idx" ON "pages" ("promptStatus");
CREATE INDEX IF NOT EXISTS "pages_image_status_idx" ON "pages" ("imageStatus");
