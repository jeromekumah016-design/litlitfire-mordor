import React, { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { CheckCircle2, AlertCircle, Clock, Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Card } from "@/components/ui/card";

interface ProcessingProgressProps {
  bookId: number;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

export function ProcessingProgress({
  bookId,
  autoRefresh = true,
  refreshInterval = 3000,
}: ProcessingProgressProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Fetch progress data
  const { data: progress, refetch } = trpc.books.getProgress.useQuery(
    { bookId },
    {
      enabled: true,
      refetchInterval: autoRefresh ? refreshInterval : false,
    }
  );

  if (!progress) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-orange-500" />
      </div>
    );
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "done":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "error":
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      case "processing":
        return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
      case "pending":
        return <Clock className="h-4 w-4 text-gray-500" />;
      default:
        return null;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "done":
        return "Completed";
      case "error":
        return "Failed";
      case "processing":
        return "Processing";
      case "pending":
        return "Pending";
      default:
        return status;
    }
  };

  return (
    <div className="space-y-6">
      {/* Overall Progress */}
      <Card className="p-6 bg-slate-900 border-orange-500/20">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">Processing Progress</h3>
            <span className="text-2xl font-bold text-orange-500">
              {progress.progressPercentage}%
            </span>
          </div>

          <Progress
            value={progress.progressPercentage}
            className="h-2 bg-slate-800"
          />

          {/* Status Summary */}
          <div className="grid grid-cols-4 gap-4 mt-6">
            <div className="text-center">
              <div className="text-2xl font-bold text-green-500">
                {progress.completedPages}
              </div>
              <div className="text-xs text-gray-400">Completed</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-500">
                {progress.processingPages}
              </div>
              <div className="text-xs text-gray-400">Processing</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-500">
                {progress.pendingPages}
              </div>
              <div className="text-xs text-gray-400">Pending</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-500">
                {progress.failedPages}
              </div>
              <div className="text-xs text-gray-400">Failed</div>
            </div>
          </div>
        </div>
      </Card>

      {/* Per-Page Status */}
      <Card className="p-6 bg-slate-900 border-orange-500/20">
        <h3 className="text-lg font-semibold text-white mb-4">Page Status</h3>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {progress.pages.map((page) => (
            <div
              key={page.id}
              className="flex items-center justify-between p-3 rounded-lg bg-slate-800/50 hover:bg-slate-800 transition-colors"
            >
              <div className="flex items-center gap-3 flex-1">
                {getStatusIcon(page.processingStatus)}
                <div className="flex-1">
                  <div className="text-sm font-medium text-white">
                    Page {page.pageNumber}
                  </div>
                  {page.errorMessage && (
                    <div className="text-xs text-red-400 truncate">
                      {page.errorMessage}
                    </div>
                  )}
                </div>
              </div>
              <div className="text-xs font-medium text-gray-400">
                {getStatusLabel(page.processingStatus)}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Generated Images Preview (if any) */}
      {progress.pages.some((p) => p.generatedImageUrl) && (
        <Card className="p-6 bg-slate-900 border-orange-500/20">
          <h3 className="text-lg font-semibold text-white mb-4">Generated Images</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {progress.pages
              .filter((p) => p.generatedImageUrl)
              .map((page) => (
                <div key={page.id} className="relative group">
                  <img
                    src={page.generatedImageUrl!}
                    alt={`Page ${page.pageNumber}`}
                    className="w-full h-32 object-cover rounded-lg border border-orange-500/20 group-hover:border-orange-500/50 transition-colors"
                  />
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 rounded-lg">
                    <span className="text-white text-sm font-medium">
                      Page {page.pageNumber}
                    </span>
                  </div>
                </div>
              ))}
          </div>
        </Card>
      )}
    </div>
  );
}
