/**
 * Streaming Upload Handler
 * Handles large file uploads with streaming to reduce memory usage
 */

import { Readable } from "stream";

interface StreamingUploadOptions {
  maxChunkSize?: number; // Default 1MB
  timeout?: number; // Default 30s per chunk
  onProgress?: (bytesReceived: number, totalBytes: number) => void;
  onChunk?: (chunk: Buffer, offset: number) => Promise<void>;
}

/**
 * Stream-based file upload handler
 */
export class StreamingUploadHandler {
  private readonly maxChunkSize: number;
  private readonly timeout: number;
  private bytesReceived = 0;
  private totalBytes = 0;

  constructor(options: StreamingUploadOptions = {}) {
    this.maxChunkSize = options.maxChunkSize || 1024 * 1024; // 1MB
    this.timeout = options.timeout || 30000; // 30s
  }

  /**
   * Process stream with chunks
   */
  async processStream(
    stream: Readable,
    totalBytes: number,
    options: StreamingUploadOptions
  ): Promise<Buffer[]> {
    const chunks: Buffer[] = [];
    this.bytesReceived = 0;
    this.totalBytes = totalBytes;

    return new Promise((resolve, reject) => {
      let timeout: NodeJS.Timeout | null = null;

      const resetTimeout = () => {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => {
          stream.destroy();
          reject(new Error("Streaming upload timeout"));
        }, this.timeout);
      };

      stream.on("data", async (chunk: Buffer) => {
        resetTimeout();

        try {
          chunks.push(chunk);
          this.bytesReceived += chunk.length;

          if (options.onProgress) {
            options.onProgress(this.bytesReceived, this.totalBytes);
          }

          if (options.onChunk) {
            await options.onChunk(chunk, this.bytesReceived - chunk.length);
          }
        } catch (error) {
          stream.destroy();
          reject(error);
        }
      });

      stream.on("end", () => {
        if (timeout) clearTimeout(timeout);
        resolve(chunks);
      });

      stream.on("error", (error) => {
        if (timeout) clearTimeout(timeout);
        reject(error);
      });

      resetTimeout();
    });
  }

  /**
   * Convert chunks to buffer
   */
  static chunksToBuffer(chunks: Buffer[]): Buffer {
    return Buffer.concat(chunks);
  }

  /**
   * Get progress percentage
   */
  getProgress(): number {
    if (this.totalBytes === 0) return 0;
    return (this.bytesReceived / this.totalBytes) * 100;
  }
}

/**
 * Streaming upload with resumable capability
 */
export class ResumableUpload {
  private uploadId: string;
  private chunks: Map<number, Buffer> = new Map();
  private totalChunks: number;
  private uploadedChunks: Set<number> = new Set();
  private readonly chunkSize: number;

  constructor(
    uploadId: string,
    totalSize: number,
    chunkSize: number = 1024 * 1024
  ) {
    this.uploadId = uploadId;
    this.chunkSize = chunkSize;
    this.totalChunks = Math.ceil(totalSize / chunkSize);
  }

  /**
   * Add chunk to upload
   */
  addChunk(chunkIndex: number, data: Buffer): void {
    if (chunkIndex < 0 || chunkIndex >= this.totalChunks) {
      throw new Error("Invalid chunk index");
    }

    this.chunks.set(chunkIndex, data);
    this.uploadedChunks.add(chunkIndex);
  }

  /**
   * Check if upload is complete
   */
  isComplete(): boolean {
    return this.uploadedChunks.size === this.totalChunks;
  }

  /**
   * Get missing chunks
   */
  getMissingChunks(): number[] {
    const missing: number[] = [];
    for (let i = 0; i < this.totalChunks; i++) {
      if (!this.uploadedChunks.has(i)) {
        missing.push(i);
      }
    }
    return missing;
  }

  /**
   * Get progress percentage
   */
  getProgress(): number {
    return (this.uploadedChunks.size / this.totalChunks) * 100;
  }

  /**
   * Assemble chunks into complete file
   */
  assemble(): Buffer {
    const buffers: Buffer[] = [];

    for (let i = 0; i < this.totalChunks; i++) {
      const chunk = this.chunks.get(i);
      if (!chunk) {
        throw new Error(`Missing chunk ${i}`);
      }
      buffers.push(chunk);
    }

    return Buffer.concat(buffers);
  }

  /**
   * Clear upload data
   */
  clear(): void {
    this.chunks.clear();
    this.uploadedChunks.clear();
  }

  /**
   * Get upload statistics
   */
  getStats() {
    return {
      uploadId: this.uploadId,
      totalChunks: this.totalChunks,
      uploadedChunks: this.uploadedChunks.size,
      progress: this.getProgress().toFixed(2) + "%",
      isComplete: this.isComplete(),
    };
  }
}

/**
 * Resumable upload manager
 */
export class ResumableUploadManager {
  private uploads: Map<string, ResumableUpload> = new Map();
  private readonly maxUploads = 100;
  private readonly uploadTimeout = 24 * 60 * 60 * 1000; // 24 hours

  /**
   * Create new resumable upload
   */
  createUpload(uploadId: string, totalSize: number): ResumableUpload {
    if (this.uploads.size >= this.maxUploads) {
      throw new Error("Maximum concurrent uploads exceeded");
    }

    const upload = new ResumableUpload(uploadId, totalSize);
    this.uploads.set(uploadId, upload);

    // Auto-cleanup after timeout
    setTimeout(() => {
      this.uploads.delete(uploadId);
    }, this.uploadTimeout);

    return upload;
  }

  /**
   * Get upload by ID
   */
  getUpload(uploadId: string): ResumableUpload | undefined {
    return this.uploads.get(uploadId);
  }

  /**
   * Remove upload
   */
  removeUpload(uploadId: string): void {
    this.uploads.delete(uploadId);
  }

  /**
   * Get all active uploads
   */
  getActiveUploads(): string[] {
    return Array.from(this.uploads.keys());
  }

  /**
   * Get manager statistics
   */
  getStats() {
    const uploads: Record<string, object> = {};

    this.uploads.forEach((upload, id) => {
      uploads[id] = upload.getStats();
    });

    return {
      activeUploads: this.uploads.size,
      maxUploads: this.maxUploads,
      uploads,
    };
  }
}

// Export singleton instance
export const resumableUploadManager = new ResumableUploadManager();
