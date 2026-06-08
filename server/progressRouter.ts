import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, protectedProcedure } from "./_core/trpc";
import {
  getProgressTracker,
  getOrCreateProgressTracker,
  removeProgressTracker,
  getAllProgressTrackers,
} from "./progressTracker";

/**
 * Progress tracking router for real-time PDF processing updates
 */
export const progressRouter = {
  /**
   * Get current progress for a book
   */
  getProgress: protectedProcedure
    .input(z.number())
    .query(({ input }) => {
      const tracker = getProgressTracker(input);
      if (!tracker) {
        return null;
      }
      return tracker.getProgress();
    }),

  /**
   * Get all page statuses for a book
   */
  getPageStatuses: protectedProcedure
    .input(z.number())
    .query(({ input }) => {
      const tracker = getProgressTracker(input);
      if (!tracker) {
        return [];
      }
      return tracker.getAllPageStatuses();
    }),

  /**
   * Get specific page status
   */
  getPageStatus: protectedProcedure
    .input(z.object({ bookId: z.number(), pageNumber: z.number() }))
    .query(({ input }) => {
      const tracker = getProgressTracker(input.bookId);
      if (!tracker) {
        return null;
      }
      return tracker.getPageStatus(input.pageNumber);
    }),

  /**
   * Get all active processing jobs
   */
  getActiveJobs: protectedProcedure.query(() => {
    const trackers = getAllProgressTrackers();
    const jobs: Array<{ bookId: number; progress: any }> = [];

    trackers.forEach((tracker, bookId) => {
      const progress = tracker.getProgress();
      if (progress.status === "processing") {
        jobs.push({
          bookId,
          progress,
        });
      }
    });

    return jobs;
  }),

  /**
   * Subscribe to progress updates via polling
   * Clients can poll this endpoint to get updated progress
   */
  pollProgress: protectedProcedure
    .input(z.number())
    .query(({ input: bookId }) => {
      const tracker = getProgressTracker(bookId);
      if (!tracker) {
        return null;
      }
      return tracker.getProgress();
    }),

  /**
   * Cancel processing for a book
   */
  cancelProcessing: protectedProcedure
    .input(z.number())
    .mutation(({ input: bookId }) => {
      const tracker = getProgressTracker(bookId);
      if (!tracker) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Processing not found" });
      }

      tracker.cancel();
      removeProgressTracker(bookId);

      return { success: true, message: "Processing cancelled" };
    })
};
