import { describe, it, expect } from "vitest";
import { packSceneOcrText } from "./sceneMetadata";
import { toGalleryImage, toGalleryImages } from "./galleryImages";

describe("galleryImages", () => {
  it("uses 'Page N' title and no subtitle for plain page-mode rows", () => {
    const img = toGalleryImage({
      id: 7,
      pageNumber: 3,
      generatedImageUrl: "https://cdn/x.png",
      ocrText: "Once upon a time there was a dragon.",
    });
    expect(img).toEqual({
      id: "7",
      pageNumber: 3,
      url: "https://cdn/x.png",
      title: "Page 3",
      subtitle: undefined,
    });
  });

  it("surfaces the scene title and source-page subtitle for scene-mode rows", () => {
    const ocrText = packSceneOcrText(
      { title: "The parting of the sea", rationale: "pivotal", sourcePage: 12, importance: 5 },
      "A vast sea splits down the middle as the prophet raises his staff."
    );
    const img = toGalleryImage({
      id: 42,
      pageNumber: 2, // scene ordinal
      generatedImageUrl: "https://cdn/scene.png",
      ocrText,
    });
    expect(img.title).toBe("The parting of the sea");
    expect(img.subtitle).toBe("Scene 2 • from page 12");
    expect(img.url).toBe("https://cdn/scene.png");
    expect(img.id).toBe("42");
  });

  it("falls back to 'Page N' when a scene header lacks a usable title", () => {
    const ocrText = packSceneOcrText(
      { title: "", rationale: "", sourcePage: 0, importance: 0 },
      "Some description without a real title or source page."
    );
    const img = toGalleryImage({
      id: 1,
      pageNumber: 4,
      generatedImageUrl: "https://cdn/y.png",
      ocrText,
    });
    expect(img.title).toBe("Page 4");
    // sourcePage 0 is not a real source page -> no subtitle
    expect(img.subtitle).toBeUndefined();
  });

  it("filters out pages with no generated image and preserves order", () => {
    const pages = [
      { id: 1, pageNumber: 1, generatedImageUrl: "a.png", ocrText: "page one text here ok" },
      { id: 2, pageNumber: 2, generatedImageUrl: null, ocrText: "no image yet" },
      { id: 3, pageNumber: 3, generatedImageUrl: "c.png", ocrText: "page three text here ok" },
    ];
    const imgs = toGalleryImages(pages);
    expect(imgs.map((i) => i.pageNumber)).toEqual([1, 3]);
    expect(imgs.map((i) => i.url)).toEqual(["a.png", "c.png"]);
  });

  it("returns an empty array for an empty page set", () => {
    expect(toGalleryImages([])).toEqual([]);
  });
});
