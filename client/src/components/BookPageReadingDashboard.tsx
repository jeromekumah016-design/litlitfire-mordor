import React, { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Search,
  Image as ImageIcon,
  FileText,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";

interface Page {
  id: number;
  pageNumber: number;
  thumbnailUrl?: string | null;
  ocrText?: string | null;
  generatedPrompt?: string | null;
  generatedImageUrl?: string | null;
  generatedImageFileKey?: string | null;
  processingStatus: string;
  promptStatus?: string;
  imageStatus?: string;
  skipSuggested?: boolean;
  errorMessage?: string | null;
}

interface BookPageReadingDashboardProps {
  book: {
    id: number;
    title: string;
    pageCount: number;
    processingStatus: string;
    storyBible?: unknown;
    pages: Page[];
  };
  /** @deprecated use Stage buttons; kept for call-site compat */
  onStartGeneration?: () => void;
  isGenerating?: boolean;
}

/**
 * Two-phase review dashboard (functional bar §2–3).
 * Stage 1: Transcribe → storyBible + prompts
 * Review: approve per page (server enforces promptStatus === approved for render)
 * Stage 2: Render only approved pages
 */
export default function BookPageReadingDashboard({
  book,
}: BookPageReadingDashboardProps) {
  const [selectedPageNumber, setSelectedPageNumber] = useState<number>(
    book.pages.length > 0 ? book.pages[0].pageNumber : 1
  );
  const [searchTerm, setSearchTerm] = useState("");

  const utils = trpc.useUtils();
  const invalidate = () => utils.books.getDetails.invalidate({ bookId: book.id });

  const stage1Mut = trpc.books.transcribePages.useMutation({
    onSuccess: (data) => {
      toast.success(
        `Transcribed ${data.transcribed} page(s)` +
          (data.biblePersisted ? " · story bible saved" : " · no bible (empty text?)")
      );
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const approveMut = trpc.books.setPromptApproved.useMutation({
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(e.message),
  });

  const stage2Mut = trpc.books.renderApprovedImages.useMutation({
    onSuccess: (data) => {
      toast.success(data.message ?? `Rendered ${data.rendered} image(s)`);
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const pages = book.pages || [];
  const currentPage = useMemo(
    () => pages.find((p) => p.pageNumber === selectedPageNumber) || pages[0],
    [pages, selectedPageNumber]
  );

  const filteredPages = useMemo(() => {
    let result = [...pages];
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase().trim();
      result = result.filter(
        (p) =>
          p.pageNumber.toString().includes(term) ||
          (p.ocrText && p.ocrText.toLowerCase().includes(term))
      );
    }
    return result.sort((a, b) => a.pageNumber - b.pageNumber);
  }, [pages, searchTerm]);

  const hasPages = pages.length > 0;
  const approvedCount = pages.filter((p) => p.promptStatus === "approved").length;
  const promptReadyCount = pages.filter(
    (p) => p.promptStatus === "prompt_ready" || p.promptStatus === "approved"
  ).length;
  const imageReadyCount = pages.filter((p) => p.imageStatus === "image_ready").length;
  const currentIndex = pages.findIndex((p) => p.pageNumber === selectedPageNumber);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < pages.length - 1;

  const getStatusBadge = (p: Page) => {
    if (p.imageStatus === "image_ready")
      return <Badge className="bg-emerald-700 text-white text-xs">Photo Ready</Badge>;
    if (p.imageStatus === "generating")
      return <Badge className="bg-blue-600 text-white text-xs">Rendering…</Badge>;
    if (p.promptStatus === "approved")
      return <Badge className="bg-amber-600 text-white text-xs">Approved</Badge>;
    if (p.promptStatus === "prompt_ready")
      return <Badge className="bg-green-600 text-white text-xs">Prompt Ready</Badge>;
    if (p.promptStatus === "transcribing")
      return <Badge className="bg-blue-500 text-white text-xs">Transcribing</Badge>;
    if (p.promptStatus === "prompt_error" || p.imageStatus === "image_error")
      return <Badge variant="destructive" className="text-xs">Error</Badge>;
    if (p.ocrText)
      return <Badge variant="outline" className="text-xs">OCR Ready</Badge>;
    return <Badge variant="outline" className="text-xs">Pending</Badge>;
  };

  const busy =
    stage1Mut.isPending || stage2Mut.isPending || approveMut.isPending;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-accent/20 pb-3">
        <div className="flex items-center gap-3">
          <BookOpen className="w-6 h-6 text-accent" />
          <div>
            <h2 className="text-2xl literary-heading text-primary">
              Prompt Review &amp; Photo Generation
            </h2>
            <p className="text-sm text-muted-foreground">
              Stage 1: Transcribe → review &amp; approve → Stage 2: Generate photos
              {book.storyBible ? " · story bible saved" : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => stage1Mut.mutate({ bookId: book.id })}
            disabled={busy || !hasPages}
            variant="outline"
            className="gap-2"
          >
            {stage1Mut.isPending ? "Transcribing…" : "Stage 1: Transcribe → Prompts"}
          </Button>
          <Button
            onClick={() => stage2Mut.mutate({ bookId: book.id })}
            disabled={busy || approvedCount === 0}
            className="gap-2 bg-amber-600 hover:bg-amber-700 text-white"
          >
            {stage2Mut.isPending
              ? "Rendering…"
              : `Stage 2: Generate Photos (${approvedCount} approved)`}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
        <span>Pages: {pages.length}</span>
        <span>Prompts: {promptReadyCount}</span>
        <span>Approved: {approvedCount}</span>
        <span>Photos: {imageReadyCount}</span>
      </div>

      {!hasPages ? (
        <Card className="border-accent/20">
          <CardContent className="py-12 text-center text-muted-foreground">
            No pages extracted yet. Re-upload the PDF or wait for extract to finish.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-1 border-accent/20 bg-card/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Pages</CardTitle>
              <Input
                placeholder="Search…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="h-8"
              />
            </CardHeader>
            <CardContent className="space-y-1 max-h-[480px] overflow-y-auto">
              {filteredPages.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedPageNumber(p.pageNumber)}
                  className={`w-full text-left px-3 py-2 rounded-md text-sm flex items-center justify-between gap-2 ${
                    p.pageNumber === selectedPageNumber
                      ? "bg-accent/20 border border-accent/40"
                      : "hover:bg-muted/50"
                  }`}
                >
                  <span className="font-medium">Page {p.pageNumber}</span>
                  {getStatusBadge(p)}
                </button>
              ))}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2 border-accent/20">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-lg literary-heading">
                Page {currentPage?.pageNumber ?? "—"}
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  disabled={!hasPrev}
                  onClick={() =>
                    hasPrev && setSelectedPageNumber(pages[currentIndex - 1].pageNumber)
                  }
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  disabled={!hasNext}
                  onClick={() =>
                    hasNext && setSelectedPageNumber(pages[currentIndex + 1].pageNumber)
                  }
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {currentPage && (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    {getStatusBadge(currentPage)}
                    {(currentPage.promptStatus === "prompt_ready" ||
                      currentPage.promptStatus === "approved") && (
                      <label className="flex items-center gap-2 text-sm select-none cursor-pointer">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={currentPage.promptStatus === "approved"}
                          disabled={
                            approveMut.isPending ||
                            currentPage.imageStatus === "image_ready"
                          }
                          onChange={() =>
                            approveMut.mutate({
                              pageId: currentPage.id,
                              approved: currentPage.promptStatus !== "approved",
                            })
                          }
                        />
                        <CheckCircle2 className="h-4 w-4 text-amber-600" />
                        Approve for photo generation
                      </label>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center gap-2 text-sm font-medium mb-1">
                      <FileText className="h-4 w-4" /> Source text (OCR)
                    </div>
                    <div className="rounded-md border border-accent/10 bg-muted/30 p-3 text-sm whitespace-pre-wrap max-h-40 overflow-y-auto">
                      {currentPage.ocrText?.trim() || (
                        <span className="text-muted-foreground italic">No text extracted</span>
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center gap-2 text-sm font-medium mb-1">
                      Image prompt
                    </div>
                    <div className="rounded-md border border-accent/10 bg-muted/30 p-3 text-sm whitespace-pre-wrap">
                      {currentPage.generatedPrompt?.trim() || (
                        <span className="text-muted-foreground italic">
                          Run Stage 1 to generate a prompt
                        </span>
                      )}
                    </div>
                  </div>

                  {currentPage.generatedImageUrl && (
                    <div>
                      <div className="flex items-center gap-2 text-sm font-medium mb-1">
                        <ImageIcon className="h-4 w-4" /> Generated photo
                      </div>
                      <img
                        src={currentPage.generatedImageUrl}
                        alt={`Page ${currentPage.pageNumber}`}
                        className="max-w-full rounded-md border border-accent/20"
                      />
                      {currentPage.generatedImageFileKey && (
                        <p className="text-xs text-muted-foreground mt-1 font-mono">
                          key: {currentPage.generatedImageFileKey}
                        </p>
                      )}
                    </div>
                  )}

                  {currentPage.errorMessage && (
                    <p className="text-sm text-destructive">{currentPage.errorMessage}</p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
