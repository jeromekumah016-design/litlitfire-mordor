-- Close audit finding: pages(bookId, pageNumber) was only a plain (non-unique)
-- index. extractAndStorePages does a check-then-insert (fetch existing pages,
-- insert only for numbers not already present) that is NOT atomic under
-- concurrent calls for the same book -- a double-submitted upload or an
-- overlapping retry can race past the in-memory check and insert two rows for
-- the same (bookId, pageNumber). This migration is defensive: it first
-- de-duplicates any rows that already exist in production before adding the
-- real constraint, since CREATE UNIQUE INDEX fails outright if duplicates are
-- present.
--
-- Dedup rule: for each (bookId, pageNumber) group, keep one row -- prefer the
-- most-progressed one (done > processing > pending > error), tie-broken by
-- newest id -- and delete the rest. processingJobs.pageId / retryHistory.pageId
-- are plain integer columns (no FK constraint in schema.ts), so deleting a
-- losing duplicate cannot violate a foreign key; any orphaned job/retry history
-- rows simply reference a page id that no longer exists, same as they would
-- after any other page deletion.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "bookId", "pageNumber"
      ORDER BY
        CASE "processingStatus"
          WHEN 'done' THEN 0
          WHEN 'processing' THEN 1
          WHEN 'pending' THEN 2
          ELSE 3
        END,
        id DESC
    ) AS rn
  FROM "pages"
)
DELETE FROM "pages"
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Swap the plain composite index for a unique one (same name, so no app-code
-- references need to change).
DROP INDEX IF EXISTS "pages_bookPage_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "pages_bookPage_idx" ON "pages" ("bookId", "pageNumber");
