import React, { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { 
  BookOpen, 
  Play, 
  ChevronLeft, 
  ChevronRight, 
  Search, 
  Image as ImageIcon,
  FileText 
} from "lucide-react";

interface Page {
  id: number;
  pageNumber: number;
  thumbnailUrl?: string | null;
  ocrText?: string | null;
  generatedPrompt?: string | null;
  generatedImageUrl?: string | null;
  processingStatus: string;
  errorMessage?: string | null;
}

interface BookPageReadingDashboardProps {
  book: {
    id: number;
    title: string;
    pageCount: number;
    processingStatus: string;
    pages: Page[];
  };
  onStartGeneration?: () => void;
  isGenerating?: boolean;
}

/**
 * BookPageReadingDashboard
 * 
 * A dedicated reading / review dashboard for extracted book pages.
 * This is the area where users can read the book content (OCR text) page-by-page
 * BEFORE (or while preparing for) the software generates AI photos/illustrations.
 * 
 * Features:
 * - Prominent "Generate Photos" CTA (pre-generation action)
 * - Reader-focused main pane with large, readable text
 * - Page browser / list with search
 * - Status indicators per page
 * - Clean literary styling matching the app
 */
export default function BookPageReadingDashboard({
  book,
  onStartGeneration,
  isGenerating = false,
}: BookPageReadingDashboardProps) {
  const [selectedPageNumber, setSelectedPageNumber] = useState<number>(
    book.pages.length > 0 ? book.pages[0].pageNumber : 1
  );
  const [searchTerm, setSearchTerm] = useState("");

  const pages = book.pages || [];

  // Current selected page for the reading view
  const currentPage = useMemo(
    () => pages.find((p) => p.pageNumber === selectedPageNumber) || pages[0],
    [pages, selectedPageNumber]
  );

  // Filtered + sorted pages for the sidebar browser
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
  const currentIndex = pages.findIndex((p) => p.pageNumber === selectedPageNumber);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < pages.length - 1;

  const goToPage = (pageNumber: number) => {
    setSelectedPageNumber(pageNumber);
  };

  const goPrev = () => {
    if (hasPrev) {
      const prevPage = pages[currentIndex - 1];
      setSelectedPageNumber(prevPage.pageNumber);
    }
  };

  const goNext = () => {
    if (hasNext) {
      const nextPage = pages[currentIndex + 1];
      setSelectedPageNumber(nextPage.pageNumber);
    }
  };

  const getStatusBadge = (status: string) => {
    const base = "text-xs px-2 py-0.5 rounded-full font-medium";
    if (status === "done") return <Badge className={`${base} bg-green-600 text-white`}>Photo Ready</Badge>;
    if (status === "processing") return <Badge className={`${base} bg-blue-600 text-white`}>Generating</Badge>;
    if (status === "error") return <Badge variant="destructive" className={base}>Error</Badge>;
    return <Badge variant="outline" className={base}>Pending Review</Badge>;
  };

  const handleGenerateClick = () => {
    if (onStartGeneration) {
      onStartGeneration();
    }
  };

  return (
    <div className="space-y-4">
      {/* Dashboard Header */}
      <div className="flex items-center justify-between border-b border-accent/20 pb-3">
        <div>
          <div className="flex items-center gap-3">
            <BookOpen className="w-6 h-6 text-accent" />
            <div>
              <h2 className="text-2xl literary-heading text-primary">Page Reading Dashboard</h2>
              <p className="text-sm text-muted-foreground">
                Review &amp; read extracted pages before AI photo generation
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right text-sm">
            <div className="font-medium">{book.pageCount} pages extracted</div>
            <div className="text-muted-foreground">Status: <span className="capitalize">{book.processingStatus}</span></div>
          </div>

          <Button
            onClick={handleGenerateClick}
            disabled={isGenerating || !hasPages || book.processingStatus === "processing"}
            className="gap-2 bg-amber-600 hover:bg-amber-700 text-white px-6"
            size="lg"
          >
            <Play className="w-4 h-4" />
            {isGenerating ? "Starting Generation..." : "Generate Photos from These Pages"}
          </Button>
        </div>
      </div>

      {!hasPages ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <FileText className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
            <p className="font-medium">No pages extracted yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Upload a PDF or start processing to populate pages for reading.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Reader Main Pane (large reading area) */}
          <div className="lg:col-span-8 space-y-3">
            <Card className="border-accent/20 shadow-inner">
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="text-3xl font-bold tabular-nums text-primary">{currentPage?.pageNumber ?? "?"}</div>
                  <div>
                    <CardTitle className="text-xl">Page {currentPage?.pageNumber}</CardTitle>
                    <p className="text-xs text-muted-foreground">of {pages.length} • Ready for illustration</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {currentPage && getStatusBadge(currentPage.processingStatus)}

                  <div className="flex gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={goPrev}
                      disabled={!hasPrev}
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={goNext}
                      disabled={!hasNext}
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                {/* Visual */}
                <div className="relative rounded-lg overflow-hidden border border-accent/10 bg-black/5 flex items-center justify-center min-h-[220px] max-h-[320px]">
                  {currentPage?.generatedImageUrl ? (
                    <img
                      src={currentPage.generatedImageUrl}
                      alt={`Generated illustration for page ${currentPage.pageNumber}`}
                      className="max-h-full max-w-full object-contain"
                    />
                  ) : currentPage?.thumbnailUrl ? (
                    <img
                      src={currentPage.thumbnailUrl}
                      alt={`Page ${currentPage.pageNumber} preview`}
                      className="max-h-full max-w-full object-contain opacity-90"
                    />
                  ) : (
                    <div className="text-center p-8">
                      <ImageIcon className="w-12 h-12 mx-auto mb-2 text-muted-foreground/60" />
                      <p className="text-sm text-muted-foreground">No preview image yet</p>
                    </div>
                  )}
                </div>

                {/* Reading Area - the core "for reading" experience */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <FileText className="w-4 h-4 text-accent" />
                    <span className="font-semibold text-sm tracking-wide">Extracted Text — Read Here</span>
                  </div>

                  <div 
                    className="prose prose-stone dark:prose-invert max-w-none bg-white/70 border border-accent/10 rounded-lg p-6 min-h-[260px] max-h-[380px] overflow-auto font-serif leading-relaxed text-[15px] shadow-inner"
                  >
                    {currentPage?.ocrText ? (
                      currentPage.ocrText
                    ) : (
                      <span className="italic text-muted-foreground">
                        No text extracted for this page yet. Processing may still be running.
                      </span>
                    )}
                  </div>

                  {currentPage?.generatedPrompt && (
                    <div className="mt-3 text-xs">
                      <span className="font-medium text-accent/80">AI Illustration Prompt prepared:</span>
                      <p className="mt-1 text-muted-foreground line-clamp-2">{currentPage.generatedPrompt}</p>
                    </div>
                  )}

                  {currentPage?.errorMessage && (
                    <div className="mt-3 rounded bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                      <strong>Error:</strong> {currentPage.errorMessage}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <div className="text-[10px] text-muted-foreground px-1">
              Tip: Read the page content above. When ready, click <span className="font-medium">Generate Photos from These Pages</span> to have the software create consistent AI illustrations based on the full story context.
            </div>
          </div>

          {/* Page Browser / List (sidebar for navigation + quick scan) */}
          <div className="lg:col-span-4 space-y-3">
            <Card className="border-accent/20 h-full">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Search className="w-4 h-4" /> Browse Pages
                </CardTitle>
                <div className="pt-1">
                  <Input
                    placeholder="Search page number or text..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
              </CardHeader>

              <CardContent className="p-0">
                <div className="max-h-[520px] overflow-auto divide-y divide-accent/10">
                  {filteredPages.length === 0 && (
                    <div className="p-4 text-sm text-muted-foreground text-center">No matching pages.</div>
                  )}

                  {filteredPages.map((page) => {
                    const isActive = page.pageNumber === selectedPageNumber;
                    const snippet = page.ocrText 
                      ? page.ocrText.substring(0, 90).replace(/\s+/g, " ") + (page.ocrText.length > 90 ? "..." : "") 
                      : "No text yet";

                    return (
                      <button
                        key={page.id}
                        onClick={() => goToPage(page.pageNumber)}
                        className={`w-full text-left px-4 py-3 transition-colors hover:bg-accent/5 flex gap-3 ${isActive ? "bg-accent/10 border-l-4 border-accent" : ""}`}
                      >
                        <div className="font-mono text-xs w-8 shrink-0 pt-0.5 text-primary/70">{page.pageNumber}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            {getStatusBadge(page.processingStatus)}
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-2 leading-snug">{snippet}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
