import { v2 as cloudinary } from "cloudinary";
import { ENV } from "./_core/env";

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
  return relKey
    .replace(/^\/+/, "")
    .replace(/\.[^.]+$/, "")
    .replace(/\s+/g, "-");
}

function resourceType(contentType: string): "image" | "raw" | "video" {
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";
  return "raw";
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  const cld = getCloudinary();
  const publicId = keyToPublicId(relKey);
  const resType = resourceType(contentType);

  const url = await new Promise<string>((resolve, reject) => {
    const stream = cld.uploader.upload_stream(
      { public_id: publicId, resource_type: resType, overwrite: true },
      (error, result) => {
        if (error) return reject(error);
        resolve(result!.secure_url);
      }
    );
    stream.end(Buffer.isBuffer(data) ? data : Buffer.from(data as any));
  });

  return { key: relKey, url };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const cld = getCloudinary();
  const publicId = keyToPublicId(relKey);
  const url = cld.url(publicId);
  return { key: relKey, url };
}

export async function storageGetSignedUrl(relKey: string): Promise<string> {
  const { url } = await storageGet(relKey);
  return url;
}
