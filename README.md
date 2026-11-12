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
| `npm run e2e` | Real-browser workflow tests (Phase 1 + 2). Start `npm run dev` first. Needs Playwright + Chromium. |

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

Press <kbd>?</kbd> in the app for all keyboard shortcuts.

## Roadmap

| Phase | Scope |
| --- | --- |
| 3 – Advanced modelling | Boolean union/subtract/intersect (Manifold), holes, 3D text, more shapes |
| 4 – File handling | STL/OBJ import and export, local projects (IndexedDB) |
| 5 – Refinement | Performance, accessibility, onboarding, polish |

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the technical design.

## Tech stack

React 19 · TypeScript · Vite · Three.js · React Three Fiber · drei · Zustand + Immer · Tailwind CSS v4 · Lucide · Vitest · Playwright
