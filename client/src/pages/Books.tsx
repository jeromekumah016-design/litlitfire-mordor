import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Play, Eye, Image, ChevronLeft, ChevronRight } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useLocation } from "wouter";
import PDFUploadForm from "./PDFUploadForm";
import PDFPreviewCarousel from "./PDFPreviewCarousel";
import PDFPreviewCarouselOptimized from "@/components/PDFPreviewCarouselOptimized";
import DevModeDiagnostics from "./DevModeDiagnostics";
import BookListCard from "@/components/BookListCard";
import BookPageReadingDashboard from "@/components/BookPageReadingDashboard";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";

export default function Books() {
  const [selectedBookId, setSelectedBookId] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [, setLocation] = useLocation();
  const pageSize = 10;
  const { user, loading: authLoading, isAuthenticated } = useAuth();

  const booksQuery = trpc.books.list.useQuery(
    { page: currentPage, pageSize },
    {
      enabled: isAuthenticated,
      retry: false,
      // Poll while any book is still reading / waiting for Stage 1 so phase advances.
      refetchInterval: (query) => {
        const items = (query.state.data as { items?: { pipelinePhase?: string }[] } | undefined)
          ?.items;
        if (!items?.length) return false;
        const busy = items.some(
          (b) => b.pipelinePhase === "reading" || b.pipelinePhase === "extracted"
        );
        return busy ? 3000 : false;
      },
    }
  );
  const bookDetailsQuery = trpc.books.getDetails.useQuery(
    { bookId: selectedBookId! },
    {
      enabled: isAuthenticated && !!selectedBookId,
      refetchInterval: (query) => {
        const phase = (query.state.data as { pipelinePhase?: string } | undefined)
          ?.pipelinePhase;
        return phase === "reading" || phase === "extracted" ? 3000 : false;
      },
    }
  );
  const transcribeMutation = trpc.books.transcribePages.useMutation({
    onSuccess: (data) => {
      toast.success(data.message ?? `Transcribed book ${data.bookId}`);
      booksQuery.refetch();
      if (selectedBookId) {
        bookDetailsQuery.refetch();
      }
    },
    onError: (error) => {
      toast.error(`Transcribe failed: ${error.message}`);
    },
  });

  const deleteMutation = trpc.books.delete.useMutation({
    onSuccess: (_data, vars) => {
      toast.success("Book deleted");
      if (selectedBookId === vars.bookId) setSelectedBookId(null);
      booksQuery.refetch();
    },
    onError: (error) => {
      toast.error(`Delete failed: ${error.message}`);
    },
  });

  const handleTranscribe = (bookId: number) => {
    transcribeMutation.mutate({ bookId });
  };

  const handleDeleteBook = (bookId: number, title?: string) => {
    const label = title ? `"${title}"` : "this book";
    if (
      !window.confirm(
        `Delete ${label}? This removes the book, pages, and generated images from your library.`
      )
    ) {
      return;
    }
    deleteMutation.mutate({ bookId });
  };

  const handleViewBook = (bookId: number) => {
    setSelectedBookId(bookId);
  };

  if (authLoading) {
    return (
      <div className="flex justify-center items-center min-h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 p-8">
        <h1 className="text-2xl font-semibold text-center">Sign in to add books</h1>
        <p className="text-sm text-muted-foreground text-center max-w-md">
          Uploading and listing books requires a session. Locally this uses demo
          login (no Google account needed when Google OAuth is not configured).
        </p>
        <Button asChild size="lg">
          <a href={getLoginUrl("/books")}>Sign in</a>
        </Button>
      </div>
    );
  }

  if (selectedBookId && bookDetailsQuery.data) {
    const book = bookDetailsQuery.data;
    return (
      <div className="space-y-6 parchment-texture p-6 rounded-xl border border-accent/20">
        <div className="flex items-center justify-between gap-4 border-b border-accent/20 pb-4">
          <div className="flex items-center gap-4">
            <Button variant="outline" onClick={() => setSelectedBookId(null)} className="border-accent/40 text-primary hover:bg-accent/10">
              ← Return to Library
            </Button>
            <h1 className="text-4xl literary-heading text-primary">{(book as any).title}</h1>
          </div>
          <div className="flex gap-2">
             <Button variant="ghost" size="icon" className="text-accent" onClick={() => setLocation("/dashboard")} title="Library Dashboard"><Eye className="h-5 w-5" /></Button>
             <Button variant="ghost" size="icon" className="text-accent" onClick={() => setLocation(`/gallery/${(book as any).id}`)} title="View Gallery"><Image className="h-5 w-5" /></Button>
          </div>
        </div>

        {(book as any).description && <p className="text-muted-foreground">{(book as any).description}</p>}

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Main content area now uses the dedicated reading dashboard for pages before photo generation */}
          <div className="lg:col-span-3 space-y-6">
            <BookPageReadingDashboard book={book as any} />

            <DevModeDiagnostics bookId={(book as any).id} />
          </div>

          <div className="space-y-4">
            <Card className="bg-card/50 border-accent/20">
              <CardHeader className="border-b border-accent/10">
                <CardTitle className="text-lg literary-heading text-primary">Folio Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-4">
                <div>
                  <p className="text-sm text-muted-foreground">Package</p>
                  <p className="font-medium">
                    Lite · chapters
                    {(book as any).chapterCount
                      ? ` (${(book as any).chapterCount} detected)`
                      : ""}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {(book as any).pageCount} source pages · Upgraded (per page) is a
                    paid package later
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Lite estimate</p>
                  <p className="font-medium">
                    $
                    {Number(
                      (book as any).liteDisplayPrice ?? (book as any).totalPrice
                    ).toFixed(2)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {(book as any).mainChapterCount ??
                      (book as any).promptReadyCount ??
                      "—"}{" "}
                    chapter image unit(s) (not every source page)
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
                  <p className="font-medium">
                    {(book as any).pipelineLabel ||
                      String((book as any).processingStatus)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Created</p>
                  <p className="font-medium text-sm">
                    {new Date((book as any).createdAt).toLocaleDateString()}
                  </p>
                </div>

                {((book as any).pipelinePhase === "extracted" ||
                  (book as any).pipelinePhase === "reading" ||
                  (!(book as any).pipelinePhase &&
                    (book as any).processingStatus === "pending")) && (
                  <Button
                    onClick={() => handleTranscribe((book as any).id)}
                    disabled={
                      transcribeMutation.isPending ||
                      (book as any).pipelinePhase === "reading"
                    }
                    className="w-full"
                  >
                    {transcribeMutation.isPending ||
                    (book as any).pipelinePhase === "reading" ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Reading book…
                      </>
                    ) : (
                      <>
                        <Play className="mr-2 h-4 w-4" />
                        Stage 1: Build prompts
                      </>
                    )}
                  </Button>
                )}

                {(book as any).pipelinePhase === "needs_approve" && (
                  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2">
                    Prompts ready — approve them in the dashboard, then Stage 2
                    generate.
                  </p>
                )}

                {(book as any).pipelinePhase === "ready_to_render" && (
                  <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md p-2">
                    {(book as any).approvedCount ?? 0} approved — use Stage 2 to
                    generate photos.
                  </p>
                )}

                {((book as any).imageReadyCount > 0 ||
                  (book as any).pages?.some((p: any) => p.generatedImageUrl)) && (
                  <Button
                    onClick={() => setLocation(`/gallery/${(book as any).id}`)}
                    className="w-full bg-amber-600 hover:bg-amber-700"
                  >
                    <Image className="mr-2 h-4 w-4" />
                    View Gallery
                  </Button>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Processing Progress</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Completed Pages</span>
                    <span className="font-medium">
                      {(book as any).pages.filter((p: any) => p.processingStatus === "done").length} /{
                        " "}
                      {(book as any).pageCount}
                    </span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div
                      className="bg-primary h-2 rounded-full transition-all"
                      style={{
                        width: `${((book as any).pages.filter((p: any) => p.processingStatus === "done").length / (book as any).pageCount) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold mb-2">PDF Books</h1>
        <p className="text-muted-foreground">Upload and process PDF books into visual content</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <PDFUploadForm />
        </div>

        <div>
          <Card>
            <CardHeader>
              <CardTitle>How It Works</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div>
                <p className="font-medium mb-1">1. Upload PDF (Lite package)</p>
                <p className="text-muted-foreground">
                  Text is extracted; chapters are found at page breaks and headings
                </p>
              </div>
              <div>
                <p className="font-medium mb-1">2. Approve chapter prompts</p>
                <p className="text-muted-foreground">
                  One illustration per chapter (cheap lite package). Approve before photos.
                </p>
              </div>
              <div>
                <p className="font-medium mb-1">3. Generate Photos</p>
                <p className="text-muted-foreground">
                  Stage 2 renders approved chapters. Per-page images are the paid upgraded package.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Book List Section */}
      <div className="space-y-4">
        <div>
          <h2 className="text-2xl font-bold mb-2">Your Books</h2>
          <p className="text-muted-foreground">Manage and track your PDF processing</p>
        </div>

        {booksQuery.isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : booksQuery.data && (booksQuery.data as any).items && (booksQuery.data as any).items.length > 0 ? (
          <>
            {/* Book Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {(booksQuery.data as any).items.map((book: any) => (
                  <BookListCard
                    key={book.id}
                    id={book.id}
                    title={book.title}
                    description={book.description ?? undefined}
                    pageCount={book.pageCount}
                    processingStatus={book.processingStatus}
                    createdAt={book.createdAt}
                    pipelinePhase={book.pipelinePhase}
                    pipelineLabel={book.pipelineLabel}
                    promptReadyCount={book.promptReadyCount}
                    approvedCount={book.approvedCount}
                    imageReadyCount={book.imageReadyCount}
                    packageTier={book.packageTier}
                    chapterCount={book.chapterCount}
                    mainChapterCount={book.mainChapterCount}
                    liteDisplayPrice={book.liteDisplayPrice}
                    onView={() => handleViewBook(book.id)}
                    onDelete={() => handleDeleteBook(book.id, book.title)}
                  />
                ))}
            </div>

            {/* Pagination */}
            {(booksQuery.data as any).pagination && (booksQuery.data as any).pagination.totalPages > 1 && (
              <div className="flex items-center justify-between mt-6 pt-6 border-t">
                <div className="text-sm text-muted-foreground">
                  Page {currentPage} of {(booksQuery.data as any).pagination.totalPages}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setCurrentPage((p) =>
                        Math.min((booksQuery.data as any).pagination.totalPages, p + 1)
                      )
                    }
                    disabled={currentPage === (booksQuery.data as any).pagination.totalPages}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">No books uploaded yet. Start by uploading a PDF above.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
