# MODELLIO 2.0 — Codebase audit and plan

Audited at `main` 48ef16b. Development continues on the `modellio-2-development` branch.
Detailed engine notes live in [ARCHITECTURE.md](ARCHITECTURE.md); Split Studio in [SPLIT_STUDIO.md](SPLIT_STUDIO.md).

## Stack

| Area | Today |
| --- | --- |
| Framework | Vite 8, React 19, TypeScript (strict), Tailwind v4 (`@theme` tokens in `src/styles/index.css`) |
| Routing | One page; the workspace is the `?studio=` query (`src/app/studio.ts`), Back/Forward aware; `#share=` links open the Design Studio |
| State | Zustand stores; the Design Studio document is Immer-managed JSON with snapshot undo/redo and transactions (`src/store/editorStore.ts`) |
| Rendering | three.js via React Three Fiber + drei, demand frame loop |
| Geometry | Manifold (WASM) for every solid operation: Booleans, extrusion, offsets, hulls, splits (`src/cad/kernel`); opentype.js for text outlines |
| Workers | Vase builds, Split Studio import and splitting run in Web Workers |
| Import / export | STL, OBJ, 3MF (fast streaming reader, checked against lib3mf in tests), SVG and pictures (traced); export STL, OBJ, 3MF (objects, colours) |
| Persistence | IndexedDB projects + version history (`repository.ts`), `.modellio` project files, share links, optional Supabase cloud with magic-link sign-in (only when `VITE_SUPABASE_*` is set); asset library in IndexedDB |
| Backend | None: a static Vercel deployment |
| Tests | Vitest (unit, geometry checked for watertightness and exact volumes) and Playwright workflow suites in `scripts/e2e-*.mjs` |

## Layers

Rendering (`src/viewport`) · document and commands (`src/store`, `src/cad/document.ts`, `hierarchy.ts`) · geometry (`src/cad/kernel`, `geometry`, `operations`, `text`) · persistence (`src/cad/serialization`) · import/export (`src/cad/import`, `src/cad/export`, `src/assets`) · makers (`src/makers/*`, `src/split`). These are already separate; the 2.0 work keeps them so.

## Makers

| Maker | Geometry | Editable | Saved | Export | To Design Studio |
| --- | --- | --- | --- | --- | --- |
| Keyring & Name Tag | Manifold 2D → extrude, raised / engraved / flush / holes, back side | 2D canvas, roles, 28 templates | localStorage only | 3MF (colours), STL | Yes, real meshes |
| Cookie Cutter & Stamp | Manifold offsets, cutter / stamp / handle | 2D canvas, 25 templates | localStorage only | 3MF, STL | Yes |
| Vase & Planter | Profile × cross-section in a worker | Profile curve, patterns, 32 templates | localStorage only | 3MF, STL (fine mesh) | Yes |
| Split Studio | Splits 3MF colours into closed parts, pegs | Per-step settings | Session only | Per-plate 3MF, STL per part | — |
| Key Tag Maker | **missing** | | | | |
| Sign Maker | **missing** | | | | |

The keyring and cookie makers share `src/makers/canvas` (model, store, canvas, panels, preview).

## Findings

**Works:** real Booleans (union / subtract / intersect, live and non-destructive), text, primitives with exact dimensions, grouping, align / distribute / mirror, snapping (grid, object edges and centres, faces), lay flat, print check (overhang, thin walls), imports and exports, versions, share links, makers with real geometry.

**Needs improving:** a dated, light visual identity that doesn't match the brief; no dashboard (the landing page goes straight into a workspace); maker work isn't a project (lost when the browser storage is cleared, not listed anywhere); no orthographic view; history is invisible beyond undo/redo; no GLB/GLTF; no mesh clean-up tools; text has no spacing or multi-line controls; no sketching or parametric profiles; no AI.

**Reuse:** the kernel, document model, maker canvas and keyring geometry (the Key Tag and Sign makers build on it), the project repository, the asset library, the Playwright harness.

**Refactor:** project metadata gains a workspace and the maker's own settings (versioned, migrated); maker headers move into one shared shell.

**New technology:** none required for the platform. Manifold stays the single solid kernel (OpenCascade would add ~30 MB and B-rep complexity for features not needed yet; STEP import is noted for the future). The AI assistant needs one server function on Vercel and an `ANTHROPIC_API_KEY` set in the project settings.

## Plan

1. Design tokens and shared UI in the navy / violet / electric-blue identity; new landing page; dashboard at `?studio=dashboard` with real projects.
2. Projects that remember which maker made them (and its settings); a shared maker shell; new Key Tag and Sign makers.
3. Design Studio: orthographic / isometric views, a history timeline, GLB/GLTF, gear and box generators, mesh tools, text spacing, sketch-based profiles.
4. AI Design Assistant: validated, structured modelling plans applied as one undo step.
5. Performance, responsive layouts, documentation.

## Status

| Stage | State | Tests |
| --- | --- | --- |
| 1 Audit | Done (this document) | — |
| 2 Design system, landing, dashboard | Done | `e2e-landing`, `e2e-platform` |
| 3 Projects, maker shell, Key Tag and Sign makers | Done | `platform.test.ts`, `sign.test.ts`, maker e2e suites |
| 4–6 Studio views, history, GLB, gear, box & lid, mesh tools, text spacing, sketch & profiles | Done | `e2e-studio2`, sketch / mesh-tool / gear unit tests |
| 7 AI Design Assistant | Done; needs `ANTHROPIC_API_KEY` on the server to answer | `src/ai/*.test.ts`, `e2e-assistant` (API intercepted; no live model call in CI) |
| 8 Responsive makers, docs | Done | `e2e-mobile` |

**Decisions:** Manifold remains the only solid kernel; the sketch solver is a small Levenberg–Marquardt solver
(`src/cad/sketch/solver.ts`) rather than a dependency; the assistant uses structured outputs with a strict command
schema plus a second validation pass, never generated code; one new runtime dependency (`@anthropic-ai/sdk`, server only).

**Remaining:** sketch offset / trim / extend / splines; a feature tree (sweep, loft, fillet with history); assemblies
with joints; STEP; lithophane and thread tools; sign-in-gated access for the assistant; a live-model evaluation set for
assistant prompts.
