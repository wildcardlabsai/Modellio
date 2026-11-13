# MODELLIO Split Studio — architecture and plan

Workflow: **upload 3MF → analyse → split colours → explode → connectors → export**, for people who
print multi-colour designs as separate single-colour jobs.

## 1. What already exists (inspection summary)

| Area | Existing system | Reuse in Split Studio |
| --- | --- | --- |
| Build | Vite 8 (rolldown), React 19, TypeScript 5.9, Tailwind v4, ESLint/Prettier, Vitest, Playwright e2e suites, GitHub Actions CI | Same toolchain, new test files and an e2e suite |
| 3D engine | three.js r187 + React Three Fiber + drei. Z-up, 1 unit = 1 mm (`cad/coordinates.ts`) | Same engine and conventions; a second `<Canvas>` only while the studio is open (the editor's canvas is unmounted, not duplicated) |
| Geometry | `cad/kernel` — Manifold WASM (Booleans, guaranteed manifold output), `MeshData` (welded positions + indices), `meshDataToGeometry`, `analyzeMesh` watertightness validator, Boolean Web Worker | Splitting, validation, connectors (Phase 5, Booleans on real solids) |
| Import/export | STL/OBJ import, STL/OBJ/**3MF writer** (`cad/export/threemf.ts`, single colour per object), `.modellio` projects | 3MF writer extended for per-plate export (Phase 6); round-trip tests use the existing writer |
| State | Zustand stores (`editorStore`, `projectStore`), Immer snapshot history | Separate `splitStore`; the editor stores are untouched |
| Routing | No router. `projectStore.view` switches Design / Projects / Templates; share links use `#share=` | New **studio** dimension in the URL (`?studio=split`), so it doesn't collide with `#share=` and supports Back/Forward |
| UI kit | `IconButton`, `Modal`, `Segmented`, `Toggle`, `NumberField`, `Popover`, labels layer, design tokens | Reused as-is |
| **Keyring Studio** | **Does not exist in this repository.** The only related item is the "Name keychain" template | Nothing to preserve; studio switching is designed so further studios can be added |

## 2. Libraries (decisions)

* **`@3mfconsortium/lib3mf` (official 3MF Consortium library, WASM, BSD-2).** This is the authoritative parser for the core
  spec, the Materials & Properties extension (base materials, colour groups, texture groups, composites,
  multi-properties), the Production extension (multi-part packages), components, build items, transforms and units.
  Evaluated in this repository:
  * ✅ Correct values for vertices, triangles, per-triangle properties, object-level properties, colours and transforms.
  * ✅ Strict about invalid files (it rejected a test file with partial per-triangle properties and no object default — correct per spec).
  * ⚠️ The JS binding has gaps: `ReadFromBuffer` and the bulk vector getters are unbound, so the package goes through Emscripten MEMFS
    and data is read element by element. Measured cost: ~1.2 s per 200k triangles, so it runs in a **Web Worker**.
  * ⚠️ Triangle properties reference lib3mf *unique* resource IDs, which must be mapped back to model IDs.
  * ⚠️ 2.2 MB WASM. It is loaded only when the Split Studio imports a file.
* **fflate** (already a dependency): used only to open the OPC package to read vendor metadata parts.
* **saxes** (streaming XML parser): used for vendor metadata and for scanning per-triangle vendor attributes. `DOMParser` is not
  available in workers, and a streaming parser keeps memory flat on large model parts.
* **Manifold** (existing): Phase 3 validation and Phase 5 connector Booleans.

## 3. Real-world colour data (why vendor support is needed)

Most multi-colour 3MF files downloaded today (MakerWorld, Printables) come from Bambu Studio, OrcaSlicer or PrusaSlicer.
They often do **not** use the spec's material resources:

| Source | Where colour lives | Support |
| --- | --- | --- |
| 3MF Materials extension | `basematerials`, `m:colorgroup`, triangle `pid/p1..p3`, object `pid/pindex` | Phase 2, via lib3mf |
| Bambu / Orca multi-part objects | `Metadata/model_settings.config` (`extruder` per object / part) + `Metadata/project_settings.config` (`filament_colour`) | Phase 2 |
| PrusaSlicer volumes | `Metadata/Slic3r_PE_model.config` (triangle ranges per volume + `extruder`) + `extruder_colour` | Phase 2 |
| Painted colour (Bambu `paint_color`, Prusa `slic3rpe:mmu_segmentation`) | Per-triangle subdivision trees | Phase 2: whole-triangle paint decoded exactly. Sub-triangle paint is **detected, counted and reported**, with an approximate preview colour (area-weighted majority). Exact sub-triangle splitting is a Phase 3 task |
| Textures (`texture2dgroup`) | Image sampled by UV | Phase 2: detected and reported; preview uses a neutral colour. Splitting by texture is not supported |

Nothing is dropped silently: each case produces an entry in the import report.

## 4. Module structure

```
src/app/studio.ts          studio routing (?studio=split), Back/Forward support
src/split/
  model/      types.ts (ThreeMFDocument, ThreeMFObject, ThreeMFMaterial, ThreeMFMesh, ColourComponent),
              materialResolver.ts, flatten.ts (instances), components.ts (colour components), mat4.ts — pure, tested
  import/     opc.ts (ZIP, content types, relationships), lib3mf.ts (WASM loader), parse3mf.ts (lib3mf → raw model),
              scan.ts (data the lib3mf JS binding can't return + vendor paint), vendor.ts (Bambu/Orca/Prusa metadata),
              paint.ts (paint-tree decoder), importer.ts (pipeline + progress), xml.ts (streaming XML)
  worker/     import.worker.ts, client.ts (progress, cancellation, transferables), protocol.ts
  fixtures/   build3mf.ts — deterministic synthetic 3MF packages (tests, e2e, and the built-in sample)
  store.ts    splitStore (Zustand)
  ui/         SplitStudio.tsx (shell, stepper, drop zone, progress), LeftPanel, RightPanel, SplitViewport, previewGeometry
```

The geometry and import layers have no React dependencies. The whole import runs in the worker.

### Material resolution order

Per triangle, highest first: slicer paint (non-zero state) → slicer part/volume type (modifier, negative and support volumes are
"not printed") → slicer part/volume extruder, then object extruder → 3MF triangle property → 3MF object-level property → unassigned.
A slicer project prints with its own assignments, so they win over 3MF properties; when both exist, the report says so.
Distinct base materials stay distinct even with equal colours; colour-group colours are keyed by value.

### lib3mf binding gaps (2.5.0) and how they are handled

| Gap | Handling |
| --- | --- |
| `ReadFromBuffer` unbound | Package written to Emscripten MEMFS, read with `ReadFromFile`, then unlinked |
| Vector getters (`GetVertices`, `GetAllPropertyIDs`, composite constituents, multi-property indices) unbound | Per-element getters; property IDs of groups read from a file are 1..count (verified by tests); composite and multi-property constituents come from `scan.ts` |
| Unknown vendor attributes (`paint_color`, `slic3rpe:mmu_segmentation`) are ignored by lib3mf | Read by `scan.ts` and matched to triangles by index within each object |

## 5. Coordinates and units

3MF is right-handed and Z-up, like MODELLIO, so no axis conversion is needed. The model `unit` (micron, mm, cm, inch,
foot, metre) is converted to **millimetres** once, at import. Each mesh is stored once in object space.
Each **instance** (build item → component path) keeps its own composed transform, so two instances of the same object stay
distinct and the source data is never altered.

## 6. Technical risks

1. **Sub-triangle paint** needs Bambu/Prusa's subdivision rules reproduced exactly (Phase 3). It is reported, never hidden.
2. **lib3mf binding gaps** (per-element reads). Mitigated by the worker, progress reporting and cancellation. Reads stay correct, but very large files (> 2M triangles) are slow.
3. **Open boundaries.** Splitting one mesh by colour yields open shells. They will be reported, and the user chooses whether to repair them (Phases 3 and 5).
4. **Slicer compatibility** of multi-plate 3MF. Per-plate single files are the baseline; multi-plate export needs manual testing in Bambu Studio.
5. **Connector placement** on thin or curved surfaces (Phase 5).

## 7. Test strategy

* Deterministic synthetic fixtures built in tests (no binary files committed) for each case: three objects with base materials,
  per-triangle colour groups, nested components with transforms, multiple instances, inch units, textures (reported),
  production-extension parts, Bambu parts with extruders and filament colours, Bambu/Prusa paint, Prusa volumes,
  and malformed packages.
* Round trip: the existing 3MF writer → importer, comparing geometry and colours.
* e2e: open the Split Studio, upload fixtures through the real UI (picker and drag-and-drop), check the colour legend, warnings, preview,
  cancellation and return to Design; the editor suites stay green.

## 8. Phases

1. **Integration** ✅ — studio routing (`?studio=split`, Back/Forward), top-bar switcher, Split Studio shell with a guided stepper
   (later steps locked), its own viewport; editor shortcuts and the first-run tour are inactive while in the studio.
2. **Import** ✅ — package reader, lib3mf parser in a worker (progress, cancellation), units → mm, components and instances,
   vendor metadata, paint decoding, material resolver, colour legend (select / hide / isolate), region dimensions, preview,
   import report. Known limits (all reported in the import report):
   * fine (sub-triangle) paint shows each triangle's majority colour; exact splitting is Phase 3;
   * textures show neutral grey; composite materials show the blended colour; multi-properties use the last colour layer;
   * the Split Studio has no undo/redo, save or export yet: nothing in Phases 1–2 changes the model, and those controls arrive
     with the phases that need them.
3. Split strategies, geometry separation, boundary and validation report.
4. Explode controller, plates.
5. Round peg / blind socket connectors (Manifold Booleans), tolerances, the Pokémon-eye acceptance scenario.
6. Export (per-plate and per-component 3MF and STL), validation, round trip.
7. Performance, persistence, polish, documentation.

## 9. Tests

* `src/split/import/import.test.ts` — 21 tests: paint decoding; base materials; colour groups; gradients; nested components and
  transforms; multiple instances; inch units; textures, composites and multi-properties; production-extension parts; round trip
  with MODELLIO's 3MF writer; the sample; Bambu parts, extruders, filament colours, paint and modifiers; Prusa volumes and MMU
  painting; malformed packages.
* `scripts/e2e-split.mjs` — 41 browser checks: routing, shell, sample import, preview pixels, selection and dimensions,
  visibility, viewport picking, Bambu project via the file picker, error handling, progress and cancellation, a 200k-triangle
  file without blocking the page, drag-and-drop, studio switching with Back/Forward, editor isolation, accessibility, tablet layout.
