/**
 * Gallery image mapping.
 *
 * Converts persisted book-page rows into the shape the gallery renders. The
 * key job is making scene-mode output legible: scene-mode rows carry the
 * scene's title and source page packed into ocrText (see sceneMetadata), so
 * the gallery shows the real scene title ("The parting of the sea") instead of
 * a generic "Page N", plus a subtitle noting which book page it was drawn from.
 *
 * Dual read path: scene-mode books from the scenes table arrive with real
 * `sceneTitle` / `sourcePage` fields and are used directly. Legacy interim
 * scene rows (pre-cutover) instead carry their metadata packed into ocrText,
 * so we fall back to unpacking that. Page-mode rows have neither and fall back
 * to "Page N" with no subtitle. This module only READS already-stored metadata
 * — it never touches OCR or image generation, keeping that decoupling intact.
 */

import { unpackSceneOcrText } from "./sceneMetadata";

export interface GalleryImage {
  id: string;
  pageNumber: number;
  url: string;
  title: string;
  /** Secondary caption; present only for scene-mode images. */
  subtitle?: string;
}

export interface GalleryPageInput {
  id: number | string;
  pageNumber: number;
  generatedImageUrl?: string | null;
  ocrText?: string | null;
  /** Scene-mode (scenes table) rows carry these real fields directly. */
  sceneTitle?: string | null;
  sourcePage?: number | null;
}

/** Map a single page row to a gallery image (caller ensures it has an image). */
export function toGalleryImage(page: GalleryPageInput): GalleryImage {
  // Preferred path: real scene fields from the scenes table.
  if (page.sceneTitle || page.sourcePage) {
    return {
      id: String(page.id),
      pageNumber: page.pageNumber,
      url: page.generatedImageUrl as string,
      title: page.sceneTitle || `Page ${page.pageNumber}`,
      subtitle: page.sourcePage
        ? `Scene ${page.pageNumber} • from page ${page.sourcePage}`
        : undefined,
    };
  }

  // Legacy fallback: interim scene rows packed metadata into ocrText.
  const { metadata } = unpackSceneOcrText(page.ocrText);
  const isScene = !!(metadata && metadata.sourcePage);
  return {
    id: String(page.id),
    pageNumber: page.pageNumber,
    url: page.generatedImageUrl as string,
    title:
      metadata && metadata.title ? metadata.title : `Page ${page.pageNumber}`,
    subtitle: isScene
      ? `Scene ${page.pageNumber} • from page ${metadata!.sourcePage}`
      : undefined,
  };
}

/** Filter to pages with a generated image, mapped to gallery images in order. */
export function toGalleryImages(pages: GalleryPageInput[]): GalleryImage[] {
  return pages.filter((p) => !!p.generatedImageUrl).map(toGalleryImage);
}
