# MODELLIO 2.2 — Design Studio professional interface: audit and plan

Branch `modellio-2.2-design-studio`, from `main` @ 1deed2a (MODELLIO 2.1 + landing refinement). Stage 1 of the
brief: audit the existing Studio and plan the work. No application code has been changed yet.

Reference: the supplied mockup (dark CAD shell; tool rail and shape library on the left; Design Browser with Bodies /
Sketches / Features; a compact Loft panel; a tabbed Inspector — Properties, Appearance, Features, Print; a history
timeline). Of the three images described, only the mockup was attached; the "current" state below comes from the code
and the running app.

## 1. What exists and works today

| Area | Today | Where |
| --- | --- | --- |
| Layout | Top bar (Dashboard, Design, Split Studio, Makers, My Projects, Templates, Community (disabled), Help); toolbar; left rail (Shapes, Text, Assets, Workplane, Print, Assistant, Measure) and panel; viewport; history timeline; right Inspector with an Objects tree. Compact layout below ~1024 px with drawers. | `src/app/App.tsx`, `src/components/layout/*`, `toolbar/*` |
| Look | **Light** theme: white panels, `--color-canvas/line/ink/muted/brand` tokens plus hard-coded light colours: about 61 `bg-white`, about 99 arbitrary hex classes and about 410 light token classes across the Studio. The viewport is light too (#f5f7fb background, light grid). | `src/styles/index.css`, components |
| Geometry | Manifold (primitives, live Booleans, mesh tools) plus OpenCascade precise solids (fillet, chamfer, loft, sweep, STEP) in a lazy worker. | `src/cad/**` |
| Document | Flat map of objects: shapes and groups with `parentId` / `children`. Groups are assemblies or **Booleans** (`combine: union / intersect`, with hole children as cutters). Precise solids carry a **feature recipe** `{ base, ops }`: the base is a primitive, sketch, loft, sweep or imported BRep; the ops are fillet and chamfer, with suppression. Profiles carry their sketch. | `src/types/document.ts`, `src/cad/brep/types.ts` |
| Objects tree | A full ARIA tree: expand and collapse, multi-select, rename, show/hide, lock, drag to re-parent and reorder, and keyboard navigation. | `src/components/hierarchy/ObjectTree.tsx` |
| Inspector | One long column (1,133 lines): name, colour, solid or hole, size, position, rotation, the underside tool, shape parameters, hollow, text, mesh tools, sketch, precise solid (operations list with edit, suppress and delete), Booleans, group actions, options (lock proportions, visible, locked). | `src/components/inspector/Inspector.tsx` |
| Viewport | Gizmos for move, rotate and scale; resize handles; snapping and guides; view cube; standard, isometric, perspective and orthographic views; fit and focus; measure; lay flat; edge picking; the solid preview. | `src/viewport/*` |
| Features | Fillet and chamfer panel (over the viewport); Loft and Sweep panel (360 px over the viewport); the sketch editor (full screen). | `src/components/features/*`, `sketch/*` |
| History | Snapshot undo/redo (200 steps, labelled), transactions, and a timeline you can click to jump. | `src/store/history.ts`, `HistoryTimeline.tsx` |
| Tests | 16 Playwright suites (543 checks) and 367 unit tests. The suites rely on **211 accessible names** ("Size X", "Combine", "Export", "Standard views", …) and many test ids. | `scripts/e2e-*.mjs` |

## 2. What can be reused unchanged

All geometry: both kernels, recipes, Booleans and exports. The document model and store actions. Undo and history. Gizmos,
snapping and picking. The edge picker and the previews. The ObjectTree's interaction model, which becomes the base of
the Design Browser. NumberField, IconButton and Popover (restyled through tokens). The print check and mesh report. The
Loft, Sweep, Fillet and Chamfer logic (`solidBuilder.ts`, `featureTool.ts`).

## 3. What needs modifying

1. **Theming (the foundation).** Introduce **semantic Studio tokens** (`--ui-panel`, `--ui-surface`, `--ui-raised`,
   `--ui-edge`, `--ui-fg`, `--ui-fg-muted`, `--ui-accent`, …) exposed as Tailwind colours. Convert Studio components
   from light-specific classes to them. Values come from a scope on the Studio root: `data-ui="studio-dark"`.
   - Shared controls (NumberField, Modal, Popover, Toggle) are also used by the **makers** (about 15 files). Those
     keep the light values outside the Studio scope, so the makers do not change.
   - Converting about 570 class uses is mechanical but large; it is done file by file with screenshots and the suites
     after each group.
2. **Viewport workspace theme:** a dark or light workspace setting (persisted per device). It changes the background,
   fog, grid, axes, lighting balance and selection colours. Contrast is checked, for example dark-blue parts on the
   dark workspace.
3. **Toolbar:** the same actions, regrouped as in the mockup: file (name, save state); history; select, move, rotate
   and scale; create (Sketch, Extrude, Revolve, Loft, Sweep); modify (Fillet, Chamfer, Features); arrange (Group,
   Align, Mirror, Combine); and on the right, Import, Share and Export. Every button maps to an existing action.
   Extrude and Revolve open the sketch editor with that operation chosen. Below about 1280 px groups collapse into
   menus.
4. **Left side:**
   - The rail becomes Shapes, Text, Sketch, Assets, Measure, Print Check, Workplane and Assistant.
   - The shape library becomes collapsible categories: Basic, Advanced, Text & Graphics, Generators, Sketches, My
     Library (assets), Templates.
   - Search covers shapes, generators and tools. Existing 3D thumbnails are kept.
5. **Right side:** the Design Browser on top. Below it, the Inspector in tabs:
   - **Properties:** name, solid or hole, size, position, rotation, shape parameters, lock, visible, locked.
   - **Appearance:** colour, plus a new render-only finish (matte, satin or gloss) and transparency.
   - **Features:** sketch, precise solid, operations, Booleans, hollow, text, mesh tools.
   - **Print:** dimensions, volume, surface area, watertight, open edges, overhangs and thin walls, lay flat.

   Every existing control moves to a tab; none is removed. Accessible names stay the same, so tests change only where
   a control now sits behind a tab.
6. **Feature panels:** one compact **docked panel** design (left of the viewport, about 300 px, collapsible) for
   Fillet, Chamfer, Loft and Sweep: inputs, live status and preview, plain-language errors, Apply and Cancel. The logic
   is unchanged.
7. **History timeline:** restyled as a slim track with step nodes and labels, as in the mockup. It is the same single
   history system.

## 4. What genuinely needs building

**The Design Browser and feature tree, over real relationships.** The document already holds the relationships a
feature tree needs:
- groups → children (components or assemblies);
- Boolean groups → solid bodies plus cutter bodies;
- each precise solid → its base (a primitive, a sketch, a loft's section sketches, a sweep's profile and path, an
  imported STEP solid) → its ordered fillet and chamfer operations;
- profiles → their sketch.

**Stage 3a (no schema change):** the tree is derived live from the document. It is not a second store, so it cannot
drift.
- **Bodies and components:** groups and shapes with the existing select, rename, visibility, lock, drag and delete.
- **Features per body:** the base node, editable where it really is (sketch, loft, sweep; "imported, no history" for
  STEP). Then each fillet and chamfer, with real edit, suppress and delete.
- **Booleans:** a union or intersect node listing solid and cutter bodies.
- **Sketches:** every sketch that drives a body, opening the real sketch editor.
- Icons per type, context menus (only actions that work) and a type filter.

**Stage 3b (needs a schema change, version 4, with migration):** first-class **components**, and **sketches as
standalone document entities** that features reference by id. This lets one sketch drive several features and sketches
exist on their own. It touches serialization, share links, undo and maker handoff, so it is planned separately and only
built after 3a is accepted.

**History ↔ tree:** each history entry also records the ids it changed. One small addition to `pushHistory`, still a
single history. The timeline can then highlight and select what a step affected, and the tree can show what is newest.

**Smaller real additions:** surface area (from the mesh); the render-only appearance finishes and transparency;
"hovered object" highlighting; the workspace theme.

## 5. Mockup elements that are not real today (not built as fake controls)

| In the mockup | Plan |
| --- | --- |
| Notifications bell, global search, account avatar | The avatar shows only when accounts are on (existing); no bell; search lives in the shape library |
| "Thread" generator | Not built: left out, like elsewhere |
| Cookie Cutter / Stamp tiles in Generators | They are makers: shown as links that open the Cookie maker, labelled as such |
| "Components" rail item | Arrives with Stage 3b; until then not shown |
| "Analyse" rail item | Merged into Print Check, which holds the real analysis |
| Material dropdown | A render-only finish (matte, satin, gloss) and transparency, described as appearance only (no physical materials) |

## 6. Risks and how they are contained

- **Makers share UI components and tokens.** Semantic tokens default to the current light values, and only the Studio
  root switches them. The maker suites (keyring, cookie, vase, assets, mobile, platform) run after every stage.
- **Tests depend on accessible names and test ids.** Names and ids are kept. Where a control moves behind an Inspector
  tab, the suites open the tab: a deliberate, documented change that never removes a check.
- **Size of the Inspector change.** It is split into tab components that reuse the existing section components
  unchanged, so behaviour stays identical.
- **The dark viewport hiding dark parts.** Rim lighting, a lighter grid, and a selection colour that contrasts with
  every part colour, plus the light workspace option.
- **Performance.** No new dependencies, and thumbnails are reused. A 200-object scene is timed before and after.
- **Compact screens** (tablets): drawers stay; the Browser and Inspector share one drawer with tabs.

## 7. Stages

| Stage | Contents | Tests |
| --- | --- | --- |
| 2a | Semantic tokens and Studio dark scope; shell, top bar and toolbar regrouped; left rail and shape library categories and search | All 16 suites; screenshots |
| 2b | Right panel: Design Browser (the current tree, restyled) plus the tabbed Inspector; appearance finish and transparency; surface area | All suites (with tab steps added); unit tests for surface area |
| 2c | Viewport: dark or light workspace, grid, selection and hover colours, floating viewport toolbar; docked feature panels; history timeline restyle | `e2e-advanced-cad`, `e2e-studio2`, `e2e-phase1`–`5` |
| 3a | Feature tree derived from document relationships; history entries record affected ids, linked to the tree | New `e2e-feature-tree` plus unit tests for tree derivation |
| 3b | (On approval) schema v4: first-class components and standalone sketches, with migration | Migration, round-trip, share-link and maker-handoff tests |
| 4 | Workflow: hover highlight, snapping and measure refinements, keyboard shortcut review | Targeted suites |
| 5 | Polish, tablet layouts, full regression, performance check, docs | Everything |

Every stage is committed on this branch with a report. Nothing goes to `main` without approval.

## 8. Progress

| Stage | Status | Notes |
| --- | --- | --- |
| 2a | Done | Grouped toolbar (fits without scrolling from 1100 px), rail with Sketch, library in six collapsible categories with one search. |
| 2b | Done | Design Browser with body-type icons above a four-tab Inspector. Finish and transparency are view-only optional shape fields (no schema change, sanitised on load, never exported). Print tab: size, volume (exact for precise solids), surface area, closed-solid check. |
| 2c | Done | Dark or light 3D workspace (a per-browser preference, dark by default). The left tool strip's "Fit to view" duplicated "Focus selected" / "Fit all" and was removed (F still frames). Fillet, Chamfer, Loft and Sweep share one docked, foldable panel. The history timeline is a slim track of step nodes. |
