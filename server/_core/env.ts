export const ENV = {
  appId: process.env.VITE_APP_ID ?? "literatureai",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  isProduction: process.env.NODE_ENV === "production",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  // Legacy Manus Forge stubs -- unused but kept for template files that reference them
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  // Google OAuth
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  // OpenAI
  openAiApiKey: process.env.OPENAI_API_KEY ?? "",
  // Cloudinary
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME ?? "",
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY ?? "",
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET ?? "",
  // Feature flags
  // When true, processBookPipeline plans MULTIPLE distinct scenes per book
  // (scenePlanner) instead of a rigid one-image-per-page mapping. Defaults off
  // to preserve existing behaviour.
  sceneModeEnabled: process.env.SCENE_MODE_ENABLED === "true",
  // When true, ALL paid boundaries (LLM, DALL-E image gen, Cloudinary storage)
  // run as local no-cost stubs even if keys are present -- lets the full pipeline
  // run end-to-end with zero spend. Each boundary also auto-falls-back to offline
  // when its own key is absent (see server/_core/offline.ts).
  offlineMode: process.env.OFFLINE_MODE === "true",
};
