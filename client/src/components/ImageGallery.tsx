import { useState, useEffect, useRef, useCallback } from "react";
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

export default function ImageGallery({
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

  const currentImage = images[currentIndex];

  // Keyboard navigation
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
  }, [currentIndex, isAnimating, isFullscreen, onClose]);

  // Touch/swipe navigation
  const touchStartX = useRef(0);
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const touchEndX = e.changedTouches[0].clientX;
    const diff = touchStartX.current - touchEndX;

    if (Math.abs(diff) > 50) {
      if (diff > 0) {
        goToNext();
      } else {
        goToPrevious();
      }
    }
  };

  const goToNext = useCallback(() => {
    if (isAnimating || currentIndex >= images.length - 1) return;
    setIsAnimating(true);
    setTimeout(() => {
      setCurrentIndex((prev) => Math.min(prev + 1, images.length - 1));
      setIsAnimating(false);
    }, 300);
  }, [currentIndex, images.length, isAnimating]);

  const goToPrevious = useCallback(() => {
    if (isAnimating || currentIndex <= 0) return;
    setIsAnimating(true);
    setTimeout(() => {
      setCurrentIndex((prev) => Math.max(prev - 1, 0));
      setIsAnimating(false);
    }, 300);
  }, [currentIndex, isAnimating]);

  const handleZoom = (direction: "in" | "out") => {
    const zoomLevels: ZoomLevel[] = ["fit", "100", "150", "200"];
    const currentZoomIndex = zoomLevels.indexOf(zoom);

    if (direction === "in" && currentZoomIndex < zoomLevels.length - 1) {
      setZoom(zoomLevels[currentZoomIndex + 1]);
    } else if (direction === "out" && currentZoomIndex > 0) {
      setZoom(zoomLevels[currentZoomIndex - 1]);
    }
  };

  const downloadImage = async () => {
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
      console.error("Failed to download image:", error);
    }
  };

  const getImageStyle = () => {
    const baseStyle: React.CSSProperties = {
      transition: isAnimating ? "opacity 0.3s ease-in-out" : "none",
      opacity: isAnimating ? 0.8 : 1,
    };

    if (zoom === "fit") {
      return { ...baseStyle, maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto" };
    }

    const zoomPercent = parseInt(zoom);
    return { ...baseStyle, width: `${zoomPercent}%`, height: "auto" };
  };

  const galleryContent = (
    <div
      className={`flex flex-col ${isFullscreen ? "fixed inset-0 z-50 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950" : ""}`}
    >
      {/* Header */}
      {!isFullscreen && (
        <div className="flex items-center justify-between p-4 border-b bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border-amber-900/30 shadow-lg shadow-amber-900/20">
          <div>
            <h2 className="text-lg font-semibold text-amber-100 drop-shadow-lg">{title}</h2>
            <p className="text-sm text-amber-200/70">
              Page {currentImage?.pageNumber || 0} of {images.length}
            </p>
          </div>
          {onClose && (
            <Button variant="ghost" size="icon" onClick={onClose} className="text-amber-200 hover:text-amber-100 hover:bg-amber-900/20">
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      )}      {/* Main Image Area */}
      <div
        ref={containerRef}
        className={`flex-1 flex items-center justify-center overflow-auto ${
          isFullscreen ? "bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950" : "bg-gradient-to-b from-slate-900 to-slate-950"
        }`}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >        {currentImage && (
          <img
            ref={imageRef}
            src={currentImage.url}
            alt={`Page ${currentImage.pageNumber}`}
            style={getImageStyle()}
            className="object-contain"
          />
        )}
      </div>

      {/* Controls */}
      <div
        className={`flex items-center justify-between p-4 ${
          isFullscreen ? "bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 border-t border-amber-900/30" : "bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border-t border-amber-900/30"
        }`}
      >
        {/* Navigation */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={goToPrevious}
            disabled={currentIndex === 0 || isAnimating}
            className="border-amber-700/50 text-amber-200 hover:bg-amber-900/30 hover:text-amber-100 hover:border-amber-600"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>

          <div className="px-4 text-sm font-medium text-amber-200">
            {currentIndex + 1} / {images.length}
          </div>

          <Button
            variant="outline"
            size="icon"
            onClick={goToNext}
            disabled={currentIndex === images.length - 1 || isAnimating}
            className="border-amber-700/50 text-amber-200 hover:bg-amber-900/30 hover:text-amber-100 hover:border-amber-600"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>

        {/* Progress Bar */}
        <div className="flex-1 mx-4 h-1 bg-slate-700/50 rounded-full overflow-hidden shadow-lg shadow-amber-900/30">
          <div
            className="h-full bg-gradient-to-r from-amber-500 to-amber-400 transition-all shadow-lg shadow-amber-500/50"
            style={{ width: `${((currentIndex + 1) / images.length) * 100}%` }}
          />
        </div>

        {/* Zoom & Actions */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => handleZoom("out")}
            disabled={zoom === "fit"}
            className="border-amber-700/50 text-amber-200 hover:bg-amber-900/30 hover:text-amber-100 hover:border-amber-600"
          >
            <ZoomOut className="w-4 h-4" />
          </Button>

          <div className="text-sm font-medium w-12 text-center text-amber-200">
            {zoom === "fit" ? "Fit" : `${zoom}%`}
          </div>

          <Button
            variant="outline"
            size="icon"
            onClick={() => handleZoom("in")}
            disabled={zoom === "200"}
            className="border-amber-700/50 text-amber-200 hover:bg-amber-900/30 hover:text-amber-100 hover:border-amber-600"
          >
            <ZoomIn className="w-4 h-4" />
          </Button>

          <Button
            variant="outline"
            size="icon"
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="border-amber-700/50 text-amber-200 hover:bg-amber-900/30 hover:text-amber-100 hover:border-amber-600"
          >
            <Maximize className="w-4 h-4" />
          </Button>

          <Button
            variant="outline"
            size="icon"
            onClick={downloadImage}
            className="border-amber-700/50 text-amber-200 hover:bg-amber-900/30 hover:text-amber-100 hover:border-amber-600"
          >
            <Download className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Keyboard Hints (Desktop) */}
      {!isFullscreen && (
        <div className="px-4 py-2 text-xs text-amber-200/70 bg-slate-900/50 border-t border-amber-900/30">
          💡 Keyboard: ← → or A/D to navigate • Space to next • F for fullscreen • ESC to close
        </div>
      )}
    </div>
  );

  if (isFullscreen) {
    return galleryContent;
  }

  return <Card className="overflow-hidden">{galleryContent}</Card>;
}
