# Port plan: `feat/prompt-transcription-gate` → `overnight/2026-07-04`

**Status:** plan only — no code port in this document’s accompanying P0 work.  
**Source:** `origin/feat/prompt-transcription-gate` @ `37c262d` (2026-06-04)  
**Target:** `overnight/2026-07-04` @ `91ecad5`+ (post-P0 tip)  
**Merge-base:** `394a055` (early library-dashboard checkpoint)  
**Not merged:** `git merge-base --is-ancestor feat… overnight` fails; ~13 feat-only commits vs large overnight delta (scene mode, auth hardening, image params, OCR cache, 327+ tests).

This plan answers: for each two-phase design piece, is it portable or conflicted, what order to integrate, and which items need a Jerome architecture decision before any port PR opens.

---

## 1. Divergence snapshot

| Area | Feat (June 4) | Overnight (July 20+) |
|------|---------------|----------------------|
| Auth on booksRouter | `protectedProcedure` (yes) | `protectedProcedure` + ownership + caches + imageParams + **daily render cap** + **H5 fetch ordering** |
| Pipeline shape | Single-shot `processBookPipeline` **plus** additive `generateStoryBible` / `transcribePages` / `renderApprovedImages` | Single-shot **page mode** + **scene mode** (`SCENE_MODE_ENABLED`, `scenes` table, `generationMode`) |
| Story bible | New jsonb column + simple gate `StoryBible` type in promptService | Ephemeral `StoryContext` / `buildStoryContext` in-memory; soft invariant tests; **no column** |
| Page statuses | `processingStatus` + `promptStatus` + `imageStatus` + approve/skip fields | `processingStatus` only on pages **and** scenes |
| Migrations | Claims `0005_prompt_transcription_gate` (pg enums + columns) | Has **`0005_scenes_cutover.sql`** (generationMode + scenes table); journal dialect still says mysql historically |
| Image gen API | Older `generateImage({ prompt })` shape in gate render path | `generateImage({ prompt, keyPrefix, params })` + real key recording + offline stubs |
| UI dashboard | Two-phase Stage1/Stage2 + native approve checkboxes | Pre-generation “Generate Photos” CTA; dual page/scene read in getDetails |
| Tests | Sparse around gate | 327+ tests; `storyBibleBoundary` soft invariant suite is sacred |

**Bottom line:** treat feat as a **reference design + partial implementation**, not a cherry-pick-friendly branch. Mechanical `git merge` will thrash `pipelineService.ts`, `promptService.ts`, `booksRouter.ts`, `drizzle/schema.ts`, and the dashboard.

---

## 2. Piece-by-piece portability

### 2.1 Schema enums (`promptStatus`, `imageStatus`)

| | |
|--|--|
| **Feat** | `page_prompt_status`, `page_image_status` enums; columns on `pages` only |
| **Overnight conflict** | No status split yet; **scenes** table uses shared `page_processing_status` only. Migration number **0005 is already taken** by scenes cut-over. |
| **Portable?** | **Concept yes, dump no.** Needs a new migration id (e.g. `0006_…`), additive columns on **pages and likely scenes**, and dual-path read/write design. |
| **Decision needed?** | **Yes — D1:** Do scenes get the same split statuses, or only page-mode books? (Recon P1 said “both write paths.”) |

### 2.2 `books.storyBible` jsonb

| | |
|--|--|
| **Feat** | Column + persist in `generateStoryBible`; UI shows bible in getDetails |
| **Overnight conflict** | In-memory `StoryContext` from `buildStoryContext`; retry rebuilds bible → drift (audit C3). Soft tests assert within-run identity, not cross-run persistence. |
| **Portable?** | **Highly portable as additive column.** Type shape must be reconciled: feat’s simple `StoryBible` vs overnight’s richer `StoryContext` (characters/factions/locations/objects/events). Prefer **one type**, map at boundary. |
| **Decision needed?** | **Yes — D2:** Persist overnight `StoryContext` as-is, or adopt feat’s smaller locked artStyle/physDesc bible, or a union? Bible failure today degrades; audit wants **block phase 2** — that policy change is architectural. |

### 2.3 `generateStoryBible` / `transcribePages` / `renderApprovedImages`

| | |
|--|--|
| **Feat** | Appended at end of `pipelineService`; old single-shot left as wrapper. **Bug risk:** feat’s `generateStoryBible(bookId)` appears to call a same-named promptService helper with a recursive/shadowing name — reimplement carefully, don’t copy blindly. `renderApprovedImages` uses legacy image API and does not pass `keyPrefix` / imageParams. `transcribePages` assumes OCR text already on page rows. |
| **Overnight conflict** | Full single-shot path already does OCR → bible → prompt → image in one run; scene path plans multi-scene. Upload auto-start now **cap-gated** (book may sit `pending`). Empty pages throw `EmptyPageError`. Offline stubs + retries exist. |
| **Portable?** | **Logic portable as new modules**, not as a dump into current `processBookPipeline`. Prefer `server/gatePipeline.ts` (or similar) that: (1) OCR/text extract only, (2) bible persist, (3) prompt-only, (4) render approved — each step reusable by page + scene. |
| **Decision needed?** | **Yes — D3:** Keep single-shot as default product path, or switch default UX to two-phase and leave single-shot as admin/legacy? **D4:** Does Stage1 include OCR, or is OCR still “upload time”? Feat assumes pages already have `ocrText` (upload/single-shot prefill) — overnight upload no longer always runs pipeline. |

### 2.4 Approve gate (`promptApproved`, `setPromptApproved`, `skipSuggested`, `promptStructured`)

| | |
|--|--|
| **Feat** | boolean columns + protected mutation with ownership via getPage |
| **Overnight conflict** | No getPage in older paths was fixed on feat; overnight may need `getPage` helper (check db.ts — currently has getBookPages, not getPage). Scene rows have no approve column. |
| **Portable?** | **Mechanically easy on pages.** Scenes need either row-level approve or “approve all planned scenes” product rule. |
| **Decision needed?** | **Yes — D5:** Approve granularity for scene-mode (per scene vs per source page vs book-level “approve plan”). |

### 2.5 Two-phase UI (`BookPageReadingDashboard`)

| | |
|--|--|
| **Feat** | Stage1 / Stage2 buttons, approve checkboxes, badges for prompt/image status, storyBible awareness |
| **Overnight conflict** | Dashboard evolved differently (nav, gallery scene titles, dual getDetails for scenes). Client must handle `generationMode === "scene"` and empty pages when auto-render was cap-blocked. |
| **Portable?** | **UI patterns portable; file not.** Rebuild Stage1/Stage2 against overnight getDetails shapes + scene dual-read, rather than overwriting the component wholesale. |
| **Decision needed?** | **Yes — D6:** Should cap-blocked uploads land users in Stage1 automatically, or still offer one-click single-shot when under cap? |

### 2.6 Soft invariant suite (overnight-only, keep)

`server/storyBibleBoundary.test.ts` encodes: bible once per run, no drift in system prompt fields, chronology gate, image gen never sees raw OCR, EmptyPageError. Any port must **extend** these tests for persisted bible + two-phase, not delete them.

---

## 3. Incremental integration order (smallest safe slice first)

Each slice should be its own PR/commit stack on a branch off current overnight tip. Stop and re-review decisions before Slice 3 if D1–D2 unresolved.

### Slice 0 — Preconditions (docs/ops only)

- Confirm D1–D6 answers (section 4).
- Fix migration numbering plan: **never reuse 0005**; next file `0006_prompt_image_status_split.sql` (and journal entry).
- Inventory feat files to **reference only** (`git show 37c262d:path`), no merge.

### Slice 1 — Schema only (no behavior change)

- Add `storyBible jsonb` on books (nullable).
- Add page columns: `promptStatus`, `imageStatus`, `promptApproved`, `promptStructured`, `skipSuggested` with defaults that make existing single-shot still valid (`prompt_ready`/`image_ready` optional backfill later, or leave pending until written).
- If D1 = scenes too: mirror columns (or a subset) on `scenes`.
- Ship migration + Drizzle types + tsc green.
- **No** new router endpoints yet. Existing pipeline ignores new columns.

### Slice 2 — Persist bible in current single-shot (no UI gate yet)

- After `buildStoryContext`, `updateBook({ storyBible })`.
- On retry/start: if storyBible present, reuse instead of rebuild (fixes C3 drift for single-shot).
- Extend `storyBibleBoundary` tests for reuse-on-retry.
- Bible failure policy: keep degrade until D2 decides block.

### Slice 3 — Prompt-only + render-only services (API behind feature flag)

- Implement clean `gatePipeline.ts` using overnight image API (`keyPrefix`, params, EmptyPageError, offline).
- Endpoints: `generateStoryBible`, `transcribePages` (or `buildPrompts`), `renderApprovedImages`, `setPromptApproved` — all `protectedProcedure` + ownership.
- Feature flag e.g. `TWO_PHASE_PIPELINE=true` so default product stays single-shot.
- OCR prerequisite: if book is pending with no pages, Stage1 must run extract/OCR first (new sub-step) — feat never solved this cleanly for cap-blocked uploads.

### Slice 4 — Wire UI for page-mode only

- Stage1/Stage2 + approve on `BookPageReadingDashboard` when flag on and `generationMode === "page"`.
- getDetails/getProgress expose new fields (overnight already dual-reads scenes).
- Upload under cap can still single-shot; over cap → pending → user enters two-phase (or explicit processPdf single-shot — product choice D6).

### Slice 5 — Scene-mode parity

- Planner produces scenes with prompts; approve gate on scenes; renderApproved only approved scenes.
- Align status enums with scenes table.
- Gallery/DevMode already show scene title/sourcePage — extend badges.

### Slice 6 — Retire / constrain single-shot cost paths

- Optionally remove upload auto full-render entirely (cap becomes redundant) once two-phase is default.
- Rebuild retry worker as **render-only** against persisted prompts (audit P2) before re-enabling `RETRY_WORKER_ENABLED`.

---

## 4. Architecture decisions for Jerome (blockers before port code)

| ID | Question | Why it isn’t mechanical |
|----|----------|-------------------------|
| **D1** | Status split on **pages only** vs **pages + scenes**? | Overnight’s main differentiator is scene mode; half-porting the gate creates two product languages. |
| **D2** | Which bible schema is canonical, and does bible failure **block** render? | Feat simple vs overnight rich `StoryContext`; audit wants hard block + checksummed final prompts. |
| **D3** | Is two-phase the **default UX**, or an opt-in beside single-shot? | Affects upload, pricing, and whether auto-render cap remains primary cost control. |
| **D4** | Where does **OCR/extract** live in the phase model? | Feat assumed pages pre-filled; overnight can leave books pending with zero pages after cap block. |
| **D5** | Approve unit in scene mode? | No page row per image in scene mode. |
| **D6** | Cap-blocked upload → force Stage1, or allow under-cap single-shot forever? | Product + cost policy. |
| **D7** | Final prompt assembly: LLM free-text (today) vs **code-assembled** with verbatim bible segments + checksum (audit hard rule)? | Feat injects via system prompt still; audit’s harder invariant is not implemented on either branch. |

Until D1–D2 and D3 are answered, only **Slice 1** is unambiguously safe to implement.

---

## 5. Explicit non-goals for the first port attempt

- Do **not** `git merge` feat into overnight.
- Do **not** replace overnight `processBookPipeline` body with feat’s older single-shot (feat even had a repair commit because it was stubbed once).
- Do **not** copy feat `renderApprovedImages` image-call site without overnight’s keyPrefix/params/offline path.
- Do **not** delete `storyBibleBoundary` tests or weaken EmptyPageError.
- Do **not** enable retry worker as part of the port.

---

## 6. Suggested first PR title (when unblocked)

`feat(schema): additive storyBible + prompt/image status columns (no behavior)`

Then stop for review of Slice 2 bible-reuse behavior against D2.

---

## 7. File map (feat reference paths)

| Concern | Feat paths @ 37c262d |
|---------|----------------------|
| Schema | `drizzle/schema.ts`, `drizzle/0005_prompt_transcription_gate.sql` |
| Gate pipeline | `server/pipelineService.ts` (tail section), `server/promptService.ts` (StoryBible + transcribePage) |
| Router | `server/booksRouter.ts` (`generateStoryBible`, `transcribePages`, `renderApprovedImages`, `setPromptApproved`) |
| DB helper | `server/db.ts` (`getPage`) |
| UI | `client/src/components/BookPageReadingDashboard.tsx` |

Overnight counterparts to edit later: same paths plus `server/scenePlanner.ts`, `server/pipelineService.ts` scene branch, `drizzle/0005_scenes_cutover.sql` (leave as-is), new `0006_*.sql`.

---

## 8. Relation to July 17 audit recon

Recon claimed two-phase “exists on NO branch.” That is **false for the remote set** (`feat/prompt-transcription-gate` has it) and **true for the overnight line**. This plan is the reconciliation: port by re-implementation against overnight, using feat as reference, after D1–D7.
