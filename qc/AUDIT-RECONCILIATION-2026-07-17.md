# Audit Reconciliation — 2026-07-17

**Audit target:** `main` @ `873a2cb` (June 19, Manus "hybrid storage workaround" checkpoint).
**Reconciled against:** `overnight/2026-07-04` @ `d3d388f` (July 17, tip of the autonomous-sprint line).
**Divergence:** merge-base is `3c70234` (June 5). origin/main = base + exactly 1 commit (873a2cb). This branch = base + 24 commits. Zero overlap. The audit saw none of the sprint line's work; the sprint line never saw 873a2cb.

**Answer to the audit's open question:** explanation (a), mostly. Auth hardening, the image-key integrity fix, scene-based generation, offline/zero-spend mode, retry hardening, and invariant test coverage all exist on this branch, unmerged. But the P1 two-phase architecture (promptStatus/imageStatus split, review gate, persisted bible) exists on NO branch — the audit is right that it was never built. The July agents were not maintaining a phantom; they were maintaining the softer invariant (bible mediates; image generator never receives raw OCR text — enforced in storyBibleBoundary.test.ts), not the audit's harder one.

---

## Corrections to the audit (wrong for this branch)

**C1 — auth half already fixed.** All booksRouter procedures are `protectedProcedure` with `ctx.user.id` and ownership checks (`booksRouter.ts:120,124,166,221,273,323,359`). No `?? 1` anywhere. Fixed on the qa line in June. **Still standing from C1:** upload auto-triggers the pipeline (`booksRouter.ts:146`) with no rate limit, no daily cap, no payment gate — an authenticated cost faucet instead of an anonymous one.

**C4 — "retryWorker is dead code, luckily" is inverted here.** `startRetryWorker` IS called at boot on this branch (`_core/index.ts:69-71`), default-enabled. Combined with H3 (thumbnails still 1×1 PNGs, `pdfService.ts:167-168`) and the empty-text guard returning a renderable prompt (`promptService.ts:338-341`), the money-to-garbage converter the audit described as dormant is **live** here whenever real API keys are configured. Severity is higher than audited, not lower. Existing mitigations: offline mode (absent keys → zero-spend stubs, `_core/offline.ts`), and fail-fast classification on non-retryable 4xx (`imageGeneration.ts:31-35`).

**H2 — fixed.** `generateImage` accepts `keyPrefix`, stores at that key, returns the real key; both pipelines record `imageResult.key` (`imageGeneration.ts:82-92,146-148`; commit `ea944fd`). The audited fabricated-key bug is gone.

**Duplicate-row claim — half fixed.** The single-page path (retryWorker → `processPagePipeline`) upserts (commit `7e00efd`). The book-level path (`retryFailedPages` → `processBookPipeline` → `processPagePipelineWithContext`) still calls plain `createPage` on success (`pipelineService.ts:129`) — a previously-errored page reset to "pending" gets a second row. `pages(bookId,pageNumber)` has a plain index, not unique (`schema.ts:90`). `scenes(bookId,sceneIndex)` already has the unique index (`schema.ts:141`).

**The audit never saw scene mode.** Dedicated `scenes` table (structured title/rationale/sourcePage/prompt/params capture, unique index, retry columns), scene pipeline writing only to scenes, dual read path in getDetails/getProgress, flag-gated at the single pipeline entry point. This changes P1's shape: the bible-persistence and status-split design should cover both write paths, and scenes already records resolved render params per row (the audit's audit-trail ask, delivered for scenes).

**Dead code — list shrinks by two.** `ocrCacheService` + `dataStructureOptimizations` were wired into production on 2026-07-17 (`d3d388f`). The other ~10 server modules the audit lists are confirmed dead on this branch too. `@aws-sdk/*` and `mysql2` still in package.json (lines 16-17, 65).

---

## Confirmed still open on this branch (audit right)

- **C2:** no `promptStatus`/`imageStatus`, no approval concept, no transcribe/render split. Greps across server/shared/drizzle/client return nothing.
- **C3:** bible is ephemeral — no `storyBible` column; rebuilt per pipeline run; `retryFailedPages` reruns the book pipeline → new bible → guaranteed drift vs original pages. Bible-build failure degrades instead of blocking (`pipelineService.ts` catch → continue). Enforcement is paraphrase-through-system-prompt (`promptService.ts:346-449`); the final DALL·E prompt is LLM output, not code-assembled. The byte-identity our tests assert is of bible fields **within the system prompt across pages in one run** — the softer invariant. The audit's byte-identical-final-prompt rule is not implemented.
- **C4 manual path:** image retry regenerates the prompt (root defect), confirmed.
- **H1:** main path uses pdfjs text-layer only; Tesseract exists only in the single-page path, fed a 1×1 PNG; empty text → renderable "empty page" prompt. Scanned books = blank art at full price.
- **H3:** `generatePageThumbnail` returns a 1×1 white PNG ("kept for backward compatibility", `pdfService.ts:144-168`). todo.md's "real canvas thumbnails" checkmarks are false — same self-reported-completion pattern as the perf section.
- **H4:** tier math multiplies the whole count by one tier rate → non-monotonic (50 pages $25.00, 51 pages $20.40; `pricingService.ts:44-48`); priced on `totalPages` (≤500) while `MAX_PAGES=20` caps processing; nothing collects payment.
- **H5:** `processPdf` sets "processing" before fetching the PDF; fetch failure only logs → permanently stuck, re-trigger refused (`booksRouter.ts:167-177`). Same shape in `retryFailedPages` (`:328-342`), which also resets pages to pending before knowing the fetch works.
- **Medium, all confirmed:** chronology regex passes non-matching entries (`promptService.ts:396`); `extractCharacters` duplicated in promptService + pipelineService and its output (`PageContext.characters`) never read downstream; "A page from a book" fallback exists (`promptService.ts:556`) but is unreachable from the live pipeline (`generateImagePromptsWithContext` is imported by pipelineService and never called — dead import); getDetails/list 30s cache is invalidated at mutation endpoints but NOT by pipeline page-writes (staleness bounded at 30s); the ghost-book localStorage fallback is **not on this branch** — it is the content of 873a2cb itself.

---

## Revised plan (delta to the audit's P0–P3)

**P0 (unchanged in spirit, one addition):**
1. ~~upload/list → protected~~ done. Add a per-user daily render cap + remove or gate the upload auto-trigger.
2. **Disable the retry worker until rebuilt** (`RETRY_WORKER_ENABLED=false` default, or drop the boot call) — on this branch it is live and harmful, not dead.
3. H5 fix: set "processing" only after successful fetch; revert on failure (both endpoints).
4. ~~Refuse to render empty/fallback prompts — fail the page.~~ **DONE (2026-07-20)**: `generateImagePrompt` throws `EmptyPageError` instead of returning `"An empty page, {style}"`; both page-mode paths already fail+record that page without scheduling a retry (retrying can't produce text that was never there). See `sprint-log.md` 2026-07-20 and commit `60cb24a`.

**P1 (as audited, scoped wider):** persist the bible (`books.storyBible` jsonb), status split, code-assembled final prompts with verbatim bible segments + checksum — designed across BOTH write paths (pages + scenes). Bible failure blocks phase 2.

**P2:** unique index on `pages(bookId,pageNumber)` + upsert in the WithContext path; image retry = re-render persisted prompt only; pricing → marginal tiers on pages actually processed + render gate; delete/quarantine dead modules (needs Jerome's call, list in STATUS_LOG 2026-07-17); drop `@aws-sdk/*` + `mysql2`; delete dead `generateImagePromptsWithContext` import + dedupe/delete `extractCharacters`.

**P3:** unchanged (RenderBackend seam; book_to_visuals NightCafe as second backend).

---

## Merge/push record (2026-07-17)

Jerome instructed: push to GitHub main. origin/main (`873a2cb`) is not an ancestor of this line, so main was merged into `overnight/2026-07-04` with **strategy=ours**: `873a2cb` is preserved in history, its content is not carried forward. Rationale: its hybrid localStorage fallback modifies the same upload/list endpoints this line hardened (auth, typed caches, imageParams); its DB-failure fallback conflicts with the auth model and is the audit's ghost-book finding. The tested tree (317/317, tsc clean) ships as-is. To resurrect the client-side piece: `git show 873a2cb:client/src/lib/localStorage.ts`.

## Decisions Jerome owns
1. Dead-module cluster: wire in, delete, or leave (STATUS_LOG 2026-07-17 has the ranked list).
2. P1 go/no-go + schema migrations (storyBible jsonb, status split, pages unique index).
3. Retry worker: rebuild render-only per P2, or delete the scheduling half.
4. Pricing model + render gate (credits vs ArtDetect-side entitlement).
5. Whether 873a2cb's localStorage fallback should be ported forward properly (offline-first UX) or stay retired.
6. Deployment status: if this is publicly reachable with real keys, P0 items 1-2 are same-day.
