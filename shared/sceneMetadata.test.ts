import { describe, it, expect } from "vitest";
import { packSceneOcrText, unpackSceneOcrText, type SceneOcrMetadata } from "./sceneMetadata";

const META: SceneOcrMetadata = {
  title: "The burning ship",
  rationale: "Pivotal action scene at the narrative climax.",
  sourcePage: 7,
  importance: 5,
};

describe("packSceneOcrText / unpackSceneOcrText", () => {
  it("round-trips metadata + description", () => {
    const packed = packSceneOcrText(META, "A tall ship engulfed in flames.");
    const { metadata, description } = unpackSceneOcrText(packed);
    expect(metadata).toEqual(META);
    expect(description).toBe("A tall ship engulfed in flames.");
  });

  it("round-trips when description contains newlines", () => {
    const desc = "Line one.\nLine two.\nLine three.";
    const packed = packSceneOcrText(META, desc);
    const { metadata, description } = unpackSceneOcrText(packed);
    expect(metadata).toEqual(META);
    expect(description).toBe(desc);
  });

  it("round-trips an empty description", () => {
    const packed = packSceneOcrText(META, "");
    const { metadata, description } = unpackSceneOcrText(packed);
    expect(metadata).toEqual(META);
    expect(description).toBe("");
  });

  it("returns null metadata for plain page-mode ocrText", () => {
    const plain = "This is regular OCR text from a page.";
    const { metadata, description } = unpackSceneOcrText(plain);
    expect(metadata).toBeNull();
    expect(description).toBe(plain);
  });

  it("returns null metadata for null/undefined input", () => {
    expect(unpackSceneOcrText(null)).toEqual({ metadata: null, description: "" });
    expect(unpackSceneOcrText(undefined)).toEqual({ metadata: null, description: "" });
    expect(unpackSceneOcrText("")).toEqual({ metadata: null, description: "" });
  });

  it("returns null metadata when first line is JSON but lacks the sentinel", () => {
    const fakeJson = '{"title":"foo"}\nsome description';
    const { metadata, description } = unpackSceneOcrText(fakeJson);
    expect(metadata).toBeNull();
    expect(description).toBe(fakeJson);
  });

  it("returns null metadata when first line is malformed JSON", () => {
    const broken = '{"__sm__":1, title: broken}\nsome description';
    const { metadata, description } = unpackSceneOcrText(broken);
    expect(metadata).toBeNull();
    expect(description).toBe(broken);
  });

  it("preserves special characters in title and rationale", () => {
    const meta: SceneOcrMetadata = {
      title: 'The "chosen" one\'s dilemma',
      rationale: "Character faces a choice: life or <death>.",
      sourcePage: 3,
      importance: 4,
    };
    const packed = packSceneOcrText(meta, "A young hero stands at a crossroads.");
    const { metadata } = unpackSceneOcrText(packed);
    expect(metadata).toEqual(meta);
  });

  it("handles multi-line description where first line could look like JSON", () => {
    const desc = '{"not":"a header"}\nactual content';
    const packed = packSceneOcrText(META, desc);
    const { metadata, description } = unpackSceneOcrText(packed);
    expect(metadata).toEqual(META);
    expect(description).toBe(desc);
  });
});
