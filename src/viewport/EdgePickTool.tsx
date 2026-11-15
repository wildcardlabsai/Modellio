import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { useEditor } from '@/store/editorStore';
import { worldMatrix } from '@/cad/hierarchy';
import { pickMode, sameRef, useFeatureTool } from '@/components/features/featureTool';
import type { BrepBuild, EdgeRef } from '@/cad/brep/types';
import type { Vec3 } from '@/types/document';
import { FastLine } from './FastLine';
import { pickableMeshes, viewport } from './viewportBridge';

type P3 = [number, number, number];

/** Map a build's local points to world space exactly as the displayed mesh is placed (fit to size, mirror, transform). */
export function toWorld(build: BrepBuild, size: Vec3, mirror: Vec3 | undefined, matrix: THREE.Matrix4) {
  const box = new THREE.Box3();
  const p = build.positions;
  for (let i = 0; i < p.length; i += 3) box.expandByPoint(new THREE.Vector3(p[i], p[i + 1], p[i + 2]));
  const c = box.getCenter(new THREE.Vector3());
  const e = box.getSize(new THREE.Vector3());
  const s = [e.x > 1e-9 ? size[0] / e.x : 1, e.y > 1e-9 ? size[1] / e.y : 1, e.z > 1e-9 ? size[2] / e.z : 1];
  const m = mirror ?? [1, 1, 1];
  const v = new THREE.Vector3();
  return (x: number, y: number, z: number): P3 => {
    v.set((x - c.x) * s[0] * m[0], (y - c.y) * s[1] * m[1], (z - c.z) * s[2] * m[2]).applyMatrix4(matrix);
    return [v.x, v.y, v.z];
  };
}

/** The inverse of `toWorld`: a world point back to the build's local coordinates. */
export function fromWorld(build: BrepBuild, size: Vec3, mirror: Vec3 | undefined, matrix: THREE.Matrix4) {
  const box = new THREE.Box3();
  const p = build.positions;
  for (let i = 0; i < p.length; i += 3) box.expandByPoint(new THREE.Vector3(p[i], p[i + 1], p[i + 2]));
  const c = box.getCenter(new THREE.Vector3());
  const e = box.getSize(new THREE.Vector3());
  const s = [e.x > 1e-9 ? size[0] / e.x : 1, e.y > 1e-9 ? size[1] / e.y : 1, e.z > 1e-9 ? size[2] / e.z : 1];
  const m = mirror ?? [1, 1, 1];
  const inv = matrix.clone().invert();
  return (w: THREE.Vector3): P3 => {
    const v = w.clone().applyMatrix4(inv);
    return [v.x / (s[0] * m[0]) + c.x, v.y / (s[1] * m[1]) + c.y, v.z / (s[2] * m[2]) + c.z];
  };
}

const PICK_PX = 10;

/**
 * Edge picking for Fillet / Chamfer: draws the real edges of the precise solid, highlights the
 * visible edge under the cursor, and toggles it on click. Selected edges are drawn thick blue.
 */
export function EdgePickTool() {
  const session = useFeatureTool((s) => s.session);
  const tool = useEditor((s) => s.tool);
  const object = useEditor((s) => (session ? s.doc.objects[session.objectId] : undefined));
  const doc = useEditor((s) => s.doc);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const [hover, setHover] = useState<number>(-1);

  // Leaving the tool any other way (Esc, another tool, object deleted) cancels the session.
  useEffect(() => {
    if (session && (tool !== 'edges' || !object)) useFeatureTool.getState().cancel();
  }, [session, tool, object]);

  const edgeMode = !!session && pickMode(session.kind) === 'edges';
  const edges = useMemo(() => {
    if (!edgeMode || !session?.before || object?.kind !== 'shape') return [];
    const map = toWorld(session.before, object.size, object.mirror, worldMatrix(doc, object.id));
    return session.before.edges.map((e) => {
      const pts: P3[] = [];
      for (let i = 0; i < e.points.length; i += 3) pts.push(map(e.points[i], e.points[i + 1], e.points[i + 2]));
      return { ref: e.ref, pts };
    });
  }, [edgeMode, session?.before, object, doc]);

  useEffect(() => {
    if (!session || !edges.length) return;
    const el = gl.domElement;
    const project = (p: P3, rect: DOMRect) => {
      const v = new THREE.Vector3(...p).project(viewport.camera!);
      return [rect.left + ((v.x + 1) / 2) * rect.width, rect.top + ((1 - v.y) / 2) * rect.height, v.z] as const;
    };
    /** Nearest point on the edge to the cursor in screen space: distance (px) and the 3D point. */
    const nearest = (pts: P3[], x: number, y: number, rect: DOMRect) => {
      let best = Infinity;
      let at: P3 = pts[0];
      for (let i = 0; i + 1 < pts.length; i++) {
        const [ax, ay, az] = project(pts[i], rect);
        const [bx, by, bz] = project(pts[i + 1], rect);
        if (az > 1 || bz > 1) continue;
        const dx = bx - ax;
        const dy = by - ay;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
        const d = Math.hypot(ax + t * dx - x, ay + t * dy - y);
        if (d < best) {
          best = d;
          const a = pts[i];
          const b = pts[i + 1];
          at = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])];
        }
      }
      return { d: best, at };
    };
    /** An edge point is visible when nothing pickable sits in front of it. */
    const visible = (p: P3) => {
      const cam = viewport.camera!;
      const origin = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
      const target = new THREE.Vector3(...p);
      const isOrtho = (cam as THREE.OrthographicCamera).isOrthographicCamera;
      const dir = isOrtho ? new THREE.Vector3(0, 0, -1).transformDirection(cam.matrixWorld) : target.clone().sub(origin).normalize();
      if (isOrtho) origin.copy(target).addScaledVector(dir, -10000);
      const dist = origin.distanceTo(target);
      const hits = new THREE.Raycaster(origin, dir, 0, dist + 1).intersectObjects(pickableMeshes(), false);
      const tol = Math.max(0.05, dist * 0.002);
      return !hits.length || hits[0].distance >= dist - tol;
    };
    const pick = (e: PointerEvent): number => {
      const rect = el.getBoundingClientRect();
      const selected = useFeatureTool.getState().session?.edges ?? [];
      const ranked = edges
        .map((edge, i) => ({ i, ...nearest(edge.pts, e.clientX, e.clientY, rect), sel: selected.some((s) => sameRef(s, edge.ref)) }))
        .filter((c) => c.d <= PICK_PX)
        .sort((a, b) => a.d - b.d);
      // Selected edges can always be un-picked (the preview may have rounded them away).
      return ranked.find((c) => c.sel || visible(c.at))?.i ?? -1;
    };
    let down: { x: number; y: number } | null = null;
    const onMove = (e: PointerEvent) => {
      if (e.buttons) return;
      const i = pick(e);
      setHover(i);
      el.style.cursor = i >= 0 ? 'pointer' : '';
      invalidate();
    };
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      if (e.button !== 0 || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      const i = pick(e);
      if (i >= 0) useFeatureTool.getState().toggleEdge(edges[i].ref);
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
  }, [session, edges, gl, invalidate]);

  if (!session || !edges.length) return null;
  const isSel = (ref: EdgeRef) => session.edges.some((s) => sameRef(s, ref));
  return (
    <group userData={{ noThumbnail: true }}>
      {edges.map((e, i) => {
        const sel = isSel(e.ref);
        const hot = i === hover;
        return (
          <FastLine
            key={i}
            points={e.pts}
            color={sel ? '#E11D48' : hot ? '#F59E0B' : '#F8FAFC'}
            lineWidth={sel || hot ? 4 : 2}
            depthTest={false}
            transparent
            opacity={sel || hot ? 1 : 0.85}
            renderOrder={sel || hot ? 11 : 10}
          />
        );
      })}
    </group>
  );
}
