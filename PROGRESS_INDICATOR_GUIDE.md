# Visual Progress Indicator Implementation Guide

## Overview

This guide explains how to integrate the comprehensive visual progress indicator system for batch PDF processing. The system provides real-time feedback with animated progress bars, detailed page-by-page status, and estimated time remaining.

---

## Architecture

### Backend Components

**ProgressTracker Service** (`server/progressTracker.ts`):
- Manages real-time progress tracking for batch operations
- Emits progress events with detailed page status
- Calculates estimated time remaining based on historical data
- Automatically cleans up after 24 hours

**Progress Router** (`server/progressRouter.ts`):
- Exposes tRPC endpoints for progress queries
- Supports polling-based progress updates
- Provides cancel functionality for long operations

### Frontend Components

**ProcessingProgressBar** (`client/src/components/ProcessingProgressBar.tsx`):
- Animated progress bar with smooth transitions
- Real-time status indicators (processing, completed, failed)
- Estimated time remaining display
- Current step information
- Page count and processing stats

**DetailedProgressPanel** (`client/src/components/DetailedProgressPanel.tsx`):
- Per-page status visualization
- Filterable page list (pending, processing, completed, failed)
- Error details for failed pages
- Summary statistics

**useProcessingProgress Hook** (`client/src/hooks/useProcessingProgress.ts`):
- Automatic polling for progress updates
- Configurable poll interval
- Lifecycle callbacks (onComplete, onError)
- Automatic cleanup

---

## Integration Steps

### Step 1: Add Progress Tracking to Backend Pipeline

**File**: `server/pipelineServiceOptimized.ts`

```typescript
import { getOrCreateProgressTracker } from "./progressTracker";

export async function processBookPipelineOptimized(
  bookId: number,
  pdfBuffer: Buffer,
  onProgress?: (progress: PipelineProgress) => void
): Promise<{ successCount: number; failureCount: number }> {
  // Create progress tracker
  const pdfData = await extractPDFPages(pdfBuffer);
  const totalPages = pdfData.totalPages;
  const tracker = getOrCreateProgressTracker(bookId, totalPages);

  try {
    await updateBook(bookId, { processingStatus: "processing" });

    const pages = pdfData.pages.map((p, idx) => ({
      pageNum: idx + 1,
      ocrText: p.text,
    }));

    const results = [];
    for (let i = 0; i < pages.length; i += MAX_CONCURRENT) {
      const batch = pages.slice(i, i + MAX_CONCURRENT);

      const batchResults = await Promise.allSettled(
        batch.map((item) => {
          // Start page processing
          tracker.startPage(item.pageNum);

          return processPageOptimized(
            bookId,
            item.pageNum,
            pdfBuffer,
            item.ocrText,
            pageContexts,
            (progress) => {
              // Update step progress
              tracker.updatePageStep(
                item.pageNum,
                "ocr", // or other step names
                50 // progress percentage
              );
            }
          ).then((page) => {
            // Mark page as completed
            tracker.completePage(item.pageNum);
            return page;
          }).catch((error) => {
            // Mark page as failed
            tracker.failPage(item.pageNum, error.message);
            throw error;
          });
        })
      );

      results.push(...batchResults);
    }

    tracker.completeProcessing();
    return { successCount: results.length, failureCount: 0 };
  } catch (error) {
    tracker.failProcessing(error instanceof Error ? error.message : String(error));
    throw error;
  }
}
```

### Step 2: Register Progress Router

**File**: `server/routers.ts`

```typescript
import { progressRouter } from "./progressRouter";

export const appRouter = router({
  // ... existing routers
  progress: progressRouter,
});
```

### Step 3: Use Progress Components in UI

**File**: `client/src/pages/PDFUploadForm.tsx` or wherever you show processing status

```typescript
import { useState, useEffect } from "react";
import ProcessingProgressBar from "@/components/ProcessingProgressBar";
import DetailedProgressPanel from "@/components/DetailedProgressPanel";
import { useProcessingProgress, useCancelProcessing } from "@/hooks/useProcessingProgress";

export default function PDFUploadForm() {
  const [bookId, setBookId] = useState<number | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Use progress hook
  const { progress, isLoading, error, isComplete } = useProcessingProgress({
    bookId: bookId || 0,
    enabled: !!bookId && isUploading,
    pollInterval: 1000, // Poll every second
    onComplete: (data) => {
      console.log("Processing complete:", data);
      setIsUploading(false);
    },
    onError: (error) => {
      console.error("Processing error:", error);
    },
  });

  const { cancel, isLoading: isCancelling } = useCancelProcessing();

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      setIsUploading(true);
      
      // Upload PDF and get bookId
      const response = await fetch("/api/trpc/books.upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "My Book",
          pdfData: "...", // base64 encoded PDF
        }),
      });

      const data = await response.json();
      setBookId(data.result.bookId);
    } catch (error) {
      console.error("Upload failed:", error);
      setIsUploading(false);
    }
  };

  return (
    <div>
      {/* Upload form */}
      <form onSubmit={handleUpload}>
        {/* form fields */}
      </form>

      {/* Progress indicator */}
      {isUploading && progress && (
        <div className="space-y-4 mt-6">
          {/* Main progress bar */}
          <ProcessingProgressBar
            progress={progress.overallProgress}
            status={progress.status}
            currentPage={progress.currentPage}
            totalPages={progress.totalPages}
            estimatedTimeRemaining={progress.estimatedTimeRemaining}
            currentStep={progress.currentStep?.displayName}
            error={progress.error}
          />

          {/* Detailed page status */}
          <DetailedProgressPanel
            pageStatuses={progress.pageStatuses}
            totalPages={progress.totalPages}
            failedPages={progress.failedPages}
          />

          {/* Cancel button */}
          <button
            onClick={() => cancel(bookId!)}
            disabled={isCancelling}
            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
          >
            {isCancelling ? "Cancelling..." : "Cancel Processing"}
          </button>
        </div>
      )}
    </div>
  );
}
```

---

## Features

### 1. Real-time Progress Updates

Progress is updated via polling every 1 second (configurable):

```typescript
const { progress } = useProcessingProgress({
  bookId,
  pollInterval: 1000, // 1 second
});
```

### 2. Animated Progress Bar

- Smooth progress animation
- Color-coded status (blue=processing, green=completed, red=failed)
- Displays current page and total pages
- Shows estimated time remaining

### 3. Detailed Page Status

- Per-page processing status
- Filterable by status (pending, processing, completed, failed)
- Error details for failed pages
- Processing duration for each page

### 4. Estimated Time Remaining

Calculated based on:
- Historical page processing times
- Number of remaining pages
- Current processing speed

```typescript
// Average duration = sum of all page durations / number of pages
// ETA = remaining pages * average duration
```

### 5. Automatic Cleanup

Progress trackers are automatically removed after:
- Processing completion
- 24 hours of inactivity

---

## API Reference

### ProgressTracker Class

```typescript
// Create tracker
const tracker = getOrCreateProgressTracker(bookId, totalPages);

// Start page processing
tracker.startPage(pageNumber);

// Update step progress
tracker.updatePageStep(pageNumber, "ocr", 50);

// Mark page complete
tracker.completePage(pageNumber);

// Mark page failed
tracker.failPage(pageNumber, "Error message");

// Get current progress
const progress = tracker.getProgress();

// Get page status
const pageStatus = tracker.getPageStatus(pageNumber);

// Complete processing
tracker.completeProcessing();

// Fail processing
tracker.failProcessing("Error message");

// Cancel processing
tracker.cancel();

// Listen to progress events
tracker.on("progress", (event) => {
  console.log("Progress updated:", event);
});
```

### tRPC Endpoints

```typescript
// Get current progress
trpc.progress.getProgress.useQuery(bookId);

// Get all page statuses
trpc.progress.getPageStatuses.useQuery(bookId);

// Get specific page status
trpc.progress.getPageStatus.useQuery({ bookId, pageNumber });

// Get all active jobs
trpc.progress.getActiveJobs.useQuery();

// Poll for progress updates
trpc.progress.pollProgress.useQuery(bookId);

// Cancel processing
trpc.progress.cancelProcessing.useMutation();
```

### useProcessingProgress Hook

```typescript
const {
  progress,           // Current progress data
  isLoading,          // Is polling in progress
  error,              // Any polling errors
  isComplete,         // Is processing complete
  isProcessing,       // Is currently processing
} = useProcessingProgress({
  bookId,                    // Book ID to track
  enabled: true,             // Enable/disable polling
  pollInterval: 1000,        // Poll interval in ms
  onComplete: (data) => {},  // Callback on completion
  onError: (error) => {},    // Callback on error
});
```

---

## Customization

### Change Poll Interval

```typescript
const { progress } = useProcessingProgress({
  bookId,
  pollInterval: 2000, // Poll every 2 seconds
});
```

### Custom Callbacks

```typescript
const { progress } = useProcessingProgress({
  bookId,
  onComplete: (data) => {
    console.log("Processing complete!");
    // Show success message, redirect, etc.
  },
  onError: (error) => {
    console.error("Processing failed:", error);
    // Show error message
  },
});
```

### Styling

All components use Tailwind CSS and can be customized:

```typescript
// ProcessingProgressBar
<ProcessingProgressBar
  progress={progress.overallProgress}
  status={progress.status}
  // ... other props
/>

// DetailedProgressPanel
<DetailedProgressPanel
  pageStatuses={progress.pageStatuses}
  totalPages={progress.totalPages}
  failedPages={progress.failedPages}
/>
```

---

## Performance Considerations

1. **Polling Interval**: Default 1 second. Increase for lower server load, decrease for faster feedback.

2. **Page Status Updates**: Only pages being processed are updated. Completed pages are cached.

3. **Memory**: Progress trackers are automatically cleaned up after 24 hours.

4. **Concurrent Processing**: Up to 3 pages can be processed concurrently (configurable).

---

## Troubleshooting

### Progress not updating

1. Check that `bookId` is set correctly
2. Verify `enabled` is `true` in the hook
3. Check browser console for errors
4. Verify backend is emitting progress events

### Estimated time incorrect

- ETA is calculated based on historical page durations
- First few pages may have inaccurate estimates
- Estimates improve as more pages are processed

### Progress stuck at 100%

- Check that `tracker.completeProcessing()` is called
- Verify error handling in pipeline

---

## Next Steps

1. Integrate progress tracking into PDF upload flow
2. Test with various PDF sizes
3. Monitor performance and adjust poll interval
4. Add persistence for progress recovery
5. Implement WebSocket for real-time updates (optional)

