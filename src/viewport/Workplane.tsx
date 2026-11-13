import { useMemo } from 'react';
import * as THREE from 'three';
import { Grid } from '@react-three/drei';

interface Props {
  size: [number, number];
  showGrid: boolean;
}

/** The build plate: a fine 1 mm grid with 10 mm sections plus X/Y/Z axes, in the XY plane. */
export function Workplane({ size, showGrid }: Props) {
  const [w, h] = size;

  const axes = useMemo(() => {
    const ext = Math.max(w, h) * 0.75;
    const make = (a: THREE.Vector3, b: THREE.Vector3) => new THREE.BufferGeometry().setFromPoints([a, b]);
    return {
      x: make(new THREE.Vector3(0, 0, 0.02), new THREE.Vector3(ext, 0, 0.02)),
      xNeg: make(new THREE.Vector3(-ext, 0, 0.02), new THREE.Vector3(0, 0, 0.02)),
      y: make(new THREE.Vector3(0, 0, 0.02), new THREE.Vector3(0, ext, 0.02)),
      yNeg: make(new THREE.Vector3(0, -ext, 0.02), new THREE.Vector3(0, 0, 0.02)),
      z: make(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, ext * 0.35)),
    };
  }, [w, h]);

  return (
    <group>
      {/* Plate surface, also receives shadows. */}
      <mesh position={[0, 0, -0.05]} receiveShadow renderOrder={-2}>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial color="#eef3fb" roughness={1} metalness={0} />
      </mesh>
      <mesh position={[0, 0, -0.02]} receiveShadow renderOrder={-1}>
        <planeGeometry args={[w, h]} />
        <shadowMaterial transparent opacity={0.12} />
      </mesh>
      {/* drei's Grid lives in its local XZ plane; rotate it into world XY. */}
      {showGrid && (
        <Grid
          rotation={[Math.PI / 2, 0, 0]}
          args={[w, h]}
          cellSize={1}
          cellThickness={0.6}
          cellColor="#c9d4e6"
          sectionSize={10}
          sectionThickness={1}
          sectionColor="#9fb3d6"
          fadeDistance={Math.max(w, h) * 4}
          fadeStrength={1.2}
          side={THREE.DoubleSide}
        />
      )}
      <lineSegments geometry={axes.x}>
        <lineBasicMaterial color="#e5484d" />
      </lineSegments>
      <lineSegments geometry={axes.xNeg}>
        <lineBasicMaterial color="#e5484d" transparent opacity={0.3} />
      </lineSegments>
      <lineSegments geometry={axes.y}>
        <lineBasicMaterial color="#30a46c" />
      </lineSegments>
      <lineSegments geometry={axes.yNeg}>
        <lineBasicMaterial color="#30a46c" transparent opacity={0.3} />
      </lineSegments>
      <lineSegments geometry={axes.z}>
        <lineBasicMaterial color="#2463eb" transparent opacity={0.6} />
      </lineSegments>
    </group>
  );
}
