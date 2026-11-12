# MODELLIO — Architecture

MODELLIO is a browser-based CAD modeller. The guiding rule is that **the CAD
document is the single source of truth**. Rendering, UI and file I/O are views
or adapters over it, and geometry is always generated from it.

```
 ┌───────────── UI (React + Tailwind) ─────────────┐
 │ TopBar · Toolbar · ShapeLibrary · Inspector ... │
 └───────────────┬──────────────────────┬──────────┘
                 │ commands             │ selectors
          ┌──────▼──────────────────────▼──────┐
          │ store/editorStore (Zustand + Immer) │  doc · history · selection · transaction
          └──────┬──────────────────────┬──────┘
                 │ pure document ops    │ document (plain JSON)
          ┌──────▼──────┐        ┌──────▼──────────────────────┐
          │ cad/        │        │ viewport/ (R3F)             │
          │  document   │◄───────┤  ShapeMesh → buildShapeGeometry
          │  geometry/  │        │  TransformGizmo → doc edits │
          │  transforms/│        │  CameraController, ViewCube │
          └─────────────┘        └─────────────────────────────┘
```

## Source layout

| Path | Responsibility |
| --- | --- |
| `src/types/document.ts` | The document model (plain, serializable JSON). |
| `src/cad/geometry/` | Pure geometry: primitive builders, mesh helpers, the watertightness validator. No React. |
| `src/cad/shapeRegistry.ts` | Shape library definitions: default size, parameters, inspector schema. **The extension point for new primitives.** |
| `src/cad/transforms/` | Matrix ↔ document transform conversion, world bounds, workplane drop. |
| `src/cad/document.ts` | Pure document operations (add, remove, duplicate, naming, free-spot placement). |
| `src/store/` | Zustand editor store and the snapshot history. |
| `src/viewport/` | Everything Three.js / R3F: meshes, gizmo, camera, view cube, workplane, overlays. |
| `src/components/` | DOM UI: layout, toolbar, shape library, inspector, scene list, UI primitives. |
| `src/hooks/` | Keyboard shortcuts. |
| `src/utils/` | Math, ids, the safe arithmetic evaluator for numeric fields. |
| Reserved: `src/cad/operations`, `export`, `import`, `serialization`, `selection` | Phases 2–4 (Booleans, STL/OBJ, persistence). |

## Coordinate system and units

* **Z-up, right-handed, 1 world unit = 1 mm.** CAD and slicer software use this convention.
  `src/cad/coordinates.ts` sets `THREE.Object3D.DEFAULT_UP = (0,0,1)` before
  anything else is created, so the cameras, OrbitControls and TransformControls all work natively in Z-up.
  No conversion layer is needed and there are no hidden rotations.
* The workplane is the XY plane at Z = 0 (default 200 × 200 mm).
* `transform.position` is the **centre of the object's local bounding box**.
  New shapes are placed with their bottom on the plate (`z = height / 2`).
  "Drop to workplane" (D) computes the exact Z from the rotated bounds.
* Rotations are Euler XYZ in **degrees**, normalised to (-180, 180].

## Dimensions: `size` is authoritative

Every shape stores `size: [x, y, z]` in mm, the extent of its local bounding box.
Geometry is **regenerated** from `size` and `params`. Objects never carry a residual
scale factor. Each primitive builder ends with `fitToSize()`, which guarantees
that the mesh's bounding box is exactly `size`. This is covered by tests for
every primitive at several sizes.

So the numbers in the inspector, the dimension labels in the viewport and the
exported geometry can never disagree. When the resize gizmo is dragged, the drag
scale is converted into a new `size` on every frame; the local bottom face stays
anchored so objects don't sink through the plate.

Absolute parameters (e.g. tube wall thickness in mm) stay absolute when an object is resized.

## Geometry engine

* Primitives: box, cylinder, sphere, cone (with optional truncation), pyramid,
  roof, torus, tube, wedge, half sphere, and N-sided polygon prism.
* Every primitive is a **closed, consistently oriented (watertight) mesh with
  positive volume and unit normals**. `analyzeMesh()` checks this by welding
  vertices by position, then checking every edge is shared by exactly two
  triangles with opposite winding. It runs for all primitives in the
  test suite. Analytic volumes are verified (box, cylinder, pyramid, wedge, tube).
* Flat-faced solids are built with `polyhedron()` (explicit faces, flat normals).
  Curved solids reuse Three.js generators, rotated into Z-up.

### Boolean library evaluation (for Phase 3)

| Library | Verdict |
| --- | --- |
| **manifold-3d** (WASM) | **Chosen for Booleans.** It guarantees manifold (watertight) output, is robust on coplanar faces and is fast, which is what 3D-printable output needs. It is already published as an npm package with TypeScript types. |
| three-bvh-csg | Fast and convenient for previews, but it gives no guarantee of manifold output. It may be used for live hover previews only. |
| three-csg-ts / BSP CSG | Slow, with poor robustness on coplanar faces. Rejected. |
| @jscad/modeling | A good solid-modelling kernel (also used for text extrusion and hull). Its Booleans are slower and its data model differs. Candidate for text/2D tooling, not core Booleans. |

Primitive meshes are already watertight, so they can be passed straight to Manifold after welding vertices.

## State, history and transactions

* Documents are immutable (Immer, auto-frozen) and **structurally shared**.
* **Undo/redo stores snapshots.** Because of structural sharing, a history
  step only costs the objects that changed (a test checks this). Large binary
  data (imported meshes, Boolean results) will live in a separate immutable
  asset store referenced by id (Phase 3/4), so it is never copied per step.
  The history is capped at 200 steps.
* **Transactions:** a gizmo drag calls `beginTransaction`, streams
  `applyTransient` updates (live viewport and inspector), and ends with
  `commitTransaction`, so **one drag = one undo step**. A drag with no
  change creates no entry, and `cancelTransaction` restores the start state.
* Selection, tool mode and snap settings are editor state and are not part of the document or the history.

## Viewport interaction

* Left drag orbits, right drag (or Shift+left) pans, and the wheel zooms to the cursor.
* Selection uses R3F click events and ignores clicks that end a camera drag
  (more than 4 px), so orbiting never changes the selection. Clicks in the
  ~200 ms after a gizmo drag are also ignored (`gizmoRecentlyUsed`).
* **Gizmo:** a single three.js `TransformControls` instance is attached to an
  invisible proxy at the selection pivot. Each change is converted into
  document edits (translate → position delta, rotate → matrix delta, scale →
  new `size`). Multi-selection move and rotate happen around the selection's centre.
  The instance is created once and disposed on unmount. drei's wrapper was replaced
  because it leaked gizmo geometry every time it remounted.
* Snapping: translation snaps in mm (0.1–10) and rotation in degrees (1–90), and also applies to the resize gizmo.
* Camera views animate along a spherical arc. The view cube is drawn in a Hud
  overlay; clicking a face or corner animates to that standard or isometric view.

## Memory management

* `ShapeMesh` memoises geometry on `(shape, size, params)` and disposes the old
  geometry when it changes or the mesh unmounts.
* The e2e suite checks `renderer.info.memory.geometries` returns to its starting
  value after repeated add → resize → delete cycles.
* Shape-library thumbnails are rendered once from the **real CAD geometry** with a
  temporary WebGL context, which is then force-lost.

## Testing

* `npm test`: Vitest unit tests for geometry validity, exact dimensions, volumes,
  transforms, the store (undo/redo, transactions, structural sharing,
  duplication, locking) and the numeric expression parser.
* `npm run e2e`: real-browser workflow test (Playwright, WebGL via SwiftShader)
  that drives the actual UI with mouse and keyboard input. See `scripts/e2e-phase1.mjs`.

## Future-proofing

* **Persistence (Phase 4):** the document is plain JSON with `schemaVersion`. A
  `ProjectRepository` interface (IndexedDB now, Supabase later) will sit in
  `src/cad/serialization`.
* **Groups (Phase 2):** `GroupObject`, `parentId` and `children` already exist in the model, and
  delete/duplicate already handle subtrees.
* **Holes (Phase 3):** `ShapeObject.isHole` is already in the model.
