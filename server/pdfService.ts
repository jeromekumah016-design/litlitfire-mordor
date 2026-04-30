import { getDocument } from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

// Canvas is optional - only imported when rendering
let createCanvas: any = null;
try {
  const canvasModule = require("canvas");
  createCanvas = canvasModule.createCanvas;
} catch (e) {
  // Canvas not available in test environment
}

// Lazy initialization of pdfjs worker
let workerConfigured = false;
function ensureWorkerConfigured() {
  if (!workerConfigured) {
    try {
      const pdfjsLib = require("pdfjs-dist");
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
      workerConfigured = true;
    } catch (e) {
      console.error("Failed to configure pdfjs worker:", e);
    }
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
 * Extract text from a PDF page using pdfjs
 */
async function extractTextFromPage(page: PDFPageProxy): Promise<string> {
  try {
    const textContent = await page.getTextContent();
    const text = textContent.items
      .map((item: any) => (item.str ? item.str : ""))
      .join(" ");
    return text;
  } catch (error) {
    console.error("Error extracting text from page:", error);
    return "";
  }
}

/**
 * Render a PDF page to a canvas and return as buffer
 * Used for generating thumbnails
 */
async function renderPageToBuffer(page: PDFPageProxy, scale: number = 1.5): Promise<Buffer> {
  try {
    if (!createCanvas) {
      throw new Error("Canvas module not available. Cannot render PDF pages.");
    }

    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(viewport.width, viewport.height);
    const context = canvas.getContext("2d");

    const renderContext = {
      canvasContext: context,
      viewport: viewport,
      canvas: canvas as any,
    };

    await page.render(renderContext as any).promise;
    return canvas.toBuffer("image/png");
  } catch (error) {
    console.error("Error rendering page to buffer:", error);
    throw error;
  }
}

/**
 * Load a PDF from a buffer and extract all pages
 */
export async function extractPDFPages(pdfBuffer: Buffer): Promise<PDFExtractionResult> {
  try {
    ensureWorkerConfigured();
    const uint8Array = new Uint8Array(pdfBuffer);
    const pdf = await getDocument({ data: uint8Array }).promise;
    const totalPages = pdf.numPages;
    const pages: ExtractedPage[] = [];

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      try {
        const page = await pdf.getPage(pageNum);
        const text = await extractTextFromPage(page);
        const viewport = page.getViewport({ scale: 1 });

        const extractedPage: ExtractedPage = {
          pageNumber: pageNum,
          text,
          width: viewport.width,
          height: viewport.height,
        };

        pages.push(extractedPage);
      } catch (error) {
        console.error(`Error extracting page ${pageNum}:`, error);
        pages.push({
          pageNumber: pageNum,
          text: "",
          width: 0,
          height: 0,
        });
      }
    }

    return {
      totalPages,
      pages,
    };
  } catch (error) {
    console.error("Error loading PDF:", error);
    throw new Error(`Failed to extract PDF: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Generate a thumbnail for a specific page
 */
export async function generatePageThumbnail(pdfBuffer: Buffer, pageNumber: number, scale: number = 1.5): Promise<Buffer> {
  try {
    ensureWorkerConfigured();
    const uint8Array = new Uint8Array(pdfBuffer);
    const pdf = await getDocument({ data: uint8Array }).promise;

    if (pageNumber < 1 || pageNumber > pdf.numPages) {
      throw new Error(`Invalid page number: ${pageNumber}. PDF has ${pdf.numPages} pages.`);
    }

    const page = await pdf.getPage(pageNumber);
    const thumbnailBuffer = await renderPageToBuffer(page, scale);

    return thumbnailBuffer;
  } catch (error) {
    console.error(`Error generating thumbnail for page ${pageNumber}:`, error);
    throw error;
  }
}

/**
 * Extract all page thumbnails from a PDF
 */
export async function extractAllThumbnails(pdfBuffer: Buffer, scale: number = 1.5): Promise<Map<number, Buffer>> {
  try {
    ensureWorkerConfigured();
    const uint8Array = new Uint8Array(pdfBuffer);
    const pdf = await getDocument({ data: uint8Array }).promise;
    const thumbnails = new Map<number, Buffer>();

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      try {
        const page = await pdf.getPage(pageNum);
        const thumbnailBuffer = await renderPageToBuffer(page, scale);
        thumbnails.set(pageNum, thumbnailBuffer);
      } catch (error) {
        console.error(`Error generating thumbnail for page ${pageNum}:`, error);
      }
    }

    return thumbnails;
  } catch (error) {
    console.error("Error extracting thumbnails:", error);
    throw error;
  }
}

/**
 * Get metadata about a PDF
 */
export async function getPDFMetadata(pdfBuffer: Buffer): Promise<{ totalPages: number; title?: string }> {
  try {
    ensureWorkerConfigured();
    const uint8Array = new Uint8Array(pdfBuffer);
    const pdf = await getDocument({ data: uint8Array }).promise;
    const metadata = await pdf.getMetadata();

    return {
      totalPages: pdf.numPages,
      title: (metadata?.info as any)?.Title || undefined,
    };
  } catch (error) {
    console.error("Error getting PDF metadata:", error);
    throw error;
  }
}
