import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Clock, Zap } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

interface ProcessingProgressBarProps {
  progress: number; // 0-100
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  currentPage: number;
  totalPages: number;
  estimatedTimeRemaining: number; // in milliseconds
  currentStep?: string;
  error?: string;
}

/**
 * Animated progress bar component for PDF processing
 */
export default function ProcessingProgressBar({
  progress,
  status,
  currentPage,
  totalPages,
  estimatedTimeRemaining,
  currentStep,
  error,
}: ProcessingProgressBarProps) {
  const [displayProgress, setDisplayProgress] = useState(progress);
  const [animatedProgress, setAnimatedProgress] = useState(progress);

  // Smooth progress animation
  useEffect(() => {
    const interval = setInterval(() => {
      setAnimatedProgress((prev) => {
        const diff = displayProgress - prev;
        if (Math.abs(diff) < 1) return displayProgress;
        return prev + diff * 0.1;
      });
    }, 100);

    return () => clearInterval(interval);
  }, [displayProgress]);

  useEffect(() => {
    setDisplayProgress(progress);
  }, [progress]);

  // Format time remaining
  const formatTimeRemaining = (ms: number): string => {
    if (ms <= 0) return "Calculating...";
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `${seconds}s remaining`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m remaining`;
    const hours = Math.round(minutes / 60);
    return `${hours}h remaining`;
  };

  // Get status color
  const getStatusColor = (): string => {
    switch (status) {
      case "completed":
        return "bg-green-500";
      case "failed":
        return "bg-red-500";
      case "cancelled":
        return "bg-yellow-500";
      case "processing":
        return "bg-blue-500";
      default:
        return "bg-gray-500";
    }
  };

  // Get status icon
  const getStatusIcon = () => {
    switch (status) {
      case "completed":
        return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case "failed":
        return <AlertCircle className="w-5 h-5 text-red-500" />;
      case "processing":
        return <Zap className="w-5 h-5 text-blue-500 animate-pulse" />;
      default:
        return <Clock className="w-5 h-5 text-gray-500" />;
    }
  };

  return (
    <Card className="w-full p-6 bg-slate-900 border-slate-700">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          {getStatusIcon()}
          <div>
            <h3 className="font-semibold text-white capitalize">
              {status === "processing" ? "Processing PDF..." : `Processing ${status}`}
            </h3>
            <p className="text-sm text-slate-400">
              Page {currentPage} of {totalPages}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-amber-400">{Math.round(animatedProgress)}%</p>
          <p className="text-xs text-slate-400">{formatTimeRemaining(estimatedTimeRemaining)}</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-4">
        <Progress value={animatedProgress} className="h-3" />
      </div>

      {/* Current step */}
      {currentStep && status === "processing" && (
        <div className="mb-3 p-3 bg-slate-800 rounded-lg border border-slate-700">
          <p className="text-sm text-slate-300">
            <span className="text-amber-400 font-medium">Current step:</span> {currentStep}
          </p>
        </div>
      )}

      {/* Error message */}
      {error && status === "failed" && (
        <div className="p-3 bg-red-900/20 border border-red-700 rounded-lg">
          <p className="text-sm text-red-300">
            <span className="font-medium">Error:</span> {error}
          </p>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-slate-700">
        <div className="text-center">
          <p className="text-xs text-slate-400">Pages Processed</p>
          <p className="text-lg font-semibold text-white">{currentPage}</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-slate-400">Total Pages</p>
          <p className="text-lg font-semibold text-white">{totalPages}</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-slate-400">Time Remaining</p>
          <p className="text-lg font-semibold text-amber-400">
            {Math.round(estimatedTimeRemaining / 1000)}s
          </p>
        </div>
      </div>
    </Card>
  );
}
