import { useState, useMemo } from "react";
import { ChevronDown, ChevronUp, AlertCircle, CheckCircle2, Clock, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface PageStatus {
  pageNumber: number;
  status: "pending" | "processing" | "completed" | "error";
  progress: number;
  error?: string;
  duration?: number;
}

interface DetailedProgressPanelProps {
  pageStatuses: PageStatus[];
  totalPages: number;
  failedPages: number;
}

/**
 * Detailed progress panel showing per-page status
 */
export default function DetailedProgressPanel({
  pageStatuses,
  totalPages,
  failedPages,
}: DetailedProgressPanelProps) {
  const [expandedPages, setExpandedPages] = useState<Set<number>>(new Set());
  const [filterStatus, setFilterStatus] = useState<"all" | "pending" | "processing" | "completed" | "error">("all");

  // Filter pages based on selected status
  const filteredPages = useMemo(() => {
    if (filterStatus === "all") return pageStatuses;
    return pageStatuses.filter((p) => p.status === filterStatus);
  }, [pageStatuses, filterStatus]);

  // Count pages by status
  const statusCounts = useMemo(() => {
    const counts = {
      pending: 0,
      processing: 0,
      completed: 0,
      error: 0,
    };
    pageStatuses.forEach((p) => {
      counts[p.status]++;
    });
    return counts;
  }, [pageStatuses]);

  const togglePageExpanded = (pageNumber: number) => {
    const newExpanded = new Set(expandedPages);
    if (newExpanded.has(pageNumber)) {
      newExpanded.delete(pageNumber);
    } else {
      newExpanded.add(pageNumber);
    }
    setExpandedPages(newExpanded);
  };

  const getStatusIcon = (status: PageStatus["status"]) => {
    switch (status) {
      case "completed":
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case "error":
        return <AlertCircle className="w-4 h-4 text-red-500" />;
      case "processing":
        return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
      default:
        return <Clock className="w-4 h-4 text-slate-400" />;
    }
  };

  const getStatusBgColor = (status: PageStatus["status"]) => {
    switch (status) {
      case "completed":
        return "bg-green-900/20 border-green-700";
      case "error":
        return "bg-red-900/20 border-red-700";
      case "processing":
        return "bg-blue-900/20 border-blue-700";
      default:
        return "bg-slate-800 border-slate-700";
    }
  };

  return (
    <Card className="w-full bg-slate-900 border-slate-700">
      {/* Header */}
      <div className="p-4 border-b border-slate-700">
        <h3 className="font-semibold text-white mb-3">Page-by-Page Status</h3>

        {/* Status filters */}
        <div className="flex gap-2 flex-wrap">
          <Button
            variant={filterStatus === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilterStatus("all")}
            className="text-xs"
          >
            All ({totalPages})
          </Button>
          <Button
            variant={filterStatus === "pending" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilterStatus("pending")}
            className="text-xs"
          >
            Pending ({statusCounts.pending})
          </Button>
          <Button
            variant={filterStatus === "processing" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilterStatus("processing")}
            className="text-xs"
          >
            Processing ({statusCounts.processing})
          </Button>
          <Button
            variant={filterStatus === "completed" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilterStatus("completed")}
            className="text-xs"
          >
            Completed ({statusCounts.completed})
          </Button>
          {failedPages > 0 && (
            <Button
              variant={filterStatus === "error" ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterStatus("error")}
              className="text-xs"
            >
              Failed ({statusCounts.error})
            </Button>
          )}
        </div>
      </div>

      {/* Pages list */}
      <div className="max-h-96 overflow-y-auto">
        {filteredPages.length === 0 ? (
          <div className="p-4 text-center text-slate-400">
            <p>No pages with status: {filterStatus}</p>
          </div>
        ) : (
          filteredPages.map((page) => (
            <div
              key={page.pageNumber}
              className={`border-b border-slate-700 transition-colors hover:bg-slate-800/50 ${getStatusBgColor(page.status)}`}
            >
              <button
                onClick={() => togglePageExpanded(page.pageNumber)}
                className="w-full px-4 py-3 flex items-center justify-between text-left"
              >
                <div className="flex items-center gap-3 flex-1">
                  {getStatusIcon(page.status)}
                  <div className="flex-1">
                    <p className="text-sm font-medium text-white">Page {page.pageNumber}</p>
                    <p className="text-xs text-slate-400 capitalize">{page.status}</p>
                  </div>
                  {page.progress > 0 && page.progress < 100 && (
                    <div className="text-xs text-slate-400">{page.progress}%</div>
                  )}
                  {page.duration && (
                    <div className="text-xs text-slate-400">{(page.duration / 1000).toFixed(1)}s</div>
                  )}
                </div>
                {page.error && (
                  expandedPages.has(page.pageNumber) ? (
                    <ChevronUp className="w-4 h-4 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                  )
                )}
              </button>

              {/* Expanded error details */}
              {expandedPages.has(page.pageNumber) && page.error && (
                <div className="px-4 pb-3 pt-0">
                  <div className="p-2 bg-red-900/30 border border-red-700 rounded text-xs text-red-300">
                    <p className="font-medium mb-1">Error Details:</p>
                    <p className="break-words">{page.error}</p>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Summary */}
      <div className="p-4 border-t border-slate-700 bg-slate-800/50">
        <div className="grid grid-cols-4 gap-2 text-center text-xs">
          <div>
            <p className="text-slate-400">Pending</p>
            <p className="font-semibold text-white">{statusCounts.pending}</p>
          </div>
          <div>
            <p className="text-slate-400">Processing</p>
            <p className="font-semibold text-blue-400">{statusCounts.processing}</p>
          </div>
          <div>
            <p className="text-slate-400">Completed</p>
            <p className="font-semibold text-green-400">{statusCounts.completed}</p>
          </div>
          <div>
            <p className="text-slate-400">Failed</p>
            <p className="font-semibold text-red-400">{statusCounts.error}</p>
          </div>
        </div>
      </div>
    </Card>
  );
}
