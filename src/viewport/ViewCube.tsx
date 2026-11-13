import { useMemo, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Hud, OrthographicCamera } from '@react-three/drei';
import { viewport } from './viewportBridge';

const CUBE = 62;

function faceTexture(text: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = '#d5dcea';
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, 246, 246);
  ctx.fillStyle = '#344054';
  ctx.font = '600 52px "Inter Variable", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 132);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/*
 * The cube is built in BoxGeometry's native (Y-up) frame and then rotated
 * +90° about X so it matches MODELLIO's Z-up world. With that rotation the
 * material slots map to: +X Right, -X Left, +Y Top, -Y Bottom, +Z Front, -Z Back.
 */
const FACE_LABELS = ['Right', 'Left', 'Top', 'Bottom', 'Front', 'Back'];
const CUBE_ROTATION = new THREE.Euler(Math.PI / 2, 0, 0);

function ViewCubeInner({ mainCamera }: { mainCamera: THREE.Camera }) {
  const size = useThree((s) => s.size);
  const [hover, setHover] = useState<number | null>(null);
  const [cornerHover, setCornerHover] = useState<number | null>(null);
  const group = useMemo(() => new THREE.Group(), []);

  const materials = useMemo(() => FACE_LABELS.map((l) => new THREE.MeshBasicMaterial({ map: faceTexture(l), toneMapped: false })), []);

  const corners = useMemo(() => {
    const out: THREE.Vector3[] = [];
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) out.push(new THREE.Vector3(x, y, z));
    return out;
  }, []);

  useFrame(() => {
    group.quaternion.copy(mainCamera.quaternion).invert();
  });

  materials.forEach((m, i) => m.color.set(hover === i ? '#cfe0ff' : '#ffffff'));

  const onFaceClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (!e.face) return;
    const n = e.face.normal.clone().applyEuler(CUBE_ROTATION).normalize();
    // Avoid a perfectly vertical view direction (degenerate for a Z-up orbit).
    if (Math.abs(n.z) > 0.99) n.y = -1e-4 * Math.sign(n.z || 1);
    viewport.setView(n.normalize());
  };

  return (
    <group position={[size.width / 2 - 72, size.height / 2 - 72, 0]}>
      <primitive object={group}>
        <mesh
          rotation={CUBE_ROTATION}
          material={materials}
          onClick={onFaceClick}
          onPointerMove={(e) => {
            e.stopPropagation();
            setHover(e.face ? Math.floor(e.faceIndex! / 2) : null);
          }}
          onPointerOut={() => setHover(null)}
        >
          <boxGeometry args={[CUBE, CUBE, CUBE]} />
        </mesh>
        {corners.map((c, i) => (
          <mesh
            key={i}
            position={c.clone().multiplyScalar(CUBE / 2)}
            onClick={(e) => {
              e.stopPropagation();
              viewport.setView(c.clone().normalize());
            }}
            onPointerOver={(e) => {
              e.stopPropagation();
              setCornerHover(i);
            }}
            onPointerOut={() => setCornerHover(null)}
          >
            <sphereGeometry args={[6, 12, 12]} />
            <meshBasicMaterial color={cornerHover === i ? '#2463eb' : '#9fb3d6'} transparent opacity={cornerHover === i ? 1 : 0.0} />
          </mesh>
        ))}
        {/* Axis hints */}
        <axesHelper args={[CUBE * 0.9]} position={[-CUBE / 2 - 2, -CUBE / 2 - 2, -CUBE / 2 - 2]} />
      </primitive>
    </group>
  );
}

/** Clickable orientation cube in the top-right corner of the viewport. */
export function ViewCube() {
  const mainCamera = useThree((s) => s.camera);
  return (
    <Hud renderPriority={1}>
      <OrthographicCamera makeDefault position={[0, 0, 200]} near={1} far={1000} />
      <ambientLight intensity={1} />
      <ViewCubeInner mainCamera={mainCamera} />
    </Hud>
  );
}
