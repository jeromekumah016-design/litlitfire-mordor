import { useEffect, useCallback, useRef } from "react";
import { useProcessingProgress } from "@/hooks/useProcessingProgress";
import { useCompletionNotifications } from "@/hooks/useCompletionNotifications";

interface ProgressWithNotificationsOptions {
  bookId: number | null;
  enabled?: boolean;
  showNotifications?: boolean;
  playSound?: boolean;
}

/**
 * Hook that integrates progress tracking with toast notifications and sound alerts
 * Automatically shows notifications when processing completes or fails
 */
export function useProgressWithNotifications(
  options: ProgressWithNotificationsOptions
) {
  const {
    bookId,
    enabled = true,
    showNotifications = true,
    playSound = true,
  } = options;

  const startTimeRef = useRef<number>(0);
  const notificationShownRef = useRef<boolean>(false);

  const notifications = useCompletionNotifications({
    showToast: showNotifications,
    playSound,
  });

  const progress = useProcessingProgress({
    bookId: bookId || 0,
    enabled: enabled && bookId !== null,
    onComplete: (data) => {
      // Prevent duplicate notifications
      if (notificationShownRef.current) return;
      notificationShownRef.current = true;

      const processingTime = Math.round((Date.now() - startTimeRef.current) / 1000);

      if (data.status === "completed") {
        notifications.showProcessingComplete(
          data.processedPages,
          processingTime
        );
      } else if (data.status === "failed") {
        notifications.showProcessingError(
          data.failedPages,
          data.totalPages
        );
      }
    },
  });

  // Reset notification flag when bookId changes
  useEffect(() => {
    if (bookId) {
      notificationShownRef.current = false;
      startTimeRef.current = Date.now();
    }
  }, [bookId]);

  return {
    progress,
    notifications,
  };
}

/**
 * Hook to show progress notifications on demand
 */
export function useProgressNotificationTrigger() {
  const notifications = useCompletionNotifications();

  const notifyProcessingStarted = useCallback(
    (pageCount: number) => {
      notifications.showProcessingStarted(pageCount);
    },
    [notifications]
  );

  const notifyProcessingComplete = useCallback(
    (pageCount: number, processingTime: number) => {
      notifications.showProcessingComplete(pageCount, processingTime);
    },
    [notifications]
  );

  const notifyProcessingError = useCallback(
    (failedPages: number, totalPages: number) => {
      notifications.showProcessingError(failedPages, totalPages);
    },
    [notifications]
  );

  return {
    notifyProcessingStarted,
    notifyProcessingComplete,
    notifyProcessingError,
  };
}
