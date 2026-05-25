import type { Express } from "express";

// Storage is now served directly via Cloudinary CDN URLs.
// No proxy needed.
export function registerStorageProxy(_app: Express) {}
