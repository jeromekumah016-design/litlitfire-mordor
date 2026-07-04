import OpenAI from "openai";
import { storagePut } from "../storage";
import { ENV } from "./env";
import { isImageOffline, buildPlaceholderSvg } from "./offline";
import { withRetry } from "../resilience";
import {
  type ImageGenParams,
  normalizeImageParams,
  resolveDalleSize,
  resolvePlaceholderDimensions,
} from "./imageParams";

/**
 * Number of in-process attempts for a single DALL-E generation call. Kept
 * small and separate from the DB-backed page-level retry scheduling in
 * retryService.ts (markPageForRetry) -- that layer handles a page that has
 * definitively failed and needs a backoff-scheduled re-run later; this layer
 * only absorbs a transient failure (rate limit, 5xx, network blip) within the
 * same call so one hiccup doesn't burn a page's whole retry budget.
 */
const IMAGE_GEN_MAX_RETRIES = 2;
const IMAGE_GEN_INITIAL_DELAY_MS = 500;

/**
 * True for errors worth retrying in-process: rate limits, server-side (5xx),
 * and network-level failures with no HTTP status at all. False for anything
 * that a retry can't fix -- bad request/prompt, auth, content-policy
 * rejections (4xx other than 429) -- so we fail fast on those instead of
 * burning time and spend repeating a call that will never succeed.
 */
function isRetryableImageGenError(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  if (status === undefined) return true; // network/timeout-style failure
  return status === 429 || status >= 500;
}

export type GenerateImageOptions = {
  prompt: string;
  /**
   * Optional storage key PREFIX (WITHOUT extension), e.g.
   * `books/12/scenes/0/generated`. When supplied, the generated image is stored
   * at `${keyPrefix}.<ext>` so it lives alongside the book's other assets and the
   * file key the pipeline records actually matches the stored object (enabling
   * signed URLs and prefix-based cleanup on book deletion). When omitted, a
   * generic `generated/<timestamp>` key is used (legacy behaviour).
   */
  keyPrefix?: string;
  /**
   * Render-side controls (aspect ratio, quality, stylisation). Normalised
   * against the defaults so a partial or malformed object is always safe. These
   * govern HOW the prompt is rasterised; they are NOT derived from OCR and do
   * not touch the story bible (decoupling invariant upheld).
   */
  params?: Partial<ImageGenParams>;
  originalImages?: Array<{
    url?: string;
    b64Json?: string;
    mimeType?: string;
  }>;
};

export type GenerateImageResponse = {
  url?: string;
  /** The storage key the image was actually written to (matches the stored object). */
  key?: string;
};

let _openai: OpenAI | null = null;
function getOpenAI() {
  if (!_openai) {
    if (!ENV.openAiApiKey) throw new Error("OPENAI_API_KEY is not configured");
    _openai = new OpenAI({ apiKey: ENV.openAiApiKey });
  }
  return _openai;
}

/**
 * Resolve the storage key for a generated image. A caller-supplied keyPrefix is
 * honoured (any extension it carries is stripped first, then the real `ext` is
 * appended); otherwise a unique generic key is minted. Kept pure for testing.
 */
export function resolveGeneratedImageKey(
  keyPrefix: string | undefined,
  ext: string
): string {
  const prefix = keyPrefix?.trim();
  if (prefix) {
    const clean = prefix.replace(/\.[^/.]+$/, "");
    return `${clean}.${ext}`;
  }
  return `generated/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
}

/**
 * Offline stub: render a deterministic SVG placeholder for the prompt and store
 * it like a real generation. No OpenAI call, no spend. Used when OFFLINE_MODE is
 * on or no OpenAI key is configured. The pipeline is unchanged -- it still calls
 * generateImage() and gets back a usable URL plus the key it was stored under.
 */
async function generateImageOffline(
  options: GenerateImageOptions
): Promise<GenerateImageResponse> {
  // Mirror the requested aspect ratio so the placeholder has the same shape the
  // real generation would, exercising the params path end-to-end with no spend.
  const params = normalizeImageParams(options.params);
  const { width, height } = resolvePlaceholderDimensions(params.aspectRatio);
  const svg = buildPlaceholderSvg(options.prompt, { width, height });
  const key = resolveGeneratedImageKey(options.keyPrefix, "svg");
  const { url } = await storagePut(key, Buffer.from(svg, "utf-8"), "image/svg+xml");
  return { url, key };
}

export async function generateImage(
  options: GenerateImageOptions
): Promise<GenerateImageResponse> {
  if (isImageOffline()) return generateImageOffline(options);
  const openai = getOpenAI();

  const params = normalizeImageParams(options.params);

  const callOpenAi = () =>
    openai.images.generate({
      model: "dall-e-3",
      prompt: options.prompt.slice(0, 4000),
      n: 1,
      size: resolveDalleSize(params.aspectRatio),
      quality: params.quality,
      style: params.style,
      response_format: "b64_json",
    });

  let response;
  try {
    response = await callOpenAi();
  } catch (firstError) {
    if (!isRetryableImageGenError(firstError)) throw firstError;
    // First attempt hit a transient-looking failure (rate limit / 5xx /
    // network) -- hand the remaining attempts to withRetry's backoff loop.
    response = await withRetry(callOpenAi, IMAGE_GEN_MAX_RETRIES, IMAGE_GEN_INITIAL_DELAY_MS);
  }

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error("No image data returned from OpenAI");

  const buffer = Buffer.from(b64, "base64");
  const key = resolveGeneratedImageKey(options.keyPrefix, "png");
  const { url } = await storagePut(key, buffer, "image/png");
  return { url, key };
}
