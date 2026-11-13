<p align="center"><img src="public/logo-dark.png" alt="modellio" height="56"></p>

<p align="center"><strong>Make anything. Shape everything.</strong><br>
A free, browser-based 3D CAD modeller for beginners, hobbyists, makers and 3D-printing enthusiasts.</p>

---

MODELLIO is a real interactive CAD application. It is **not** an AI text-to-3D generator. Every object is
genuine, watertight 3D geometry measured in millimetres.

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Type-check and build for production (`dist/`) |
| `npm run typecheck` | TypeScript only |
| `npm test` | Unit tests (geometry, transforms, store, undo/redo) |
| `npm run e2e` | Real-browser workflow tests (Phases 1–4). Start `npm run dev` first. Needs Playwright + Chromium. |

## Phase 1 status: foundation ✅

* Full-screen CAD workspace: header, toolbar, tool rail, shape library, 3D viewport and inspector.
* Z-up millimetre workplane (200 × 200 mm) with a 1 mm / 10 mm grid and X/Y/Z axes.
* Orbit, pan and zoom-to-cursor; an animated view cube; Home and standard views; fit to selection or scene (F).
* 11 parametric primitives, added by click or drag-and-drop: box, cylinder, sphere, cone, pyramid, roof,
  torus, tube, wedge, half sphere and polygon. All are verified watertight with exact dimensions.
* Selection by click, Shift/Ctrl+click for multi-select, click on empty space to deselect. Orbiting never changes the selection.
* Move, rotate and resize gizmo (W / E / R) with mm and degree snapping. A whole drag is one undo step.
* Live bounding box, dimension labels and an elevation indicator.
* Inspector: exact size, position and rotation (fields accept arithmetic like `20+5`), shape
  parameters, colour, lock proportions, visibility and locking. There is also a scene object list.
* Duplicate (Ctrl/⌘ D), delete (Del), undo (Ctrl/⌘ Z), redo (Ctrl/⌘ ⇧ Z), arrow-key nudge and drop to workplane (D).

## Phase 2 status: core CAD ✅

* **Scene hierarchy:** real nested groups. Transforms are relative to the parent group, and grouping
  and ungrouping never move anything in 3D.
* **Object tree:** select (synchronised with the viewport), Shift for range and Ctrl/⌘ for toggle,
  expand and collapse, double-click to rename, hide/show, lock (inherited by children), delete,
  and drag-and-drop to reorder or move objects into and out of groups.
* **Groups in the viewport:** click selects the whole group and double-click selects a part
  inside it. Groups can be moved, rotated and resized with the gizmo or with exact sizes in the inspector.
  Resizing rewrites the real dimensions of every part, and groups containing parts at odd angles
  resize uniformly so no shear is introduced.
* **Align:** left/centre/right, front/centre/back and bottom/middle/top. A single object aligns to the workplane.
  There is also **distribute** with equal gaps on X/Y/Z.
* **Mirror X/Y/Z:** genuinely reflected geometry. Triangle winding is corrected so meshes stay watertight.
* **Clipboard:** copy, cut and paste (Ctrl/⌘ C/X/V), including whole groups. Repeated pastes cascade.
* **Workplane panel:** plate size with common printer presets, grid toggle, and snap steps.
* Undo/redo covers all of the above.

## Phase 3 status: advanced modelling ✅

* **Real Boolean operations** with the Manifold kernel (WASM), whose output is guaranteed watertight:
  **Union**, **Subtract** and **Intersect** from the Combine menu, the toolbar or the multi-selection inspector.
* **Holes:** press <kbd>H</kbd> or use the Solid/Hole switch. Holes render as translucent grey cutters and are cut
  from the solids when combined.
* **Combinations stay editable.** Select any part in the Objects tree, edit it, and the result updates
  live. You can switch a group between Assembly, Union and Intersect at any time, and ungroup gives the parts back.
  The inspector reports a watertight result with its triangle count, or explains why a combination failed
  (for example, an empty result).
* **Flatten to mesh** bakes a combination into one fixed solid. **Separate parts** splits a mesh into its
  disconnected pieces, in place.
* **3D text:** six bundled fonts (Inter, Inter Bold, Roboto Slab, Bebas Neue, Pacifico, Space Mono; all OFL),
  multi-line, with editable content, font and size. Text is built by the kernel, so it is always a valid solid,
  even in script fonts with overlapping strokes. Make text a hole to engrave it.
* **New shapes:** star, capsule and paraboloid, plus a **fillet radius** (rounded edges) on the box.
* **Measure tool** (<kbd>M</kbd>): click two points to read the distance and ΔX/ΔY/ΔZ. Points snap to corners.

## Phase 4 status: file handling ✅

* **Export STL** (binary or text) and **OBJ** (one named object per part, optional `.mtl` colours), in millimetres.
  - Boolean combinations are exported as their real result, and every transform is applied.
  - Choose everything or just the selection, and Z-up (slicers) or Y-up (3D apps).
  - Before you download, a summary shows the object count, triangles and overall size, plus checks for watertightness,
    loose holes, parts below the workplane and parts beyond the plate.
* **Import STL / OBJ** with the Import button, <kbd>Ctrl/⌘ O</kbd>, or by dropping files onto the viewport.
  - Units (mm/cm/inch/m) and up axis are detected: models smaller than 1 unit are assumed to be in metres,
    and OBJ files are assumed to be Y-up. You can override both.
  - The dialog previews the final size in mm and reports whether the mesh is watertight.
  - Multi-object OBJ files come in as a group, or merged if you choose.
  - Imported meshes are full citizens: you can move, resize, mirror and align them, and combine them if they are watertight.
* **Projects** saved in this browser (IndexedDB):
  - Autosave with a *Saved / Unsaved / Saving…* indicator, plus <kbd>Ctrl/⌘ S</kbd>.
  - Reopens where you left off, and saves when the tab is hidden.
  - **My Projects:** thumbnails, new, open, rename, duplicate and delete (with confirmation).
  - **Project files (.modellio):** download a self-contained backup (design and meshes) and open it on any computer.
    Corrupt or unknown files are rejected with a clear message.
  - Everything is preserved: geometry, imported meshes, transforms, colours, holes, groups and combinations, text, mirror and plate size.

Press <kbd>?</kbd> in the app for all keyboard shortcuts.

## Roadmap

| Phase | Scope |
| --- | --- |
| Later | 3MF export (colours, multi-material), STEP via OpenCascade WASM, Supabase accounts and cloud projects |
| 5 – Refinement | Performance, accessibility, onboarding, polish |

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the technical design.

## Tech stack

React 19 · TypeScript · Vite · Three.js · React Three Fiber · drei · Manifold (WASM) · opentype.js · Zustand + Immer · Tailwind CSS v4 · Lucide · Vitest · Playwright
