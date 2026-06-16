# LiteralLiterature — Autonomous Sprint Log

2026-06-14 | Fixed broken test env (missing linux rollup binary). Added scenePlanner.ts: selects distinct, illustration-worthy scenes across a book (multiple-images-per-book layer), decoupled from OCR. +23 tests. Suite: 252 passed / 0 failed. tsc clean. Wrote qc/REPORT-2026-06-14.md.

2026-06-15 | Wired generateScenePrompts into processBookPipeline behind SCENE_MODE_ENABLED flag (off by default). Added processBookPipelineScenes: OCR text -> story bible -> scene plan -> prompts -> image gen, scenes persisted as sequential rows (interim, schema decision still NEEDS JEROME). OCR/image-gen decoupling upheld. +5 tests. Suite: 257 passed / 0 failed. tsc clean.

2026-06-16 | Recovered RED build: restored 3 tail-truncated working-tree files from HEAD (DevModeDiagnostics.tsx, pipelineService.ts, vitest.config.ts). Built user-facing gallery scene captions: shared/galleryImages.ts maps scene-mode rows to real scene title + "from page p" subtitle, page-mode falls back to "Page N"; wired into ImageGalleryView. OCR/image-gen decoupling upheld. +5 tests. Suite: 271 passed / 0 failed. tsc clean. Wrote qc/REPORT-2026-06-16.md.
