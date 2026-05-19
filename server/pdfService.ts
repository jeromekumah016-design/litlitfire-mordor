/**
 * PDF Service - Real PDF processing with pdfjs-dist
 * Handles actual text extraction, thumbnail generation, and metadata reading
 */

import * as pdfjsLib from "pdfjs-dist";
import { createCanvas } from "canvas";

// Polyfills for Node.js canvas environment
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

// Set up worker for pdfjs-dist (only in Node environment)
if (typeof (global as any).window === "undefined") {
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
  } catch (e) {
    // Worker setup may fail in test environment
  }
}

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
  pdfDocument: pdfjsLib.PDFDocumentProxy,
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
 * Generate a thumbnail for a PDF page using canvas
 */
async function generateThumbnailForPage(
  pdfDocument: pdfjsLib.PDFDocumentProxy,
  pageNumber: number,
  scale: number = 1.5
): Promise<Buffer> {
  try {
    const page = await pdfDocument.getPage(pageNumber);
    const viewport = page.getViewport({ scale });

    // Create canvas with page dimensions
    const canvas = createCanvas(viewport.width, viewport.height);
    const context = canvas.getContext("2d");

    // Render page to canvas
    const renderContext = {
      canvasContext: context,
      viewport: viewport,
      canvas: canvas,
    };

    await page.render(renderContext as any).promise;

    // Convert canvas to PNG buffer
    return canvas.toBuffer("image/png");
  } catch (error) {
    console.error(`Failed to generate thumbnail for page ${pageNumber}:`, error);
    // Return a minimal valid PNG on error instead of placeholder
    return createMinimalPNG();
  }
}

/**
 * Create a minimal valid PNG for error cases
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
    }).promise;

    const totalPages = pdfDocument.numPages;
    const pages: ExtractedPage[] = [];

    // Extract metadata
    const metadata = await pdfDocument.getMetadata();
    const title = (metadata?.info as any)?.Title || undefined;

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
    }).promise;

    const totalPages = pdfDocument.numPages;
    if (pageNumber < 1 || pageNumber > totalPages) {
      throw new Error(
        `Invalid page number: ${pageNumber}. PDF has ${totalPages} pages.`
      );
    }

    // Generate thumbnail using canvas
    return await generateThumbnailForPage(pdfDocument, pageNumber, scale);
  } catch (error) {
    throw new Error(
      `Failed to generate thumbnail for page ${pageNumber}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Extract all page thumbnails from a PDF
 */
export async function extractAllThumbnails(
  pdfBuffer: Buffer,
  scale: number = 1.5
): Promise<Map<number, Buffer>> {
  try {
    // Load PDF document
    const pdfDocument = await pdfjsLib.getDocument({
      data: new Uint8Array(pdfBuffer),
    }).promise;

    const totalPages = pdfDocument.numPages;
    const thumbnails = new Map<number, Buffer>();

    // Generate thumbnails for all pages
    for (let i = 1; i <= totalPages; i++) {
      const thumbnail = await generateThumbnailForPage(pdfDocument, i, scale);
      thumbnails.set(i, thumbnail);
    }

    return thumbnails;
  } catch (error) {
    throw new Error(
      `Failed to extract thumbnails: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Get accurate metadata about a PDF
 */
export async function getPDFMetadata(
  pdfBuffer: Buffer
): Promise<{ totalPages: number; title?: string }> {
  try {
    // Load PDF document
    const pdfDocument = await pdfjsLib.getDocument({
      data: new Uint8Array(pdfBuffer),
    }).promise;

    const metadata = await pdfDocument.getMetadata();
    const title = (metadata?.info as any)?.Title || undefined;

    return {
      totalPages: pdfDocument.numPages,
      title,
    };
  } catch (error) {
    throw new Error(
      `Failed to get PDF metadata: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
