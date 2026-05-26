import { useParams, useLocation } from "wouter";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import ImageGalleryVirtualized from "@/components/ImageGalleryVirtualized";
import { Button } from "@/components/ui/button";
import { ArrowLeft, RotateCcw } from "lucide-react";

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
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading gallery...</p>
        </div>
      </div>
    );
  }

  if (bookDetailsQuery.isError || !bookDetailsQuery.data) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-red-500 mb-4">Failed to load gallery</p>
          <Button onClick={() => setLocation("/books")}>Back to Books</Button>
        </div>
      </div>
    );
  }

  const book = bookDetailsQuery.data as any;
  const failedPages = book.pages.filter((page: any) => page.processingStatus === "error");
  const generatedImages = book.pages
    .filter((page: any) => page.generatedImageUrl)
    .map((page: any) => ({
      id: String(page.id),
      pageNumber: page.pageNumber,
      url: page.generatedImageUrl!,
      title: `Page ${page.pageNumber}`,
    }));

  if (generatedImages.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">
            No generated images yet. Processing in progress...
          </p>
          <Button onClick={() => setLocation("/books")}>Back to Books</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="border-b bg-background p-4">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-4 mb-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setLocation("/books")}
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div className="flex-1">
              <h1 className="text-2xl font-bold">{(book as any).title}</h1>
              <p className="text-sm text-muted-foreground">
                {generatedImages.length} of {(book as any).pageCount} pages generated
              </p>
            </div>
          </div>

          {/* Retry Failed Pages Alert */}
          {failedPages.length > 0 && (
            <div className="flex items-center gap-3 p-3 bg-amber-950/30 border border-amber-700/50 rounded-md">
              <div className="flex-1">
                <p className="text-sm text-amber-200">
                  {failedPages.length} page{failedPages.length !== 1 ? "s" : ""} failed to process. 
                  Retry when API quota resets.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleRetryFailed}
                disabled={isRetrying || retryMutation.isPending}
                className="gap-2 whitespace-nowrap"
              >
                <RotateCcw className="w-4 h-4" />
                {isRetrying || retryMutation.isPending ? "Retrying..." : "Retry Failed"}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Gallery */}
      <div className="flex-1 p-4">
        <div className="max-w-6xl mx-auto h-full">
          <ImageGalleryVirtualized
            images={generatedImages}
            isLoading={false}
            onImageSelect={() => {}}
          />
        </div>
      </div>
    </div>
  );
}
