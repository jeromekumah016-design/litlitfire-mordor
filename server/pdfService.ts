/**
 * PDF Service - Real PDF processing with pdfjs-dist
 * Handles actual text extraction and metadata reading
 * Uses the legacy ESM build for Node.js compatibility
 * Thumbnails are generated client-side to avoid native module dependencies
 */

// Set up polyfills BEFORE any pdfjs-dist code runs
if (typeof (global as any).DOMMatrix === "undefined") {
  (global as any).DOMMatrix = class DOMMatrix {
    a = 1;
    b = 0;
    c = 0;
    d = 1;
    e = 0;
    f = 0;
  };
}

if (typeof (global as any).CanvasRenderingContext2D === "undefined") {
  (global as any).CanvasRenderingContext2D = class CanvasRenderingContext2D {};
}

// Import the legacy ESM build for Node.js compatibility
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

// === CRITICAL: Configure worker for server-side usage ===
// Use file:// URL for Node.js ESM loader compatibility
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const workerPath = join(__dirname, '../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
// pdfjs's ESM worker loader requires a URL with a file:// scheme. A raw
// absolute path works on POSIX but fails on Windows ("Received protocol 'c:'"),
// so always convert to a file:// URL.
pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;

export interface ExtractedPage {
  pageNumber: number;
  text: string;
  width: number;
  height: number;
  thumbnailBuffer?: Buffer;
}

export interface PDFExtractionResult {
  totalPages: number;
  pages: ExtractedPage[];
  title?: string;
}

/**
 * Extract text from a PDF page using pdfjs-dist
 */
async function extractPageText(
  pdfDocument: any,
  pageNumber: number
): Promise<string> {
  try {
    const page = await pdfDocument.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const text = textContent.items
      .map((item: any) => (item.str ? item.str : ""))
      .join(" ");
    return text.trim();
  } catch (error) {
    console.error(`Failed to extract text from page ${pageNumber}:`, error);
    return ""; // Return empty string instead of placeholder
  }
}

/**
 * Create a minimal valid PNG for error cases or placeholder thumbnails
 * This is used when canvas is not available or thumbnail generation is deferred to client
 */
function createMinimalPNG(): Buffer {
  // 1x1 white PNG
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
    0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0x99, 0x63, 0xf8, 0xff, 0xff, 0x3f,
    0x00, 0x00, 0x05, 0xfe, 0x02, 0xfe, 0x8c, 0x6c, 0x2d, 0x2a, 0x00, 0x00,
    0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
}

/**
 * Extract text and metadata from a PDF with real pdfjs-dist
 */
export async function extractPDFPages(
  pdfBuffer: Buffer
): Promise<PDFExtractionResult> {
  try {
    // Load PDF document
    const pdfDocument = await pdfjsLib.getDocument({
      data: new Uint8Array(pdfBuffer),
      useWorkerFetch: false,
      isEvalSupported: false,
      disableFontFace: true,
    } as any).promise;

    const totalPages = pdfDocument.numPages;
    const pages: ExtractedPage[] = [];

    // Extract metadata (gracefully handle missing metadata)
    let title: string | undefined = undefined;
    try {
      const metadata = await pdfDocument.getMetadata();
      title = (metadata?.info as any)?.Title || undefined;
    } catch {
      // Some PDFs don't have metadata — this is fine
    }

    // Extract text from each page
    for (let i = 1; i <= totalPages; i++) {
      const page = await pdfDocument.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      const text = await extractPageText(pdfDocument, i);

      pages.push({
        pageNumber: i,
        text, // Real extracted text, not placeholder
        width: viewport.width,
        height: viewport.height,
        // Thumbnail generation is deferred to client-side to avoid native module dependency
        thumbnailBuffer: createMinimalPNG(),
      });
    }

    return {
      totalPages,
      pages,
      title,
    };
  } catch (error) {
    throw new Error(
      `Failed to extract PDF: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Generate a real thumbnail for a specific page using canvas
 * NOTE: This function is kept for backward compatibility but uses minimal PNG in production
 */
export async function generatePageThumbnail(
  pdfBuffer: Buffer,
  pageNumber: number,
  scale: number = 1.5
): Promise<Buffer> {
  try {
    // Load PDF document
    const pdfDocument = await pdfjsLib.getDocument({
      data: new Uint8Array(pdfBuffer),
      useWorkerFetch: false,
      isEvalSupported: false,
      disableFontFace: true,
    } as any).promise;

    const totalPages = pdfDocument.numPages;
    if (pageNumber < 1 || pageNumber > totalPages) {
      throw new Error(
        `Invalid page number: ${pageNumber}. PDF has ${totalPages} pages.`
      );
    }

    // Return minimal PNG - actual thumbnail generation happens client-side
    return createMinimalPNG();
  } catch (error) {
    throw new Error(
      `Failed to generate thumbnail for page ${pageNumber}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Extract all page thumbnails from a PDF
 * NOTE: Returns minimal PNGs - actual thumbnail generation happens client-side
 */
export async function extractAllThumbnails(
  pdfBuffer: Buffer,
  scale: number = 1.5
): Promise<Map<number, Buffer>> {
  try {
    // Load PDF document
    const pdfDocument = await pdfjsLib.getDocument({
      data: new Uint8Array(pdfBuffer),
      useWorkerFetch: false,
      isEvalSupported: false,
      disableFontFace: true,
    } as any).promise;

    const totalPages = pdfDocument.numPages;
    const thumbnails = new Map<number, Buffer>();

    // Return minimal PNGs for all pages - actual rendering happens client-side
    for (let i = 1; i <= totalPages; i++) {
      thumbnails.set(i, createMinimalPNG());
    }

    return thumbnails;
  } catch (error) {
    throw new Error(
      `Failed to extract thumbnails: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Extract comprehensive metadata from a PDF
 * Includes title, author, subject, and page count
 */
export async function extractPDFMetadata(pdfBuffer: Buffer) {
  try {
    const pdfDocument = await pdfjsLib.getDocument({
      data: new Uint8Array(pdfBuffer),
      useWorkerFetch: false,
      isEvalSupported: false,
      disableFontFace: true,
    } as any).promise;

    let metadata: any = {};
    try {
      metadata = await pdfDocument.getMetadata();
    } catch {
      // Some PDFs don't have metadata — this is fine
    }

    return {
      title: metadata?.info?.Title || null,
      author: metadata?.info?.Author || null,
      subject: metadata?.info?.Subject || null,
      pageCount: pdfDocument.numPages,
    };
  } catch (error) {
    console.error("PDF metadata extraction failed:", error);
    throw new Error(
      `Failed to get PDF metadata: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Get accurate metadata about a PDF (legacy function for backward compatibility)
 */
export async function getPDFMetadata(
  pdfBuffer: Buffer
): Promise<{ totalPages: number; title?: string }> {
  try {
    const metadata = await extractPDFMetadata(pdfBuffer);
    return {
      totalPages: metadata.pageCount,
      title: metadata.title || undefined,
    };
  } catch (error) {
    throw new Error(
      `Failed to get PDF metadata: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
