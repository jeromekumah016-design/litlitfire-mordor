import React, { useEffect, useState } from "react";
import { useToast } from "@/contexts/ToastContext";
import { Toast } from "@/services/toastService";
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from "lucide-react";

/**
 * Individual Toast Component
 */
function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const [isExiting, setIsExiting] = useState(false);

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(onClose, 300); // Match animation duration
  };

  const getIcon = () => {
    switch (toast.type) {
      case "success":
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case "error":
        return <AlertCircle className="w-5 h-5 text-red-500" />;
      case "warning":
        return <AlertTriangle className="w-5 h-5 text-yellow-500" />;
      case "info":
        return <Info className="w-5 h-5 text-blue-500" />;
    }
  };

  const getBgColor = () => {
    switch (toast.type) {
      case "success":
        return "bg-green-50 border-green-200";
      case "error":
        return "bg-red-50 border-red-200";
      case "warning":
        return "bg-yellow-50 border-yellow-200";
      case "info":
        return "bg-blue-50 border-blue-200";
    }
  };

  const getTextColor = () => {
    switch (toast.type) {
      case "success":
        return "text-green-900";
      case "error":
        return "text-red-900";
      case "warning":
        return "text-yellow-900";
      case "info":
        return "text-blue-900";
    }
  };

  return (
    <div
      className={`
        transform transition-all duration-300 ease-out
        ${isExiting ? "translate-x-full opacity-0" : "translate-x-0 opacity-100"}
      `}
    >
      <div
        className={`
          flex items-start gap-3 p-4 rounded-lg border
          ${getBgColor()}
          shadow-lg backdrop-blur-sm
          max-w-sm
        `}
      >
        {/* Icon */}
        <div className="flex-shrink-0 pt-0.5">{getIcon()}</div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <h3 className={`font-semibold text-sm ${getTextColor()}`}>
            {toast.title}
          </h3>
          {toast.message && (
            <p className={`text-sm mt-1 ${getTextColor()} opacity-90`}>
              {toast.message}
            </p>
          )}

          {/* Action Button */}
          {toast.action && (
            <button
              onClick={() => {
                toast.action?.onClick();
                handleClose();
              }}
              className={`
                mt-2 text-sm font-medium
                ${
                  toast.type === "success"
                    ? "text-green-600 hover:text-green-700"
                    : toast.type === "error"
                      ? "text-red-600 hover:text-red-700"
                      : toast.type === "warning"
                        ? "text-yellow-600 hover:text-yellow-700"
                        : "text-blue-600 hover:text-blue-700"
                }
                transition-colors
              `}
            >
              {toast.action.label}
            </button>
          )}
        </div>

        {/* Close Button */}
        <button
          onClick={handleClose}
          className={`
            flex-shrink-0 p-1 rounded hover:bg-black/10
            transition-colors
            ${getTextColor()}
          `}
          aria-label="Close notification"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

/**
 * Toast Container Component
 * Displays all active toasts
 */
export function ToastContainer() {
  const { toasts, remove } = useToast();
  const [position, setPosition] = useState<string>("top-right");

  // Get position classes
  const getPositionClasses = () => {
    const baseClasses = "fixed z-50 pointer-events-none";
    const positionClasses: Record<string, string> = {
      "top-left": "top-4 left-4",
      "top-center": "top-4 left-1/2 -translate-x-1/2",
      "top-right": "top-4 right-4",
      "bottom-left": "bottom-4 left-4",
      "bottom-center": "bottom-4 left-1/2 -translate-x-1/2",
      "bottom-right": "bottom-4 right-4",
    };

    return `${baseClasses} ${positionClasses[position] || positionClasses["top-right"]}`;
  };

  return (
    <div className={getPositionClasses()}>
      <div className="flex flex-col gap-3 pointer-events-auto">
        {toasts.map((toast) => (
          <ToastItem
            key={toast.id}
            toast={toast}
            onClose={() => remove(toast.id)}
          />
        ))}
      </div>
    </div>
  );
}

export default ToastContainer;
