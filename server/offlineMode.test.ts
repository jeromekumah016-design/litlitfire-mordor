import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "os";
import path from "path";
import { promises as fs } from "fs";

import {
  buildPlaceholderSvg,
  contentTypeForKey,
  seededColor,
  hashString,
  isLLMOffline,
  isImageOffline,
  isStorageOffline,
} from "./_core/offline";
import { invokeLLM } from "./_core/llm";
import { generateImage } from "./_core/imageGeneration";
import { storagePut, storageGet, storageGetSignedUrl, offlineFilePath } from "./storage";

// Point offline storage at a throwaway temp dir so the suite never writes into
// the repo's .offline-storage. offlineStorageDir() reads this at call time.
const TMP = path.join(os.tmpdir(), `litlit-offline-${Date.now()}`);
beforeAll(() => {
  process.env.OFFLINE_STORAGE_DIR = TMP;
});
afterAll(() => {
  delete process.env.OFFLINE_STORAGE_DIR;
});

// In the test env there are no OpenAI/Cloudinary keys, so all three boundaries
// are offline by default — exactly the "no API keys" state we are validating.
describe("offline activation", () => {
  it("LLM, image and storage all report offline with no keys configured", () => {
    expect(isLLMOffline()).toBe(true);
    expect(isImageOffline()).toBe(true);
    expect(isStorageOffline()).toBe(true);
  });
});

describe("placeholder + helpers", () => {
  it("buildPlaceholderSvg embeds the (escaped) prompt and is deterministic", () => {
    const a = buildPlaceholderSvg("A storm at sea & a <ship>");
    const b = buildPlaceholderSvg("A storm at sea & a <ship>");
    expect(a).toBe(b); // deterministic
    expect(a.startsWith("<?xml")).toBe(true);
    expect(a).toContain("<svg");
    expect(a).toContain("&amp;"); // & escaped
    expect(a).toContain("&lt;ship&gt;"); // <ship> escaped
    expect(a).not.toContain("<ship>"); // raw angle brackets not injected
    expect(a).toContain("OFFLINE PLACEHOLDER");
  });

  it("contentTypeForKey maps known extensions", () => {
    expect(contentTypeForKey("a/b.svg")).toBe("image/svg+xml");
    expect(contentTypeForKey("x.PNG")).toBe("image/png");
    expect(contentTypeForKey("x.jpeg")).toBe("image/jpeg");
    expect(contentTypeForKey("x.unknown")).toBe("application/octet-stream");
  });

  it("seededColor is a deterministic hex and hashString is stable", () => {
    expect(seededColor("moses")).toBe(seededColor("moses"));
    expect(seededColor("moses")).toMatch(/^#[0-9a-f]{6}$/);
    expect(hashString("abc")).toBe(hashString("abc"));
    expect(hashString("abc")).not.toBe(hashString("abd"));
  });
});

describe("invokeLLM offline stub", () => {
  it("returns a schema-valid image_prompt derived from the page text", async () => {
    const r = await invokeLLM({
      messages: [{ role: "user", content: 'Page text: "Moses parts the sea"' }],
      response_format: { type: "json_schema", json_schema: { name: "image_prompt", schema: { type: "object" } } },
    });
    const parsed = JSON.parse(r.choices[0].message.content as string);
    expect(parsed).toHaveProperty("prompt");
    expect(parsed).toHaveProperty("style");
    expect(parsed).toHaveProperty("mood");
    expect(parsed.prompt).toContain("Moses parts the sea");
    expect(r.usage?.total_tokens).toBe(0); // no spend
  });

  it("returns a valid empty story_context", async () => {
    const r = await invokeLLM({
      messages: [{ role: "user", content: "scan" }],
      response_format: { type: "json_schema", json_schema: { name: "story_context", schema: { type: "object" } } },
    });
    const ctx = JSON.parse(r.choices[0].message.content as string);
    expect(Array.isArray(ctx.characters)).toBe(true);
    expect(ctx.characters).toHaveLength(0);
    expect(typeof ctx.artStyle).toBe("string");
  });

  it("returns an empty scene_plan so scenePlanner falls back deterministically", async () => {
    const r = await invokeLLM({
      messages: [{ role: "user", content: "plan" }],
      response_format: { type: "json_schema", json_schema: { name: "scene_plan", schema: { type: "object" } } },
    });
    const plan = JSON.parse(r.choices[0].message.content as string);
    expect(plan.scenes).toEqual([]);
  });
});

describe("storage offline", () => {
  it("storagePut writes a readable local file and returns an offline URL", async () => {
    const { key, url } = await storagePut("books/9/scenes/0/generated.svg", Buffer.from("<svg/>"), "image/svg+xml");
    expect(url.startsWith("/__offline_storage__/")).toBe(true);
    const onDisk = await fs.readFile(offlineFilePath(key), "utf-8");
    expect(onDisk).toBe("<svg/>");
  });

  it("storageGet and storageGetSignedUrl return offline URLs", async () => {
    const got = await storageGet("books/9/x.png");
    expect(got.url).toBe("/__offline_storage__/books/9/x.png");
    const signed = await storageGetSignedUrl("books/9/x.png");
    expect(signed).toBe("/__offline_storage__/books/9/x.png");
  });

  it("strips path traversal from the served URL", async () => {
    const { url } = await storagePut("../../etc/evil.txt", Buffer.from("x"));
    expect(url).not.toContain("..");
    expect(url).toBe("/__offline_storage__/etc/evil.txt");
  });
});

describe("generateImage offline", () => {
  it("produces an SVG placeholder stored locally with no OpenAI call", async () => {
    const { url } = await generateImage({ prompt: "A calm harbour at dawn" });
    expect(url).toBeTruthy();
    expect(url!.startsWith("/__offline_storage__/generated/")).toBe(true);
    expect(url!.endsWith(".svg")).toBe(true);
    const rel = decodeURIComponent(url!.replace("/__offline_storage__/", ""));
    const svg = await fs.readFile(offlineFilePath(rel), "utf-8");
    expect(svg).toContain("<svg");
    expect(svg).toContain("OFFLINE PLACEHOLDER");
  });
});
