/**
 * Scene metadata pack/unpack for the ocrText column.
 *
 * In scene mode the pipeline stores scene metadata (title, rationale, etc.)
 * as a JSON header on the first line of ocrText, followed by a newline and
 * the scene description. Page-mode rows have no such header, so the parser
 * falls back gracefully. No schema change required.
 *
 * Sentinel key `__sm__` (scene metadata) keeps the detection unambiguous and
 * short, while avoiding collision with any real OCR content.
 */

export interface SceneOcrMetadata {
  title: string;
  rationale: string;
  sourcePage: number;
  importance: number;
}

const SENTINEL = "__sm__";

/**
 * Pack scene metadata + description into a single string for ocrText storage.
 * The first line is a compact JSON header; the rest is the scene description.
 */
export function packSceneOcrText(
  metadata: SceneOcrMetadata,
  description: string
): string {
  const header = JSON.stringify({ [SENTINEL]: 1, ...metadata });
  return `${header}\n${description}`;
}

/**
 * Unpack ocrText.  Returns metadata + description when a scene header is found,
 * or { metadata: null, description: ocrText } for plain page-mode rows.
 */
export function unpackSceneOcrText(ocrText: string | null | undefined): {
  metadata: SceneOcrMetadata | null;
  description: string;
} {
  if (!ocrText) return { metadata: null, description: "" };

  const newlineIndex = ocrText.indexOf("\n");
  const firstLine =
    newlineIndex === -1 ? ocrText : ocrText.slice(0, newlineIndex);
  const rest = newlineIndex === -1 ? "" : ocrText.slice(newlineIndex + 1);

  if (!firstLine.startsWith(`{"${SENTINEL}"`)) {
    return { metadata: null, description: ocrText };
  }

  try {
    const parsed = JSON.parse(firstLine) as Record<string, unknown>;
    if (parsed[SENTINEL] !== 1) return { metadata: null, description: ocrText };

    const metadata: SceneOcrMetadata = {
      title: typeof parsed.title === "string" ? parsed.title : "",
      rationale: typeof parsed.rationale === "string" ? parsed.rationale : "",
      sourcePage:
        typeof parsed.sourcePage === "number" ? parsed.sourcePage : 0,
      importance:
        typeof parsed.importance === "number" ? parsed.importance : 0,
    };
    return { metadata, description: rest };
  } catch {
    return { metadata: null, description: ocrText };
  }
}
