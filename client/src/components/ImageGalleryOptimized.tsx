import { useState, useRef, useEffect, useCallback, useMemo, memo } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize,
  Download,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface ImageGalleryProps {
  images: Array<{
    id: number;
    pageNumber: number;
    url: string;
    title?: string;
  }>;
  title?: string;
  onClose?: () => void;
}

type ZoomLevel = "fit" | "100" | "150" | "200";

/**
 * Memoized image tile component to prevent unnecessary re-renders
 */
const ImageTile = memo(function ImageTile({
  image,
  isActive,
  onClick,
}: {
  image: { id: number; pageNumber: number; url: string; title?: string };
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`cursor-pointer border-2 transition-colors ${
        isActive ? "border-amber-500 bg-amber-500/10" : "border-transparent hover:border-amber-500/50"
      }`}
    >
      <img
        src={image.url}
        alt={`Page ${image.pageNumber}`}
        className="w-full h-20 object-cover"
        loading="lazy"
      />
      <p className="text-xs text-center p-1">Page {image.pageNumber}</p>
    </div>
  );
});

/**
 * Optimized ImageGallery with memoization, lazy loading, and efficient event handling
 */
export default memo(function ImageGallery({
  images,
  title = "Image Gallery",
  onClose,
}: ImageGalleryProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [zoom, setZoom] = useState<ZoomLevel>("fit");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const touchStartX = useRef(0);

  const currentImage = useMemo(() => images[currentIndex], [images, currentIndex]);

  // Memoized navigation callbacks
  const goToNext = useCallback(() => {
    if (isAnimating || currentIndex >= images.length - 1) return;
    setIsAnimating(true);
    setCurrentIndex((prev) => prev + 1);
    setTimeout(() => setIsAnimating(false), 300);
  }, [currentIndex, images.length, isAnimating]);

  const goToPrevious = useCallback(() => {
    if (isAnimating || currentIndex <= 0) return;
    setIsAnimating(true);
    setCurrentIndex((prev) => prev - 1);
    setTimeout(() => setIsAnimating(false), 300);
  }, [currentIndex, isAnimating]);

  const goToPage = useCallback((index: number) => {
    if (index !== currentIndex && !isAnimating) {
      setIsAnimating(true);
      setCurrentIndex(index);
      setTimeout(() => setIsAnimating(false), 300);
    }
  }, [currentIndex, isAnimating]);

  // Keyboard navigation with useCallback to prevent re-binding
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isAnimating) return;

      switch (e.key) {
        case "ArrowLeft":
        case "a":
          goToPrevious();
          break;
        case "ArrowRight":
        case "d":
        case " ":
          goToNext();
          break;
        case "Escape":
          if (isFullscreen) {
            setIsFullscreen(false);
          } else if (onClose) {
            onClose();
          }
          break;
        case "f":
          setIsFullscreen(!isFullscreen);
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goToNext, goToPrevious, isAnimating, isFullscreen, onClose]);

  // Touch/swipe navigation
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  }, []);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const touchEndX = e.changedTouches[0].clientX;
      const diff = touchStartX.current - touchEndX;

      if (Math.abs(diff) > 50) {
        if (diff > 0) {
          goToNext();
        } else {
          goToPrevious();
        }
      }
    },
    [goToNext, goToPrevious]
  );

  // Memoized zoom class
  const zoomClass = useMemo(() => {
    switch (zoom) {
      case "100":
        return "w-full h-full";
      case "150":
        return "w-[150%] h-[150%]";
      case "200":
        return "w-[200%] h-[200%]";
      default:
        return "w-full h-full object-contain";
    }
  }, [zoom]);

  // Download handler
  const handleDownload = useCallback(async () => {
    if (!currentImage) return;
    try {
      const response = await fetch(currentImage.url);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `page-${currentImage.pageNumber}.png`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error("Download failed:", error);
    }
  }, [currentImage]);

  if (!currentImage) {
    return <div>No images available</div>;
  }

  return (
    <Card className="w-full h-screen flex flex-col bg-slate-900 border-0">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-slate-700">
        <h2 className="text-lg font-semibold text-amber-400">{title}</h2>
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-400">
            {currentIndex + 1} / {images.length}
          </span>
          {onClose && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Main gallery area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Main image */}
        <div
          ref={containerRef}
          className="flex-1 flex items-center justify-center bg-slate-950 relative overflow-hidden"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <img
            ref={imageRef}
            src={currentImage.url}
            alt={`Page ${currentImage.pageNumber}`}
            className={`${zoomClass} transition-all duration-300 ${
              isAnimating ? "opacity-50" : "opacity-100"
            }`}
          />

          {/* Navigation arrows */}
          {currentIndex > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={goToPrevious}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-white hover:bg-slate-700"
            >
              <ChevronLeft className="w-6 h-6" />
            </Button>
          )}
          {currentIndex < images.length - 1 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={goToNext}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-white hover:bg-slate-700"
            >
              <ChevronRight className="w-6 h-6" />
            </Button>
          )}
        </div>

        {/* Thumbnail strip (optimized with lazy loading) */}
        <div className="w-24 bg-slate-800 border-l border-slate-700 overflow-y-auto">
          <div className="flex flex-col gap-1 p-2">
            {images.map((img, idx) => (
              <ImageTile
                key={img.id}
                image={img}
                isActive={idx === currentIndex}
                onClick={() => goToPage(idx)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between p-4 border-t border-slate-700 bg-slate-800">
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setZoom("fit")}
            className={zoom === "fit" ? "bg-amber-500/20 text-amber-400" : "text-slate-400"}
          >
            Fit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setZoom("100")}
            className={zoom === "100" ? "bg-amber-500/20 text-amber-400" : "text-slate-400"}
          >
            100%
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setZoom("150")}
            className={zoom === "150" ? "bg-amber-500/20 text-amber-400" : "text-slate-400"}
          >
            150%
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setZoom("200")}
            className={zoom === "200" ? "bg-amber-500/20 text-amber-400" : "text-slate-400"}
          >
            200%
          </Button>
        </div>

        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="text-slate-400 hover:text-white"
            title="Press 'F' for fullscreen"
          >
            <Maximize className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDownload}
            className="text-slate-400 hover:text-white"
            title="Download page"
          >
            <Download className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
});
