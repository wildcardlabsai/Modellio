import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { useEditor } from '@/store/editorStore';
import { worldMatrix } from '@/cad/hierarchy';
import { toWorld } from '@/cad/placement';
import { useFacePick } from '@/components/sketch/facePick';

/**
 * The 3D side of picking a face to sketch on: the body's exact faces, the one under the cursor
 * highlighted (flat faces in blue; curved ones grey, as they can't take a sketch), and a click
 * chooses it.
 */
export function SketchFacePicker() {
  const pick = useFacePick((s) => s.pick);
  const object = useEditor((s) => (pick ? s.doc.objects[pick.objectId] : undefined));
  const doc = useEditor((s) => s.doc);
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const [hover, setHover] = useState(-1);

  const mesh = useMemo(() => {
    if (!pick || object?.kind !== 'shape') return null;
    const b = pick.build;
    const map = toWorld(b, object.size, object.mirror, worldMatrix(doc, object.id));
    const pos = new Float32Array(b.positions.length);
    for (let i = 0; i < pos.length; i += 3) pos.set(map(b.positions[i], b.positions[i + 1], b.positions[i + 2]), i);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(b.indices, 1));
    const faceOfTri = new Int32Array(b.indices.length / 3).fill(-1);
    b.faces.forEach((f, fi) => faceOfTri.fill(fi, f.start, f.start + f.count));
    return { geo, faceOfTri, hit: new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })) };
  }, [pick, object, doc]);
  useEffect(() => () => mesh?.geo.dispose(), [mesh]);

  useEffect(() => {
    if (!mesh) return;
    const el = gl.domElement;
    const faceAt = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(
        new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1),
        camera,
      );
      const h = ray.intersectObject(mesh.hit, false)[0];
      return h?.faceIndex != null ? mesh.faceOfTri[h.faceIndex] : -1;
    };
    let down: { x: number; y: number } | null = null;
    const onMove = (e: PointerEvent) => {
      if (e.buttons) return;
      const f = faceAt(e);
      setHover(f);
      el.style.cursor = f >= 0 ? 'pointer' : '';
      invalidate();
    };
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      if (e.button !== 0 || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      const f = faceAt(e);
      if (f >= 0) useFacePick.getState().choose(f);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && useFacePick.getState().cancel();
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      el.style.cursor = '';
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [mesh, gl, camera, invalidate]);

  const hot = useMemo(() => {
    if (!mesh || !pick || hover < 0 || !pick.build.faces[hover]) return null;
    const f = pick.build.faces[hover];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', mesh.geo.getAttribute('position'));
    g.setIndex(new THREE.BufferAttribute(pick.build.indices.slice(f.start * 3, (f.start + f.count) * 3), 1));
    return { g, flat: f.ref.kind === 'plane' };
  }, [mesh, pick, hover]);
  useEffect(() => () => hot?.g.dispose(), [hot]);

  if (!pick || !hot) return null;
  return (
    <mesh geometry={hot.g} renderOrder={12} userData={{ noThumbnail: true }}>
      <meshBasicMaterial
        color={hot.flat ? '#2463EB' : '#98A2B3'}
        transparent
        opacity={0.4}
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-2}
        polygonOffsetUnits={-2}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
