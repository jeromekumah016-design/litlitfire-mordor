import React, { memo, useCallback, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface Thumbnail {
  pageNumber: number;
  dataUrl: string;
}

interface PDFPreviewCarouselOptimizedProps {
  thumbnails: Thumbnail[];
  isLoading?: boolean;
  onPageSelect?: (pageNumber: number) => void;
}

/**
 * Memoized thumbnail item component
 */
const ThumbnailItem = memo(
  ({
    thumbnail,
    isSelected,
    onClick,
  }: {
    thumbnail: Thumbnail;
    isSelected: boolean;
    onClick: () => void;
  }) => (
    <button
      onClick={onClick}
      className={`
        flex-shrink-0 w-24 h-32 rounded-lg overflow-hidden
        transition-all duration-200 cursor-pointer
        ${
          isSelected
            ? "ring-2 ring-amber-500 scale-105"
            : "ring-1 ring-gray-300 hover:ring-amber-400"
        }
      `}
      aria-label={`Page ${thumbnail.pageNumber}`}
    >
      <img
        src={thumbnail.dataUrl}
        alt={`Page ${thumbnail.pageNumber}`}
        className="w-full h-full object-cover"
        loading="lazy"
      />
      <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs p-1 text-center">
        {thumbnail.pageNumber}
      </div>
    </button>
  )
);

ThumbnailItem.displayName = "ThumbnailItem";

/**
 * Optimized PDF Preview Carousel with memoization
 * Prevents unnecessary re-renders and optimizes scroll performance
 */
export const PDFPreviewCarouselOptimized = memo(
  function PDFPreviewCarouselOptimized({
    thumbnails,
    isLoading = false,
    onPageSelect,
  }: PDFPreviewCarouselOptimizedProps) {
    const [selectedPage, setSelectedPage] = useState(1);
    const [scrollPosition, setScrollPosition] = useState(0);
    const containerRef = React.useRef<HTMLDivElement>(null);

    // Memoize thumbnail items to prevent re-renders
    const memoizedThumbnails = useMemo(
      () => thumbnails,
      [thumbnails]
    );

    // Memoize handlers with useCallback
    const handlePageSelect = useCallback(
      (pageNumber: number) => {
        setSelectedPage(pageNumber);
        onPageSelect?.(pageNumber);
      },
      [onPageSelect]
    );

    const handleScroll = useCallback(
      (direction: "left" | "right") => {
        if (!containerRef.current) return;

        const container = containerRef.current;
        const scrollAmount = 300; // pixels to scroll
        const newPosition =
          direction === "left"
            ? Math.max(0, scrollPosition - scrollAmount)
            : scrollPosition + scrollAmount;

        container.scrollTo({
          left: newPosition,
          behavior: "smooth",
        });

        setScrollPosition(newPosition);
      },
      [scrollPosition]
    );

    // Memoize scroll handlers
    const handleScrollLeft = useCallback(
      () => handleScroll("left"),
      [handleScroll]
    );

    const handleScrollRight = useCallback(
      () => handleScroll("right"),
      [handleScroll]
    );

    if (isLoading) {
      return (
        <div className="w-full h-40 bg-gray-200 rounded-lg animate-pulse flex items-center justify-center">
          <p className="text-gray-600">Loading PDF preview...</p>
        </div>
      );
    }

    if (memoizedThumbnails.length === 0) {
      return (
        <div className="w-full h-40 bg-gray-100 rounded-lg flex items-center justify-center">
          <p className="text-gray-600">No pages to preview</p>
        </div>
      );
    }

    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">
            Page Preview ({memoizedThumbnails.length} pages)
          </h3>
          <span className="text-xs text-gray-600">
            Selected: Page {selectedPage}
          </span>
        </div>

        <div className="relative">
          {/* Scroll Buttons */}
          <button
            onClick={handleScrollLeft}
            className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-black/50 hover:bg-black/75 text-white p-2 rounded-r-lg transition-colors"
            aria-label="Scroll left"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          <button
            onClick={handleScrollRight}
            className="absolute right-0 top-1/2 -translate-y-1/2 z-10 bg-black/50 hover:bg-black/75 text-white p-2 rounded-l-lg transition-colors"
            aria-label="Scroll right"
          >
            <ChevronRight className="w-5 h-5" />
          </button>

          {/* Carousel Container */}
          <div
            ref={containerRef}
            className="flex gap-3 overflow-x-auto scroll-smooth pb-2 px-12"
            style={{
              scrollBehavior: "smooth",
              WebkitOverflowScrolling: "touch",
            }}
          >
            {memoizedThumbnails.map((thumbnail) => (
              <ThumbnailItem
                key={thumbnail.pageNumber}
                thumbnail={thumbnail}
                isSelected={selectedPage === thumbnail.pageNumber}
                onClick={() => handlePageSelect(thumbnail.pageNumber)}
              />
            ))}
          </div>
        </div>

        {/* Progress Indicator */}
        <div className="w-full h-1 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-amber-400 to-amber-600 transition-all duration-300"
            style={{
              width: `${(selectedPage / memoizedThumbnails.length) * 100}%`,
            }}
          />
        </div>
      </div>
    );
  }
);

export default PDFPreviewCarouselOptimized;
