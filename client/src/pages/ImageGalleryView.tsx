import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import ImageGalleryVirtualized from "@/components/ImageGalleryVirtualized";
import { Button } from "@/components/ui/button";
import { ArrowLeft, RotateCcw, BookMarked, Sparkles } from "lucide-react";
import { toGalleryImages } from "../../../shared/galleryImages";

export default function ImageGalleryView() {
  const params = useParams<{ bookId: string }>();
  const [, setLocation] = useLocation();
  const bookId = params ? parseInt(params.bookId) : 0;
  const [isRetrying, setIsRetrying] = useState(false);

  const bookDetailsQuery = trpc.books.getDetails.useQuery(
    { bookId },
    { enabled: !!bookId }
  );

  const retryMutation = trpc.books.retryFailedPages.useMutation({
    onSuccess: (result) => {
      setIsRetrying(false);
      // Show success message
      const message = result.message || `Retrying ${result.retriedCount} page(s)`;
      console.log("[Gallery] Retry success:", message);
      // Refetch book details to update UI
      setTimeout(() => bookDetailsQuery.refetch(), 500);
    },
    onError: (error) => {
      setIsRetrying(false);
      console.error("[Gallery] Retry error:", error.message);
    },
  });

  const handleRetryFailed = async () => {
    setIsRetrying(true);
    try {
      await retryMutation.mutateAsync({ bookId });
    } catch (error) {
      console.error("[Gallery] Retry mutation error:", error);
      setIsRetrying(false);
    }
  };

  if (bookDetailsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent mx-auto" />
          <p className="text-muted-foreground">Unveiling your visual story...</p>
        </div>
      </div>
    );
  }

  if (bookDetailsQuery.isError || !bookDetailsQuery.data) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center space-y-4">
          <p className="text-red-500">Failed to load gallery</p>
          <Button onClick={() => setLocation("/books")} variant="outline">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Library
          </Button>
        </div>
      </div>
    );
  }

  const book = bookDetailsQuery.data as any;
  const failedPages = book.pages.filter((page: any) => page.processingStatus === "error");
  // Scene-mode rows render with their scene title + source-page subtitle;
  // page-mode rows fall back to "Page N". Mapping lives in a tested shared helper.
  const generatedImages = toGalleryImages(book.pages);

  if (generatedImages.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center space-y-6 max-w-md">
          <div className="flex justify-center">
            <BookMarked className="w-16 h-16 text-accent/50" />
          </div>
          <div>
            <p className="text-lg text-muted-foreground mb-2">
              No generated images yet
            </p>
            <p className="text-sm text-foreground/60">
              Processing in progress... Check back soon to see your visual story unfold.
            </p>
          </div>
          <Button onClick={() => setLocation("/books")} variant="outline">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Library
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Ambient background effects */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="ambient-light ambient-light-warm" style={{ width: '200px', height: '200px', top: '10%', left: '5%', animationDelay: '0s' }} />
        <div className="ambient-light ambient-light-cool" style={{ width: '150px', height: '150px', bottom: '15%', right: '10%', animationDelay: '2s' }} />
      </div>

      {/* Header */}
      <header className="relative z-10 border-b border-accent/20 bg-background/50 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center gap-4 mb-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setLocation("/books")}
              className="hover:bg-accent/10"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <BookMarked className="w-5 h-5 text-accent" />
                <h1 className="text-2xl md:text-3xl font-serif font-bold text-primary">
                  {(book as any).title}
                </h1>
              </div>
              <p className="text-sm text-accent/70">
                {generatedImages.length} of {(book as any).pageCount} pages transformed into visual art
              </p>
            </div>
          </div>

          {/* Retry Failed Pages Alert */}
          {failedPages.length > 0 && (
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 p-4 bg-gradient-to-r from-amber-950/40 to-orange-950/30 border border-amber-700/50 rounded-lg">
              <div className="flex-1">
                <p className="text-sm text-amber-100">
                  <Sparkles className="w-4 h-4 inline mr-2" />
                  {failedPages.length} page{failedPages.length !== 1 ? "s" : ""} awaiting transformation. 
                  Retry when API quota resets.
                </p>
              </div>
              <Button
                size="sm"
                onClick={handleRetryFailed}
                disabled={isRetrying || retryMutation.isPending}
                className="gap-2 whitespace-nowrap bg-accent/80 hover:bg-accent text-background"
              >
                <RotateCcw className="w-4 h-4" />
                {isRetrying || retryMutation.isPending ? "Retrying..." : "Retry Transformation"}
              </Button>
            </div>
          )}
        </div>
      </header>

      {/* Gallery Container */}
      <div className="flex-1 p-4 md:p-8 relative z-10">
        <div className="max-w-7xl mx-auto h-full">
          {/* Gallery Title */}
          <div className="mb-8 text-center space-y-2">
            <h2 className="text-2xl font-serif text-primary">Your Visual Story</h2>
            <p className="text-sm text-foreground/60">
              Each page brought to life through AI-generated imagery
            </p>
          </div>

          {/* Gallery Grid */}
          <ImageGalleryVirtualized
            images={generatedImages}
            isLoading={false}
            onImageSelect={() => {}}
          />
        </div>
      </div>

      {/* Footer with stats */}
      <footer className="relative z-10 border-t border-accent/20 bg-background/50 backdrop-blur-md py-6">
        <div className="max-w-7xl mx-auto px-4 text-center space-y-2">
          <p className="text-sm text-accent/70">
            ✨ {generatedImages.length} pages of visual storytelling
          </p>
          <p className="text-xs text-foreground/50">
            Powered by advanced AI • Every image is unique to your story
          </p>
        </div>
      </footer>
    </div>
  );
}
