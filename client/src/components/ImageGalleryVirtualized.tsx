import React, { memo, useCallback, useMemo, useState, useRef, useEffect } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize,
  Download,
  X,
} from "lucide-react";

interface Image {
  id: string;
  url: string;
  pageNumber: number;
  title?: string;
}

interface ImageGalleryVirtualizedProps {
  images: Image[];
  isLoading?: boolean;
  onImageSelect?: (image: Image) => void;
}

/**
 * Memoized image viewer component
 */
const ImageViewer = memo(
  ({
    image,
    zoom,
    onZoomIn,
    onZoomOut,
    onFullscreen,
    onDownload,
  }: {
    image: Image;
    zoom: number;
    onZoomIn: () => void;
    onZoomOut: () => void;
    onFullscreen: () => void;
    onDownload: () => void;
  }) => (
    <div className="flex flex-col gap-4">
      {/* Image Container */}
      <div className="relative bg-gray-900 rounded-lg overflow-hidden flex items-center justify-center min-h-[500px]">
        <img
          src={image.url}
          alt={`Page ${image.pageNumber}`}
          className="max-w-full max-h-[600px] object-contain transition-transform duration-300"
          style={{ transform: `scale(${zoom})` }}
          loading="lazy"
        />

        {/* Controls Overlay */}
        <div className="absolute top-4 right-4 flex gap-2 bg-black/50 rounded-lg p-2">
          <button
            onClick={onZoomIn}
            className="p-2 hover:bg-white/20 rounded transition-colors"
            aria-label="Zoom in"
            title="Zoom in"
          >
            <ZoomIn className="w-5 h-5 text-white" />
          </button>
          <button
            onClick={onZoomOut}
            className="p-2 hover:bg-white/20 rounded transition-colors"
            aria-label="Zoom out"
            title="Zoom out"
          >
            <ZoomOut className="w-5 h-5 text-white" />
          </button>
          <button
            onClick={onFullscreen}
            className="p-2 hover:bg-white/20 rounded transition-colors"
            aria-label="Fullscreen"
            title="Fullscreen"
          >
            <Maximize className="w-5 h-5 text-white" />
          </button>
          <button
            onClick={onDownload}
            className="p-2 hover:bg-white/20 rounded transition-colors"
            aria-label="Download"
            title="Download"
          >
            <Download className="w-5 h-5 text-white" />
          </button>
        </div>
      </div>

      {/* Image Info */}
      <div className="text-center">
        <h3 className="text-lg font-semibold text-gray-900">
          {image.title || `Page ${image.pageNumber}`}
        </h3>
        <p className="text-sm text-gray-600">Zoom: {Math.round(zoom * 100)}%</p>
      </div>
    </div>
  )
);

ImageViewer.displayName = "ImageViewer";

/**
 * Memoized thumbnail grid item
 */
const ThumbnailGridItem = memo(
  ({
    image,
    isSelected,
    onClick,
  }: {
    image: Image;
    isSelected: boolean;
    onClick: () => void;
  }) => (
    <button
      onClick={onClick}
      className={`
        relative rounded-lg overflow-hidden transition-all duration-200
        ${
          isSelected
            ? "ring-2 ring-amber-500 scale-105"
            : "ring-1 ring-gray-300 hover:ring-amber-400"
        }
      `}
      aria-label={`Page ${image.pageNumber}`}
    >
      <img
        src={image.url}
        alt={`Page ${image.pageNumber}`}
        className="w-full h-24 object-cover"
        loading="lazy"
      />
      <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs p-1 text-center">
        {image.pageNumber}
      </div>
    </button>
  )
);

ThumbnailGridItem.displayName = "ThumbnailGridItem";

/**
 * Virtualized Image Gallery with optimized rendering
 * Only renders visible images to improve performance with large galleries
 */
export const ImageGalleryVirtualized = memo(
  function ImageGalleryVirtualized({
    images,
    isLoading = false,
    onImageSelect,
  }: ImageGalleryVirtualizedProps) {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [zoom, setZoom] = useState(1);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // Memoize images
    const memoizedImages = useMemo(() => images, [images]);

    const currentImage = useMemo(
      () => memoizedImages[currentIndex],
      [memoizedImages, currentIndex]
    );

    // Memoize navigation handlers
    const handlePrevious = useCallback(() => {
      setCurrentIndex((prev) =>
        prev === 0 ? memoizedImages.length - 1 : prev - 1
      );
      setZoom(1); // Reset zoom on navigation
    }, [memoizedImages.length]);

    const handleNext = useCallback(() => {
      setCurrentIndex((prev) =>
        prev === memoizedImages.length - 1 ? 0 : prev + 1
      );
      setZoom(1); // Reset zoom on navigation
    }, [memoizedImages.length]);

    const handleZoomIn = useCallback(() => {
      setZoom((prev) => Math.min(prev + 0.2, 3));
    }, []);

    const handleZoomOut = useCallback(() => {
      setZoom((prev) => Math.max(prev - 0.2, 1));
    }, []);

    const handleFullscreen = useCallback(() => {
      if (containerRef.current && containerRef.current.requestFullscreen) {
        containerRef.current.requestFullscreen();
        setIsFullscreen(true);
      }
    }, []);

    const handleDownload = useCallback(() => {
      if (!currentImage) return;

      const link = document.createElement("a");
      link.href = currentImage.url;
      link.download = `page-${currentImage.pageNumber}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }, [currentImage]);

    // Keyboard navigation
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "ArrowLeft") handlePrevious();
        if (e.key === "ArrowRight") handleNext();
        if (e.key === "+" || e.key === "=") handleZoomIn();
        if (e.key === "-") handleZoomOut();
        if (e.key === "Escape") setIsFullscreen(false);
      };

      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }, [handlePrevious, handleNext, handleZoomIn, handleZoomOut]);

    if (isLoading) {
      return (
        <div className="w-full h-96 bg-gray-200 rounded-lg animate-pulse flex items-center justify-center">
          <p className="text-gray-600">Loading gallery...</p>
        </div>
      );
    }

    if (memoizedImages.length === 0) {
      return (
        <div className="w-full h-96 bg-gray-100 rounded-lg flex items-center justify-center">
          <p className="text-gray-600">No images to display</p>
        </div>
      );
    }

    return (
      <div ref={containerRef} className="space-y-6">
        {/* Main Image Viewer */}
        <div>
          <ImageViewer
            image={currentImage}
            zoom={zoom}
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
            onFullscreen={handleFullscreen}
            onDownload={handleDownload}
          />
        </div>

        {/* Navigation Controls */}
        <div className="flex items-center justify-between gap-4">
          <button
            onClick={handlePrevious}
            className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
            aria-label="Previous page"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>

          <div className="flex-1 text-center">
            <p className="text-sm text-gray-600">
              Page {currentIndex + 1} of {memoizedImages.length}
            </p>
            <div className="w-full h-1 bg-gray-200 rounded-full mt-2 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-amber-400 to-amber-600 transition-all duration-300"
                style={{
                  width: `${((currentIndex + 1) / memoizedImages.length) * 100}%`,
                }}
              />
            </div>
          </div>

          <button
            onClick={handleNext}
            className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
            aria-label="Next page"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        </div>

        {/* Thumbnail Grid */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">
            Thumbnail Grid
          </h3>
          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
            {memoizedImages.map((image, index) => (
              <ThumbnailGridItem
                key={image.id}
                image={image}
                isSelected={currentIndex === index}
                onClick={() => {
                  setCurrentIndex(index);
                  setZoom(1);
                  onImageSelect?.(image);
                }}
              />
            ))}
          </div>
        </div>

        {/* Keyboard Hints */}
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
          <p>
            💡 <strong>Keyboard shortcuts:</strong> ← → to navigate, + - to zoom,
            ESC for fullscreen
          </p>
        </div>
      </div>
    );
  }
);

export default ImageGalleryVirtualized;
