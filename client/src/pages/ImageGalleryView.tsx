import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import ImageGalleryVirtualized from "@/components/ImageGalleryVirtualized";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Logo } from "@/components/Logo";
import LegalFooter from "@/components/LegalFooter";

export default function ImageGalleryView() {
  const params = useParams<{ bookId: string }>();
  const [, setLocation] = useLocation();
  const bookId = params ? parseInt(params.bookId) : 0;

  const bookDetailsQuery = trpc.books.getDetails.useQuery(
    { bookId },
    {
      enabled: !!bookId,
      refetchInterval: (query) => {
        const book = query.state.data as any;
        if (!book) return false;
        const isProcessing = book.processingStatus === "processing" || book.processingStatus === "pending";
        const allDone = book.pages?.every((p: any) => p.generatedImageUrl);
        return isProcessing || !allDone ? 3000 : false;
      },
    }
  );

  if (bookDetailsQuery.isLoading) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <header className="sticky top-0 z-50 border-b border-accent/20 bg-background/80 backdrop-blur-md">
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
            <Logo size="sm" />
            <span className="font-semibold text-sm text-foreground/80">LiteralLiterature</span>
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="animate-spin h-12 w-12 text-accent mx-auto mb-4" />
            <p className="text-muted-foreground">Loading gallery...</p>
          </div>
        </div>
        <LegalFooter />
      </div>
    );
  }

  if (bookDetailsQuery.isError || !bookDetailsQuery.data) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <header className="sticky top-0 z-50 border-b border-accent/20 bg-background/80 backdrop-blur-md">
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
            <Logo size="sm" />
            <span className="font-semibold text-sm text-foreground/80">LiteralLiterature</span>
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-red-500 mb-4">Failed to load gallery</p>
            <Button onClick={() => setLocation("/books")}>Back to Books</Button>
          </div>
        </div>
        <LegalFooter />
      </div>
    );
  }

  const book = bookDetailsQuery.data as any;
  const isProcessing = book.processingStatus === "processing" || book.processingStatus === "pending";
  const generatedImages = book.pages
    .filter((page: any) => page.generatedImageUrl)
    .map((page: any) => ({
      id: String(page.id),
      pageNumber: page.pageNumber,
      url: page.generatedImageUrl!,
      title: `Page ${page.pageNumber}`,
    }));

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Nav header */}
      <header className="sticky top-0 z-50 border-b border-accent/20 bg-background/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLocation("/books")}
            className="mr-1"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <Logo size="sm" />
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-semibold text-foreground/80 truncate">
              LiteralLiterature
            </span>
            <span className="text-foreground/40">|</span>
            <span className="font-medium truncate">{book.title}</span>
            {isProcessing && (
              <Loader2 className="w-4 h-4 animate-spin text-accent shrink-0" />
            )}
          </div>
        </div>
      </header>

      {/* Status bar */}
      <div className="border-b border-border/50 bg-muted/30 px-4 py-2">
        <div className="max-w-7xl mx-auto flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {generatedImages.length} of {book.pageCount} pages illustrated
          </span>
          {isProcessing && (
            <span className="text-accent text-xs animate-pulse">
              Generating images — auto-refreshing...
            </span>
          )}
        </div>
      </div>

      {/* Gallery or empty state */}
      <div className="flex-1 p-4">
        <div className="max-w-6xl mx-auto h-full">
          {generatedImages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 gap-4">
              {isProcessing ? (
                <>
                  <Loader2 className="w-10 h-10 animate-spin text-accent" />
                  <p className="text-muted-foreground text-center">
                    Images are being generated. This page will update automatically.
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground">No images available for this book.</p>
              )}
              <Button variant="outline" onClick={() => setLocation("/books")}>
                Back to Books
              </Button>
            </div>
          ) : (
            <ImageGalleryVirtualized
              images={generatedImages}
              isLoading={isProcessing}
              onImageSelect={() => {}}
            />
          )}
        </div>
      </div>

      <LegalFooter />
    </div>
  );
}
