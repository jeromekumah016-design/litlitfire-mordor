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
import { ProcessingProgress } from "@/components/ProcessingProgress";

export default function Books() {
  const [selectedBookId, setSelectedBookId] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [, setLocation] = useLocation();
  const pageSize = 10;

  const booksQuery = trpc.books.list.useQuery({ page: currentPage, pageSize });
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
      <div className="space-y-6 parchment-texture p-6 rounded-xl border border-accent/20">
        <div className="flex items-center justify-between gap-4 border-b border-accent/20 pb-4">
          <div className="flex items-center gap-4">
            <Button variant="outline" onClick={() => setSelectedBookId(null)} className="border-accent/40 text-primary hover:bg-accent/10">
              ← Return to Library
            </Button>
            <h1 className="text-4xl literary-heading text-primary">{(book as any).title}</h1>
          </div>
          <div className="flex gap-2">
             <Button variant="ghost" size="icon" className="text-accent"><Eye className="h-5 w-5" /></Button>
             <Button variant="ghost" size="icon" className="text-accent"><Image className="h-5 w-5" /></Button>
          </div>
        </div>

        {(book as any).description && <p className="text-muted-foreground">{(book as any).description}</p>}

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="lg:col-span-3 space-y-6">
            {((book as any).processingStatus === "processing" || (book as any).processingStatus === "failed") && (
              <ProcessingProgress bookId={(book as any).id} autoRefresh={true} refreshInterval={2000} />
            )}
            
            <div className="relative bg-white/50 p-8 rounded-lg shadow-inner border border-accent/10 min-h-[600px] flex flex-col items-center justify-center">
              <div className="absolute top-4 right-4 flex gap-2">
                <span className="px-3 py-1 bg-accent/10 text-accent text-xs rounded-full border border-accent/20">AI Analysis Active</span>
              </div>
              
              <PDFPreviewCarouselOptimized
                thumbnails={(book as any).pages.map((page: any) => ({
                  pageNumber: page.pageNumber,
                  dataUrl: page.thumbnailUrl || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect fill='%23f0f0f0' width='100' height='100'/%3E%3Ctext x='50' y='50' text-anchor='middle' dy='.3em' fill='%23999'%3EPage %3C/text%3E%3C/svg%3E",
                }))}
                isLoading={false}
                onPageSelect={() => {}}
              />

              <div className="mt-8 w-full grid grid-cols-2 gap-4">
                <div className="marginalia">
                  <h4 className="font-bold text-primary mb-1">Atmospheric Note</h4>
                  <p className="text-sm">The prose here suggests a shift towards gothic romanticism, with heavy emphasis on nature as a sentient force.</p>
                </div>
                <div className="p-4 bg-accent/5 border border-accent/20 rounded-md">
                   <h4 className="text-xs uppercase tracking-widest text-accent font-bold mb-2">Literary Devices</h4>
                   <div className="flex flex-wrap gap-2">
                      <span className="px-2 py-1 bg-primary/10 text-primary text-[10px] rounded border border-primary/20">Personification</span>
                      <span className="px-2 py-1 bg-primary/10 text-primary text-[10px] rounded border border-primary/20">Alliteration</span>
                   </div>
                </div>
              </div>
            </div>

            <DevModeDiagnostics bookId={(book as any).id} />
          </div>

          <div className="space-y-4">
            <Card className="bg-card/50 border-accent/20">
              <CardHeader className="border-b border-accent/10">
                <CardTitle className="text-lg literary-heading text-primary">Folio Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-4">
                <div>
                  <p className="text-sm text-muted-foreground">Pages</p>
                  <p className="font-medium">{(book as any).pageCount}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Price</p>
                  <p className="font-medium">${((book as any).totalPrice / 100).toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
                  <p className="font-medium capitalize">{(book as any).processingStatus}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Created</p>
                  <p className="font-medium text-sm">
                    {new Date((book as any).createdAt).toLocaleDateString()}
                  </p>
                </div>

                {((book as any).processingStatus === "pending" ||
                  (book as any).processingStatus === "failed") && (
                  <Button
                    onClick={() => handleProcessPdf((book as any).id)}
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
                        {(book as any).processingStatus === "failed"
                          ? "Reprocess Book"
                          : "Start Processing"}
                      </>
                    )}
                  </Button>
                )}

                {(book as any).pages.some((p: any) => p.generatedImageUrl) && (
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
                    onView={() => handleViewBook(book.id)}
                    onDelete={() => {
                      toast.success(`Book deleted`);
                      booksQuery.refetch();
                    }}
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
