import { useState, memo, useMemo, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";

interface DevModeDiagnosticsProps {
  bookId: number;
}

interface DiagnosticsPage {
  id: number;
  pageNumber: number;
  thumbnailUrl?: string | null;
  ocrText?: string | null;
  generatedPrompt?: string | null;
  generatedImageUrl?: string | null;
  processingStatus: string;
  promptStatus?: string | null;
  imageStatus?: string | null;
  skipSuggested?: boolean | null;
  errorMessage?: string | null;
  retryCount?: number | null;
  maxRetries?: number | null;
  // Scene-mode rows only (legacy dual read path; scene pipeline has no live
  // writer as of the gate-pipeline cutover, but old scene-mode books can
  // still have rows shaped this way).
  sceneTitle?: string | null;
  sourcePage?: number | null;
  promptStructured?: {
    chapterTitle?: string;
    unitTitle?: string;
    sourcePages?: number[];
    packageTier?: string;
    genres?: string[];
  } | null;
}

/** Live gate-pipeline status badge (functional bar §2-4: transcribe -> approve -> render). */
function statusBadge(page: DiagnosticsPage) {
  if (page.imageStatus === "image_ready")
    return <Badge className="bg-emerald-700 text-white">Photo Ready</Badge>;
  if (page.imageStatus === "generating")
    return <Badge className="bg-blue-600 text-white">Rendering…</Badge>;
  if (page.imageStatus === "image_error")
    return <Badge variant="destructive">Image Error</Badge>;
  if (page.promptStatus === "approved")
    return <Badge className="bg-amber-600 text-white">Approved</Badge>;
  if (page.promptStatus === "prompt_ready")
    return <Badge className="bg-green-600 text-white">Prompt Ready</Badge>;
  if (page.promptStatus === "transcribing")
    return <Badge className="bg-blue-500 text-white">Transcribing</Badge>;
  if (page.skipSuggested)
    return (
      <Badge variant="outline" className="text-muted-foreground">
        Skipped
      </Badge>
    );
  if (page.promptStatus === "prompt_error")
    return <Badge variant="destructive">Prompt Error</Badge>;
  if (page.processingStatus === "error") return <Badge variant="destructive">Error</Badge>;
  if (page.processingStatus === "processing")
    return <Badge variant="secondary">Processing</Badge>;
  if (page.ocrText) return <Badge variant="outline">Extracted</Badge>;
  return <Badge variant="outline">Pending</Badge>;
}

const DevModeDiagnosticsContent = memo(function DevModeDiagnosticsContent({
  bookId,
}: DevModeDiagnosticsProps) {
  const [expandedPageId, setExpandedPageId] = useState<number | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const handleToggleRefresh = useCallback(() => {
    setAutoRefresh((prev) => !prev);
  }, []);

  const handleTogglePage = useCallback((pageId: number) => {
    setExpandedPageId((prev) => (prev === pageId ? null : pageId));
  }, []);

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

  const book = bookDetailsQuery.data as any;
  const pages: DiagnosticsPage[] = (book?.pages as DiagnosticsPage[]) || [];
  const isSceneMode = book?.generationMode === "scene";
  const readingProfile = (book?.readingProfile ?? null) as {
    genres?: string[];
    authorIntent?: string;
  } | null;

  // Gate-pipeline counts (server-computed via derivePipelinePhase; prefer
  // these over client re-derivation so diagnostics never drift from the
  // same truth the real approve/render UI uses).
  const promptReadyCount: number = book?.promptReadyCount ?? 0;
  const approvedCount: number = book?.approvedCount ?? 0;
  const imageReadyCount: number = book?.imageReadyCount ?? 0;

  const stats = useMemo(
    () => ({
      total: pages.length,
      pending: pages.filter((p) => p.processingStatus === "pending").length,
      processing: pages.filter((p) => p.processingStatus === "processing").length,
      done: pages.filter((p) => p.processingStatus === "done").length,
      error: pages.filter((p) => p.processingStatus === "error").length,
      skipped: pages.filter((p) => p.skipSuggested).length,
      needsRetry: pages.filter(
        (p) =>
          p.processingStatus === "error" &&
          (p.retryCount ?? 0) < (p.maxRetries ?? 3)
      ).length,
      totalRetries: pages.reduce((sum, p) => sum + (p.retryCount || 0), 0),
    }),
    [pages]
  );

  const pageLabel = (page: DiagnosticsPage): { title: string; subtitle?: string } => {
    if (page.sceneTitle) {
      return {
        title: `Scene ${page.pageNumber} — ${page.sceneTitle}`,
        subtitle: page.sourcePage != null ? `from page ${page.sourcePage}` : undefined,
      };
    }
    const chapterTitle =
      page.promptStructured?.chapterTitle || page.promptStructured?.unitTitle;
    if (chapterTitle) {
      const sourcePages = page.promptStructured?.sourcePages;
      const range =
        sourcePages && sourcePages.length >= 2 && sourcePages[0] !== sourcePages[1]
          ? `pages ${sourcePages[0]}–${sourcePages[1]}`
          : `page ${page.pageNumber}`;
      return { title: chapterTitle, subtitle: range };
    }
    return { title: `Page ${page.pageNumber}` };
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Dev Mode Diagnostics</CardTitle>
              <CardDescription>
                Real-time processing status for book {bookId}
                {isSceneMode && (
                  <span className="ml-2 text-amber-600 font-medium">(legacy scene mode)</span>
                )}
                {book?.pipelineLabel && (
                  <span className="ml-2">— {book.pipelineLabel}</span>
                )}
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleToggleRefresh}
              className="gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              {autoRefresh ? "Auto" : "Manual"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Extraction statistics */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">
              Extraction (Stage 0 — text/thumbnail)
            </p>
            <div className="grid grid-cols-6 gap-2">
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
              <div className="bg-muted p-3 rounded-lg text-center">
                <div className="text-2xl font-bold">{stats.skipped}</div>
                <div className="text-xs text-muted-foreground">Skipped</div>
              </div>
            </div>
          </div>

          {/* Gate-pipeline statistics (Stage 1 transcribe -> approve -> Stage 2 render) */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">
              Gate pipeline (Stage 1 transcribe → human approve → Stage 2 render)
            </p>
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-green-50 border border-green-200 p-3 rounded-lg text-center">
                <div className="text-2xl font-bold text-green-700">{promptReadyCount}</div>
                <div className="text-xs text-green-700">Prompt ready or approved</div>
              </div>
              <div className="bg-amber-50 border border-amber-200 p-3 rounded-lg text-center">
                <div className="text-2xl font-bold text-amber-700">{approvedCount}</div>
                <div className="text-xs text-amber-700">Approved (awaiting/rendering)</div>
              </div>
              <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-lg text-center">
                <div className="text-2xl font-bold text-emerald-700">{imageReadyCount}</div>
                <div className="text-xs text-emerald-700">Photos ready</div>
              </div>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="font-medium">Text Extraction Progress</span>
              <span className="text-muted-foreground">
                {stats.done} / {stats.total}
              </span>
            </div>
            <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
              <div
                className="bg-green-500 h-2 transition-all"
                style={{ width: `${stats.total ? (stats.done / stats.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Reading profile: genre discovery + author intent (Stage 1 multi-pass reading) */}
      {(readingProfile?.genres?.length || readingProfile?.authorIntent || book?.chapterCount) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Reading Profile</CardTitle>
            <CardDescription>
              {book?.packageTier ? `${book.packageTier} package` : null}
              {book?.chapterCount != null &&
                ` · ${book.chapterCount} chapter(s) detected, ${book?.mainChapterCount ?? "?"} illustrated`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {readingProfile?.genres?.length ? (
              <div className="flex flex-wrap gap-1">
                {readingProfile.genres.map((g) => (
                  <Badge key={g} variant="outline" className="text-xs">
                    {g}
                  </Badge>
                ))}
              </div>
            ) : null}
            {readingProfile?.authorIntent && (
              <p className="text-xs text-muted-foreground">{readingProfile.authorIntent}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Pages / Chapters / Scenes List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {isSceneMode ? "Scene Processing Details" : "Page & Chapter Processing Details"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {pages.map((page) => {
              const label = pageLabel(page);
              return (
                <div
                  key={page.id}
                  className="border rounded-lg overflow-hidden hover:shadow-sm transition-shadow"
                >
                  <button
                    onClick={() => handleTogglePage(page.id)}
                    className="w-full p-3 flex items-center justify-between hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-3 flex-1 text-left">
                      {statusBadge(page)}
                      <span className="font-medium">
                        {label.title}
                        {label.subtitle && (
                          <span className="text-muted-foreground font-normal ml-1 text-sm">
                            ({label.subtitle})
                          </span>
                        )}
                      </span>
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

                      {/* Skip reason (lite package skips non-anchor / non-plot pages) */}
                      {page.skipSuggested && (
                        <div className="bg-muted border rounded p-2">
                          <p className="text-xs font-semibold">Skipped from illustration</p>
                          {page.errorMessage && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {page.errorMessage}
                            </p>
                          )}
                        </div>
                      )}

                      {/* Scene info card (legacy scene mode only) */}
                      {page.sceneTitle && (
                        <div className="bg-amber-50 border border-amber-200 rounded p-2 space-y-1">
                          <p className="text-xs font-semibold text-amber-800">
                            {page.sceneTitle}
                          </p>
                          {page.sourcePage != null && (
                            <p className="text-xs text-amber-700">
                              Source page {page.sourcePage}
                            </p>
                          )}
                        </div>
                      )}

                      {/* Gate status */}
                      <div className="flex flex-wrap gap-2 text-xs">
                        <span className="text-muted-foreground">
                          promptStatus: <span className="font-mono">{page.promptStatus ?? "—"}</span>
                        </span>
                        <span className="text-muted-foreground">
                          imageStatus: <span className="font-mono">{page.imageStatus ?? "—"}</span>
                        </span>
                        {(page.retryCount ?? 0) > 0 && (
                          <span className="text-muted-foreground">
                            retries: {page.retryCount}/{page.maxRetries ?? 3}
                          </span>
                        )}
                      </div>

                      {/* OCR Text / Scene Description */}
                      {page.ocrText && (
                        <div>
                          <p className="text-sm font-medium mb-1">
                            {page.sceneTitle ? "Scene Description:" : "OCR Text:"}
                          </p>
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

                      {/* Error Message (non-skip errors only; skip reason shown above) */}
                      {page.errorMessage && !page.skipSuggested && (
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
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
});

export default DevModeDiagnosticsContent;
