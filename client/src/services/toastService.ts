/**
 * Toast Notification Service
 * Manages toast notifications with queue and lifecycle management
 */

export type ToastType = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message: string;
  duration?: number; // 0 = permanent
  action?: {
    label: string;
    onClick: () => void;
  };
  onClose?: () => void;
  timestamp: number;
}

export interface ToastConfig {
  position: "top-left" | "top-center" | "top-right" | "bottom-left" | "bottom-center" | "bottom-right";
  maxToasts: number;
  defaultDuration: number; // milliseconds
}

type ToastListener = (toasts: Toast[]) => void;

class ToastService {
  private toasts: Map<string, Toast> = new Map();
  private listeners: Set<ToastListener> = new Set();
  private config: ToastConfig = {
    position: "top-right",
    maxToasts: 5,
    defaultDuration: 5000,
  };
  private timeouts: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Update service configuration
   */
  setConfig(config: Partial<ToastConfig>): void {
    this.config = { ...this.config, ...config };
    localStorage.setItem("toastConfig", JSON.stringify(this.config));
  }

  /**
   * Get current configuration
   */
  getConfig(): ToastConfig {
    return { ...this.config };
  }

  /**
   * Load configuration from localStorage
   */
  loadConfig(): void {
    const saved = localStorage.getItem("toastConfig");
    if (saved) {
      try {
        this.config = { ...this.config, ...JSON.parse(saved) };
      } catch (error) {
        console.error("Error loading toast config:", error);
      }
    }
  }

  /**
   * Show success toast
   */
  success(title: string, message: string, options?: Partial<Toast>): string {
    return this.show({
      type: "success",
      title,
      message,
      duration: this.config.defaultDuration,
      ...options,
    });
  }

  /**
   * Show error toast
   */
  error(title: string, message: string, options?: Partial<Toast>): string {
    return this.show({
      type: "error",
      title,
      message,
      duration: this.config.defaultDuration,
      ...options,
    });
  }

  /**
   * Show info toast
   */
  info(title: string, message: string, options?: Partial<Toast>): string {
    return this.show({
      type: "info",
      title,
      message,
      duration: this.config.defaultDuration,
      ...options,
    });
  }

  /**
   * Show warning toast
   */
  warning(title: string, message: string, options?: Partial<Toast>): string {
    return this.show({
      type: "warning",
      title,
      message,
      duration: this.config.defaultDuration,
      ...options,
    });
  }

  /**
   * Show generic toast
   */
  private show(toast: Omit<Toast, "id" | "timestamp">): string {
    // Generate unique ID
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Create toast object
    const toastObj: Toast = {
      ...toast,
      id,
      timestamp: Date.now(),
    };

    // Remove oldest toast if max reached
    if (this.toasts.size >= this.config.maxToasts) {
      const oldest = Array.from(this.toasts.values()).sort(
        (a, b) => a.timestamp - b.timestamp
      )[0];
      this.remove(oldest.id);
    }

    // Add toast
    this.toasts.set(id, toastObj);
    this.notifyListeners();

    // Auto-dismiss if duration is set
    if (toast.duration !== 0 && toast.duration !== undefined) {
      const timeout = setTimeout(() => {
        this.remove(id);
      }, toast.duration);
      this.timeouts.set(id, timeout);
    }

    return id;
  }

  /**
   * Remove toast by ID
   */
  remove(id: string): void {
    const toast = this.toasts.get(id);
    if (toast) {
      // Clear timeout
      const timeout = this.timeouts.get(id);
      if (timeout) {
        clearTimeout(timeout);
        this.timeouts.delete(id);
      }

      // Call onClose callback
      if (toast.onClose) {
        toast.onClose();
      }

      // Remove toast
      this.toasts.delete(id);
      this.notifyListeners();
    }
  }

  /**
   * Remove all toasts
   */
  clear(): void {
    this.timeouts.forEach((timeout) => clearTimeout(timeout));
    this.timeouts.clear();
    this.toasts.clear();
    this.notifyListeners();
  }

  /**
   * Get all toasts
   */
  getToasts(): Toast[] {
    return Array.from(this.toasts.values()).sort(
      (a, b) => b.timestamp - a.timestamp
    );
  }

  /**
   * Subscribe to toast changes
   */
  subscribe(listener: ToastListener): () => void {
    this.listeners.add(listener);

    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Notify all listeners of changes
   */
  private notifyListeners(): void {
    const toasts = this.getToasts();
    this.listeners.forEach((listener) => {
      try {
        listener(toasts);
      } catch (error) {
        console.error("Error in toast listener:", error);
      }
    });
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.clear();
    this.listeners.clear();
  }
}

// Export singleton instance
export const toastService = new ToastService();

// Load configuration on initialization
toastService.loadConfig();
