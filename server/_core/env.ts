export const ENV = {
  appId: process.env.VITE_APP_ID ?? "literatureai",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  isProduction: process.env.NODE_ENV === "production",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  // Legacy Manus Forge endpoint — still read by notification.ts (notifyOwner),
  // which throws INTERNAL_SERVER_ERROR when these are unset (the normal case
  // outside Manus hosting).
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  // Google OAuth
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  // OpenAI
  openAiApiKey: process.env.OPENAI_API_KEY ?? "",
  openAiBaseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com",
  // LLM model used by invokeLLM for prompt/story-context generation
  llmModel: process.env.LLM_MODEL ?? "gpt-4o-mini",
  llmMaxTokens: Number(process.env.LLM_MAX_TOKENS ?? "4096"),
  // Image generation model + size
  imageModel: process.env.IMAGE_MODEL ?? "dall-e-3",
  imageSize: process.env.IMAGE_SIZE ?? "1024x1024",
  // Automatic retry worker for failed pages
  retryWorkerEnabled: (process.env.RETRY_WORKER_ENABLED ?? "true") !== "false",
  retryWorkerIntervalMs: Number(process.env.RETRY_WORKER_INTERVAL_MS ?? "30000"),
  // Cloudinary
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME ?? "",
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY ?? "",
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET ?? "",
};
