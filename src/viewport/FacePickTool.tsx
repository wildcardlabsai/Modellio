import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { useEditor } from '@/store/editorStore';
import { worldMatrix } from '@/cad/hierarchy';
import { pickMode, sameRef, useFeatureTool } from '@/components/features/featureTool';
import type { Vec3 } from '@/types/document';
import { fromWorld, toWorld } from './EdgePickTool';

/**
 * Face picking for Shell, Draft and Hole: highlights the face of the precise solid under the
 * cursor and, on click, chooses it (Shell, Draft) or places the hole at the clicked point of a flat
 * face. Chosen faces are tinted; the hole position is marked.
 */
export function FacePickTool() {
  const session = useFeatureTool((s) => s.session);
  const object = useEditor((s) => (session ? s.doc.objects[session.objectId] : undefined));
  const doc = useEditor((s) => s.doc);
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const [hover, setHover] = useState(-1);
  const mode = session ? pickMode(session.kind) : null;
  const active = mode === 'faces' || mode === 'point';

  /** The solid as it was before this operation, placed in world space, plus which face each triangle belongs to. */
  const pick = useMemo(() => {
    const b = session?.before;
    if (!active || !b || object?.kind !== 'shape') return null;
    const matrix = worldMatrix(doc, object.id);
    const map = toWorld(b, object.size, object.mirror, matrix);
    const pos = new Float32Array(b.positions.length);
    for (let i = 0; i < pos.length; i += 3) pos.set(map(b.positions[i], b.positions[i + 1], b.positions[i + 2]), i);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(b.indices, 1));
    const faceOfTri = new Int32Array(b.indices.length / 3).fill(-1);
    b.faces.forEach((f, fi) => faceOfTri.fill(fi, f.start, f.start + f.count));
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    return { geo, mesh, faceOfTri, back: fromWorld(b, object.size, object.mirror, matrix), map, half: b.half };
  }, [active, session?.before, object, doc]);
  useEffect(() => () => pick?.geo.dispose(), [pick]);

  useEffect(() => {
    if (!session || !pick) return;
    const el = gl.domElement;
    const hit = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, camera);
      const h = ray.intersectObject(pick.mesh, false)[0];
      if (!h || h.faceIndex == null) return null;
      const fi = pick.faceOfTri[h.faceIndex];
      return fi >= 0 ? { fi, point: h.point } : null;
    };
    let down: { x: number; y: number } | null = null;
    const onMove = (e: PointerEvent) => {
      if (e.buttons) return;
      const h = hit(e);
      setHover(h?.fi ?? -1);
      el.style.cursor = h ? 'pointer' : '';
      invalidate();
    };
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      if (e.button !== 0 || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      const h = hit(e);
      const s = useFeatureTool.getState().session;
      if (!h || !s?.before) return;
      const face = s.before.faces[h.fi].ref;
      if (pickMode(s.kind) === 'faces') useFeatureTool.getState().toggleFace(face);
      else if (face.kind !== 'plane') useEditor.getState().notify('Holes go into flat faces. Click a flat face.');
      else {
        const local = pick.back(h.point);
        const at = local.map((v, i) => Math.round((v / pick.half[i]) * 1e6) / 1e6) as Vec3;
        useFeatureTool.getState().placeHole(face, at);
      }
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    return () => {
      el.style.cursor = '';
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointerdown', onDown);
    };
  }, [session, pick, gl, camera, invalidate]);

  /** One geometry per highlighted face (chosen ones and the one under the cursor). */
  const overlays = useMemo(() => {
    if (!pick || !session?.before) return [];
    const b = session.before;
    const chosen = mode === 'faces' ? session.faces : session.hole.face ? [session.hole.face] : [];
    const list = b.faces
      .map((f, fi) => ({ fi, f, sel: chosen.some((c) => sameRef(c, f.ref)), hot: fi === hover }))
      .filter((x) => x.sel || x.hot);
    return list.map(({ fi, f, sel, hot }) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', pick.geo.getAttribute('position'));
      g.setIndex(new THREE.BufferAttribute(b.indices.slice(f.start * 3, (f.start + f.count) * 3), 1));
      return { key: `${fi}-${sel}-${hot}`, g, sel, hot };
    });
  }, [pick, session?.before, session?.faces, session?.hole.face, mode, hover]);
  useEffect(() => () => overlays.forEach((o) => o.g.dispose()), [overlays]);

  if (!session || !pick) return null;
  const at =
    mode === 'point' && session.hole.at ? pick.map(...(session.hole.at.map((v, i) => v * pick.half[i]) as [number, number, number])) : null;
  return (
    <group userData={{ noThumbnail: true }}>
      {overlays.map((o) => (
        <mesh key={o.key} geometry={o.g} renderOrder={12}>
          <meshBasicMaterial
            color={o.sel ? '#E11D48' : '#F59E0B'}
            transparent
            opacity={o.sel ? 0.45 : 0.3}
            depthWrite={false}
            polygonOffset
            polygonOffsetFactor={-2}
            polygonOffsetUnits={-2}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
      {at && (
        <mesh position={at} renderOrder={13} name="hole-marker">
          <sphereGeometry args={[0.6, 16, 12]} />
          <meshBasicMaterial color="#E11D48" depthTest={false} />
        </mesh>
      )}
    </group>
  );
}
