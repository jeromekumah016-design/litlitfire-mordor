/**
 * Progress Tracker Service
 * Manages real-time progress tracking for batch PDF processing operations
 * Emits progress events that can be streamed to clients via SSE or WebSocket
 */

import { EventEmitter } from "events";

export interface ProcessingStep {
  name: "thumbnail" | "ocr" | "prompt" | "image_generation" | "database_save";
  displayName: string;
  estimatedDuration: number; // in milliseconds
}

export interface PageProgress {
  pageNumber: number;
  status: "pending" | "processing" | "completed" | "error";
  currentStep?: ProcessingStep;
  progress: number; // 0-100
  error?: string;
  startTime?: number;
  endTime?: number;
  duration?: number;
}

export interface ProgressEvent {
  bookId: number;
  totalPages: number;
  processedPages: number;
  failedPages: number;
  currentPage: number;
  overallProgress: number; // 0-100
  estimatedTimeRemaining: number; // in milliseconds
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  pageStatuses: PageProgress[];
  currentStep?: ProcessingStep;
  error?: string;
  timestamp: number;
}

/**
 * Processing steps with estimated durations
 */
const PROCESSING_STEPS: ProcessingStep[] = [
  { name: "thumbnail", displayName: "Extracting Thumbnail", estimatedDuration: 500 },
  { name: "ocr", displayName: "Extracting Text (OCR)", estimatedDuration: 2000 },
  { name: "prompt", displayName: "Generating Prompt", estimatedDuration: 1500 },
  { name: "image_generation", displayName: "Generating Image", estimatedDuration: 5000 },
  { name: "database_save", displayName: "Saving to Database", estimatedDuration: 500 },
];

const TOTAL_STEP_DURATION = PROCESSING_STEPS.reduce((sum, step) => sum + step.estimatedDuration, 0);

/**
 * ProgressTracker class for tracking batch processing progress
 */
export class ProgressTracker extends EventEmitter {
  private bookId: number;
  private totalPages: number;
  private pageStatuses: Map<number, PageProgress> = new Map();
  private startTime: number = 0;
  private processedPages: number = 0;
  private failedPages: number = 0;
  private currentStep?: ProcessingStep;
  private status: "pending" | "processing" | "completed" | "failed" | "cancelled" = "pending";
  private historicalDurations: number[] = []; // Track actual durations for estimation

  constructor(bookId: number, totalPages: number) {
    super();
    this.bookId = bookId;
    this.totalPages = totalPages;

    // Initialize page statuses
    for (let i = 1; i <= totalPages; i++) {
      this.pageStatuses.set(i, {
        pageNumber: i,
        status: "pending",
        progress: 0,
      });
    }

    this.setMaxListeners(100); // Allow many listeners for multiple clients
  }

  /**
   * Start processing a page
   */
  startPage(pageNumber: number): void {
    const pageStatus = this.pageStatuses.get(pageNumber);
    if (!pageStatus) return;

    if (this.status === "pending") {
      this.status = "processing";
      this.startTime = Date.now();
    }

    pageStatus.status = "processing";
    pageStatus.progress = 0;
    pageStatus.startTime = Date.now();
    pageStatus.currentStep = PROCESSING_STEPS[0];

    this.emitProgress();
  }

  /**
   * Update progress for current page step
   */
  updatePageStep(pageNumber: number, stepName: ProcessingStep["name"], progress: number): void {
    const pageStatus = this.pageStatuses.get(pageNumber);
    if (!pageStatus) return;

    const step = PROCESSING_STEPS.find((s) => s.name === stepName);
    if (!step) return;

    pageStatus.currentStep = step;
    pageStatus.progress = progress;

    this.currentStep = step;
    this.emitProgress();
  }

  /**
   * Mark page as completed
   */
  completePage(pageNumber: number): void {
    const pageStatus = this.pageStatuses.get(pageNumber);
    if (!pageStatus) return;

    pageStatus.status = "completed";
    pageStatus.progress = 100;
    pageStatus.endTime = Date.now();
    pageStatus.duration = pageStatus.endTime - (pageStatus.startTime || 0);

    // Track duration for estimation
    if (pageStatus.duration) {
      this.historicalDurations.push(pageStatus.duration);
    }

    this.processedPages++;
    this.emitProgress();
  }

  /**
   * Mark page as failed
   */
  failPage(pageNumber: number, error: string): void {
    const pageStatus = this.pageStatuses.get(pageNumber);
    if (!pageStatus) return;

    pageStatus.status = "error";
    pageStatus.progress = 0;
    pageStatus.endTime = Date.now();
    pageStatus.error = error;

    this.failedPages++;
    this.emitProgress();
  }

  /**
   * Get average page processing duration
   */
  private getAverageDuration(): number {
    if (this.historicalDurations.length === 0) {
      return TOTAL_STEP_DURATION;
    }
    const sum = this.historicalDurations.reduce((a, b) => a + b, 0);
    return sum / this.historicalDurations.length;
  }

  /**
   * Calculate estimated time remaining
   */
  private calculateETA(): number {
    const remainingPages = this.totalPages - this.processedPages;
    if (remainingPages <= 0) return 0;

    const averageDuration = this.getAverageDuration();
    return remainingPages * averageDuration;
  }

  /**
   * Calculate overall progress percentage
   */
  private calculateOverallProgress(): number {
    if (this.totalPages === 0) return 0;
    return Math.round((this.processedPages / this.totalPages) * 100);
  }

  /**
   * Emit progress event
   */
  private emitProgress(): void {
    const event: ProgressEvent = {
      bookId: this.bookId,
      totalPages: this.totalPages,
      processedPages: this.processedPages,
      failedPages: this.failedPages,
      currentPage: this.getCurrentPage(),
      overallProgress: this.calculateOverallProgress(),
      estimatedTimeRemaining: this.calculateETA(),
      status: this.status,
      pageStatuses: Array.from(this.pageStatuses.values()),
      currentStep: this.currentStep,
      timestamp: Date.now(),
    };

    this.emit("progress", event);
  }

  /**
   * Get current page being processed
   */
  private getCurrentPage(): number {
    let currentPage = this.totalPages;
    this.pageStatuses.forEach((status, pageNum) => {
      if (status.status === "processing") {
        currentPage = pageNum;
      }
    });
    return currentPage;
  }

  /**
   * Complete processing
   */
  completeProcessing(): void {
    this.status = "completed";
    this.emitProgress();
  }

  /**
   * Fail processing
   */
  failProcessing(error: string): void {
    this.status = "failed";
    const event: ProgressEvent = {
      bookId: this.bookId,
      totalPages: this.totalPages,
      processedPages: this.processedPages,
      failedPages: this.failedPages,
      currentPage: this.getCurrentPage(),
      overallProgress: this.calculateOverallProgress(),
      estimatedTimeRemaining: 0,
      status: this.status,
      pageStatuses: Array.from(this.pageStatuses.values()),
      error,
      timestamp: Date.now(),
    };

    this.emit("progress", event);
  }

  /**
   * Cancel processing
   */
  cancel(): void {
    this.status = "cancelled";
    this.emitProgress();
  }

  /**
   * Get current progress state
   */
  getProgress(): ProgressEvent {
    return {
      bookId: this.bookId,
      totalPages: this.totalPages,
      processedPages: this.processedPages,
      failedPages: this.failedPages,
      currentPage: this.getCurrentPage(),
      overallProgress: this.calculateOverallProgress(),
      estimatedTimeRemaining: this.calculateETA(),
      status: this.status,
      pageStatuses: Array.from(this.pageStatuses.values()),
      currentStep: this.currentStep,
      timestamp: Date.now(),
    };
  }

  /**
   * Get page status
   */
  getPageStatus(pageNumber: number): PageProgress | undefined {
    return this.pageStatuses.get(pageNumber);
  }

  /**
   * Get all page statuses
   */
  getAllPageStatuses(): PageProgress[] {
    const statuses: PageProgress[] = [];
    this.pageStatuses.forEach((status) => {
      statuses.push(status);
    });
    return statuses;
  }
}

/**
 * Global progress tracker store
 * Maps bookId to ProgressTracker instance
 */
const progressTrackers = new Map<number, ProgressTracker>();

/**
 * Create or get progress tracker for a book
 */
export function getOrCreateProgressTracker(bookId: number, totalPages: number): ProgressTracker {
  if (!progressTrackers.has(bookId)) {
    const tracker = new ProgressTracker(bookId, totalPages);
    progressTrackers.set(bookId, tracker);

    // Auto-cleanup after 24 hours
    setTimeout(() => {
      progressTrackers.delete(bookId);
    }, 24 * 60 * 60 * 1000);
  }

  return progressTrackers.get(bookId)!;
}

/**
 * Get existing progress tracker
 */
export function getProgressTracker(bookId: number): ProgressTracker | undefined {
  return progressTrackers.get(bookId);
}

/**
 * Remove progress tracker
 */
export function removeProgressTracker(bookId: number): void {
  progressTrackers.delete(bookId);
}

/**
 * Get all active progress trackers
 */
export function getAllProgressTrackers(): Map<number, ProgressTracker> {
  return new Map(progressTrackers);
}
