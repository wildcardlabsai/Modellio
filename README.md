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
| `npm run lint` / `npm run format` | ESLint (TypeScript + React hooks) / Prettier |
| `npm run check` | Typecheck, lint, unit tests and build in one go |
| `npm run e2e` | All real-browser workflow suites against the production build (`npm run build` first; or `E2E_URL=http://localhost:5173 npm run e2e`). Needs Playwright + Chromium. |

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

## Refinement round ✅

**Direct manipulation**
* **Dragging:** drag objects by their body, Tinkercad-style. They slide across the plate and **stack** on whatever
  is under them. Left-dragging an object no longer orbits the camera.
* **Dropping:** shapes dropped onto another object **stand on that face**, aligned with it.
* **Resize handles** (<kbd>R</kbd>): corners, edges and a top height handle. The opposite side stays put,
  <kbd>Shift</kbd> keeps proportions, and sizes snap to the grid.
* **Smart snapping** to neighbours' edges and centres, with pink guide lines.
* **Selection:** <kbd>Shift</kbd>+drag box-selects, and double-click picks a part inside a combination (including holes).

**3D printing**
* **3MF export**, with millimetres, object names and colours.
* **Lay flat** (<kbd>L</kbd>): click any face to put it on the plate.
* **Print panel:** overhang, thin-wall, floating, below-plate and off-plate checks, with 3D highlights.
* **Hollow (shell)** with a wall thickness and an optional open top, plus **chamfered** box edges.

**Product**
* **Templates:** six editable starter designs.
* **Share links:** a view-only copy that lives in the link itself, and recipients can make their own copy.
* **mm / inch** display units (designs are always stored in mm).
* **Version history:** automatic snapshots plus every <kbd>Ctrl/⌘ S</kbd>; restoring is undoable.
* **Tablets:** panels become drawers, and touch works for tap, drag and orbit.
* **Optional cloud projects with Supabase:** sign in with a magic link. Projects are protected by row-level security,
  and your browser projects can be copied to your account. See *Cloud projects* below.

**Quality**
* **Booleans in a Web Worker,** so the UI stays responsive.
* **Smaller download:** split vendor chunks and lazy-loaded panels, dialogs and font engine (≈398 kB gzip initial).
* **Error boundaries** with recovery and an emergency backup. Persistent storage is requested, and a full disk is handled.
* **Accessibility:** keyboard tree navigation, a screen-reader announcer, dialog focus traps, reduced motion and
  WCAG AA contrast. axe-core reports no serious issues.
* **First-run guided tour** (Help → Take the tour).
* **Engineering:** ESLint, Prettier, and GitHub Actions CI running typecheck, lint, format, unit and all browser suites.

Press <kbd>?</kbd> in the app for all keyboard shortcuts.

## Landing page and studios

`/` is the landing page: product overview, the live studios, the coming-soon studios (Sign Generator,
Organiser Generator, Box & Lid Maker, Lithophane Studio), features, templates and FAQ.

| URL | Opens |
| --- | --- |
| `/` | Landing page |
| `/?studio=design` | Design Studio (the editor). Share links (`#share=…`) open here too |
| `/?studio=split` | Split Studio |
| `/?studio=cookie` | Cookie Cutter & Stamp Maker |
| `/?studio=vase` | Vase Maker |
| `/?studio=keyring` | Keyring & Name Tag Maker |

The landing screenshots are real captures of the app: `node scripts/render-landing-images.mjs` (against `vite preview`).

## Split Studio ✅

A second workspace (**Split Studio** on the landing page and in the top bar, or `/?studio=split`) for printing multi-colour
designs as separate single-colour parts: **Import → Split → Connect → Export**.

* **Import:** a fast streaming 3MF reader in a Web Worker, checked against the official lib3mf library in tests. It reads objects,
  components, units, materials, colour groups, Bambu/Orca/Prusa filaments and painted triangles, and reports anything approximated.
* **Split:** each colour becomes a closed solid. Paint is split exactly, shared joint faces mate exactly, and thin painted
  areas become inlays with matching pockets. Every part is validated.
* **Connect:** round pegs and blind sockets on joint faces, with checks for wall thickness and break-through.
* **Export:** parts laid flat and packed onto plates for your printer; download a 3MF per plate, an STL per part and a README.

Design notes and limits: [docs/SPLIT_STUDIO.md](docs/SPLIT_STUDIO.md).

## Maker design canvas

The keyring and cookie makers share a 2D design space (`src/makers/canvas`), so a design is edited where it is made:

* **Add** shapes (25+), text in any bundled font, uploads (SVG, or a picture traced automatically) and freehand drawing.
* **Arrange** on a millimetre grid: drag to move (snaps to 0.5 mm and the centre lines), corner handles resize in
  proportion (Shift to stretch), the top handle rotates (Shift snaps to 15°); arrow keys nudge, Delete, Ctrl+D duplicates.
* **Roles** say what each item does in that maker (raised, engraved, a hole, stamp-only detail…), set in the inspector,
  which also takes exact positions, sizes and angles. Layers, undo/redo per gesture, and the design is remembered.
* A **live 3D preview** sits beside the canvas (or full size with the 3D view), with the built outline drawn on the canvas.
* **Open a copy in Design Studio** for anything the maker can't do; a bar there leads back to the maker, design intact.

## Keyring & Name Tag Maker ✅

`/?studio=keyring`. **28 templates** (name tags, pets, bags & keys, badges & gifts) or **start blank**.

* Each item is **raised**, **engraved**, **flush** (a two-colour inlay you can't feel), part of the **plate**, or a **hole**.
* The tag either follows the content (a rounded bubble with a set margin) or takes the shape of the plate items.
* A draggable, reinforced **key ring hole** (size and wall), an optional **border**, thickness and heights.
* **Two colours**: separate base and top parts in the 3MF for an AMS/MMU, plus the exact height for a filament change on
  one nozzle. Warns about detached rings, thin walls, small holes and lettering too fine to print.
* Thumbnails: `node scripts/render-keyring-thumbnails.mjs`. Tests: `src/makers/keyring/keyring.test.ts`,
  `scripts/e2e-keyring.mjs`.

## Cookie Cutter & Stamp Maker ✅

`/?studio=cookie`. **25 templates** (shapes, names & words, seasonal, celebrations) or **start blank**, on the design canvas.

* **Design with** built-in shapes (heart, star, gingerbread person and more), names in any bundled font, an SVG logo, or a
  picture (PNG/JPG, traced automatically) — drop a file anywhere on the maker to add it.
* **Roles:** "Cookie shape" makes the outline and is stamped; "Outline only" makes the outline (a plain round behind a
  message); "Stamp detail" is only pressed into the dough. An outline margin joins separate letters into one cookie.
* **Makes** a cutter (thin blade on a wide flange, printed flange-down), a stamp that fits inside it with the design raised
  as lines or filled shapes (printed face-up, no supports), and a separate handle that press-fits a blind socket.
* **Mirrored for printing** by default, so the cookie comes out the right way round after you flip the cutter and stamp over.
* **Warns** about pieces that are narrower than 5 mm, outlines that make several cookies, and cutters too large for a plate.
* Downloads all parts as one 3MF or each as an STL. Thumbnails: `node scripts/render-cookie-thumbnails.mjs`.

Code: `src/makers/cookie` (geometry with Manifold 2D offsets and extrusion; tests in `cookie.test.ts`, browser suite
`scripts/e2e-cookie.mjs`).

## Vase Maker ✅

`/?studio=vase` (Makers menu or the landing page). Vases, plant pots, bowls and lampshades.

* **32 templates** in four categories (vases, planters, bowls & pots, lampshades), each just a set of editable settings,
  plus **Surprise me** for a random printable design.
* **Start blank** and shape it yourself: a side-profile curve with draggable points (add, remove, keyboard nudging),
  6 cross-sections (round, polygon, star, flower, gear, squircle) with sides, depth and rounding, twist (even, eased,
  there-and-back) and 7 surface patterns (ribs, spiral, waves, diamond, bubbles, organic, steps) with depth, count,
  rows, turns and sharpness.
* **Vase mode** (a solid for the slicer's spiral mode) or real walls with a true offset, so stars and flowers keep their
  wall thickness. Plant pots get 1 or 5 drainage holes and a matching saucer; lampshades a lamp-holder hole.
* Shows size, **capacity** and the **steepest overhang**, and warns about drooping overhangs, thin walls, narrow
  openings and tippy shapes. Undo/redo, remembered designs, finer mesh for downloads (3MF or STL), and
  "Open a copy in Design Studio".
* Builds run in a Web Worker so dragging stays smooth. Thumbnails: `node scripts/render-vase-thumbnails.mjs`.

## Cloud projects (optional)

Without configuration, projects are stored in the browser (IndexedDB). To enable accounts and cloud sync:

1. Create a Supabase project and apply `supabase/migrations/0001_projects.sql`. It creates the `projects` table, the
   row-level security policies and a private `projects` storage bucket.
2. Copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
3. Enable email (magic link) sign-in in Supabase Auth, and add your site URL to the redirect URLs.

The Supabase client is only downloaded when this is configured.

## Roadmap

| Phase | Scope |
| --- | --- |
| Later | STEP via OpenCascade WASM, real-time collaboration, community gallery, PWA / offline install |
| 5 – Refinement | Performance, accessibility, onboarding, polish |

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the technical design.

## Tech stack

React 19 · TypeScript · Vite · Three.js · React Three Fiber · drei · Manifold (WASM) · opentype.js · fflate · Zustand + Immer · Tailwind CSS v4 · Lucide · Supabase (optional) · Vitest · Playwright · axe-core · ESLint · Prettier
