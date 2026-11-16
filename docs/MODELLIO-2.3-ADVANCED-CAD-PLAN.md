# MODELLIO 2.3 — Advanced CAD & Professional Modelling: audit and plan

Branch `modellio-2.3-advanced-cad`, from `main` at a313141 (2.2 merged, CI green). This document is the audit and the
proposed plan. **No implementation starts until it is approved**, and nothing is merged to `main` or deployed without
explicit approval.

Read alongside [`ARCHITECTURE.md`](ARCHITECTURE.md) and
[`MODELLIO-2.2-DESIGN-STUDIO-PLAN.md`](MODELLIO-2.2-DESIGN-STUDIO-PLAN.md).

## 1. Baseline

| Check | Result on this branch (a313141) |
| --- | --- |
| Formatting, types, lint | prettier, `tsc -b` and eslint (zero warnings) clean |
| Unit tests | 386 passed in 37 files |
| Browser workflow suites | 17/17 suites, 630/630 checks passed (Playwright against the production build) |
| Build | Succeeds. One warning: `SketchEditor` is lazy-loaded by `SketchHost` but imported directly by `LoftSweepDialog`, so the lazy split does nothing (see §3.6). |
| Performance (200 mixed primitives, headless) | Measured at the end of 2.2 (fb46600, the same Studio code as this commit): add all ~300 ms; select (to the next painted frame) ~37 ms median; edit position ~35 ms median. On a par with the pre-2.2 `main`. |

## 2. What exists today

### 2.1 Genuinely implemented

| Area | What is there | Where |
| --- | --- | --- |
| Document | Flat object map plus hierarchy. Schema 2 adds standalone sketch records (resolve-on-write, so bodies keep a resolved copy) and a `component` flag on groups. Migrations from v1, project files v4, share links, versions | `src/types/document.ts`, `src/cad/serialization/*`, `src/cad/sketchRecords.ts` |
| History | Immutable snapshots with labels, transactions (one drag = one step), jump to step, changed-object derivation | `src/store/history.ts`, `src/store/editorStore.ts`, `src/cad/featureTree.ts` |
| Mesh kernel | Manifold: 15 parametric primitives, text, imported meshes, sketched extrude and revolve, Booleans (in a worker), hollow, mesh tools | `src/cad/kernel/*`, `src/cad/operations/*` |
| Precise solids | OpenCascade 7 via replicad 1.2.1 in a worker. **Bases:** primitives, sketch extrude and revolve, loft (ruled or smooth), sweep (Frenet; round or sharp corners), stored BRep from STEP. **Operations:** fillet and chamfer. Edges are referenced by `EdgeRef` (normalised midpoint and direction, or circle centre and axis); an operation whose edges vanish is flagged `missing-edges` and skipped, never guessed | `src/cad/brep/*` |
| STEP | Import every solid as exact. Export exact for precise solids and primitives, faceted for meshes and Boolean results | `src/cad/brep/step.ts` |
| Other formats | **Import:** STL, OBJ (unit and up-axis detection), 3MF, GLB/glTF, SVG and pictures (traced). **Export:** STL (binary and text), OBJ+MTL, 3MF, GLB | `src/cad/import/*`, `src/cad/export/*` |
| Sketcher | Lines, arcs, circles and construction geometry. **Constraints:** horizontal, vertical, length, radius, coincident, parallel, perpendicular, equal, point X/Y, fix. Levenberg–Marquardt solver with DOF, over-constrained and conflicting status. Even-odd multi-profile with holes | `src/cad/sketch/*`, `src/components/sketch/SketchEditor.tsx` |
| Feature browser | Bodies, Sketches and Features views derived from the document. Edit, suppress and delete act on the real recipe. Hover links to 3D | `src/cad/featureTree.ts`, `src/components/hierarchy/FeatureTree.tsx` |
| Print inspection | Overhang by face normal, thin walls (inward ray per sampled triangle), floating or below plate, off-plate, watertight. A 3D overlay of problem triangles. The Inspector's Print tab shows size, volume, area and closed-solid check | `src/cad/analysis/printability.ts`, `src/components/print/*` |
| AI assistant | Claude via a Vercel function. **9 schema-validated ops:** add shape or text, size, position, rotation, colour, hole, combine, delete. Validated on the server and again in the browser, applied as one undo step with full rollback, a clarification flag and 6 turns of history | `src/ai/*`, `api/assistant.ts` |

### 2.2 Partially implemented

- **Components.**
  - A `component: true` flag on a group, and a panel with "Insert another".
  - Copies are independent; there are no definitions, instances or links.
- **Sketch placement.**
  - Every sketch lives on its body's local XY plane, and the sketch data has no frame.
  - There are no reference planes and no sketch-on-face.
  - Loft sections are XY slices at a height; sweep paths lie only on XY or XZ.
- **Solver feedback.**
  - It reports how many equations are redundant or conflicting, but not which.
  - The editor solves on every render, and point lookup is a linear `find`.
- **Hollow.** Mesh only (Manifold). A hollowed shape cannot become a precise solid.
- **Mesh repair.**
  - Weld, then a Manifold rebuild; if the rebuild fails, the welded mesh is returned silently.
  - No hole filling, no normal reorientation, no self-intersection repair.
- **Print check.**
  - It samples about 1500 triangles with one ray each (no spatial index) on the main thread.
  - No printer or material profiles, no minimum-feature check, no shell connectivity.
  - Issues are listed but cannot be selected.

### 2.3 Missing

- **Exact Booleans.** Every Boolean is a Manifold mesh, so combining loses exact geometry: no fillet after a union,
  and STEP export of a Boolean is faceted.
- **Face references and picking:** no `FaceRef`, no face selection in the viewport.
- **Solid features:** shell, draft, face offset, holes (simple, counterbore, countersink), mirror, linear and
  circular patterns.
- **Sketch tools:**
  - **entities:** splines and Bézier curves;
  - **constraints:** tangent, concentric, symmetric, midpoint, point-on-curve, angle, point-to-line distance;
  - **editing:** trim, extend, offset, corner fillet and chamfer, on-canvas dimensions.
- **Assemblies:** linked instances, joints and a motion solver.
- **Manufacturing:** printer and material profiles, orientation advice, support-risk map, disconnected and
  self-intersecting shell detection, export validation.
- **Assistant:** sketches, precise solids, features, edits of existing feature parameters.

## 3. Technical limitations and architectural risks

1. **Edge matching is purely geometric.** `EdgeRef` stores a normalised midpoint and direction and matches the
   nearest edge of the same kind within 0.02.
   - On symmetric parts, or after uneven resizes or sketch edits, a different edge can fall inside the tolerance.
     Nothing detects that ambiguity.
   - There is no topological naming. Every new face- and edge-based feature (shell, draft, holes) inherits this
     risk, so it must be fixed first.
2. **Recipes are per body.** A `FeatureRecipe` is a single solid with a linear op list. Booleans live outside it,
   as groups computed by Manifold, so the feature history stops at a Boolean.
3. **Duplicated sketch-to-profile code.** Loop walking exists twice, in `src/cad/sketch/profile.ts` (mesh) and
   `src/cad/brep/build.ts` (exact), with a third copy of the arc maths in `sketchPath`.
   - *Corrected in Stage 1:* the audit said revolve differs between the two engines. Measured, it does not: both
     use only the part right of the axis (a −5…10 mm square revolves to 3139 mm³ in Manifold against 3142 mm³ in
     OpenCascade, the gap being faceting). Tests now pin this down.
   - At a junction of more than two edges the walk takes the first unused edge, with no validation.
4. **One OpenCascade worker, first in first out.** A slow STEP import or a heavy fillet blocks every other build,
   and there is no cancellation or priority.
5. **Main-thread work:**
   - meshing every part before a Boolean is sent to the worker;
   - the print check;
   - mesh tools;
   - *Corrected in Stage 1:* "a second Manifold instance" is not a defect. Each worker needs its own WebAssembly
     instance (memory cannot be shared between threads), and the main-thread instance is required to build
     display meshes synchronously as shapes are edited.
6. **Thin-wall analysis is unreliable:** one ray per sampled triangle centre with no spatial index. It misses thin
   regions, is wrong on open meshes, and is slow on large models.
7. **The assistant sees only top-level objects (≤100)** and has no knowledge of features. Its rate limit is in
   memory per serverless instance, so it is not durable.
8. **Lazy loading of the sketch editor is ineffective:** the loft panel imports it directly.
9. **What the engine supports (checked in `node_modules`):**

   **Available in replicad 1.2.1:**
   - `shell`, `draft`, `mirror`;
   - `fuse`, `cut`, `intersect`, `split`;
   - `extrude({ twistAngle })`, `twistExtrude`;
   - sweep with `auxiliarySpine` and `law`, `makeHelix`;
   - `Drawing.offset`;
   - `weldShellsAndFaces`, `simplify`.

   **Reachable through the raw OpenCascade build (`getOC()`):**
   - `BRepOffsetAPI_MakePipeShell`: several sections along one spine, which gives *lofting along a path*;
   - `BRepOffsetAPI_ThruSections`, `BRepOffsetAPI_DraftAngle`, `BRepOffsetAPI_MakeThickSolid`;
   - `BRepBuilderAPI_Sewing`, `BRepCheck_Analyzer`, `ShapeFix_Solid`.

   **Not available:** `ShapeFix_Shape` (general shape repair) is not in the build, and a true loft with separate
   guide rails has no API.

## 4. Approach and principles

- **Extend, never rebuild.** New modelling features are new recipe operations and bases built in the existing
  OpenCascade worker, shown in the existing feature tree, and saved through the existing migration pipeline.
- **One exact engine** (OpenCascade) and **one mesh engine** (Manifold, for display, mesh Booleans and makers). No
  third engine.
- **Every operation is real.** It builds genuine geometry, and failure is shown on the operation (the existing
  `problems` mechanism) without corrupting the document. A failed operation is skipped and flagged, and the
  document keeps its last good state.
- **Resolve-on-write for links** (proven by 2.2's shared sketches): a linked thing keeps a resolved copy, so
  geometry, export and the makers keep working unchanged, and edits rewrite every user in one undo step.
- **Determinism:**
  - Recipes are plain data.
  - Builds are pure functions of recipe plus size.
  - Tests compare exact volumes, areas and topology counts.
- **Compatibility:**
  - Each schema change gets a migration and tests for v1, v2 and v3 documents, files and share links.
  - Unknown future data is refused cleanly, as today.
- **No new dependencies planned.** A bounding-volume hierarchy library would be considered only if a hand-written
  uniform-grid index proved too slow, and that would be justified first.

## 5. Proposed stages

Each stage is committed and pushed to this branch with a report (what works, tests, limitations, what is left),
and leaves the application stable. The full regression runs at the end of every stage.

### Stage 1: foundations (needed by everything after it)

**Geometry references:**
- `EdgeRef` gains the normals of its two adjacent faces and its length.
- Matching scores all candidates and refuses (`ambiguous-edges`) when the best two are too close, instead of
  guessing.
- A new `FaceRef`: surface kind, centroid and normal (normalised), area.
- Viewport face picking reuses the edge-pick tool pattern (`src/viewport/EdgePickTool.tsx`). *Moved to Stage 2*,
  with its first user (shell), so no picking mode appears before something uses it.

**Shared code and parity:**
- One shared sketch-to-loops module used by both kernels.
- Revolve parity: both paths clip to x ≥ 0, with a message when anything is clipped.
- Validation of junctions with more than two edges and of self-intersections, reported in the sketch status.

**Workers:**
- Job priorities (interactive previews before STEP).
- Cancellation of superseded previews.
- ~~A single Manifold instance.~~ Not applicable (see §3, item 5).

**Schema 3:** *deferred* to the first stage that adds document fields. Bumping the version with no new fields would
only stop the live 2.2 app opening new saves.

**Tests:**
- unit: reference matching, including symmetric-part ambiguity and resize stability; face references; loop
  validation; revolve parity; migration v1→v3;
- e2e: face picking.

### Stage 2: solid features

All are recipe operations with edit, suppress, delete, failure flags, undo and save/reopen. Each is built in the
worker and previewed in the docked panel.

- **Shell:** a wall thickness, with optional faces to open (`shell`). This replaces mesh-only hollow for precise
  solids.
- **Draft:** an angle on picked faces from a neutral plane (`draft`).
- **Hole** on a picked planar face at a picked point:
  - simple, counterbore or countersink;
  - depth or through;
  - built as a revolved cutting profile and `cut`.
- **Mirror:** across a principal plane or a picked planar face, fused with the original.
- **Linear and circular patterns** of the body, or of the features after a chosen step: count and spacing, or
  count and angle.
- **Exact Booleans:**
  - When every part of a combined group is a precise solid, the result is built with OpenCascade
    `fuse`/`cut`/`intersect` (with the same live editing of parts as today), and STEP export becomes exact.
  - "Make precise solid" on such a group creates a solid whose base is the Boolean, so fillets, chamfers and shells
    can follow it.
- **Dependencies:**
  - A rollback marker ("Rebuild up to here") in the Features view.
  - When an earlier change breaks a later operation, that operation shows *why* (missing, ambiguous or failed) and
    can be re-picked; nothing is moved silently.

**Tests:**
- exact volume and area for each operation;
- an edit-earlier-feature cascade;
- suppress and restore;
- failure cases (shell too thick, draft on a curved face);
- STEP round-trip of an exact Boolean;
- e2e for each tool.

### Stage 3: advanced sketching

- **Constraints** (new residual equations in `solver.ts`): tangent (line–arc, arc–arc), concentric, symmetric
  about a line, midpoint, point on line, point on circle or arc, angle, point-to-point and point-to-line distance.
  Collinear comes free from parallel plus point-on-line.
- **Solver:**
  - Find the conflicting or redundant constraints by re-solving with each candidate removed, and name them in the
    panel.
  - Cache the solve and use a point index instead of `find`.
- **Tools:**
  - trim and extend to the nearest intersection;
  - offset of a chain (exact via `Drawing.offset`; the same maths in the mesh path);
  - corner fillet and chamfer between two lines;
  - mirror;
  - a cubic spline entity: a B-spline in OpenCascade, sampled for Manifold.
- **Dimensions** drawn on the canvas and edited in place.
- **Placement:**
  - Sketch records gain a frame (origin, normal, x-axis).
  - Reference planes: offset from a principal plane, or angled about an axis.
  - Sketch on a picked planar face.
  - Bodies built from a placed sketch are positioned by that frame.
  - Loft sections may use their own frames.

**Tests:**
- every constraint solved exactly;
- conflict naming;
- trim, extend, offset and fillet geometry;
- spline profiles in both kernels;
- placement round-trips;
- dependent bodies rebuild when their sketch changes;
- e2e for drawing, constraining, sketching on a face and extruding.

### Stage 4: components and assemblies

**Component definitions and linked instances** (resolve-on-write, schema 3):
- An instance is a group with `instanceOf`.
- Editing the definition rewrites every linked instance (each keeps its own position) in one undo step.
- Editing inside an instance is blocked with "Edit the original" and "Make independent".
- The browser and Components panel show a linked or independent badge.
- Nested definitions propagate in dependency order, and cycles are refused.
- Visibility and locking work per instance.

**Joints:**
- **Kinds:** fixed, revolute, slider, cylindrical and rigid group.
- **Record:** the two components; a frame picked from a planar face, circular edge or axis; limits; a drive value.
- **Solver:**
  - A kinematic-tree solver sets each child's transform from its parent's transform and the joint value, so
    joints change real positions.
  - Assemblies that would form a closed loop are refused with an explanation (closed-loop solving is out of
    scope).
  - Dragging a jointed component with the gizmo is restricted to its joint's degrees of freedom and limits.
- **Joint panel:** pick two components and a feature on each, choose the kind, set limits, and drive the angle or
  offset with a slider.

**Tests:**
- instance propagation, nested and cyclic definitions;
- undo, save and reopen, migration;
- joint maths (exact transforms for given values), limits, constrained dragging;
- loop refusal;
- e2e for building a hinged two-part assembly and driving it.

### Stage 5: manufacturing preparation

- **Printer profiles:** build volume, nozzle, layer height. Presets for common printers plus custom.
- **Material profiles:** safe overhang angle, minimum wall as a multiple of the nozzle, bridging length. PLA, PETG,
  ABS/ASA, TPU and resin, plus custom.
- **Analysis in a worker with a uniform-grid spatial index:**
  - wall thickness from several rays per sample, with a coloured map;
  - minimum feature size;
  - overhang and support-risk map (angle plus unsupported islands);
  - disconnected shells (connected components);
  - self-intersection and non-manifold edges (Manifold status plus edge counts);
  - build-volume fit.
- **Orientation recommendation:** score candidate orientations (support area, height, footprint, first-layer
  contact) and apply one with the existing lay-flat code, in one undo step.
- **Clickable issues:** a click selects the object and frames the problem triangles.
- **Export validation:** warnings in the export dialog (not watertight, off the build volume, thin walls) with
  plain explanations. "Watertight" is never presented as "printable".

**Tests:**
- analysis maths on known meshes (thin slab, overhang wedge, two shells, self-intersecting pair);
- orientation scoring;
- worker responsiveness;
- e2e for profile selection, issue selection, orientation apply and undo, export warnings.

### Stage 6: advanced modelling

- **Twist:** twisted extrude (`twistAngle`) and twisted sweep (a law or auxiliary spine).
- **Helical sweep** for threads and springs (`makeHelix` as the path), with pitch, turns and handedness.
- **Loft improvements:**
  - per-section rotation;
  - *loft along a path* through several sections (`MakePipeShell` with several sections), the closest true
    alternative to guide curves the engine offers.
  - Separate guide rails remain unsupported and are reported as such.
- **Mesh to precise solid** for small closed meshes: sewing, then `ShapeFix_Solid`, with a triangle cap and a clear
  refusal above it.
- **Imported STEP check and repair:** `BRepCheck_Analyzer` reports invalid solids; `ShapeFix_Solid` and sewing
  attempt repair; the report says what changed.
- **Better mesh repair:**
  - hole filling for small boundary loops;
  - consistent normal orientation;
  - say when a rebuild fails instead of failing silently.

**Tests:** volumes and topology of twisted and helical bodies; a multi-section path loft; mesh-to-solid round-trip;
repair of a deliberately broken STEP and STL.

### Stage 7: AI assistant

**New validated operations:**
- sketch profiles (rectangle, circle, polygon, slot, polyline) placed on a plane, then extrude or revolve;
- make precise;
- fillet and chamfer by *semantic edge selectors* ("top outer edges", "vertical edges"), resolved by the app and
  never by the model;
- shell, hole, pattern, mirror;
- set a shape or feature parameter;
- create a component instance.

**Context and behaviour:**
- A richer scene summary: hierarchy, features and sketches, within a token budget.
- Clarifying questions for complex requests (the mechanism exists) plus step explanations.
- Repair and print-improvement suggestions from the print report.
- Edits modify existing features rather than rebuilding them.
- Preview, Apply, Discard and one-undo-step stay as they are.
- No generated code.

**Tests:** plan validation for every new operation (including malicious or out-of-range input); execution on
fixture scenes; rollback on failure; e2e with a mocked server.

### Stage 8: workflow, usability and release quality

- **Context menus** (viewport and Design Browser) offering only working actions.
- **Selection filters** (body, face, edge), box selection, and select-same.
- Operation previews everywhere.
- **Errors** reported on the object or operation they concern.
- **Help:** tooltips, and the shortcut list generated from the real key map.
- **Recovery:** after a crash or closing the tab mid-edit.
- **Large projects:** a 500-object scene, plus instanced meshes for linked components.
- **Docs:** README and architecture updates; full regression and performance comparison with 2.2.

## 6. Dependencies between stages

| Stage | Depends on |
| --- | --- |
| 1 | — |
| 2 | 1 (face and edge references, worker priorities) |
| 3 | 1 (shared loops); placement uses 1 (face picking) |
| 4 | 1 (schema 3); joints use 1 (face and edge picking) |
| 5 | 1 (worker infrastructure) |
| 6 | 2 (operation framework) |
| 7 | 2 and 3 (the operations it drives) |
| 8 | all |

Stages 4 and 5 could swap if assemblies matter less than printing for current users.

## 7. Risks and how they are contained

| Risk | Containment |
| --- | --- |
| Wrong edge or face picked after an edit (topological naming) | Stage 1 ambiguity detection: refuse and flag instead of guessing; re-pick from the flagged operation. Tests on symmetric parts. |
| OpenCascade failures (shell, draft and Boolean edge cases) | Every operation runs on a clone; on failure the operation is flagged with the engine message and skipped; the document is never written with a broken result. |
| Worker load and responsiveness | Priorities, cancellation, previews debounced; heavy analysis in workers; timing tests with large scenes. |
| Schema 3 compatibility | Migration with tests for v1 and v2 documents, files and share links; resolve-on-write keeps old readers (makers, export) unchanged. |
| Joint solver scope | Kinematic trees only, stated in the interface; loops refused rather than solved wrongly. |
| Solver performance with more constraint types | Cached solves, point index, sub-problem split if needed; a timing test on a 200-entity sketch. |
| Assistant safety | Schema-validated operations only, server and client validation, limits, rollback; no code generation. |
| Scope | Stages are independent increments; each ends stable and reviewed. Anything the engine cannot do (guide-rail lofts, general ShapeFix) is reported, not faked. |

## 8. Testing requirements (every stage)

- **Unit:** geometry results by exact volume, area and topology counts; recipe rebuilds; migrations; solver
  equations.
- **Behaviour:** feature-history and dependency tests; undo and redo; save and reopen; share links; import and
  export round-trips.
- **Failures:** invalid input, failed operations, corrupted files.
- **Browser:** a workflow suite per stage, plus the 17 existing suites at every stage end.
- **Performance:** a large-model check at stages 1, 5 and 8.
- **No existing check is weakened or removed.** Where an interface change moves a control, the suite is updated to
  reach it and keeps asserting the same behaviour.

## 9. Progress

### Stage 1: foundations (done)

| Item | Result |
| --- | --- |
| Edge references | Each straight or curved edge records the normals of the two faces it joins. Matching uses them to separate edges in the same place, and returns *ambiguous* when two different edges fit almost equally well, so the operation is flagged and nothing is guessed. Circles keep centre, axis and radius only (their two halves must stay one reference). References saved by 2.2, without face normals, still apply. |
| Face references | `FaceRef` (surface kind, centre and outward normal in normalised space, area scaled by orientation), and each build lists its faces with their triangle ranges. `faceId` in OpenCascade's mesh output was confirmed to be the face hash, in the same order as the faces, so triangles map to faces exactly. `matchFaces` finds faces again after resizes and refuses on ties. |
| Shared outlines | `src/cad/sketch/outline.ts` is the one sketch walk, used by the mesh engine (sampled polygons) and the exact engine (true arcs) and by sweep paths. It also reports points where more than two curves meet and outlines that cross. The sketch editor shows these, plus a note when a revolve profile reaches left of the axis. |
| Worker queue | Priorities: tool previews, then 3D-view builds, then STEP jobs. Preview lanes: a newer fillet, chamfer, loft or sweep preview cancels an older one that has not started, so dragging a value builds only the latest. A running job always finishes. The worker is injectable for unit tests. |
| Not done, by decision | Face picking (moved to Stage 2); schema 3 (deferred); single Manifold (not applicable). |

**Tests added:**
- **Unit:** face-normal tie-breaking, ambiguity refusal, circle halves, box edges found after an uneven resize,
  face references and triangle coverage, face ties, 2.2 references still applying, outline branches, crossings and
  arc direction, revolve parity in both engines, queue priorities and lanes.
- **Browser:** new `e2e-cad-foundations` suite (8 checks).

### Stage 2: solid features (done)

| Item | Result |
| --- | --- |
| Face picking | Hover and click faces of a precise solid in the 3D view. Clicks map to faces through OpenCascade's per-face triangle ranges; a click on a flat face also gives an exact point for holes. |
| Shell | Even inward walls with chosen faces left open. Results that would not fit inside the part, or would add material, are refused with a clear message rather than accepted. |
| Draft | Tapers chosen faces inwards going up from the bottom of the part (+Z is the pull direction). |
| Holes | Simple, counterbore or countersink; blind or through; at a clicked point of a flat face (with "Centre on the face"). One revolved tool profile serves every style. Position is kept in proportion when the part is resized; diameters stay in mm. |
| Patterns and mirror | Split by what keeps the history meaningful. **Inside a solid's history:** hole patterns (row or circle). These keep the part's bounding box, which matters because solids are rebuilt at their displayed size. **For whole bodies:** "Mirror a copy" and "Pattern" (row, or circle about the vertical axis) make real copies grouped with the original. They become linked copies in Stage 4. |
| Exact Booleans | A new base, the exact combination. Groups whose parts can all be exact (precise solids, and primitives converted as "Make precise solid" would) are combined in OpenCascade once the engine is loaded or a part is already precise. Until then the mesh result shows, and it stays the fallback, with the reason shown. "Make one precise solid" turns the group into one solid so fillets, shells and holes can follow; undo restores the editable group. STEP export writes exact combinations exactly. Parts stretched unevenly cannot be exact and say so. |
| Rollback and dependencies | A rollback marker per solid ("Roll back to after this…", "Roll back to the start", "Roll forward"). Later operations are kept but not built, and new ones go in at the marker. The Features view shows, on each operation, why the latest build skipped it (an earlier change removed or confused its edges or faces), never moving it to other geometry. |
| Fixed along the way | A combined group's cached result did not change when a precise part's recipe or a sketched part's sketch changed. |

**Tests added:**
- **Unit:** exact volumes for every operation, hole style and pattern; shell and missing-face failures; exact unions, holes, intersections, rotations, mirroring, nesting and fillets on combinations; analytic volume of a tilted hole through a document group, and its placement; rollback in builds and in the document; marker insertion; patterns and mirror copies.
- **Browser:** new `e2e-solid-features` suite (31 checks) driving shell, holes, draft, exact combination, copies, rollback and a broken dependency through the real interface.

**Limitations:**
- Holes go into flat faces only.
- Draft pulls along +Z from the bottom of the part.
- Body copies are not linked yet (Stage 4).
- A primitive-only combination is exact only once the engine has been loaded, by design (it is a 23 MB download).

### Stage 3: advanced sketching (done)

Built in five increments (3a–3e), each tested, committed and pushed.

| Item | Result |
| --- | --- |
| Solver | Rewritten. Unknowns are split into independent groups (points and circle radii linked by equations); each is solved by Levenberg–Marquardt with a sparse numeric Jacobian. Points not in any equation a change touches cannot move. A 200-line sketch solves in about 8 ms. |
| New constraints | Tangent (line–circle/arc; circle–circle, outside or inside; at a shared end point for splines), concentric, symmetric about a line, midpoint, point on line, point on curve, angle, point–point and point–line distance, smooth (spline handles). Each is offered in the selection panel when the selection fits it. |
| Conflicts | A constraint or dimension that would conflict, or that only repeats what the sketch already implies, is refused: the message names the constraints it clashes with, and nothing changes. A sketch that already conflicts (an older file) names the culprits in its status and draws them red, in the list and on the canvas. |
| Splines | A Spline tool draws cubic Béziers through clicked points, with Catmull-Rom handles, closing on the first point. Handles are ordinary sketch points, so they take constraints. They are drawn as squares and can be dragged (the anchor stays put). A `smooth` constraint keeps each join smooth; "Make corner" frees a join and "Make smooth" restores it. Both engines build true splines: the mesh engine samples them, the exact engine draws Bézier edges. Splines work in extrudes, revolves, lofts and as sweep paths. |
| Parametric dimensions | Every constraint with a value is drawn on the canvas as a dimension: offset lines outside the outline for lengths, a leader for diameters, an arc for angles, and lines from the axes for X/Y. Click a label to type a value; it re-solves through the solver, with the same refusal for conflicts and invalid sizes. |
| Editing tools | **Trim** (to the crossings either side of the click; a circle becomes an arc; Béziers are split exactly). **Extend** (a free line end to the next curve). **Offset** (a chain of lines and arcs, or a circle, joined at the corners, outward for positive distances). **Fillet** and **chamfer** at a two-line corner. Intersections of any two curve kinds are found from sampled polylines and refined by Newton's method. Each tool previews its result before the click, or shows why it would be refused: a radius too big, a fold-over offset, a Bézier offset (it has no exact form), a joined or fixed end, or constraints that could not be met. Constraints that no longer hold are removed and named; direction constraints carry over to split pieces. |
| Placement (schema 3) | **Reference planes:** XY, XZ or YZ, offset and tilted, drawn in the 3D view, edited in the Sketches view; "Sketch on this plane". **Sketch on a face:** pick a flat face of a precise solid, or of a box or cylinder (built exactly for the pick; the body itself is not changed). The sketch record keeps the face's reference and the last resolved frame. Bodies made from a placed sketch sit on its frame and extrude along its normal. |
| Attachments | After every change a watcher finds each attached face again on its body's exact build, using the same reference matching as fillets and holes. When the face moved, the sketch and its bodies follow without a new undo step, so one undo restores both. When the face is gone (removed by a shell, say), cannot be told apart from another face, or its body was deleted, **nothing moves**. The sketch is marked broken, with the reason, in the Sketches view and the Inspector, with Re-attach (pick a face again) and Detach (free it where it is). |
| Placed bodies | Their position and rotation are set by the sketch. The Inspector fields and the gizmo are disabled, with the reason and a Detach button. Every other way of moving them (nudge, align, typed values, group moves) is refused centrally in the store, with a message. Grouping still works, since it keeps world positions. |
| Files | Schema 3 (project file version 5) adds `doc.planes` and, on sketch records, `placement`, `frame` and `broken`. Version 1 and 2 documents open unchanged (no planes, unplaced sketches); malformed placements are dropped; a face placement whose body is missing is kept and reported broken. Everything survives saving, closing and reopening. |
| Fixed along the way | Solver speed: an entity lookup table was being rebuilt for every Jacobian column. |

**Tests added:**
- **Unit (+55):** every constraint solved exactly; conflict naming and refusal; unrelated points unmoved; solver timing; Bézier outline walk, mesh area against the analytic area, exact extrude volume and a Bézier sweep path; spline drawing and smooth joins; dimension placement; intersections against analytic answers; de Casteljau pieces; trim, extend, offset, fillet and chamfer and each refusal; plane and face frames; frames that turn with the body; following a resized face; a broken attachment that moves nothing; migration and save/reopen.
- **Browser:** new `e2e-sketching` suite (62 checks): constraints and refusals, a conflicting file, splines and handles, on-canvas dimensions, the five editing tools with previews, reference planes, sketch on a face, following, breaking and undoing, Detach, and save and reload.
- **Changed existing tests:**
  - `e2e-studio2` checks 22–23 now assert that a contradictory constraint is refused and named, rather than added and then removed.
  - Two schema tests assert the current schema (`CURRENT_SCHEMA`, now 3) instead of the literal 2.

**Limitations:**
- Extend works on lines; fillet and chamfer on corners where two lines meet (not line–arc).
- Offset refuses splines, since a Bézier's offset is not a Bézier.
- Tangent and smooth constraints keep curves in line but don't stop them turning back into a cusp if dragged that far.
- Sketches attach to flat faces only. A face's frame takes its x axis from the body's own X (or Y), and its origin is the face's centre, so a sketch stays centred on its face as the face grows.
- A body built from a placed sketch can still be resized; its size then no longer matches the sketch.
- The editing tools' icons show their names only on wide screens; tooltips always do.

### Stage 4: project workflow, unified design system and assemblies (approved plan)

**Decisions taken with the user:**
- **Explicit save with recovery.** Edits go continuously to a recovery draft; the project itself changes only on Save. New or Open with unsaved work asks Save / Discard / Cancel. After a refresh, recovery offers Restore or Discard.
- **Maker projects: one project, two views.** Opening a Maker project in Design Studio opens that same project (same id and name, Maker settings kept). Going back to the Maker warns before regenerating over Studio edits; the edited version is kept in version history.

**Findings from the audit:**
- **Merge bug.** The Makers' "Open a copy in Design Studio" appends the parts to whatever design is open, and autosave then writes them into it.
- **Maker state ignores projects.** Maker working state lives in localStorage regardless of project.
- **Split Studio has no project saving.**
- **Switching projects leaks state.** About a dozen per-project stores are never reset (sketch session, feature tool, face pick, hover, guides, inspector tab, tool, camera frame…).
- **Components are not linked.** A component is a group flag; every copy is an independent deep copy. There are no instances, grounding, joints or exploded views in Design Studio.
- **Visual system.** Tokens exist in one place, but the dark theme is scoped to Design Studio. The Makers have light panels with about 150 hard-coded UI colours, and there are few shared controls.

**Order:**
1. **4B:** Stage 3 safeguards (small, closes data-integrity holes first).
2. **4C:** shared UI building blocks and the project lifecycle.
3. **4D:** one visual system for the Makers and Split Studio.
4. **4E:** linked components and assemblies (schema 4).
5. **4F:** joints, limits, exploded views and the full regression.

### Stage 4B: Stage 3 safeguards (done)

| Item | Result |
| --- | --- |
| Bodies controlled by a sketch | A resize that would stretch a sketched body's outline (X/Y of an extrude, any axis of a revolve) is refused by a check every change passes through, so it applies to Inspector fields, resize handles and group scaling alike. A dialog explains why and offers **Edit sketch** or **Make independent and resize**. The latter is one undo step: the body gets its own copy of the sketch, scaled. Uniform scaling rescales its dimensions; uneven scaling removes the ones that no longer hold, and names them. Changing an extruded body's height is allowed and becomes its extrude depth, so it still matches the sketch. |
| Smooth joins | The smooth constraint now requires the handles to point in opposite directions. Handles folded onto the same side (a cusp that only looks smooth) no longer count as solved. A tangent join at a shared point must carry straight on rather than double back. |
| Invalid splines | `splineIssues` finds a Bézier that crosses itself, one that stops and doubles back (a cusp), and smooth joins that are folded or have a handle sitting on its anchor. A handle drag that would create one is held at the last valid position, with the reason shown. Such problems in a loaded sketch are listed, and Create/Update solid is blocked until they are fixed. The store refuses to build or save such sketches by any route. |
| Fixed along the way | Dialogs took focus while the key that opened them was still being handled. An Enter that committed a field and opened a dialog went on to press the dialog's first button, closing it straight away. Focus now moves after the event, and `data-autofocus` chooses the button. |

**Tests added:** 12 unit tests (`src/store/safeguards.test.ts`) and 5 browser checks in `e2e-sketching`.

**Limitations:**
- A group that contains sketched bodies cannot be scaled (refused and explained). Resize those bodies one at a time or through their sketches.
- Non-uniform scaling turns a circle into a circle of the mean radius; sketches have no ellipses.

### Stage 4C: project lifecycle (done)

| Item | Result |
| --- | --- |
| Saving | Projects change only when the user saves. Edits go continuously to a **recovery draft**, stored in a separate local database so the project database is untouched. The first Save of a new design asks for its name. Save As makes an independent project, which becomes the open one; the original stays as it was saved. Ctrl+S saves in every workspace. The save status shows Saved / Unsaved changes / Not saved yet, with the last-saved time. |
| Leaving unsaved work | New design, Open, opening a template or a project file, and switching Maker designs all ask **Save / Discard / Cancel** first. Discard keeps the design as last saved. |
| New design | A blank Design Studio design, any Maker (a new design in it), or a template. Each is a new project with its own id; nothing saved is touched. |
| Open design | Every saved project with its preview, type (Design Studio or the Maker that made it), last-saved time and object count. Search and filter by type. Maker projects open in their Maker, or **in the Design Studio as the same project**. |
| Recent designs | In the project menu and on the dashboard: projects ordered by last activity (opened or saved), each once. |
| Rename, duplicate, delete | From the project menu in every workspace. Deleting the open design (after confirmation) starts a new one; nothing else is opened behind the user's back. |
| Recovery | After a refresh or a closed tab, unsaved work for the reopened design is offered back: **Restore** (still unsaved) or **Discard**. A draft never overwrites a project unless restored and then saved. A draft older than the last save is dropped. |
| Clean switching | One registry (`platform/projectScope.ts`) resets every per-project store when the open design changes:<br>• editor history, selection, tool, measure points, notices<br>• sketch session, solid-feature tool, face pick, loft/sweep builder<br>• hover, guides, inspector tab, pending imports, print check<br>Application preferences are kept. The camera re-frames the new design. |
| Makers: one project, two views | One hook (`makers/shell/makerProject.tsx`) gives every Maker the same lifecycle: project menu, Save / Save as, unsaved marker, the Save / Discard / Cancel question when a design is handed in, and Ctrl+S. **Open in Design Studio** saves first, then opens that same project (same id and name, Maker settings kept). It replaces "Open a copy in Design Studio", which merged parts into whatever design was open. Saving in the Design Studio marks the project as changed there. Saving again from the Maker warns, keeps the edited version in history, and rebuilds. The return bar reopens the same project in its Maker. |
| Split Studio | The same project menu. Save stores the split (or connected) parts as a project that opens in the Design Studio. |
| Shared components | `Button`, `ConfirmChoice`, `ProjectMenu`, `ProjectPrompts` (the unsaved-changes question and the name dialog, in every workspace), `NewDesignDialog`, `OpenDesignDialog`, `RecoveryBanner`. |

**Tests added:**
- **Unit:** 11 tests (`src/store/projectStore.test.ts`).
- **Browser:** new `e2e-projects` suite, 34 checks.

**Existing tests changed to the new behaviour, with the same coverage:**
- `e2e-phase4` and `e2e-phase5`: saves are explicit and the first save asks for a name. Template use answers the unsaved-changes question.
- `e2e-platform`: the Maker's first save uses the shared name dialog.
- `e2e-keyring`, `e2e-cookie` and `e2e-vase`: "Open in Design Studio" must open the same project, saved first, rather than add a copy to whatever design is open.

**Limitations:**
- A Maker's working design (its recovery draft) stays in that Maker's local storage on this device, as before. It is not part of the cloud drafts.
- Split Studio projects keep the split parts and settings, not the source 3MF file, so they reopen in the Design Studio rather than as an editable split session.
- Cloud projects get local recovery drafts only.

### Stage 4D: one visual system (done)

| Item | Result |
| --- | --- |
| Theme | The Design Studio's dark theme is now the application theme: every Maker, Split Studio and the shared dialogs use the same tokens. One token source, `src/styles/index.css`. The landing page and dashboard keep their approved night look. |
| Tokens | New tokens `panel-2`, `stage`, `artboard` and `accent-2`. A Maker's printable **artboard stays light** in every theme so colours read true (as in the sketch editor); around it is the dark stage. |
| Makers and Split | About 150 hard-coded interface colours are replaced with tokens: white panels, grey text and hovers, borders, success green. Brand-coloured text uses the readable `brand-ink` token. Content colours stay as they are: filament palettes, part colours, 3D materials and drawing on the artboard. |
| 3D previews | Maker previews and Split Studio use the Design Studio's workspace colours (background, grid, build plate). Product shots stay transparent. |
| Function | Every Maker keeps its layout and workflow. All Maker, Split, mobile and landing suites pass. |

**Tests added:**
- A guard unit test fails if a hard-coded hex interface colour or a plain-white panel appears in the Makers or Split Studio. The artboard drawing is the one allowlisted exception.
- New `e2e-visual` suite, 112 checks: every Maker, Split Studio and the Design Studio, at desktop, laptop, tablet and phone sizes. For each it checks:
  - the shared theme is applied
  - no plain-white interface panels
  - WCAG AA text contrast, measured from computed colours
  - no sideways scrolling
  - a screenshot is saved

**Existing test changed:** `e2e-split` recognised empty space by the old light background colour. It now treats the dark, blue-dominant workspace background and grid as empty space, so the same pixel checks still run.

**Limitations:**
- The Makers' internal layouts are kept as they were (by design). This stage unified their look, not their structure.
- Shared `Button`/`Swatches` components are used by the new dialogs; the Makers' existing controls were restyled through tokens rather than rewritten.

### Stage 4E: linked components and assemblies (done)

| Item | Result |
| --- | --- |
| Model (schema 4, file version 6) | The existing component group is extended, not replaced. `doc.components` holds definitions. An instance is a group with `componentId`. Every part inside an instance carries a `defNode` link id that is the same in every instance of that component. Instances stay real objects, so rendering, picking, Booleans, export, print checks and sketches work on them unchanged. |
| Link sync | `syncLinks` (`src/cad/assembly/links.ts`) runs after every change in the store's change pipeline, in the same undo step. An edit inside one instance is copied to every other instance of that component: parts added, removed, resized, recoloured, re-sketched or moved inside it. Parts are matched by `defNode`; nested components are synced innermost first. Each instance keeps its own position, rotation, name, visibility, lock, grounding, suppression and home. A component that would contain itself is refused, with a notice. |
| Actions | Make component; Insert (linked, the default) or Insert independent copy; Make independent (break link); Replace with another component (keeps the placement); Ground / Unground; Set home / Reset to home; Suppress / Unsuppress. Mirrored copies are always independent (a mirror image is not the same part). |
| Grounding | `guardGrounded` (`src/cad/assembly/fixed.ts`) puts back any change that would move a grounded part in the world: a drag, nudge, align, typed position, or a move of its group. The gizmo and the position and rotation fields are disabled for grounded parts. |
| Suppression | Suppressed parts are hidden and left out of picking, bounds, Booleans, export and print checks. They stay in the browser, struck through. |
| Assembly browser | The Components panel lists each component with its number of linked copies, inserts linked or independent copies, expands to the copies, and makes a copy independent. The object tree marks linked copies (with a count), grounded and suppressed parts. The Inspector has an Assembly section: link status, Make independent, Replace with…, Grounded, Suppressed, Set home, Reset to home. |
| Migration | Schema 3 documents open as schema 4. Each existing component group gets its own definition, so copies made before this stage stay independent. Nothing is linked retroactively. |

**Tests added:**
- Unit (`src/cad/assembly/links.test.ts`, 11):
  - make and insert
  - edit one → all, as one undo step
  - per-instance placement; add or remove parts
  - break link; independent insert; nested sync
  - cycle refusal; grounding and reset; suppression left out of export
  - migration
  - performance: 50 instances of a 20-part component, one edit in under 300 ms
- New `e2e-assemblies` suite, 28 checks:
  - make component; insert 4 linked copies
  - edit → all 5 update, one undo step
  - a copy moves on its own; a recolour inside a copy reaches the original
  - Inspector link info; Make independent; Insert independent copy
  - nested subassembly; cycle refusal
  - ground, typed position, home and reset; suppress
  - tree badges
  - save, reload and duplicate keep everything

**Existing tests changed:**
- `e2e-feature-tree` 13c: "Insert another" now adds a *linked* copy (listed under the same component). A new check, 13c2, covers the independent copy that 13c used to check, so coverage is kept.
- `placement.test.ts`: now expects schema 4 and file version 6.

**Limitations:**
- Instances are stored in full: each copy's parts are saved. Simple and robust, but files grow with the number of copies.
- Matching geometry is not yet shared on the GPU between instances, so very large assemblies draw each copy separately.
- A sketch-based body inside a linked component keeps one sketch for all copies; editing the sketch updates every copy.

### Stage 4F: joints, limits and exploded views (done)

| Item | Result |
| --- | --- |
| Joints | `doc.joints` (schema 4): rigid, hinge (revolute), slider, cylindrical and planar. Each joint has a frame on the fixed part A and on the moving part B. B is placed exactly: world(B) = world(A) · frameA · motion(kind, values) · frameB⁻¹. `solveJoints` (`src/cad/assembly/joints.ts`) runs in the store's change pipeline after link sync, so moving A carries B in the same undo step. Chains are solved parents first. |
| Driving | Each value (angle, slide, across/along) can be typed or set with a slider in the Assembly panel. A drag or typed position of B is projected onto the joint's freedoms: a hinge only turns, a slider only slides, a rigid joint doesn't move. A value the drag didn't change keeps its exact value. |
| Limits | Optional min/max per value. Typed values, sliders and drags stop at the limit, with an "is at its limit" notice. |
| Refused, never approximated | A part moved by two joints; a loop of joints; a joint between nested parts or on a part inside a component (connect the component itself); a grounded moving part; grounding a part a joint moves. Each gives the reason. Deleting a part removes its joints. |
| Creating | Select two parts (fixed first) and press **J** or "+ Joint". The New joint dialog has kind, axis (X/Y/Z), origin (between the parts / centre of either part), and limits (default 0–90° or 0–30 mm). The joint is made at the parts' current places, so nothing jumps. |
| Display | `JointGlyphs`: the axis, a ring for turning joints, an arrow for sliding ones, limit arcs and bars, a square for planar and a cross for rigid. The active joint is highlighted. There is a show/hide toggle. |
| Exploded views | `doc.explodeViews`: named views of ordered steps, each step moving some parts by a world offset. **Display only:** offsets are added when drawing (`SceneNode`), so positions, joints, Booleans, export and print checks always use the assembled design. **Auto** spreads the selection (or everything) outwards, furthest parts first. Steps can be added from the selection, have their offsets typed, be moved earlier or later, and be deleted. A progress slider plays the steps, and "Assembled" resets. The gizmo, resize handles, selection outlines and joint symbols are hidden while exploded. The active view and its progress are interface state, reset when switching projects. |
| Keys | **J** new joint; **G** ground / unground (both in the shortcuts list). |
| Fix found on the way | On a first visit, a design started before project storage was ready was wiped when storage opened. It is now kept, as an unsaved new design. Unit test: `projectInit.test.ts`. |

**Tests added:**
- Unit (`src/cad/assembly/joints.test.ts`, 10):
  - each joint kind's exact pose; limits on typed values and drags; drag projection
  - rigid carry and chains; one undo step
  - refusals: loop, double driver, grounded, self
  - persistence; removal with the part
  - exploded views: offsets add up with progress; display only (positions and export unchanged); reorder and delete; auto; pruning
- `e2e-assemblies` part 2 (26 more checks, 54 in all):
  - hinge 0–90° made with J and the dialog: no jump; typed 45°; 120° stops at 90° with a notice
  - a drag keeps the lid on the hinge; turning past the limit stops it
  - moving the base carries the lid in one undo step
  - slider 0–30 mm (limit, sideways drag projected)
  - rigid follows; cylindrical; planar stays in its plane
  - a double driver is refused
  - auto explode; display only; reorder; typed offset; reset
  - save, reload, duplicate, and switching projects leaves nothing behind

**Limitations:**
- Joint frames come from axis and origin presets (an X/Y/Z axis through a part's centre or between parts). Picking a face to place the frame, and "snap B onto A" mating, are not built yet.
- Explode steps are edited by typing offsets (or Auto), not by dragging with the gizmo in an explode mode.
- Joints are a tree, by design: closed loops (e.g. four-bar linkages) are refused rather than solved.

### Stage 4 status audit (after the review)

Each item was checked against the code and its tests, not the plan. **Complete** means implemented and covered by a passing test. The 4G fixes are included.

**Project lifecycle**

| Item | Status | Tests |
| --- | --- | --- |
| New design (blank, Maker, template) | Complete | e2e-projects 1, 9, 21; projectStore.test |
| Save (asks a name the first time) | Complete | e2e-projects 3–5 |
| Save As (a separate project; the original is unchanged) | Complete | e2e-projects 6; projectStore.test |
| Open design (list with type badges, search) | Complete | e2e-projects 11–13 |
| Recent designs (by last activity, each listed once) | Complete | e2e-projects 14; projectStore.test |
| Rename and duplicate | Complete | e2e-projects 15–16; e2e-platform |
| Delete safely (confirmed; the open design becomes a new one) | Complete | e2e-projects 17; e2e-platform 12b |
| Unsaved-change warnings (Save / Discard / Cancel) | Complete | e2e-projects 7–10, 29 |
| Switching projects leaves no geometry, selection, tool, history or previews behind | Complete | e2e-projects 9; projectStore.test (scope registry); e2e-assemblies 20c |
| Maker project opens in Design Studio as the same project, with its Maker settings | Complete | e2e-projects 23–25; Keyring, Cookie and Vase suites |
| Back to the Maker, continuing the same project (warns before rebuilding over Studio edits) | Complete | e2e-projects 26–28, 30 |
| A new Maker project starts blank | Complete | e2e-projects 29 |
| Recovery of unsaved work after a reload (drafts; projects change only on Save) | Complete | e2e-projects 18–20; projectStore.test |
| First visit keeps work started before storage opened | Complete (4F) | projectInit.test |
| Split Studio projects: saved with their source model, reopened in Split Studio to carry on | Complete (4G; it was partial before) | e2e-projects 32–33; base64.test |

**One visual system**

| Item | Status | Tests |
| --- | --- | --- |
| Keyring, Key Tag, Sign, Cookie, Vase & Planter Makers and Split Studio on the shared navy/purple theme (these are all the Makers) | Complete | e2e-visual (112 checks × 4 screen sizes), designSystem.test |
| Electric-blue accent | Complete (4G): used for info notes, linked-copy markers and joint references | visual review |
| Template thumbnails on the dark workspace | Complete (4G): Vase and Design Studio templates re-rendered dark. The Cookie and Keyring thumbnails show the light artboard, matching the Makers' printable area. | visual review |
| Each Maker keeps its own workflow | Complete | All Maker suites |

**Stage 3 safeguards**

| Item | Status | Tests |
| --- | --- | --- |
| Sketch-controlled bodies can't be stretched away from their sketch: refused with a reason, or made independent with a scaled sketch; extrude height becomes depth | Complete | safeguards.test (6); e2e-sketching 61–63 |
| Spline handles can't create a loop, cusp or fold: the drag is held back, Finish is disabled, and building is refused | Complete | safeguards.test (7); e2e-sketching 59–60 |
| Loft and sweep refuse sketches with spline problems (e.g. from older files) | Complete (4G) | safeguards.test |

### Stage 4G: gaps found in the audit (done)

- Split Studio projects keep the source 3MF (up to 40 MB) and their settings, and reopen in Split Studio. Saving at the Import step splits the model first. Older Split projects, or bigger files, open their parts in the Design Studio as before.
- The assembly browser marks independent components (the tree's ⛓̸ marker; "independent" in the Components list) as well as linked ones (the blue ⛓ count).
- Breaking a link leaves the original and the other copies linked. New check: e2e-assemblies 5b2.
- The loft/sweep spline check, the electric-blue accent and the dark template thumbnails are described in the audit above. The template render script now answers the unsaved-changes question it meets.

**Split Studio check 17 (intermittent failure).** Reproduced: 1 failure in 3 runs under triple load. The cause was the test, not the app. The check clicks the "model pixel nearest the centre" of a 200-pixel-wide downsample of the view. Since 4D's dark background, that pixel is often a blended edge of the white disc, and clicking it can land just outside the model. The test now clicks a point whose whole neighbourhood is model, and fails clearly if there is none. The assertion is unchanged. It then passed 6/6 under the same load.

A second check, 37 (accessibility), failed once under that load. It measured the "Design" nav button mid colour-transition. It now waits for transitions to finish; the contrast rules are unchanged.

### Stage 4H: joints placed from faces and edges (done)

| Item | Result |
| --- | --- |
| Audit | Joints already store exact frames on each part (`frameA`, `frameB`), and the solver, limits, drag projection and persistence work on any frames. So placement from geometry only had to produce those frames: the five joint kinds and their behaviour are unchanged. Bodies are read exactly the same way as the face, edge and hole tools read them. `FaceRef` has no axis for round faces, so axes are fitted from the face itself. |
| References (`src/cad/assembly/references.ts`) | A flat face gives a plane: its centre and outward normal. A cylindrical or conical face gives an axis, fitted from the face's own triangles (eigen-analysis of the normals; least-squares circle for the centre and diameter). A circular edge gives an axis through its centre. A straight edge gives an axis along it. A spherical face gives a point. Torus and free-form faces, and free-form edges, are refused with the reason. |
| Mating | The moving part is placed so its reference meets the fixed part's: two flat faces meet face to face; axes line up. Options: **Reverse direction**, **Gap** along the axis, **Turn** about it, and **Move the moving part onto the fixed part** (on by default; off keeps it where it is). The joint's axis is the fixed part's reference. The rest pose (values 0) is the mated place, so limits are measured from there. |
| Suitability | Planar needs two flat faces. Hinge, slider and cylindrical need an axis (not a sphere). Unsuitable picks say why, and another reference can be picked. Also refused: picks on the same part; moving a part that sits on its sketch's plane; and everything refused before (grounded moving part, loops, double drivers). |
| Panel | New joint is now docked beside the 3D view, so the view can be clicked. **J** (or "+ Joint") opens it. Click a face or edge of the fixed part, then of the moving part. Parts come from the picks, or from the two selected parts. The face or edge under the cursor is highlighted, and picked references are drawn (cyan for the fixed part, pink for the moving part). A see-through preview of the moving part shows where it will go, with the joint axis, before **Create joint**. "Quick axis" keeps the X/Y/Z presets. Esc stops picking, then closes the panel. The gizmo is hidden while picking, and picking never changes the selection. |
| Record | The joint stores the faces or edges it was placed from (`placement`; saved, validated on load, and shown in the joints list). |

**Tests:**
- Unit (`references.test.ts`, 7), on real exact builds:
  - flat face centre and normal
  - a cylinder's axis and diameter (lying on its side)
  - circular-edge and straight-edge axes
  - face-to-face mate, gap and reverse
  - rest pose equals the mated place
  - coaxial pin mate, and "keep where it is"
  - suitability messages
  - eigen solver
- `e2e-assemblies` part 3 (15 checks, 70 in all), all by clicking in the 3D view:
  - plate face + pin side → cylindrical joint (diameter read); preview before change; picking doesn't select
  - pin upright on the face's axis; the joint remembers its faces; driving it turns and slides on that axis
  - face-to-face (turned over), Reverse plus a 4 mm gap
  - planar on a round face refused with the reason, then the rim (circular edge) picked instead as a slider
  - saved and reloaded

**Limitations:**
- The joint's origin is the centre of the picked face (or the fitted centre of an axis), not the exact point clicked.
- If a referenced part is later resized, the joint keeps its frames. The face references are stored, so they can be re-read in a later stage.
- The docked panel covers the left of the view: parts behind it are reached by panning or orbiting.

### Stage 4 final regression

Fresh production build (`dist` removed, `npm run build`, `vite preview`). Full `run-e2e`: **23/23 suites, 957/957 checks, no failures**. That includes Split Studio 58/58 and e2e-assemblies 70/70. Unit tests: 56 files, 536 tests. Format, type-check and lint are clean. Nothing is merged or deployed.

## 10. Implementation order

1 → 2 → 3 → 4 → 5 → 6 → 7 → 8, with a report and approval point after each stage.
