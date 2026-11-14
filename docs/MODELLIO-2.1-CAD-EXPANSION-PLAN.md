# MODELLIO 2.1 — Advanced CAD expansion plan

Branch: `modellio-2.1-advanced-cad` (from `main` @ 7a79f98). Scope: Fillet, Chamfer, Loft, Sweep and STEP
import/export as genuine geometry in the Design Studio. This document is the technical assessment that precedes
implementation. It was written after reading the code, `docs/ARCHITECTURE.md` and `docs/MODELLIO-2-AUDIT.md`, and
after a throwaway spike (outside the repository) that ran the candidate kernel in Node.

## Summary

* The current kernel (Manifold) **cannot** do per-edge fillets or chamfers, lofts, sweeps or STEP. It is a mesh
  kernel with no notion of edges or faces.
* **Recommended:** keep Manifold for everything it does today, and add **OpenCascade (OCCT)** through the
  **replicad** library as an on-demand *precise-solid* kernel, loaded in a Web Worker the first time someone uses
  one of the new features. Its results are tessellated into the same mesh format the rest of the app uses.
* The spike confirmed that this works: a 3 mm fillet on one chosen box edge gives the analytic volume exactly,
  chamfer, loft and sweep produce valid solids in tens of milliseconds, and a STEP export re-imports with identical
  volume.
* Cost: a 7.2 MB (gzip) WASM download on first use, LGPL licence obligations (manageable), higher memory use, and
  the well-known edge-naming problem for feature history (handled explicitly, never silently).

## 1. What the current geometry engine can do

| Area | Today | Where |
| --- | --- | --- |
| Kernel | Manifold 3.5.4 (WASM, 0.5 MB). Watertight triangle meshes; exact, robust Booleans. | `src/cad/kernel/kernel.ts`, `booleanCore.ts`, `boolean.worker.ts` |
| Geometry storage | The document stores **recipes**, not meshes: primitive type + params + size (+ text, sketch). Meshes are rebuilt on demand and cached. Imported meshes live in an immutable asset store. | `src/types/document.ts`, `src/cad/shapeRegistry.ts` (`buildGeometryForShape`), `src/cad/assets.ts` |
| Three.js | Display only: `MeshData` → `BufferGeometry` in `ShapeMesh`; edges drawn with `FastEdges`. | `src/viewport/ShapeMesh.tsx`, `src/viewport/FastLine.tsx` |
| Booleans | Live, non-destructive: a group with `combine: 'union'|'intersect'` and hole children is recomputed in a worker. "Flatten to mesh" bakes it. | `src/cad/operations/combine.ts` |
| Sketches | 2D sketches on the XY plane with a Levenberg–Marquardt constraint solver; closed loops become a `profile` shape extruded or revolved by Manifold. No sketch plane/orientation yet. | `src/cad/sketch/*`, `src/components/sketch/SketchEditor.tsx` |
| Feature history | None as such. History = the object's parameters + group combine modes, with Immer undo/redo snapshots and transactions. Editing a parameter rebuilds the mesh from the recipe. | `src/store/editorStore.ts`, `src/store/history.ts` |
| Import / export | STL, OBJ, 3MF, GLB/glTF import; STL, OBJ, 3MF, GLB export. All mesh-based. | `src/cad/import/*`, `src/cad/export/*` |
| Project files | JSON document + mesh assets; `PROJECT_FILE_VERSION = 2`; IndexedDB locally, Supabase optionally. | `src/cad/serialization/*` |

What Manifold *can* contribute to the new features:

* **Fillet / chamfer:** nothing genuine. `minkowskiSum` with a sphere rounds *every* convex edge and grows the
  part; `smoothOut`/`smoothByNormals` smooth all sharp edges by subdivision and do not give a radius. Neither can
  target a chosen edge, so using them would be the "visual bevel" the brief rules out.
* **Loft:** only special cases (`extrude` with `scaleTop`, i.e. a scaled copy of the same profile). Different
  profiles (circle → square) need a real surface-skinning algorithm.
* **Sweep:** a hand-built mesh sweep (Frenet frames) is possible for gentle paths but self-intersects on tight
  bends and has no exact geometry for STEP.
* **STEP:** none.

## 2. What needs an additional kernel

All five features need a boundary-representation (B-rep) kernel: something that knows edges, faces and exact
surfaces. Options evaluated (licences and sizes taken from the npm registry; WASM sizes measured):

| Package | Licence | WASM size | Status | Verdict |
| --- | --- | --- | --- | --- |
| **`replicad`** 1.2.1 | MIT | — (JS API) | Active, last release Nov 2026 | **Use.** Typed API over OCCT: fillet/chamfer with edge finders, loft, sweep, STEP import/export, meshing. |
| **`replicad-opencascadejs`** 1.2.1 | LGPL-2.1 (OCCT, with the OCCT exception) | 22.9 MB, **7.2 MB gzip** (single-threaded build) | Active, released with replicad | **Use.** Trimmed OCCT build. Verified to contain `BRepFilletAPI_MakeFillet`, `BRepFilletAPI_MakeChamfer`, `BRepOffsetAPI_ThruSections` (loft), `BRepOffsetAPI_MakePipeShell` (sweep), `STEPControl_Reader`/`Writer`, `STEPCAFControl_Writer`, `XCAFDoc_ShapeTool`, `BRepMesh_IncrementalMesh`. **Missing `STEPCAFControl_Reader`**, so STEP component names and colours cannot be read on import with this build. |
| `opencascade.js` 1.1.1 | LGPL-2.1 | 66 MB package | No release since 2023 | Reject: unmaintained, much larger. |
| `occt-import-js` 0.0.23 | LGPL-2.1 | 7.6 MB | Maintained | Import-only, returns meshes with names/colours. Possible later add-on for assembly names; not needed now. |
| A custom OCCT build | LGPL-2.1 | ~15–30 MB | Our maintenance | Not now; only if we later need `STEPCAFControl_Reader` or a smaller binary. |

### Spike results (Node 22, replicad + single-threaded OCCT)

| Test | Result |
| --- | --- |
| Kernel start-up | 277 ms |
| Fillet **one chosen edge** of a 20 × 20 × 10 mm box, r = 3 mm | 86 ms; volume 3961.372 mm³ = analytic 4000 − (9 − 9π/4)·20 exactly; 12 → 15 edges |
| Chamfer the 4 vertical edges, d = 2 mm | 29 ms; volume 3920.000 mm³ = analytic |
| Impossible fillet (r = 30 on a 10 mm box) | Throws a `WebAssembly.Exception` → must be caught and turned into a message |
| Loft: circle ⌀20 at z = 0 → rounded square 10 at z = 30 | 41 ms; valid `Solid`, bbox 20 × 20 × 30 |
| Sweep: circle ⌀4 along an open line + arc path | 22 ms; valid solid |
| STEP export (two named solids) | 85 ms; 50 KB valid ISO-10303-21 |
| STEP re-import | 128 ms; 2 solids; total volume identical to the originals |
| Memory | Process RSS ≈ 340 MB |

Lesson from the spike: replicad frees its input shapes after most operations, so the implementation must clone
explicitly and release shapes deterministically (`delete()`), or the WASM heap leaks.

## 3. Recommended technical architecture

```
            Design Studio (React)                         Workers
 ┌──────────────────────────────────────┐   ┌──────────────────────────────┐
 │ Inspector / Features menu / dialogs  │   │ boolean.worker  (Manifold)   │  unchanged
 │ editorStore: doc (recipes), history  │──►│ brep.worker     (OCCT, lazy) │  new
 │ viewport: meshes + pickable edges    │◄──│  recipe → B-rep → mesh+edges │
 └──────────────────────────────────────┘   └──────────────────────────────┘
```

1. **Two kernels, clear roles.** Manifold remains the main kernel (primitives, live Booleans, print checks, mesh
   tools, every maker). OCCT is used only for objects that need exact solids. Its output is tessellated to
   `MeshData`, so rendering, Booleans with other objects, 3MF/STL export and the print check work unchanged.
2. **`src/cad/brep/`** — `brep.worker.ts` (loads OCCT on first request), `client.ts` (request queue, cancellation,
   friendly error mapping, restart after a crash or out-of-memory), `recipes.ts` (pure types and validation, usable
   in tests and on the main thread), `build.ts` (recipe → OCCT shape → mesh + edge list), `references.ts` (edge
   references). The single-threaded WASM is used, so no cross-origin-isolation headers are needed.
3. **A new shape kind, `solid`,** whose geometry comes from a **feature recipe** stored in the document:

   ```ts
   interface FeatureRecipe { base: Base; ops: Op[] }        // ordered, editable history
   type Base =
     | { kind: 'primitive'; shape: 'box'|'cylinder'|'cone'|'sphere'|'torus'|'wedge'; size: Vec3; params }
     | { kind: 'sketch'; sketch: Sketch; plane: SketchPlane; op: 'extrude'|'revolve'; depth; angle }
     | { kind: 'loft'; sections: { sketch: Sketch; plane: SketchPlane }[]; ruled: boolean }
     | { kind: 'sweep'; profile: Sketch; path: Sketch; pathPlane: SketchPlane;
         orientation: 'follow'|'fixed'; transition: 'round'|'transformed'; twist: number }
     | { kind: 'step'; assetId: string; solidIndex: number };
   type Op =
     | { id; kind: 'fillet';  edges: EdgeRef[]; radius: number;   suppressed?: boolean }
     | { id; kind: 'chamfer'; edges: EdgeRef[]; distance: number; suppressed?: boolean };
   ```

   The worker rebuilds the solid from the recipe and caches it by hash, as `getProfileMesh` does today. Because the
   document holds only the recipe, undo/redo, versions, autosave and share links keep working.
4. **Edge selection and references.** The worker returns every edge as a polyline with an index. In "pick edges"
   mode the viewport draws them (existing `FastLine`) and highlights the one nearest the cursor; selected edges are
   drawn thick and coloured. A stored `EdgeRef` is a geometric signature in object-local millimetres: curve type,
   midpoint, direction or radius, and the normals of the two adjacent faces. After an upstream change the
   reference is re-resolved by best match. If nothing matches within tolerance, the operation is marked
   **Needs attention** and skipped, never silently applied to a different edge. This is the standard
   "topological naming" problem; the design handles it honestly rather than hiding it.
5. **Which objects can be filleted.** Box, cylinder, cone, sphere, torus, wedge and sketched profiles convert
   *exactly* to a `solid` (offered as "Make editable solid", and automatically when Fillet or Chamfer is chosen).
   Imported meshes, text and mesh-only primitives (star, gear, …) stay meshes; Fillet and Chamfer are disabled on
   them with an explanation.
6. **Loft and sweep reuse the sketch system.** Sketches gain an optional `plane` (origin, normal, x-axis; default
   XY), editable in the sketch editor. Loft takes 2+ ordered profiles (same number of loops; start points aligned)
   with a smooth or ruled option. Sweep takes one closed profile and one open or closed path sketch, with
   path-following (Frenet) or fixed orientation, round or transformed corners, and an optional twist. Editing a
   profile or path sketch rebuilds the solid.
7. **STEP.**
   *Import:* OCCT reads the solids; each becomes a `solid` object whose base is `{ kind: 'step' }`. The original
   file is stored as a project asset. Imported solids are exact B-rep, so they can be moved, scaled, filleted and
   chamfered and re-exported precisely, but they have **no parametric history**, and the UI says so. Component
   names and colours are not available with this OCCT build (see §2); parts are numbered instead.
   *Export:* `solid` objects and the standard primitives are written as exact B-rep. Meshes and live Boolean
   results are written as faceted B-rep (sewn triangles), and the export dialog states which objects are exact and
   which are faceted. Units are millimetres.
8. **User experience.** One **Features** menu in the toolbar (Fillet, Chamfer, Loft, Sweep), plus STEP in the
   existing Import and Export dialogs. Every operation opens a compact dialog with numeric inputs (with stepper
   arrows), a live preview (ghost mesh from the worker, debounced), Apply and Cancel, plain-language tooltips and
   specific errors (for example "Radius too large for this edge — try under 4 mm"). The first use shows
   "Loading the precise-solid engine (7 MB)…" with progress. The Inspector lists a solid's operations in order,
   each with edit, suppress and delete.

## 4. Implementation order

| # | Step | Why this order |
| --- | --- | --- |
| 1 | OCCT foundation: worker, lazy loading, recipe → mesh, `solid` kind, exact conversion of primitives and sketch profiles, schema v3 | Everything else depends on it |
| 2 | Fillet and chamfer: edge display and picking, `EdgeRef` resolution, dialogs, preview, ops in history | Highest user value and highest risk; validates the architecture early |
| 3 | STEP export, then STEP import | Reuses the foundation; export is immediately useful for exact solids |
| 4 | Loft, with sketch planes | Needs the sketch-plane extension |
| 5 | Sweep (profile + path, orientation, twist) | Builds on sketch planes and loft experience |
| 6 | UX polish, licences page, documentation, full regression | Release readiness |

Each step ends with unit and end-to-end tests and the full existing regression, committed on this branch.

## 5. Dependencies and licensing

| Dependency | Licence | Obligation |
| --- | --- | --- |
| `replicad` | MIT | Keep the copyright notice. |
| `replicad-opencascadejs` (Open CASCADE Technology) | LGPL-2.1 with the Open CASCADE exception | Ship the WASM **unmodified as a separate file** loaded at run time (not merged into our JavaScript), so users can replace it; include the licence text and a link to the corresponding source; credit OCCT on a licences page. This is compatible with MODELLIO's closed or open licensing. |
| `occt-import-js` (optional, later) | LGPL-2.1 | Same as above. |

No GPL code. Manifold (Apache-2.0) is unchanged.

## 6. Performance and browser-compatibility risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Download size: 22.9 MB WASM, 7.2 MB gzip | First use of an advanced feature takes a few seconds on average connections | Lazy-load on first use only; long-lived immutable caching; progress indicator; the main bundle is unaffected |
| Memory: 150–400 MB WASM heap on larger models | Mobile Safari may terminate the tab | Release shapes deterministically; cap tessellation density; restart the worker on out-of-memory with a clear message; warn on very large STEP files |
| OCCT failures (tangent edges, radius larger than adjacent faces, self-intersecting sweeps) | Operation fails | Caught in the worker; specific message; the document is unchanged; preview shows the failure before Apply |
| Tessellation quality vs triangle count | Faceted curves or slow display | Tolerance tied to object size; finer mesh for export than for preview |
| Edge references after edits | A fillet could target the wrong edge | Signature matching with tolerance; "Needs attention" instead of guessing |
| Cross-origin isolation | Multi-threaded OCCT needs COOP/COEP headers that break third-party embeds | Use the single-threaded build |
| Old browsers | WASM exceptions need a recent engine (Chrome 95+, Safari 15.2+, Firefox 100+) | Feature-detect; disable the features with an explanation |

## 7. Estimated complexity

| Feature | Complexity | Main difficulty |
| --- | --- | --- |
| OCCT foundation and `solid` kind | Large | Worker protocol, memory management, caching, schema |
| Fillet | Large | Edge picking and persistent references; failure handling |
| Chamfer | Medium (after fillet) | Shares the fillet machinery; equal-distance first, two-distance later |
| STEP export | Medium | Exact vs faceted bodies; names and colours via XCAF writer |
| STEP import | Medium | Multi-solid files, storage of the source file, large files |
| Loft | Medium | Sketch planes; compatible profiles and start-point alignment |
| Sweep | Medium–large | Path sketches, orientation modes, twist, failure cases |
| UX, docs, licences | Small–medium | Keeping the interface uncluttered |

## 8. Testing requirements

* **Unit tests (Vitest, real OCCT running in Node, as in the spike):**
  fillet and chamfer volumes against analytic values; invalid radius and distance produce errors, not crashes;
  loft and sweep produce closed solids with expected bounding boxes and volumes for simple cases; STEP export →
  import preserves volume and bounding box per solid; `EdgeRef` re-resolution after resizing the base, and
  "needs attention" when an edge disappears; recipe validation; project schema v2 → v3 migration and round trip;
  memory: 100 repeated operations without heap growth.
* **End-to-end tests (Playwright, new `scripts/e2e-advanced-cad.mjs`):** make a box an editable solid → pick an
  edge → preview → apply → undo → redo; chamfer; loft two sketches; sweep a profile along a path; STEP export
  download and re-import; error states; lazy-load indicator; save, reload and reopen a project with features;
  accessibility of the new dialogs.
* **Regression:** all 15 existing e2e suites and the unit suite must stay green; makers untouched.

## 9. Project schema changes

* `PROJECT_FILE_VERSION` 2 → **3**. Additive only:
  * `ShapeObject.feature?: FeatureRecipe` for the new `solid` shape kind;
  * `Sketch.plane?: SketchPlane` (absent means the XY plane, as today);
  * binary assets for imported STEP files (stored like mesh assets; in the cloud repository as storage objects).
* Version 1 and 2 files load unchanged. A version 3 file opened by an older build is refused with the existing
  "made with a newer version" message rather than being misread.
* Saved maker projects and existing Design Studio projects are unaffected.

## Recommendation

Adopt **replicad + OpenCascade as a lazy-loaded precise-solid kernel alongside Manifold**, implement in the order
of §4, starting with the foundation and fillet/chamfer.

## Implementation status

| Step | State | Commit | Tests |
| --- | --- | --- | --- |
| 1 Foundation: lazy OpenCascade worker, `solid` shape, exact conversion, schema v3 | Done | d304b7a | `src/cad/brep/build.test.ts`, `e2e-advanced-cad` 1–12 |
| 2 Fillet & chamfer: edge picking, preview, operations list, edge re-finding | Done | a94c26c | `build.test.ts`, `featureTool.test.ts`, e2e 13–31 |
| 3 STEP export (exact + faceted) and import (exact, filletable) | Done | 735ce34 | `step.test.ts`, e2e 32–41, phase 4 9b/9c |
| 4–5 Loft and sweep | Done | 04e2c27 | `loftSweep.test.ts`, e2e 42–58 |
| 6 Licences page, docs, landing tools, regression | Done | (this commit) | full regression: 16 suites |

### Differences from the plan

* **Sketch planes** were simplified. Loft sections lie flat at a height with an X/Y shift, and sweep paths are drawn
  upright (XZ) or flat (XY). The profile is placed square to the start of the path automatically. That covers vases,
  handles, rails and transitions without a 3D plane editor; free sketch planes remain future work.
* **Sweep twist** was not added. replicad exposes OpenCascade laws for scaling but no simple twist; *Frenet*
  orientation is offered for spiralling paths. Guide curves for lofts are future work too.
* **Imported STEP solids** are stored as exact BRep text inside the project (a `brep` recipe base) instead of as separate
  file assets. They stay exact and filletable with no new storage plumbing; very large parts make large projects and
  share links.
* **Tangent propagation:** a fillet or chamfer follows edges that continue smoothly from the chosen ones (OpenCascade's
  standard behaviour); the panel says so.

### Known limitations

* An operation whose edge can no longer be matched after an edit is skipped and flagged; it is never re-targeted.
* Sketch-based, loft, sweep and imported solids scale to the object's size like other shapes, so a fillet radius on them
  is in the solid's own millimetres. STEP export refuses uneven stretching of these rather than distort them.
  Primitives rebuild at their exact size, so their radii stay exact.
* Editing a loft or sweep rebuilds it at its natural size.
* STEP import reads geometry only (no component names or colours: `STEPCAFControl_Reader` is not in this OpenCascade
  build). Meshes, text and Boolean combinations are exported as faceted solids, up to 150,000 triangles.
* First use downloads the 7 MB engine; heavy models can use several hundred MB of memory in the worker. If the worker
  stops, the operation reports it and a fresh worker starts on the next request.
