import OpenAI from "openai";
import { storagePut } from "../storage";
import { ENV } from "./env";
import { isImageOffline, buildPlaceholderSvg } from "./offline";

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
  const svg = buildPlaceholderSvg(options.prompt);
  const key = resolveGeneratedImageKey(options.keyPrefix, "svg");
  const { url } = await storagePut(key, Buffer.from(svg, "utf-8"), "image/svg+xml");
  return { url, key };
}

export async function generateImage(
  options: GenerateImageOptions
): Promise<GenerateImageResponse> {
  if (isImageOffline()) return generateImageOffline(options);
  const openai = getOpenAI();

  const response = await openai.images.generate({
    model: "dall-e-3",
    prompt: options.prompt.slice(0, 4000),
    n: 1,
    size: "1024x1024",
    response_format: "b64_json",
  });

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error("No image data returned from OpenAI");

  const buffer = Buffer.from(b64, "base64");
  const key = resolveGeneratedImageKey(options.keyPrefix, "png");
  const { url } = await storagePut(key, buffer, "image/png");
  return { url, key };
}
