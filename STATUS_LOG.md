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
