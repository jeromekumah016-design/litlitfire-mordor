# Functional E2E Proof

Generated: 2026-07-21T20:49:51.886Z  
Branch: `overnight/2026-07-04`  
Mode: **OFFLINE_MODE=true** (SVG placeholders via the same `generateImage` → `storagePut` path as live DALL·E)

## Pipeline result

| Field | Value |
|-------|-------|
| bookId | 1 |
| title | Functional E2E 1784666991116 |
| book.processingStatus | completed |
| storyBible persisted | true |
| pages extracted | 3 |
| pages image_ready | 3 |
| renderApprovedImages | rendered=3 skipped=0 errors=0 |

## First photo (bar §0)

| Field | Value |
|-------|-------|
| pageNumber | 1 |
| promptStatus | approved |
| imageStatus | image_ready |
| generatedPrompt (persisted, used for render) | `[offline] Illustration of: Generate the image prompt for this page. Page number: 1 Page text: "Chapter One. In a quiet riverside town, young Mara watched the mo` |
| **generatedImageFileKey** | `books/1/pages/1/generated.svg` |
| generatedImageUrl | `/__offline_storage__/books/1/pages/1/generated.svg` |
| on-disk file | `C:\Users\Jerom\litlitfire-mordor\.offline-storage-e2e\books\1\pages\1\generated.svg` |
| proof artifact | `qc/proof-artifacts/page-1.svg` |
| file size (bytes) | 1161 |

## Gate checks verified in this run

1. Extract created OCR pages without images.
2. Transcribe persisted storyBible + prompt_ready prompts.
3. Only approved pages rendered.
4. Render used persisted generatedPrompt (no LLM re-call for image text).
5. Storage key is book-scoped and matches the file on disk.

## App viewability

Offline URL: `/__offline_storage__/books/1/pages/1/generated.svg`  
With `OFFLINE_STORAGE_DIR=C:/Users/Jerom/litlitfire-mordor/.offline-storage-e2e` and `pnpm dev`, the storage proxy serves `/__offline_storage__/*`.

## Live DALL·E note

OPENAI_API_KEY was not available in this environment. Offline path is the same call stack as paid generation; re-run with OFFLINE_MODE=false + real keys for a DALL·E PNG.
