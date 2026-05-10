import { useEffect, useCallback } from "react";
import { useToast } from "@/contexts/ToastContext";
import { soundAlertService } from "@/services/soundAlertService";

interface CompletionNotificationOptions {
  showToast?: boolean;
  playSound?: boolean;
  soundType?: "success" | "error";
  toastDuration?: number;
  onNotificationShown?: () => void;
}

/**
 * Hook to show completion notifications with toast and sound
 */
export function useCompletionNotifications(
  options: CompletionNotificationOptions = {}
) {
  const {
    showToast = true,
    playSound = true,
    soundType = "success",
    toastDuration = 5000,
    onNotificationShown,
  } = options;

  const { success, error, info } = useToast();

  /**
   * Show success notification
   */
  const showSuccess = useCallback(
    (title: string, message: string, actionLabel?: string, onAction?: () => void) => {
      if (showToast) {
        success(title, message, {
          duration: toastDuration,
          action: actionLabel && onAction ? { label: actionLabel, onClick: onAction } : undefined,
        });
      }

      if (playSound) {
        soundAlertService.playSuccessNotification();
      }

      onNotificationShown?.();
    },
    [showToast, playSound, toastDuration, success, onNotificationShown]
  );

  /**
   * Show error notification
   */
  const showError = useCallback(
    (title: string, message: string, actionLabel?: string, onAction?: () => void) => {
      if (showToast) {
        error(title, message, {
          duration: toastDuration,
          action: actionLabel && onAction ? { label: actionLabel, onClick: onAction } : undefined,
        });
      }

      if (playSound) {
        soundAlertService.playErrorNotification();
      }

      onNotificationShown?.();
    },
    [showToast, playSound, toastDuration, error, onNotificationShown]
  );

  /**
   * Show info notification
   */
  const showInfo = useCallback(
    (title: string, message: string, actionLabel?: string, onAction?: () => void) => {
      if (showToast) {
        info(title, message, {
          duration: toastDuration,
          action: actionLabel && onAction ? { label: actionLabel, onClick: onAction } : undefined,
        });
      }

      if (playSound) {
        soundAlertService.playInfo();
      }

      onNotificationShown?.();
    },
    [showToast, playSound, toastDuration, info, onNotificationShown]
  );

  /**
   * Show processing complete notification
   */
  const showProcessingComplete = useCallback(
    (pageCount: number, processingTime: number) => {
      const minutes = Math.floor(processingTime / 60);
      const seconds = processingTime % 60;
      const timeStr =
        minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

      showSuccess(
        "Processing Complete! 🎉",
        `Successfully processed ${pageCount} page${pageCount !== 1 ? "s" : ""} in ${timeStr}`,
        "View Gallery",
        () => {
          // Navigate to gallery
          window.location.href = "/gallery";
        }
      );
    },
    [showSuccess]
  );

  /**
   * Show processing error notification
   */
  const showProcessingError = useCallback(
    (failedPages: number, totalPages: number) => {
      showError(
        "Processing Failed",
        `${failedPages} of ${totalPages} page${totalPages !== 1 ? "s" : ""} failed to process`,
        "Retry Failed",
        () => {
          // Trigger retry
          window.dispatchEvent(new CustomEvent("retryFailed"));
        }
      );
    },
    [showError]
  );

  /**
   * Show processing started notification
   */
  const showProcessingStarted = useCallback(
    (pageCount: number) => {
      showInfo(
        "Processing Started",
        `Processing ${pageCount} page${pageCount !== 1 ? "s" : ""}...`
      );
    },
    [showInfo]
  );

  return {
    showSuccess,
    showError,
    showInfo,
    showProcessingComplete,
    showProcessingError,
    showProcessingStarted,
  };
}

/**
 * Hook to integrate notifications with progress tracking
 */
export function useProgressNotifications(bookId: number | null) {
  const notifications = useCompletionNotifications();
  const { success } = useToast();

  /**
   * Notify when progress is complete
   */
  const notifyCompletion = useCallback(
    (data: {
      totalPages: number;
      processedPages: number;
      failedPages: number;
      estimatedTimeRemaining: number;
      status: string;
    }) => {
      if (data.status === "completed") {
        const processingTime = Math.round(
          (Date.now() - (data.estimatedTimeRemaining || 0)) / 1000
        );
        notifications.showProcessingComplete(data.processedPages, processingTime);
      } else if (data.status === "failed") {
        notifications.showProcessingError(data.failedPages, data.totalPages);
      }
    },
    [notifications]
  );

  return {
    notifyCompletion,
    ...notifications,
  };
}
