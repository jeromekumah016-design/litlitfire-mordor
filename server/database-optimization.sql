-- Database Optimization: Strategic Indexes for Performance

-- Index for books.list query (userId, createdAt DESC)
CREATE INDEX IF NOT EXISTS idx_books_userId_createdAt 
ON books(userId, createdAt DESC);

-- Index for books.getDetails query (id, userId)
CREATE INDEX IF NOT EXISTS idx_books_id_userId 
ON books(id, userId);

-- Index for pages query (bookId, pageNumber)
CREATE INDEX IF NOT EXISTS idx_pages_bookId_pageNumber 
ON pages(bookId, pageNumber);

-- Index for processing status queries
CREATE INDEX IF NOT EXISTS idx_pages_processingStatus 
ON pages(processingStatus);

-- Index for retry queries (processingStatus, retryCount)
CREATE INDEX IF NOT EXISTS idx_pages_status_retryCount 
ON pages(processingStatus, retryCount);

-- Index for gallery queries (generatedImageUrl)
CREATE INDEX IF NOT EXISTS idx_pages_generatedImageUrl 
ON pages(generatedImageUrl);

-- Index for user queries
CREATE INDEX IF NOT EXISTS idx_users_email 
ON users(email);

-- Index for auth queries
CREATE INDEX IF NOT EXISTS idx_users_openId 
ON users(openId);

-- Composite index for common filter patterns
CREATE INDEX IF NOT EXISTS idx_pages_bookId_status_pageNumber 
ON pages(bookId, processingStatus, pageNumber);

-- Index for date range queries
CREATE INDEX IF NOT EXISTS idx_books_createdAt 
ON books(createdAt DESC);

-- Index for pagination cursor queries
CREATE INDEX IF NOT EXISTS idx_pages_bookId_id 
ON pages(bookId, id DESC);
