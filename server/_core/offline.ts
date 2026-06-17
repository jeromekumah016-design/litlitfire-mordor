import { ENV } from "./env";

/**
 * Offline mode
 * ============
 *
 * Lets the entire book->photos pipeline run end-to-end with NO paid third-party
 * calls -- no OpenAI (LLM + DALL-E), no Cloudinary. This makes the app "fully
 * functional minus real API keys": every problem can be exercised and fixed
 * before a single credit is spent, and flipping the real keys on is the only
 * remaining step.
 *
 * Activation (per service, graceful):
 *  - Explicit:   OFFLINE_MODE=true forces offline even if keys are present
 *                (so you can run without spending while keys exist).
 *  - Automatic:  a service falls back to offline when its own key is absent.
 *
 * Decoupling invariant -- UNAFFECTED: these stubs sit only at the external
 * boundaries (LLM / image / storage). OCR transcription still runs
 * independently and the story-bible still mediates between text and rendering.
 * The offline image stub receives only a prompt; it never reads OCR.
 */

/** Forced offline for everything (keys ignored). */
export const isForcedOffline = (): boolean => ENV.offlineMode;

/** LLM (prompt/story-bible/scene-plan) runs offline when forced or no key. */
export const isLLMOffline = (): boolean =>
  ENV.offlineMode || (!ENV.openAiApiKey && !ENV.forgeApiKey);

/** Image generation runs offline when forced or no OpenAI key. */
export const isImageOffline = (): boolean =>
  ENV.offlineMode || !ENV.openAiApiKey;

/** Storage runs offline when forced or Cloudinary is not fully configured. */
export const isStorageOffline = (): boolean =>
  ENV.offlineMode ||
  !(ENV.cloudinaryCloudName && ENV.cloudinaryApiKey && ENV.cloudinaryApiSecret);

/** URL prefix under which offline-stored files are served by the app. */
export const OFFLINE_URL_PREFIX = "/__offline_storage__";

/** On-disk directory holding offline-stored files (gitignored). */
export const offlineStorageDir = (): string =>
  process.env.OFFLINE_STORAGE_DIR && process.env.OFFLINE_STORAGE_DIR.trim().length > 0
    ? process.env.OFFLINE_STORAGE_DIR
    : `${process.cwd()}/.offline-storage`;

/** Deterministic 32-bit hash (FNV-1a) -- stable colors per prompt. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Pick a readable color seeded by text. */
export function seededColor(seed: string): string {
  const h = hashString(seed);
  const hue = h % 360;
  return hslToHex(hue, 55, 42);
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const color = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Word-wrap a string into <= maxChars lines, capped at maxLines. */
function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length > maxChars) {
      if (current) lines.push(current.trim());
      current = word;
      if (lines.length >= maxLines) break;
    } else {
      current = (current + " " + word).trim();
    }
  }
  if (current && lines.length < maxLines) lines.push(current.trim());
  if (lines.length === maxLines && words.length > 0) {
    lines[maxLines - 1] = lines[maxLines - 1].replace(/.{0,3}$/, "...");
  }
  return lines;
}

/**
 * Build a deterministic SVG placeholder image for an offline-generated photo.
 * Renders the prompt text on a seeded-color gradient with a clear OFFLINE
 * watermark so it's never mistaken for a real generation.
 */
export function buildPlaceholderSvg(prompt: string, opts?: { width?: number; height?: number; label?: string }): string {
  const width = opts?.width ?? 1024;
  const height = opts?.height ?? 1024;
  const c1 = seededColor(prompt);
  const c2 = seededColor(prompt + "::2");
  const lines = wrapText(prompt || "untitled scene", 34, 8);
  const lineHeight = 54;
  const startY = height / 2 - ((lines.length - 1) * lineHeight) / 2;
  const tspans = lines
    .map(
      (line, i) =>
        `<tspan x="50%" y="${startY + i * lineHeight}">${escapeXml(line)}</tspan>`
    )
    .join("");
  const label = escapeXml(opts?.label ?? "OFFLINE PLACEHOLDER - no API spend");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${c1}"/>
      <stop offset="1" stop-color="${c2}"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#g)"/>
  <rect x="24" y="24" width="${width - 48}" height="${height - 48}" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="3" stroke-dasharray="14 10"/>
  <text font-family="Georgia, serif" font-size="40" fill="#ffffff" text-anchor="middle" style="font-weight:600">${tspans}</text>
  <text x="50%" y="${height - 56}" font-family="monospace" font-size="22" fill="rgba(255,255,255,0.85)" text-anchor="middle">${label}</text>
</svg>`;
}

/** Best-effort content type from a storage key's extension. */
export function contentTypeForKey(key: string): string {
  const ext = key.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "svg":
      return "image/svg+xml";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "json":
      return "application/json";
    case "pdf":
      return "application/pdf";
    default:
      return "application/octet-stream";
  }
}
