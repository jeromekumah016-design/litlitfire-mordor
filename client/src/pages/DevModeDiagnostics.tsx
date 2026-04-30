import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";

interface DevModeDiagnosticsProps {
  bookId: number;
}

export default function DevModeDiagnostics({ bookId }: DevModeDiagnosticsProps) {
  const [expandedPageId, setExpandedPageId] = useState<number | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const bookDetailsQuery = trpc.books.getDetails.useQuery(
    { bookId },
    {
      enabled: true,
      refetchInterval: autoRefresh ? 2000 : false,
    }
  );

  if (!bookDetailsQuery.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Dev Mode Diagnostics</CardTitle>
        </CardHeader>
        <CardContent>Loading...</CardContent>
      </Card>
    );
  }

  const book = bookDetailsQuery.data;
  const pages = book.pages || [];

  const stats = {
    total: pages.length,
    pending: pages.filter((p) => p.processingStatus === "pending").length,
    processing: pages.filter((p) => p.processingStatus === "processing").length,
    done: pages.filter((p) => p.processingStatus === "done").length,
    error: pages.filter((p) => p.processingStatus === "error").length,
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Dev Mode Diagnostics</CardTitle>
              <CardDescription>Real-time processing status for book {bookId}</CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAutoRefresh(!autoRefresh)}
              className="gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              {autoRefresh ? "Auto" : "Manual"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Statistics */}
          <div className="grid grid-cols-5 gap-2">
            <div className="bg-muted p-3 rounded-lg text-center">
              <div className="text-2xl font-bold">{stats.total}</div>
              <div className="text-xs text-muted-foreground">Total</div>
            </div>
            <div className="bg-yellow-100 p-3 rounded-lg text-center">
              <div className="text-2xl font-bold text-yellow-700">{stats.pending}</div>
              <div className="text-xs text-yellow-600">Pending</div>
            </div>
            <div className="bg-blue-100 p-3 rounded-lg text-center">
              <div className="text-2xl font-bold text-blue-700">{stats.processing}</div>
              <div className="text-xs text-blue-600">Processing</div>
            </div>
            <div className="bg-green-100 p-3 rounded-lg text-center">
              <div className="text-2xl font-bold text-green-700">{stats.done}</div>
              <div className="text-xs text-green-600">Done</div>
            </div>
            <div className="bg-red-100 p-3 rounded-lg text-center">
              <div className="text-2xl font-bold text-red-700">{stats.error}</div>
              <div className="text-xs text-red-600">Error</div>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="font-medium">Overall Progress</span>
              <span className="text-muted-foreground">
                {stats.done} / {stats.total}
              </span>
            </div>
            <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
              <div
                className="bg-green-500 h-2 transition-all"
                style={{ width: `${(stats.done / stats.total) * 100}%` }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pages List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Page Processing Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {pages.map((page) => (
              <div
                key={page.id}
                className="border rounded-lg overflow-hidden hover:shadow-sm transition-shadow"
              >
                <button
                  onClick={() =>
                    setExpandedPageId(expandedPageId === page.id ? null : page.id)
                  }
                  className="w-full p-3 flex items-center justify-between hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3 flex-1 text-left">
                    <Badge
                      variant={
                        page.processingStatus === "done"
                          ? "default"
                          : page.processingStatus === "processing"
                            ? "secondary"
                            : page.processingStatus === "error"
                              ? "destructive"
                              : "outline"
                      }
                    >
                      {page.processingStatus}
                    </Badge>
                    <span className="font-medium">Page {page.pageNumber}</span>
                  </div>
                  {expandedPageId === page.id ? (
                    <ChevronUp className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  )}
                </button>

                {expandedPageId === page.id && (
                  <div className="border-t p-3 bg-muted/30 space-y-3">
                    {/* Thumbnail */}
                    {page.thumbnailUrl && (
                      <div>
                        <p className="text-sm font-medium mb-2">Thumbnail:</p>
                        <img
                          src={page.thumbnailUrl}
                          alt={`Page ${page.pageNumber} thumbnail`}
                          className="w-full max-h-32 object-cover rounded"
                        />
                      </div>
                    )}

                    {/* OCR Text */}
                    {page.ocrText && (
                      <div>
                        <p className="text-sm font-medium mb-1">OCR Text:</p>
                        <p className="text-xs text-muted-foreground bg-background p-2 rounded line-clamp-4">
                          {page.ocrText}
                        </p>
                      </div>
                    )}

                    {/* Generated Prompt */}
                    {page.generatedPrompt && (
                      <div>
                        <p className="text-sm font-medium mb-1">Generated Prompt:</p>
                        <p className="text-xs text-muted-foreground bg-background p-2 rounded line-clamp-4">
                          {page.generatedPrompt}
                        </p>
                      </div>
                    )}

                    {/* Generated Image */}
                    {page.generatedImageUrl && (
                      <div>
                        <p className="text-sm font-medium mb-2">Generated Image:</p>
                        <img
                          src={page.generatedImageUrl}
                          alt={`Page ${page.pageNumber} generated`}
                          className="w-full max-h-32 object-cover rounded"
                        />
                      </div>
                    )}

                    {/* Error Message */}
                    {page.errorMessage && (
                      <div>
                        <p className="text-sm font-medium mb-1 text-destructive">Error:</p>
                        <p className="text-xs text-destructive/70 bg-destructive/10 p-2 rounded">
                          {page.errorMessage}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
