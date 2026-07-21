-- Product package: lite (chapters, default) vs upgraded (pages, paid framing later)
DO $$ BEGIN
  CREATE TYPE "public"."package_tier" AS ENUM('lite', 'upgraded');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
ALTER TABLE "books" ADD COLUMN IF NOT EXISTS "packageTier" "package_tier" DEFAULT 'lite' NOT NULL;
