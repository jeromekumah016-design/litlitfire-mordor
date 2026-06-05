import OpenAI from "openai";
import { storagePut } from "server/storage";
import { ENV } from "./env";

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
    _openai = new OpenAI({
      apiKey: ENV.openAiApiKey,
      baseURL: `${ENV.openAiBaseUrl.replace(/\/$/, "")}/v1`,
    });
  }
  return _openai;
}

export async function generateImage(
  options: GenerateImageOptions
): Promise<GenerateImageResponse> {
  const openai = getOpenAI();

  const response = await openai.images.generate({
    model: ENV.imageModel,
    prompt: options.prompt.slice(0, 4000),
    n: 1,
    size: ENV.imageSize as "1024x1024" | "1792x1024" | "1024x1792",
    response_format: "b64_json",
  });

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error("No image data returned from OpenAI");

  const buffer = Buffer.from(b64, "base64");
  const { url } = await storagePut(`generated/${Date.now()}.png`, buffer, "image/png");
  return { url };
}
