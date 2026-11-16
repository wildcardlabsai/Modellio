import { useEffect, useMemo, useReducer, useState } from 'react';
import * as THREE from 'three';
import { Line } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEditor } from '@/store/editorStore';
import { collectSubtree } from '@/cad/document';
import { worldMatrix } from '@/cad/hierarchy';
import { toWorld } from '@/cad/placement';
import { edgeGeometry, faceGeometry, type RefGeom } from '@/cad/assembly/references';
import { useAssemblyUi, type PickedRef } from '@/components/assembly/assemblyUi';
import { bodyBuild, draftResult, jointPartFor } from '@/components/assembly/jointDraft';
import type { ObjectId, ShapeObject } from '@/types/document';
import { pickableMeshes, viewport } from './viewportBridge';
import { useFeatureTool } from '@/components/features/featureTool';
import { useFacePick } from '@/components/sketch/facePick';

type P3 = [number, number, number];
const EDGE_PX = 8;
const HOVER = '#F59E0B';
const COLOR_A = '#22D3EE';
const COLOR_B = '#F472B6';

interface Hover {
  objectId: ObjectId;
  face?: number;
  edge?: number;
}

/**
 * Picking faces and edges for a new joint (Stage 4H). While the New joint panel waits for a pick,
 * the face or edge of the body under the cursor is highlighted (bodies are read exactly, the same
 * way the face tools do), and a click records it for the fixed part (A) or the moving part (B).
 * Once both are picked, the moving part is previewed where the joint will put it.
 */
export function JointPickTool() {
  const open = useAssemblyUi((s) => s.jointDialog);
  const draft = useAssemblyUi((s) => s.draft);
  const doc = useEditor((s) => s.doc);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const [hover, setHover] = useState<Hover | null>(null);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const picking = open && draft.mode === 'faces' && draft.target !== null;

  // Clicks pick faces while picking (the selection tool is off meanwhile).
  useEffect(() => {
    if (!picking) return;
    const ed = useEditor.getState();
    ed.setTool('edges');
    return () => {
      // After the click that made the last pick has been handled (so it doesn't also select).
      setTimeout(() => {
        if (useEditor.getState().tool === 'edges' && !otherPickActive()) useEditor.getState().setTool('select');
      }, 60);
    };
  }, [picking]);

  useEffect(() => {
    if (!picking) return;
    const el = gl.domElement;
    const ready = () => {
      rerender();
      invalidate();
    };
    const project = (p: THREE.Vector3, rect: DOMRect) => {
      const v = p.clone().project(viewport.camera!);
      return [rect.left + ((v.x + 1) / 2) * rect.width, rect.top + ((1 - v.y) / 2) * rect.height, v.z] as const;
    };
    const find = (e: PointerEvent): Hover | null => {
      const rect = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, viewport.camera!);
      const hit = ray.intersectObjects(pickableMeshes(), false)[0];
      const id = hit?.object.userData.objectId as ObjectId | undefined;
      const d = useEditor.getState().doc;
      const o = id ? d.objects[id] : undefined;
      if (!o || o.kind !== 'shape') return null;
      const entry = bodyBuild(o, ready);
      if (entry.state !== 'ready') return { objectId: o.id };
      const b = entry.build;
      const map = toWorld(b, o.size, o.mirror, worldMatrix(d, o.id));
      // An edge close to the cursor wins over the face under it.
      let best = { i: -1, d: EDGE_PX };
      b.edges.forEach((edge, i) => {
        for (let k = 0; k + 5 < edge.points.length; k += 3) {
          const [ax, ay, az] = project(new THREE.Vector3(...map(edge.points[k], edge.points[k + 1], edge.points[k + 2])), rect);
          const [bx, by, bz] = project(new THREE.Vector3(...map(edge.points[k + 3], edge.points[k + 4], edge.points[k + 5])), rect);
          if (az > 1 || bz > 1) continue;
          const dx = bx - ax;
          const dy = by - ay;
          const t = Math.max(0, Math.min(1, ((e.clientX - ax) * dx + (e.clientY - ay) * dy) / (dx * dx + dy * dy || 1)));
          const dd = Math.hypot(ax + t * dx - e.clientX, ay + t * dy - e.clientY);
          if (dd < best.d) best = { i, d: dd };
        }
      });
      if (best.i >= 0) return { objectId: o.id, edge: best.i };
      // The face: the exact build's triangle under the cursor.
      const exact = ray.intersectObject(worldMesh(o, b, d), false)[0];
      const face =
        exact?.faceIndex == null ? -1 : b.faces.findIndex((f) => exact.faceIndex! >= f.start && exact.faceIndex! < f.start + f.count);
      return face >= 0 ? { objectId: o.id, face } : { objectId: o.id };
    };
    let down: { x: number; y: number } | null = null;
    const onMove = (e: PointerEvent) => {
      if (e.buttons) return;
      const h = find(e);
      setHover(h);
      el.style.cursor = h && (h.face !== undefined || h.edge !== undefined) ? 'pointer' : '';
      invalidate();
    };
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      if (e.button !== 0 || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      const ed = useEditor.getState();
      const ui = useAssemblyUi.getState();
      const h = find(e);
      if (!h) return;
      const o = ed.doc.objects[h.objectId] as ShapeObject;
      const entry = bodyBuild(o, ready);
      if (entry.state === 'error') return ed.notify(entry.why);
      if (entry.state === 'loading') return ed.notify(`Reading the faces of ${o.name}… click again in a moment.`);
      if (h.face === undefined && h.edge === undefined) return;
      const target = ui.draft.target;
      const part = jointPartFor(ed.doc, o.id, target === 'a' ? ui.draft.partA : ui.draft.partB);
      if ('error' in part) return ed.notify(part.error);
      const m = worldMatrix(ed.doc, o.id);
      const geom: RefGeom =
        h.edge !== undefined
          ? edgeGeometry(entry.build, h.edge, o.size, o.mirror, m, o.name)
          : faceGeometry(entry.build, h.face!, o.size, o.mirror, m, o.name);
      const picked: PickedRef = {
        part: part.part,
        geom,
        ref: {
          objectId: o.id,
          label: geom.label,
          ...(h.edge !== undefined ? { edge: entry.build.edges[h.edge].ref } : { face: entry.build.faces[h.face!].ref }),
        },
      };
      ui.choose(picked);
      if (geom.kind === 'none') ed.notify(`${geom.label[0].toUpperCase()}${geom.label.slice(1)}: ${geom.why}`);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    return () => {
      el.style.cursor = '';
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
    };
  }, [picking, gl, invalidate]);

  // The hovered face or edge, in world space.
  const hot = useMemo(() => {
    if (!picking || !hover) return null;
    const o = doc.objects[hover.objectId];
    if (o?.kind !== 'shape') return null;
    const entry = bodyBuild(o, () => undefined);
    if (entry.state !== 'ready') return null;
    const b = entry.build;
    const map = toWorld(b, o.size, o.mirror, worldMatrix(doc, o.id));
    if (hover.edge !== undefined) {
      const e = b.edges[hover.edge];
      const pts: P3[] = [];
      for (let i = 0; i < e.points.length; i += 3) pts.push(map(e.points[i], e.points[i + 1], e.points[i + 2]));
      return { edge: pts };
    }
    if (hover.face === undefined) return null;
    const f = b.faces[hover.face];
    const pos = new Float32Array(f.count * 9);
    let n = 0;
    for (let t = f.start; t < f.start + f.count; t++)
      for (let k = 0; k < 3; k++) {
        const i = b.indices[t * 3 + k] * 3;
        pos.set(map(b.positions[i], b.positions[i + 1], b.positions[i + 2]), n);
        n += 3;
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return { face: g };
  }, [picking, hover, doc]);
  useEffect(() => () => hot?.face?.dispose(), [hot]);

  if (!open || draft.mode !== 'faces') return null;
  return (
    <group userData={{ noThumbnail: true }} name="joint-pick">
      {hot?.face && (
        <mesh geometry={hot.face} renderOrder={12}>
          <meshBasicMaterial
            color={HOVER}
            transparent
            opacity={0.4}
            depthWrite={false}
            side={THREE.DoubleSide}
            polygonOffset
            polygonOffsetFactor={-2}
          />
        </mesh>
      )}
      {hot?.edge && <Line points={hot.edge} color={HOVER} lineWidth={4} depthTest={false} renderOrder={13} />}
      {draft.a && <RefGlyph g={draft.a.geom} color={COLOR_A} />}
      {draft.b && <RefGlyph g={draft.b.geom} color={COLOR_B} />}
      <JointPreview />
    </group>
  );
}

/** A picked reference: a square and its normal for a flat face, a line for an axis, a dot for a point. */
function RefGlyph({ g, color }: { g: RefGeom; color: string }) {
  if (g.kind === 'none') return null;
  const o = new THREE.Vector3(...g.origin);
  if (g.kind === 'point')
    return (
      <mesh position={o} renderOrder={14}>
        <sphereGeometry args={[1.2, 16, 12]} />
        <meshBasicMaterial color={color} depthTest={false} />
      </mesh>
    );
  const z = new THREE.Vector3(...g.axis);
  const a = o.clone().addScaledVector(z, g.kind === 'plane' ? 0 : -14);
  const b = o.clone().addScaledVector(z, 14);
  return (
    <group>
      <Line points={[a, b]} color={color} lineWidth={3} depthTest={false} renderOrder={14} />
      <mesh position={o} renderOrder={14}>
        <sphereGeometry args={[0.9, 12, 10]} />
        <meshBasicMaterial color={color} depthTest={false} />
      </mesh>
    </group>
  );
}

/** The moving part, drawn see-through where the joint will put it, and the joint's axis. */
function JointPreview() {
  const draft = useAssemblyUi((s) => s.draft);
  const doc = useEditor((s) => s.doc);
  const kind = useJointKind();
  const r = useMemo(() => draftResult(doc, draft, kind), [doc, draft, kind]);
  const ghosts = useMemo(() => {
    if (r.state !== 'ok' || !r.moved || !viewport.scene) return [];
    const ids = new Set(collectSubtree(doc, [r.partB]));
    const delta = r.worldB.clone().multiply(worldMatrix(doc, r.partB).invert());
    const out: { key: string; geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }[] = [];
    viewport.scene.traverseVisible((m) => {
      const mesh = m as THREE.Mesh;
      if (!mesh.isMesh || !mesh.userData.pickable || !ids.has(mesh.userData.objectId)) return;
      mesh.updateWorldMatrix(true, false);
      out.push({ key: mesh.uuid, geometry: mesh.geometry, matrix: delta.clone().multiply(mesh.matrixWorld) });
    });
    return out;
  }, [r, doc]);
  if (r.state !== 'ok') return null;
  const p = new THREE.Vector3().setFromMatrixPosition(r.axisWorld);
  const z = new THREE.Vector3(0, 0, 1).transformDirection(r.axisWorld);
  return (
    <group name="joint-preview">
      {ghosts.map((g) => (
        <mesh key={g.key} geometry={g.geometry} matrix={g.matrix} matrixAutoUpdate={false} renderOrder={11}>
          <meshBasicMaterial color={COLOR_B} transparent opacity={0.35} depthWrite={false} />
        </mesh>
      ))}
      <Line
        points={[p.clone().addScaledVector(z, -20), p.clone().addScaledVector(z, 20)]}
        color="#FDE047"
        lineWidth={2}
        dashed
        dashSize={2}
        gapSize={1.5}
        depthTest={false}
        renderOrder={15}
      />
    </group>
  );
}

/** Whether another face / edge picking tool (feature tools, sketch-on-face) has the 'edges' tool. */
const otherPickActive = () => !!useFeatureTool.getState().session || !!useFacePick.getState().pick;

/** The kind chosen in the panel. */
const useJointKind = () => useAssemblyUi((s) => s.draft.kind);

/** A body's exact build as a world-space mesh, for ray picking (cached until it moves or changes). */
const meshes = new Map<ObjectId, { key: string; mesh: THREE.Mesh }>();
function worldMesh(o: ShapeObject, b: import('@/cad/brep/types').BrepBuild, doc: import('@/types/document').ModelDocument) {
  const m = worldMatrix(doc, o.id);
  const key = `${m.elements.join(',')}|${o.size.join(',')}|${b.positions.length}`;
  const have = meshes.get(o.id);
  if (have?.key === key) return have.mesh;
  have?.mesh.geometry.dispose();
  const map = toWorld(b, o.size, o.mirror, m);
  const pos = new Float32Array(b.positions.length);
  for (let i = 0; i < pos.length; i += 3) pos.set(map(b.positions[i], b.positions[i + 1], b.positions[i + 2]), i);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(b.indices, 1));
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  meshes.set(o.id, { key, mesh });
  return mesh;
}
