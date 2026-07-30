import React, { memo } from "react";
import { BookOpen, Clock, CheckCircle, AlertCircle, Trash2, Eye } from "lucide-react";
import { Link } from "wouter";

interface BookListCardProps {
  id: number;
  title: string;
  description?: string;
  pageCount: number;
  processingStatus: "pending" | "processing" | "completed" | "failed";
  createdAt: Date;
  onDelete?: (id: number) => void;
  onView?: (id: number) => void;
  onRetry?: (id: number) => void;
}

/**
 * Memoized book list card component
 * Displays book information in a card format with status indicators
 */
export const BookListCard = memo(function BookListCard({
  id,
  title,
  description,
  pageCount,
  processingStatus,
  createdAt,
  onDelete,
  onView,
  onRetry,
}: BookListCardProps) {
  const getStatusColor = () => {
    switch (processingStatus) {
      case "completed":
        return "bg-card/40 border-accent/20";
      case "processing":
        return "bg-accent/5 border-accent/30";
      case "failed":
        return "bg-red-50/50 border-red-200/50";
      case "pending":
        return "bg-card/40 border-accent/10";
    }
  };

  const getStatusIcon = () => {
    switch (processingStatus) {
      case "completed":
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case "processing":
        return <Clock className="w-5 h-5 text-blue-600 animate-spin" />;
      case "failed":
        return <AlertCircle className="w-5 h-5 text-red-600" />;
      case "pending":
        return <Clock className="w-5 h-5 text-yellow-600" />;
    }
  };

  const getStatusText = () => {
    switch (processingStatus) {
      case "completed":
        return "Completed";
      case "processing":
        return "Processing";
      case "failed":
        return "Failed";
      case "pending":
        return "Pending";
    }
  };

  const formattedDate = new Date(createdAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <div
      className={`
        rounded-lg border p-5 transition-all duration-300
        hover:shadow-xl hover:-translate-y-1 parchment-texture
        ${getStatusColor()}
      `}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-start gap-3 flex-1">
          <BookOpen className="w-6 h-6 text-amber-600 flex-shrink-0 mt-1" />
          <div className="flex-1 min-w-0">
            <h3 className="text-xl literary-heading text-primary truncate">
              {title}
            </h3>
            {description && (
              <p className="text-sm font-serif italic text-primary/70 line-clamp-2 mt-1">
                {description}
              </p>
            )}
          </div>
        </div>

        {/* Status Badge */}
        <div
          className={`
            flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium flex-shrink-0 ml-2
            ${
              processingStatus === "completed"
                ? "bg-green-100 text-green-700"
                : processingStatus === "processing"
                  ? "bg-blue-100 text-blue-700"
                  : processingStatus === "failed"
                    ? "bg-red-100 text-red-700"
                    : "bg-yellow-100 text-yellow-700"
            }
          `}
        >
          {getStatusIcon()}
          <span>{getStatusText()}</span>
        </div>
      </div>

      {/* Metadata */}
      <div className="flex items-center gap-4 text-sm text-gray-600 mb-4">
        <span className="flex items-center gap-1">
          <BookOpen className="w-4 h-4" />
          {pageCount} page{pageCount !== 1 ? "s" : ""}
        </span>
        <span className="flex items-center gap-1">
          <Clock className="w-4 h-4" />
          {formattedDate}
        </span>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        {processingStatus === "completed" && (
          <Link href={`/gallery/${id}`}>
            <button
              onClick={() => onView?.(id)}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors text-sm font-medium"
            >
              <Eye className="w-4 h-4" />
              View Gallery
            </button>
          </Link>
        )}

        {processingStatus === "failed" && (
          <button
            onClick={() => onRetry?.(id)}
            className="flex-1 px-3 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg transition-colors text-sm font-medium disabled:opacity-50"
            disabled={!onRetry}
          >
            Retry
          </button>
        )}

        {processingStatus === "pending" || processingStatus === "processing" ? (
          <div className="flex-1 px-3 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm font-medium text-center">
            {processingStatus === "processing"
              ? "Processing..."
              : "Queued"}
          </div>
        ) : null}

        <button
          onClick={() => onDelete?.(id)}
          className="px-3 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg transition-colors"
          aria-label="Delete book"
          title="Delete book"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
});

export default BookListCard;
