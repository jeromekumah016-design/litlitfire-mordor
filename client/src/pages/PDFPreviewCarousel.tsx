import { useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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

interface PDFPreviewCarouselProps {
  pages: Page[];
  title: string;
  isLoading?: boolean;
}

export default function PDFPreviewCarousel({ pages, title, isLoading = false }: PDFPreviewCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);

  if (!pages || pages.length === 0) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Preview</CardTitle>
          <CardDescription>No pages available</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const currentPage = pages[currentIndex];
  const hasNextPage = currentIndex < pages.length - 1;
  const hasPrevPage = currentIndex > 0;

  const goNext = () => {
    if (hasNextPage) setCurrentIndex(currentIndex + 1);
  };

  const goPrev = () => {
    if (hasPrevPage) setCurrentIndex(currentIndex - 1);
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          Page {currentPage.pageNumber} of {pages.length}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Carousel */}
        <div className="space-y-4">
          {/* Main Image */}
          <div className="relative bg-muted rounded-lg overflow-hidden aspect-video flex items-center justify-center">
            {currentPage.processingStatus === "processing" ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Processing...</p>
              </div>
            ) : currentPage.processingStatus === "error" ? (
              <div className="flex flex-col items-center gap-2 p-4 text-center">
                <p className="text-sm font-medium text-destructive">Processing Error</p>
                {currentPage.errorMessage && (
                  <p className="text-xs text-muted-foreground">{currentPage.errorMessage}</p>
                )}
              </div>
            ) : currentPage.generatedImageUrl ? (
              <img
                src={currentPage.generatedImageUrl}
                alt={`Generated image for page ${currentPage.pageNumber}`}
                className="w-full h-full object-cover"
              />
            ) : currentPage.thumbnailUrl ? (
              <img
                src={currentPage.thumbnailUrl}
                alt={`Thumbnail for page ${currentPage.pageNumber}`}
                className="w-full h-full object-cover opacity-50"
              />
            ) : (
              <p className="text-sm text-muted-foreground">No image available</p>
            )}
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={goPrev}
              disabled={!hasPrevPage || isLoading}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>

            <div className="flex-1 text-center text-sm text-muted-foreground">
              {currentIndex + 1} / {pages.length}
            </div>

            <Button
              variant="outline"
              size="icon"
              onClick={goNext}
              disabled={!hasNextPage || isLoading}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Page Details */}
        <div className="space-y-4 border-t pt-4">
          {/* Status Badge */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Status:</span>
            <span
              className={`text-xs px-2 py-1 rounded-full ${
                currentPage.processingStatus === "done"
                  ? "bg-green-100 text-green-700"
                  : currentPage.processingStatus === "processing"
                    ? "bg-blue-100 text-blue-700"
                    : currentPage.processingStatus === "error"
                      ? "bg-red-100 text-red-700"
                      : "bg-gray-100 text-gray-700"
              }`}
            >
              {currentPage.processingStatus}
            </span>
          </div>

          {/* OCR Text */}
          {currentPage.ocrText && (
            <div>
              <p className="text-sm font-medium mb-2">OCR Text:</p>
              <p className="text-sm text-muted-foreground line-clamp-3">{currentPage.ocrText}</p>
            </div>
          )}

          {/* Generated Prompt */}
          {currentPage.generatedPrompt && (
            <div>
              <p className="text-sm font-medium mb-2">Generated Prompt:</p>
              <p className="text-sm text-muted-foreground line-clamp-3">{currentPage.generatedPrompt}</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
