import type { Express, Request, Response } from "express";
import { promises as fs } from "fs";
import path from "path";
import {
  isStorageOffline,
  offlineStorageDir,
  OFFLINE_URL_PREFIX,
  contentTypeForKey,
} from "./offline";

/**
 * In online mode, storage is served directly via Cloudinary CDN URLs -- no proxy.
 *
 * In offline mode (no Cloudinary keys, or OFFLINE_MODE=true), generated images
 * and thumbnails are written to a local directory by server/storage.ts. This
 * route serves those files so the gallery/UI can display them exactly like real
 * CDN URLs, with no third-party dependency.
 */
export function registerStorageProxy(app: Express) {
  app.get(`${OFFLINE_URL_PREFIX}/*`, async (req: Request, res: Response) => {
    if (!isStorageOffline()) {
      res.status(404).end();
      return;
    }
    try {
      const rel = decodeURIComponent(req.path.slice(OFFLINE_URL_PREFIX.length + 1));
      // Prevent path traversal: resolved path must stay within the storage dir.
      const baseDir = path.resolve(offlineStorageDir());
      const abs = path.resolve(baseDir, rel);
      if (abs !== baseDir && !abs.startsWith(baseDir + path.sep)) {
        res.status(400).end();
        return;
      }
      const data = await fs.readFile(abs);
      res.setHeader("Content-Type", contentTypeForKey(abs));
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.end(data);
    } catch {
      res.status(404).end();
    }
  });
}
