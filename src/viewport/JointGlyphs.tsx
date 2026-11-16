import { useMemo } from 'react';
import * as THREE from 'three';
import { Line } from '@react-three/drei';
import { useEditor } from '@/store/editorStore';
import { worldMatrix } from '@/cad/hierarchy';
import { mat } from '@/cad/assembly/joints';
import type { Joint, ModelDocument } from '@/types/document';
import { useAssemblyUi } from '@/components/assembly/assemblyUi';

const DEG = Math.PI / 180;
const COLOR = '#22D3EE';
const ACTIVE = '#F472B6';

/** An arc in the joint's XY plane (its axis is Z), from a to b degrees. */
const arc = (r: number, a: number, b: number, n = 48) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = (a + ((b - a) * i) / n) * DEG;
    return new THREE.Vector3(Math.cos(t) * r, Math.sin(t) * r, 0);
  });

function Glyph({ joint, doc, active }: { joint: Joint; doc: ModelDocument; active: boolean }) {
  const frame = useMemo(() => worldMatrix(doc, joint.a).multiply(mat(joint.frameA)), [doc, joint]);
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  frame.decompose(p, q, new THREE.Vector3());
  const c = active ? ACTIVE : COLOR;
  const len = 18;
  const turns = joint.kind === 'revolute' || joint.kind === 'cylindrical' || joint.kind === 'planar';
  const slides = joint.kind === 'slider' || joint.kind === 'cylindrical';
  const lim = joint.limits;
  return (
    <group position={p} quaternion={q} renderOrder={10} name={`joint-${joint.id}`}>
      {/* Axis */}
      <Line
        points={[
          [0, 0, -len],
          [0, 0, len],
        ]}
        color={c}
        lineWidth={active ? 2.5 : 1.5}
        depthTest={false}
        dashed={joint.suppressed}
      />
      {turns && <Line points={arc(7, 0, 360)} color={c} lineWidth={1.5} depthTest={false} />}
      {turns && lim?.angle && <Line points={arc(9, lim.angle[0], lim.angle[1])} color={ACTIVE} lineWidth={2.5} depthTest={false} />}
      {slides && (
        <Line
          points={[
            [-2.5, 0, len - 5],
            [0, 0, len],
            [2.5, 0, len - 5],
          ]}
          color={c}
          lineWidth={1.5}
          depthTest={false}
        />
      )}
      {slides && lim?.offset && (
        <Line
          points={[
            [0, 0, lim.offset[0]],
            [0, 0, lim.offset[1]],
          ]}
          color={ACTIVE}
          lineWidth={3}
          depthTest={false}
        />
      )}
      {joint.kind === 'planar' && (
        <Line
          points={[
            [-10, -10, 0],
            [10, -10, 0],
            [10, 10, 0],
            [-10, 10, 0],
            [-10, -10, 0],
          ]}
          color={c}
          lineWidth={1}
          depthTest={false}
        />
      )}
      {joint.kind === 'rigid' && (
        <Line
          points={[
            [-4, -4, 0],
            [4, 4, 0],
            [0, 0, 0],
            [-4, 4, 0],
            [4, -4, 0],
          ]}
          color={c}
          lineWidth={1.5}
          depthTest={false}
        />
      )}
    </group>
  );
}

/** Joint axes, turning rings, slide arrows and limits, drawn over the model. */
export function JointGlyphs() {
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const activeJoint = useAssemblyUi((s) => s.activeJoint);
  const show = useAssemblyUi((s) => s.showJoints);
  // Joints sit on the assembled design; an exploded view hides them.
  const exploded = useEditor((s) => !!s.explode && s.explode.progress > 0);
  const joints = Object.values(doc.joints ?? {});
  if (!show || exploded || !joints.length) return null;
  return (
    <group>
      {joints.map((j) => (
        <Glyph key={j.id} joint={j} doc={doc} active={j.id === activeJoint || selection.includes(j.b)} />
      ))}
    </group>
  );
}
