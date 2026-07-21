import { describe, it, expect } from "vitest";
import { derivePipelinePhase } from "./readingPipeline";

describe("derivePipelinePhase", () => {
  it("extracted when pages have OCR but no prompts", () => {
    const r = derivePipelinePhase("pending", [
      { ocrText: "Once upon a time", promptStatus: "pending", imageStatus: "pending" },
    ]);
    expect(r.phase).toBe("extracted");
    expect(r.label).toMatch(/build prompts|Stage 1/i);
  });

  it("reading while book is processing and no prompts yet", () => {
    const r = derivePipelinePhase("processing", [
      { ocrText: "text", promptStatus: "pending", imageStatus: "pending" },
    ]);
    expect(r.phase).toBe("reading");
  });

  it("needs_approve when prompts are ready", () => {
    const r = derivePipelinePhase("pending", [
      { promptStatus: "prompt_ready", imageStatus: "pending", ocrText: "x" },
      { promptStatus: "prompt_error", skipSuggested: true, ocrText: "y" },
    ]);
    expect(r.phase).toBe("needs_approve");
    expect(r.promptReadyCount).toBe(1);
  });

  it("ready_to_render when at least one approved", () => {
    const r = derivePipelinePhase("pending", [
      { promptStatus: "approved", imageStatus: "pending" },
      { promptStatus: "prompt_ready", imageStatus: "pending" },
    ]);
    expect(r.phase).toBe("ready_to_render");
    expect(r.approvedCount).toBe(1);
  });

  it("photos_ready when images cover approvals", () => {
    const r = derivePipelinePhase("completed", [
      { promptStatus: "approved", imageStatus: "image_ready" },
      { promptStatus: "approved", imageStatus: "image_ready" },
    ]);
    expect(r.phase).toBe("photos_ready");
  });

  it("failed when book status is failed", () => {
    const r = derivePipelinePhase("failed", []);
    expect(r.phase).toBe("failed");
  });
});
