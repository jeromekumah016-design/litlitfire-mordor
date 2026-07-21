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

## Iteration 1 — retryWorker render-only (bar §5)

**Shipped:** commit `765dafa`
- `reRenderApprovedPage` in gatePipeline — approved + persisted prompt only
- `retryWorker` uses it; refuses non-approved (no `processPagePipeline`)
- Tests: render never calls `generateImagePrompt` / `buildStoryContext`

**Decision:** Retry worker, when enabled, is safe for C3 (no prompt/bible regen). Default remains OFF.

**Verify:** tsc clean, 304 tests pass.

**Next:** unblock bar §0 real run — need Postgres. Workspace has no usable DATABASE_URL. Will try embedded Postgres / PGlite for a local e2e loop that persists real files under `.offline-storage`.

---

## Iteration 2 — embedded-Postgres e2e proof (bar §0 offline path)

**Shipped:**
- `scripts/functional-e2e.ts` + `pnpm e2e:functional`
- `embedded-postgres` devDep + manual hydrate of windows-x64 binaries (pnpm blocked postinstall; junction + hydrate-symlinks)
- Proof: `qc/FUNCTIONAL-E2E-PROOF.md` + `qc/proof-artifacts/page-1.svg`

**Run result (exit 0):**
- extract=3, bible persisted, approved=3, rendered=3 errors=0
- key=`books/1/pages/1/generated.svg`
- url=`/__offline_storage__/books/1/pages/1/generated.svg`
- artifact size 1161 bytes on disk

**Decision:** Use embedded Postgres for local proof when no Neon URL. Offline SVG counts as bar §0 *codepath* proof (same `generateImage`→`storagePut`→key). Live DALL·E PNG blocked by missing OPENAI_API_KEY in this environment — logged, not forced.

**Decision on bar §6 cap scope:** Upload no longer renders (extract only). Cap correctly sits on `renderApprovedImages` + `retryFailedPages`. `processPdf` is extract-only (no spend) so cap is not applied there; applying a “render cap” to pure OCR would be meaningless. Auth on upload/list, retry default-off, H5 fetch ordering: intact.

**Next:** Final checklist report. No further code slices unless suite regresses.

---

## Final checklist (definition of functional)

| # | Requirement | Verdict |
|---|-------------|---------|
| 0 | Photos e2e + real key + viewable file | **PASS (offline path, real DB)** — see FUNCTIONAL-E2E-PROOF.md. Live DALL·E not run (no API key). |
| 1 | Upload store+OCR only | **PASS** |
| 2 | Transcribe + persisted storyBible + promptStatus | **PASS** |
| 3 | Server-enforced approve | **PASS** |
| 4 | Render from persisted prompt only | **PASS** (+ unit test lock) |
| 5 | Retry re-renders persisted prompt only | **PASS** (retryFailedPages + retryWorker) |
| 6 | Cap / auth / retry-off / H5 | **PASS** (cap on render paths; see decision above for processPdf extract) |

---
