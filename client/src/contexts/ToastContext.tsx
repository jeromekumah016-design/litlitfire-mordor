import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { toastService, Toast, ToastConfig } from "@/services/toastService";

interface ToastContextType {
  toasts: Toast[];
  success: (title: string, message: string, options?: Partial<Toast>) => string;
  error: (title: string, message: string, options?: Partial<Toast>) => string;
  info: (title: string, message: string, options?: Partial<Toast>) => string;
  warning: (title: string, message: string, options?: Partial<Toast>) => string;
  remove: (id: string) => void;
  clear: () => void;
  setConfig: (config: Partial<ToastConfig>) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

/**
 * Toast Provider Component
 * Wraps the application to provide toast notification functionality
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Subscribe to toast service changes
  useEffect(() => {
    const unsubscribe = toastService.subscribe((updatedToasts) => {
      setToasts(updatedToasts);
    });

    return unsubscribe;
  }, []);

  const value: ToastContextType = {
    toasts,
    success: useCallback(
      (title, message, options) =>
        toastService.success(title, message, options),
      []
    ),
    error: useCallback(
      (title, message, options) =>
        toastService.error(title, message, options),
      []
    ),
    info: useCallback(
      (title, message, options) =>
        toastService.info(title, message, options),
      []
    ),
    warning: useCallback(
      (title, message, options) =>
        toastService.warning(title, message, options),
      []
    ),
    remove: useCallback((id) => toastService.remove(id), []),
    clear: useCallback(() => toastService.clear(), []),
    setConfig: useCallback((config) => toastService.setConfig(config), []),
  };

  return (
    <ToastContext.Provider value={value}>{children}</ToastContext.Provider>
  );
}

/**
 * Hook to use toast notifications
 */
export function useToast(): ToastContextType {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
}
