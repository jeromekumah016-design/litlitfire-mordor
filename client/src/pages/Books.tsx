import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Play, Eye, Image } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useLocation } from "wouter";
import PDFUploadForm from "./PDFUploadForm";
import PDFPreviewCarousel from "./PDFPreviewCarousel";
import DevModeDiagnostics from "./DevModeDiagnostics";

export default function Books() {
  const [selectedBookId, setSelectedBookId] = useState<number | null>(null);
  const [, setLocation] = useLocation();

  const booksQuery = trpc.books.list.useQuery();
  const bookDetailsQuery = trpc.books.getDetails.useQuery(
    { bookId: selectedBookId! },
    { enabled: !!selectedBookId }
  );
  const processPdfMutation = trpc.books.processPdf.useMutation({
    onSuccess: (data) => {
      toast.success(`Processing started for book ${data.bookId}`);
      booksQuery.refetch();
      if (selectedBookId) {
        bookDetailsQuery.refetch();
      }
    },
    onError: (error) => {
      toast.error(`Processing failed: ${error.message}`);
    },
  });

  const handleProcessPdf = (bookId: number) => {
    processPdfMutation.mutate({ bookId });
  };

  const handleViewBook = (bookId: number) => {
    setSelectedBookId(bookId);
  };

  if (selectedBookId && bookDetailsQuery.data) {
    const book = bookDetailsQuery.data;
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="outline" onClick={() => setSelectedBookId(null)}>
            ← Back to Books
          </Button>
          <h1 className="text-3xl font-bold">{book.title}</h1>
        </div>

        {book.description && <p className="text-muted-foreground">{book.description}</p>}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-6">
            <PDFPreviewCarousel pages={book.pages} title={book.title} />
            <DevModeDiagnostics bookId={book.id} />
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Book Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-sm text-muted-foreground">Pages</p>
                  <p className="font-medium">{book.pageCount}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Price</p>
                  <p className="font-medium">${(book.totalPrice / 100).toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
                  <p className="font-medium capitalize">{book.processingStatus}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Created</p>
                  <p className="font-medium text-sm">
                    {new Date(book.createdAt).toLocaleDateString()}
                  </p>
                </div>

                {book.processingStatus === "pending" && (
                  <Button
                    onClick={() => handleProcessPdf(book.id)}
                    disabled={processPdfMutation.isPending}
                    className="w-full"
                  >
                    {processPdfMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <Play className="mr-2 h-4 w-4" />
                        Start Processing
                      </>
                    )}
                  </Button>
                )}

                {book.pages.some((p) => p.generatedImageUrl) && (
                  <Button
                    onClick={() => setLocation(`/gallery/${book.id}`)}
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
                      {book.pages.filter((p) => p.processingStatus === "done").length} /{" "}
                      {book.pageCount}
                    </span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div
                      className="bg-primary h-2 rounded-full transition-all"
                      style={{
                        width: `${(book.pages.filter((p) => p.processingStatus === "done").length / book.pageCount) * 100}%`,
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
                <p className="font-medium mb-1">1. Upload PDF</p>
                <p className="text-muted-foreground">Select a PDF file to get started</p>
              </div>
              <div>
                <p className="font-medium mb-1">2. Processing</p>
                <p className="text-muted-foreground">Each page is processed through OCR and image generation</p>
              </div>
              <div>
                <p className="font-medium mb-1">3. Review</p>
                <p className="text-muted-foreground">View generated images and extracted text</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>


    </div>
  );
}
