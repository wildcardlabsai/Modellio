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
| `src/cad/document.ts` | Pure document operations (add, remove, duplicate, naming, free-spot placement, clipboard). |
| `src/cad/hierarchy.ts` | Scene-graph maths: world matrices, bounds in any frame, group/ungroup, re-parenting, group scaling, mirror, align/distribute. |
| `src/store/` | Zustand editor store and the snapshot history. |
| `src/viewport/` | Everything Three.js / R3F: meshes, gizmo, camera, view cube, workplane, overlays. |
| `src/components/` | DOM UI: layout, toolbar, shape library, inspector, scene list, UI primitives. |
| `src/hooks/` | Keyboard shortcuts. |
| `src/utils/` | Math, ids, the safe arithmetic evaluator for numeric fields. |
| `src/cad/kernel/` | Manifold (WASM) loader and the `MeshData` interchange format (welded positions + indices). |
| `src/cad/operations/combine.ts` | Live Boolean evaluation of combined groups, flatten-to-mesh, separate. |
| `src/cad/text/` | Font registry (opentype.js) and kernel-based text solids. |
| `src/cad/assets.ts` | Immutable mesh asset store (referenced by id from documents). |
| Reserved: `src/cad/export`, `import`, `serialization` | Phase 4 (STL/OBJ, persistence). |

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

### Boolean library evaluation

| Library | Verdict |
| --- | --- |
| **manifold-3d** (WASM) | **Chosen for Booleans.** It guarantees manifold (watertight) output, is robust on coplanar faces and is fast, which is what 3D-printable output needs. It is already published as an npm package with TypeScript types. |
| three-bvh-csg | Fast and convenient for previews, but it gives no guarantee of manifold output. It may be used for live hover previews only. |
| three-csg-ts / BSP CSG | Slow, with poor robustness on coplanar faces. Rejected. |
| @jscad/modeling | A good solid-modelling kernel (also used for text extrusion and hull). Its Booleans are slower and its data model differs. Candidate for text/2D tooling, not core Booleans. |

Primitive meshes are already watertight, so they are passed straight to Manifold after welding vertices.

## Hierarchy (Phase 2)

* Groups are real scene-graph nodes. `transform` is **local to the parent**;
  `worldMatrix(doc, id)` composes the chain. The viewport renders nested
  `<group>` elements, so Three.js composes the same matrices.
* **World placement is invariant** under group, ungroup, re-parenting (tree drag-and-drop) and
  paste. Each of these captures world matrices first, then rewrites local transforms as
  `inverse(newParentWorld) · world`. Tests check this, including rotated groups.
* A group's pivot is placed at its bounds centre when it is created (and after it is resized).
* **Group resizing never stores a scale.** Factors are applied in the group's
  frame about the bottom centre of its bounds, so it stays on the plate. Child positions
  are scaled, and child sizes are scaled per axis through each child's rotation.
  This is exact only when every descendant is axis-aligned with the group (multiples of 90°).
  Otherwise non-uniform scaling would need shear, which a real solid can't hold, so the
  group scales uniformly instead and the UI says so.
* Lock and visibility are inherited: `isEffectivelyLocked` and `isEffectivelyVisible`. Hidden subtrees are
  not mounted, so they can't be picked.
* Selection in the viewport picks the outermost group; double-click selects the part itself.
  Commands act on the **top-level** selection (`topLevel()`), so a group and its child are never
  transformed twice.

## Mirror

A world reflection `M` has determinant −1. It can't be stored as a rotation, and a
negative scale would break the "size is authoritative" rule. For each mirrored node,
MODELLIO stores the new world matrix `M · W · F`, where `F` reflects the node's
**local axis most aligned with the mirror normal**. That product is a proper rotation,
and when the axes are aligned the rotation doesn't change at all. Each shape absorbs `F`
into a per-axis `mirror` flag. When the mesh is generated, it is reflected and its
triangle winding reversed, so normals still point outwards. Tests check that every primitive stays
watertight with the same positive volume under every mirror combination, and that mirroring twice is the identity.

## Solid modelling (Phase 3)

### Kernel

[Manifold](https://github.com/elalish/manifold) (`manifold-3d`, WASM) is the solid-modelling kernel. Its JS glue and
WASM are loaded on demand at startup. Every Boolean is evaluated by Manifold, which guarantees manifold
(watertight, consistently oriented) output and handles coplanar faces robustly. Tests cover exact volumes,
coplanar pockets, rotated and nested combinations, and empty results. All Manifold objects are deleted in
`finally` blocks to free WASM memory.

### Non-destructive combinations

A group with `combine: 'union' | 'intersect'` evaluates

```
result = (union | intersection)(visible solids) − union(visible holes)
```

in the group's local frame. Each part is turned into geometry, welded into `MeshData`, transformed by
`inverse(groupWorld) · partWorld`, and converted to a Manifold. Nested combined groups contribute their own
results; plain sub-groups pass their leaves up; a combination made only of holes acts as a hole.

* **Subtract** is not a separate mode. It marks every object except the first-selected one as a hole, then
  makes a union, which is exactly the Tinkercad mental model, and stays editable.
* **Caching:** results are cached (LRU) by a key built from everything that affects geometry (transforms,
  sizes, params, mirror flags, text, mesh ids, holes, visibility). Colour changes, renames and undo/redo
  re-use cached results.
* **Rendering:** the result is drawn with crease-angle normals, so curved surfaces look smooth and edges stay sharp.
  Parts inside a combination are not drawn, except a translucent ghost of a part selected in the tree, so it can be
  edited with the gizmo while the result updates live.
* **Bounds:** `hierarchy.boundsInFrame` asks the Boolean module (through a registered resolver, avoiding an import
  cycle) for the real result bounds. Selection boxes, drop-to-workplane and alignment use the true solid.

### Mesh shapes and the asset store

`shape: 'mesh'` objects reference an immutable, centred `MeshData` asset by id. They reuse every shape code path:
size is authoritative (the mesh is fitted to `size`), mirror, holes, gizmo, align and Booleans. *Flatten to mesh*
bakes a combination into one; *Separate* uses `Manifold.decompose()` to split disconnected solids. Undo snapshots
only hold the id, so geometry is never duplicated in history. Phase 4 imports (STL/OBJ) will become mesh shapes too.

### Text

Fonts are bundled WOFF files (Fontsource, SIL OFL) parsed by opentype.js and loaded lazily. Glyph outlines are
flattened to contours (Y flipped to Y-up) and passed to `CrossSection(contours, 'NonZero')`. That unions
overlapping strokes correctly (script fonts), then `Manifold.extrude` creates a solid that is valid by construction.
Text content, font and size are stored on the object. When they change, `size` is re-derived from the natural
layout (depth is kept). Resizing afterwards stretches the text, like any other shape. Text meshes are cached.

### Measure tool

Raycasts against pickable meshes (shapes and Boolean results) and falls back to the workplane. The hit snaps to
the nearest vertex of the hit triangle when it is within 10 px on screen, for exact corner-to-corner readings.

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
* **Performance (Phase 5):** Boolean evaluation runs on the main thread. It is cached and typically takes milliseconds,
  but very large text or imported meshes would benefit from moving `computeCombined` to a Web Worker; the
  function is already pure (document in, `MeshData` out).
