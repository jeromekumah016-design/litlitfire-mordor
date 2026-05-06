import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import ImageGallery from "@/components/ImageGallery";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function ImageGalleryView() {
  const params = useParams<{ bookId: string }>();
  const [, setLocation] = useLocation();
  const bookId = params ? parseInt(params.bookId) : 0;

  const bookDetailsQuery = trpc.books.getDetails.useQuery(
    { bookId },
    { enabled: !!bookId }
  );

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

  const book = bookDetailsQuery.data;
  const generatedImages = book.pages
    .filter((page) => page.generatedImageUrl)
    .map((page) => ({
      id: page.id,
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
        <div className="max-w-7xl mx-auto flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLocation("/books")}
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{book.title}</h1>
            <p className="text-sm text-muted-foreground">
              {generatedImages.length} of {book.pageCount} pages generated
            </p>
          </div>
        </div>
      </div>

      {/* Gallery */}
      <div className="flex-1 p-4">
        <div className="max-w-6xl mx-auto h-full">
          <ImageGallery
            images={generatedImages}
            title={`${book.title} - Generated Images`}
            onClose={() => setLocation("/books")}
          />
        </div>
      </div>
    </div>
  );
}
