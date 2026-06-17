import OpenAI from "openai";
import { storagePut } from "../storage";
import { ENV } from "./env";
import { isImageOffline, buildPlaceholderSvg } from "./offline";

export type GenerateImageOptions = {
  prompt: string;
  originalImages?: Array<{
    url?: string;
    b64Json?: string;
    mimeType?: string;
  }>;
};

export type GenerateImageResponse = {
  url?: string;
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
 * Offline stub: render a deterministic SVG placeholder for the prompt and store
 * it like a real generation. No OpenAI call, no spend. Used when OFFLINE_MODE is
 * on or no OpenAI key is configured. The pipeline is unchanged -- it still calls
 * generateImage() and gets back a usable URL.
 */
async function generateImageOffline(
  options: GenerateImageOptions
): Promise<GenerateImageResponse> {
  const svg = buildPlaceholderSvg(options.prompt);
  const { url } = await storagePut(
    `generated/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.svg`,
    Buffer.from(svg, "utf-8"),
    "image/svg+xml"
  );
  return { url };
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
  const { url } = await storagePut(`generated/${Date.now()}.png`, buffer, "image/png");
  return { url };
}
