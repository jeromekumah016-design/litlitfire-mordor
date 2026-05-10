import { useEffect, useState, useCallback, useRef } from "react";

interface ProgressData {
  bookId: number;
  totalPages: number;
  processedPages: number;
  failedPages: number;
  currentPage: number;
  overallProgress: number;
  estimatedTimeRemaining: number;
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  pageStatuses: Array<{
    pageNumber: number;
    status: "pending" | "processing" | "completed" | "error";
    progress: number;
    error?: string;
    duration?: number;
  }>;
  currentStep?: string;
  error?: string;
  timestamp: number;
}

interface UseProcessingProgressOptions {
  bookId: number;
  enabled?: boolean;
  pollInterval?: number; // in milliseconds, default 1000ms
  onComplete?: (data: ProgressData) => void;
  onError?: (error: Error) => void;
}

/**
 * Custom hook for polling progress updates
 * Automatically handles polling, cleanup, and state management
 */
export function useProcessingProgress({
  bookId,
  enabled = true,
  pollInterval = 1000,
  onComplete,
  onError,
}: UseProcessingProgressOptions) {
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastProgressRef = useRef<ProgressData | null>(null);

  // No tRPC query needed - we'll use fetch directly for polling

  // Manual polling function
  const poll = useCallback(async () => {
    if (!enabled) return;

    try {
      setIsLoading(true);
      setError(null);

      // Fetch progress data
      const response = await fetch(`/api/trpc/progress.pollProgress?input=${bookId}`);
      if (!response.ok) throw new Error("Failed to fetch progress");

      const data = await response.json();
      const progressData = data.result;

      if (progressData) {
        setProgress(progressData);
        lastProgressRef.current = progressData;

        // Call onComplete if processing is done
        if (
          (progressData.status === "completed" ||
            progressData.status === "failed" ||
            progressData.status === "cancelled") &&
          onComplete
        ) {
          onComplete(progressData);
        }
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      if (onError) onError(error);
    } finally {
      setIsLoading(false);
    }
  }, [bookId, enabled, onComplete, onError]);

  // Setup polling
  useEffect(() => {
    if (!enabled) {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      return;
    }

    // Poll immediately
    poll();

    // Setup interval
    pollIntervalRef.current = setInterval(poll, pollInterval);

    // Cleanup
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [enabled, pollInterval, poll]);

  // Stop polling when processing is complete
  useEffect(() => {
    if (
      progress &&
      (progress.status === "completed" ||
        progress.status === "failed" ||
        progress.status === "cancelled")
    ) {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    }
  }, [progress?.status]);

  return {
    progress: progress || lastProgressRef.current,
    isLoading,
    error,
    isComplete:
      progress?.status === "completed" ||
      progress?.status === "failed" ||
      progress?.status === "cancelled",
    isProcessing: progress?.status === "processing",
  };
}

/**
 * Hook to cancel processing
 */
export function useCancelProcessing() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const cancel = useCallback(async (bookId: number) => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch(`/api/trpc/progress.cancelProcessing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: bookId }),
      });

      if (!response.ok) throw new Error("Failed to cancel processing");
      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      console.error("Failed to cancel processing:", error);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    cancel,
    isLoading,
    error,
  };
}
