-- Multi-pass reading profile (genres, authorIntent, plotUnits)
ALTER TABLE "books" ADD COLUMN IF NOT EXISTS "readingProfile" jsonb;
