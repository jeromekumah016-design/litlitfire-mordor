import { v2 as cloudinary } from "cloudinary";
import { promises as fs } from "fs";
import path from "path";
import { ENV } from "./_core/env";
import {
  isStorageOffline,
  offlineStorageDir,
  OFFLINE_URL_PREFIX,
} from "./_core/offline";

function normalizeRelKey(relKey: string): string {
  // Strip leading slashes and any traversal so writes stay inside the dir.
  return relKey.replace(/^\/+/, "").replace(/\.\.(\/|\\|$)/g, "");
}

/** Absolute on-disk path for an offline-stored key. */
export function offlineFilePath(relKey: string): string {
  return path.join(offlineStorageDir(), normalizeRelKey(relKey));
}

async function offlinePut(
  relKey: string,
  data: Buffer | Uint8Array | string
): Promise<{ key: string; url: string }> {
  const rel = normalizeRelKey(relKey);
  const abs = offlineFilePath(rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as any);
  await fs.writeFile(abs, buf);
  return { key: relKey, url: `${OFFLINE_URL_PREFIX}/${rel.split("/").map(encodeURIComponent).join("/")}` };
}

function offlineUrl(relKey: string): string {
  const rel = normalizeRelKey(relKey);
  return `${OFFLINE_URL_PREFIX}/${rel.split("/").map(encodeURIComponent).join("/")}`;
}

function getCloudinary() {
  if (!ENV.cloudinaryCloudName || !ENV.cloudinaryApiKey || !ENV.cloudinaryApiSecret) {
    throw new Error("Cloudinary not configured: set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET");
  }
  cloudinary.config({
    cloud_name: ENV.cloudinaryCloudName,
    api_key: ENV.cloudinaryApiKey,
    api_secret: ENV.cloudinaryApiSecret,
  });
  return cloudinary;
}

function keyToPublicId(relKey: string): string {
  return relKey.replace(/^\/+/, "").replace(/\.[^.]+$/, "").replace(/\s+/g, "-");
}

function resourceType(contentType: string): "image" | "raw" | "video" {
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";
  return "raw";
}

export async function storagePut(relKey: string, data: Buffer | Uint8Array | string, contentType = "application/octet-stream"): Promise<{ key: string; url: string }> {
  if (isStorageOffline()) return offlinePut(relKey, data);
  const cld = getCloudinary();
  const publicId = keyToPublicId(relKey);
  const resType = resourceType(contentType);
  const url = await new Promise<string>((resolve, reject) => {
    const stream = cld.uploader.upload_stream({ public_id: publicId, resource_type: resType, overwrite: true }, (error, result) => {
      if (error) return reject(error);
      resolve(result!.secure_url);
    });
    stream.end(Buffer.isBuffer(data) ? data : Buffer.from(data as any));
  });
  return { key: relKey, url };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  if (isStorageOffline()) return { key: relKey, url: offlineUrl(relKey) };
  const cld = getCloudinary();
  const publicId = keyToPublicId(relKey);
  const url = cld.url(publicId);
  return { key: relKey, url };
}

/**
 * Returns a signed Cloudinary URL that expires after the given duration.
 * FIX: Previously returned a plain unsigned URL. Now uses sign_url + auth_token
 * so private Cloudinary assets are actually accessible.
 */
export async function storageGetSignedUrl(relKey: string, expiresInSeconds = 3600): Promise<string> {
  // Offline files are served by the app's static route; no signing needed.
  if (isStorageOffline()) return offlineUrl(relKey);
  const cld = getCloudinary();
  const publicId = keyToPublicId(relKey);
  const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const url = cld.url(publicId, { sign_url: true, auth_token: { duration: expiresInSeconds, expiration: expiresAt } });
  return url;
}
