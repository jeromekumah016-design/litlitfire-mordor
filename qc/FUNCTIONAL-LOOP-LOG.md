# Functional Loop Log

Append-only. Newest entries at the bottom.  
Branch: `overnight/2026-07-04`  
Definition: user query “functional” bars 0–6.

---

## Iteration 0 — bootstrap (read-only)

**Read:** tip `8859e86` (two-phase gate), port plan D1–D7, audit recon, booksRouter/gatePipeline/retryWorker.

**Gap vs definition:**
| # | Requirement | State at loop start |
|---|-------------|---------------------|
| 0 | Real e2e photo + viewable storage key | Code path exists; no DATABASE_URL / OPENAI in workspace — **unproven** |
| 1 | Upload store+OCR only | **Met** (`extractAndStorePages` on upload) |
| 2 | Transcribe + persisted storyBible + promptStatus | **Met** |
| 3 | Server-enforced approve before render | **Met** (`promptStatus === "approved"`) |
| 4 | Render from persisted prompt only | **Met** in `renderApprovedImages` (uses `page.generatedPrompt`) — need explicit test lock |
| 5 | Retry = re-render persisted prompt only | **Partial** — manual `retryFailedPages` OK; **retryWorker still calls `processPagePipeline`** (regenerates prompts) if enabled |
| 6 | Cap/auth/retry-off/H5 intact | Cap on render+retry; auth protected; retry default off; H5 on processPdf fetch. **retryWorker still unsafe if enabled** |

**Next slice:** rebuild `retryWorker` to re-render from persisted `generatedPrompt` when `promptStatus===approved` only (bar 5 + safety if worker ever re-enabled). Atomic commit + tests + tsc.

**Decisions (authorized defaults from D1–D7 / definition):**
- **D1:** page-mode only for functional bar (scenes later).
- **D2:** persist overnight `StoryContext` as `storyBible` jsonb; degrade already coded if null (transcribe can still prompt).
- **D3:** two-phase is the product path for upload/processPdf (no single-shot auto-render).
- **D4:** OCR at extract (upload); Stage1 = bible+prompts only.
- **D5:** N/A for page mode (per-page approve).
- **D6:** cap applies at **render**/retry, not extract.
- **D7:** deferred — still LLM free-text final prompt; not required for bars 0–6 as stated.

---
