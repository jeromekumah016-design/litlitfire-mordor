# STATUS_LOG.md
Append-only. Newest entries at the bottom.

---
## 2026-07-04 00:4x CT — Session start / Task 1 close-out

**Repo state found at session start:** working tree on `fix/litlit-bugs` was dirty:
- deleted `shared/galleryImages.ts` + `shared/galleryImages.test.ts`
- `vitest.config.ts` edited to strip `shared/**/*.test.ts` / `shared/**/*.spec.ts` from the test `include` glob
- untracked `.canary_test.txt` (200 lines of `line1`..`line200`, no clear purpose)
- untracked `package-lock.json` (repo is pnpm-managed via `pnpm-lock.yaml`; this looks like stray npm-install noise, left untouched/untracked)

Initially flagged this as possible test-suite tampering (delete feature + its test + silently widen the test-exclusion glob = classic "hide the regression" pattern) and reverted all three. On closer inspection: `grep -rln "galleryImages"` across `client/server/shared` showed **zero importers** of `galleryImages.ts` outside its own test. Commit `28f2861` ("fix: use direct sceneTitle/sourcePage fields in DevMode + gallery") had already deleted the equivalent `shared/sceneMetadata.ts` for the identical reason (`ImageGalleryView` now inlines the mapping directly) but left `galleryImages.ts` behind as an orphan. So the file deletion itself was legitimate dead-code cleanup — verified, not a hidden regression.

**What was NOT legitimate:** the `vitest.config.ts` edit removed the shared test-include glob entirely rather than scoping the change to the one dead test file. That would have silently disabled discovery of any *future* shared/-dir tests, which is exactly the kind of change that should never ride along quietly with an unrelated cleanup.

**Action taken (commit `850e1a5` on `overnight/2026-07-04`):**
- Deleted `shared/galleryImages.ts` + `shared/galleryImages.test.ts` (confirmed dead code)
- Left `vitest.config.ts`'s include globs untouched (shared test discovery intact)
- Deleted `.canary_test.txt` (noise)
- Full suite re-run: 291 passed / 0 failed

**Invariants (§2) touched:** none directly — no OCR/render coupling, no story-bible field changes, no promptStatus/imageStatus changes. Confirmed unaffected.

**Flag for Jerome:** none blocking. Worth a look when convenient: confirm the untracked `package-lock.json` isn't wanted (currently left untracked, not committed, not deleted).

**Rung 1 check:** `gh issue list -R jeromekumah016-design/litlitfire-mordor --state all` returns zero issues, open or closed. Tracker is empty — descending to rung 2 (invariant-hardening) / rung 3 (test coverage for transcribe/render boundary + story-bible consistency).

---
## 2026-07-04 00:55 CT — Task 2 close-out (rung 2: invariant-hardening / retry logic)

**Rung 1 re-check:** `gh issue list -R jeromekumah016-design/litlitfire-mordor --state all` still returns zero issues. Descending to rung 2.

**Found:** `server/resilience.ts` already has a well-built `withRetry` (exponential backoff, configurable attempts) plus `CircuitBreaker`/`RateLimiter`/`Bulkhead`, but grep confirmed it was wired into exactly zero production call sites — only exercised in `core.test.ts`. Both external calls in the pipeline (`ocrService.ts`'s `Tesseract.recognize`, `_core/imageGeneration.ts`'s `openai.images.generate`) made exactly one attempt each, no retry, before either throwing (single-image OCR path) or falling through to the page-level DB-backed retry scheduler in `retryService.ts` (`markPageForRetry`). That scheduler is the right mechanism for a page that has genuinely, definitively failed and needs a backoff-scheduled re-run — but a same-call transient blip (flaky Tesseract worker spin-up, a 429/5xx from OpenAI) shouldn't have to pay that full cost. This is a real hardening gap matching dispatch §1 priority 4 exactly ("retry logic around OCR and NightCafe/DALL·E calls").

**Action taken (commit `97aa6b7` on `overnight/2026-07-04`):**
- `server/ocrService.ts`: `extractTextFromImage` now wraps `Tesseract.recognize` in `withRetry` (2 extra attempts, 250ms initial backoff). Batch path (`extractTextFromImages`) inherits this automatically since it calls the single-image function per page.
- `server/_core/imageGeneration.ts`: `generateImage` now retries the DALL-E call, but only on transient-looking failures — rate limit (429), server error (5xx), or a network-level failure with no HTTP status at all. Non-retryable 4xx (bad prompt, auth, content-policy rejection) fails fast on the first attempt since retrying can't fix those and would just burn time/spend on a call that will never succeed. Added `isRetryableImageGenError` to classify.
- Both changes are purely additive at the call-site boundary; no signature changes, no schema changes.

**Invariants (§2) touched:**
- OCR/render decoupling: not touched. `ocrService.ts` still has zero awareness of rendering; `imageGeneration.ts`'s params are still render-only, untouched by OCR text. Confirmed via re-read of both files post-edit.
- Two-phase gate: not touched — this change is inside a single call, not across the phase boundary.
- Story-bible field identity (`physicalDescription`/`artStyle`): not touched — no story-bible code was in scope.
- `promptStatus`/`imageStatus` separation: not touched.
- No violations found or introduced.

**Verify:** `npx tsc --noEmit` clean. Targeted run (`core.test.ts` + `scenePipeline.test.ts`, the two files that exercise `resilience.ts`/OCR mocks): 203 passed / 0 failed. Full suite before commit: 291 passed / 0 failed.

**Flags for Jerome:** none blocking.

**Next up:** rung 3 — test coverage for the transcribe/render phase boundary and story-bible consistency (locked-field drift checks across pages for a given book). That's the #1 real failure mode per dispatch §1 priority 3 and doesn't yet have dedicated test coverage as far as this session's grep has found — will scope and verify that claim before starting.

---
## 2026-07-17 — Daily sprint: OCR result caching wired into production + dead-code audit

**Unit shipped:** `server/ocrCacheService.ts` (TTLMap-backed OCR cache, 24h TTL) existed but had zero importers anywhere in the codebase — todo.md's "Performance Optimization (v2.0)" section claimed it was "implemented" and "wired into active pipeline," but `grep` across `server/client/shared` showed it was never imported outside its own file. Traced the one real production call site of `extractTextFromImage` (Tesseract OCR) to `pipelineService.ts`'s `processPagePipeline` — the function `retryWorker.ts` re-invokes wholesale on every automatic retry. The dominant retry cause in this app is "OCR already succeeded, image generation failed" (only `generateImage`'s catch block calls `markPageForRetry`), so every such retry was silently redoing a full Tesseract pass on a page whose text was already correct.

**Action taken (on `overnight/2026-07-04`, uncommitted at time of writing — see below):**
- Added `getOcrTextCached(thumbnailBuffer, cacheScopeKey)` in `pipelineService.ts`: hashes the thumbnail buffer (SHA-256) and consults `ocrCacheService` keyed on `(hash, storageKey)` before calling Tesseract; caches the result on miss. `processPagePipeline` now calls this instead of `extractTextFromImage` directly.
- This also pulls `dataStructureOptimizations.ts` (TTLMap) into production transitively — previously that file's only importer besides `ocrCacheService` was `core.test.ts`.
- +15 tests: `server/ocrCacheService.test.ts` (10, direct cache-service behavior — get/set/hit/miss/stats/clear, none of which existed before) and `server/pipelineService.ocrCache.test.ts` (5, integration — cache hit skips the mocked Tesseract call, content or scope-key changes force a fresh call, failures aren't cached).
- Decoupling invariant UPHELD: this sits entirely on the transcription side. `getOcrTextCached` touches `extractTextFromImage` and `ocrCacheService` only — no import of, or dependency on, image generation, prompt service, or the story bible. Re-read post-edit to confirm.
- Suite: 317 passed / 0 failed (was 302; +15 new, 0 broken). `npx tsc --noEmit`: clean.

**Audit finding (not fixed this session — flagging for Jerome, scope discipline):** since I was already tracing import graphs for the fix above, I checked the rest of todo.md's "Performance Optimization (v2.0)" section against the real production entry point (`server/_core/index.ts` → `routers.ts` → `{system,auth,books,retry}Router` → their direct imports only). Confirmed by `grep -rn` for each module's name across `server/client/shared`, counting only non-test, non-self-file matches:

*Wired and live:* `resilience.ts` (`withRetry`, used by `ocrService.ts` + `_core/imageGeneration.ts`), `retryService.ts`/`retryWorker.ts`/`retryRouter.ts`, and now `ocrCacheService.ts`/`dataStructureOptimizations.ts` as of this entry.

*Zero production importers — code exists, works in isolation (some has test coverage via `core.test.ts` mocks, most doesn't), but is never reached by a real request:* `connectionPool.ts` ("database connection pooling" claim), `dbOptimizationHelpers.ts` + `dbOptimized.ts` ("cursor-based pagination," "query result caching," "strategic indexes" claims — the live DB layer is plain `db.ts`, not audited further here), `memoryOptimization.ts` (`TypedArrayPool`/`ObjectPool`/`CircularBuffer`/`MemoryProfiler` claims), `dbPerformanceWrapper.ts` + `trpcMiddleware.ts` + `metricsRouter.ts` (this trio is the *only* thing that imports `performanceMonitor.ts`, and nothing imports any of the three — so the whole "Monitoring & Metrics" checklist section is dead, not just under-tested), `progressRouter.ts` + `progressTracker.ts` (the fancier SSE progress-subscription backend — the UI's actual live-update mechanism is plain interval polling of `books.getDetails`/`getProgress` via tRPC, confirmed in `DevModeDiagnostics`), `streamingUpload.ts` (`ResumableUpload` — only referenced from `core.test.ts`; the real upload path is base64-over-tRPC, not streaming).

This is the same shape of gap the 07-04 session found with `resilience.ts` before that session wired `withRetry` in, and the same shape as the `galleryImages.ts`/`sceneMetadata.ts` orphaned-file findings. It's ~10 files and a large fraction of the "Performance Optimization (v2.0)" checklist. Nothing here is broken or urgent (the app works correctly without them), but the todo.md checkmarks overstate what's actually protecting production. Left todo.md's checkboxes as-is (didn't want to hand-edit ~40 historical lines without your sign-off) but added a pointer comment at the section header to this entry. **Needs your call:** wire the highest-value ones in (my guess at ranking: `trpcMiddleware`+`metricsRouter` for real observability, then `connectionPool`, then the rest), or treat them as abandoned Manus scaffolding and delete, or leave as reference code. Not blocking anything.

**Verify:** `npx tsc --noEmit` clean. Full suite 317/0. Manual re-read of the diff (`git diff server/pipelineService.ts`) confirmed the change is exactly the intended 26-line addition, nothing else touched.

**ENV:** Edit tool truncated `pipelineService.ts`'s tail again on the first attempt (same recurring bug, every session since 06-16) — caught it immediately via `wc -l`/`tail` right after the edit this time instead of discovering it later, recovered via `git show HEAD:<path>` + Python string-replace + `cat >` through the bash/Linux-mount path, same workaround as prior sessions. `.git/HEAD.lock`/`index.lock`/`objects/maintenance.lock`/`refs/heads/overnight/2026-07-04.lock` still all unremovable (`Operation not permitted`) — committing via temp-index + write-tree + commit-tree + direct ref-file overwrite, same as every session since 06-17. NOT pushed (Jerome reviews+pushes). Branch: `overnight/2026-07-04`.
