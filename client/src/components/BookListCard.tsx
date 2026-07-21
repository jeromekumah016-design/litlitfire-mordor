import React, { memo } from "react";
import { BookOpen, Clock, CheckCircle, AlertCircle, Trash2, Eye } from "lucide-react";
import { Link } from "wouter";

export type PipelinePhase =
  | "extracted"
  | "reading"
  | "needs_approve"
  | "ready_to_render"
  | "photos_ready"
  | "failed";

interface BookListCardProps {
  id: number;
  title: string;
  description?: string;
  pageCount: number;
  processingStatus: "pending" | "processing" | "completed" | "failed" | string;
  createdAt: Date;
  pipelinePhase?: PipelinePhase | string;
  pipelineLabel?: string;
  promptReadyCount?: number;
  approvedCount?: number;
  imageReadyCount?: number;
  onDelete?: (id: number) => void;
  onView?: (id: number) => void;
}

/**
 * Memoized book list card — shows honest pipeline phase (not a fake "Queued").
 */
export const BookListCard = memo(function BookListCard({
  id,
  title,
  description,
  pageCount,
  processingStatus,
  createdAt,
  pipelinePhase,
  pipelineLabel,
  promptReadyCount = 0,
  approvedCount = 0,
  imageReadyCount = 0,
  onDelete,
  onView,
}: BookListCardProps) {
  const phase = pipelinePhase || (
    processingStatus === "completed"
      ? "photos_ready"
      : processingStatus === "failed"
        ? "failed"
        : processingStatus === "processing"
          ? "reading"
          : "extracted"
  );

  const statusText =
    pipelineLabel ||
    ({
      photos_ready: "Photos ready",
      ready_to_render: `Ready to generate (${approvedCount} approved)`,
      needs_approve: `Approve prompts (${promptReadyCount} ready)`,
      reading: "Reading book…",
      extracted: "Next: build prompts",
      failed: "Failed",
    } as Record<string, string>)[phase] ||
    String(processingStatus);

  const getStatusColor = () => {
    switch (phase) {
      case "photos_ready":
        return "bg-card/40 border-accent/20";
      case "ready_to_render":
      case "needs_approve":
        return "bg-accent/5 border-accent/30";
      case "reading":
        return "bg-blue-50/50 border-blue-200/50";
      case "failed":
        return "bg-red-50/50 border-red-200/50";
      default:
        return "bg-card/40 border-accent/10";
    }
  };

  const getStatusIcon = () => {
    switch (phase) {
      case "photos_ready":
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case "reading":
        return <Clock className="w-5 h-5 text-blue-600 animate-spin" />;
      case "failed":
        return <AlertCircle className="w-5 h-5 text-red-600" />;
      case "ready_to_render":
      case "needs_approve":
        return <CheckCircle className="w-5 h-5 text-amber-600" />;
      default:
        return <Clock className="w-5 h-5 text-yellow-600" />;
    }
  };

  const badgeClass =
    phase === "photos_ready"
      ? "bg-green-100 text-green-700"
      : phase === "reading"
        ? "bg-blue-100 text-blue-700"
        : phase === "failed"
          ? "bg-red-100 text-red-700"
          : phase === "ready_to_render" || phase === "needs_approve"
            ? "bg-amber-100 text-amber-800"
            : "bg-yellow-100 text-yellow-700";

  const formattedDate = new Date(createdAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const ctaLabel =
    phase === "photos_ready"
      ? "View Gallery"
      : phase === "ready_to_render"
        ? "Open to generate"
        : phase === "needs_approve"
          ? "Open to approve"
          : phase === "reading"
            ? "Reading…"
            : phase === "failed"
              ? "Open book"
              : "Open book";

  const showGalleryLink = phase === "photos_ready" || imageReadyCount > 0;

  return (
    <div
      className={`
        rounded-lg border p-5 transition-all duration-300
        hover:shadow-xl hover:-translate-y-1 parchment-texture
        ${getStatusColor()}
      `}
    >
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

        <div
          className={`
            flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium flex-shrink-0 ml-2 max-w-[55%]
            ${badgeClass}
          `}
          title={statusText}
        >
          {getStatusIcon()}
          <span className="truncate">{statusText}</span>
        </div>
      </div>

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

      <div className="flex gap-2">
        {showGalleryLink ? (
          <Link href={`/gallery/${id}`}>
            <button
              onClick={() => onView?.(id)}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors text-sm font-medium"
            >
              <Eye className="w-4 h-4" />
              View Gallery
            </button>
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => onView?.(id)}
            disabled={phase === "reading"}
            className={`
              flex-1 px-3 py-2 rounded-lg text-sm font-medium text-center transition-colors
              ${
                phase === "reading"
                  ? "bg-gray-100 text-gray-500 cursor-wait"
                  : phase === "needs_approve" || phase === "ready_to_render"
                    ? "bg-amber-600 hover:bg-amber-700 text-white"
                    : "bg-primary/10 hover:bg-primary/20 text-primary"
              }
            `}
          >
            {ctaLabel}
          </button>
        )}

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
