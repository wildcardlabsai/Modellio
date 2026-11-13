import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { VIEW_DIRECTIONS, viewport } from './viewportBridge';
import { useEditor } from '@/store/editorStore';
import { selectionBounds, sceneBounds } from './bounds';

interface Animation {
  fromDir: THREE.Vector3;
  toDir: THREE.Vector3;
  fromDist: number;
  toDist: number;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  t: number;
}

const DURATION = 0.45; // seconds
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Orbit / pan / zoom camera with animated standard views.
 * Left-drag: orbit · Right-drag (or Shift+left): pan · Wheel: zoom to cursor.
 */
export function CameraController() {
  const controls = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  const anim = useRef<Animation | null>(null);
  const frameRequest = useEditor((s) => s.frameRequest);

  useEffect(() => {
    viewport.camera = camera;
    viewport.domElement = gl.domElement;
    viewport.renderer = gl;
    viewport.scene = scene;
    viewport.orbitControls = controls.current;

    const start = (toDir: THREE.Vector3, toTarget: THREE.Vector3, toDist: number) => {
      const c = controls.current;
      if (!c) return;
      const offset = camera.position.clone().sub(c.target);
      anim.current = {
        fromDir: offset.clone().normalize(),
        toDir: toDir.clone().normalize(),
        fromDist: offset.length(),
        toDist,
        fromTarget: c.target.clone(),
        toTarget: toTarget.clone(),
        t: 0,
      };
      invalidate();
    };

    viewport.captureThumbnail = () => {
      try {
        // Hide gizmos, selection boxes and measurements, render once, read pixels back.
        const hidden: THREE.Object3D[] = [];
        scene.traverse((o) => {
          if (o.userData.noThumbnail && o.visible) {
            o.visible = false;
            hidden.push(o);
          }
        });
        // Dedicated camera: the whole model from the standard 3/4 view, whatever the user is looking at.
        const box = new THREE.Box3();
        scene.traverseVisible((o) => {
          if ((o as THREE.Mesh).isMesh && o.userData.pickable) box.expandByObject(o);
        });
        if (box.isEmpty()) box.set(new THREE.Vector3(-50, -50, 0), new THREE.Vector3(50, 50, 10));
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        const src = gl.domElement;
        const shot = new THREE.PerspectiveCamera(30, src.width / src.height, 0.5, 20000);
        shot.up.set(0, 0, 1);
        // Fit to the 16:10 region that is cropped out of the canvas below.
        const cropH = Math.min(src.height, (src.width * 10) / 16);
        const cropW = (cropH * 16) / 10;
        const tanHalfV = Math.tan(THREE.MathUtils.degToRad(shot.fov) / 2);
        const tanV = tanHalfV * (cropH / src.height);
        const tanH = tanHalfV * shot.aspect * (cropW / src.width);
        const dist = (Math.max(sphere.radius, 8) / Math.sin(Math.atan(Math.min(tanV, tanH)))) * 1.04;
        shot.position.copy(sphere.center).addScaledVector(VIEW_DIRECTIONS.home, dist);
        shot.lookAt(sphere.center);
        shot.updateMatrixWorld();
        gl.render(scene, shot);
        // Centre-crop to the 16:10 card shape.
        const w = 320;
        const h = 200;
        const srcH = Math.min(src.height, (src.width * h) / w);
        const srcW = (srcH * w) / h;
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        c.getContext('2d')!.drawImage(src, (src.width - srcW) / 2, (src.height - srcH) / 2, srcW, srcH, 0, 0, w, h);
        hidden.forEach((o) => (o.visible = true));
        invalidate();
        return c.toDataURL('image/jpeg', 0.82);
      } catch {
        return undefined;
      }
    };

    viewport.setView = (dir) => {
      const c = controls.current;
      if (!c) return;
      start(dir, c.target, camera.position.distanceTo(c.target));
    };

    viewport.frame = (box) => {
      const c = controls.current;
      if (!c) return;
      const b = box && !box.isEmpty() ? box : new THREE.Box3(new THREE.Vector3(-60, -60, 0), new THREE.Vector3(60, 60, 20));
      const sphere = b.getBoundingSphere(new THREE.Sphere());
      const radius = Math.max(sphere.radius, 5);
      const fov = (camera.fov * Math.PI) / 180;
      const fitH = radius / Math.sin(fov / 2);
      const fitW = radius / Math.sin(Math.atan(Math.tan(fov / 2) * camera.aspect));
      const dist = Math.max(fitH, fitW) * 1.15;
      start(camera.position.clone().sub(c.target), sphere.center, dist);
    };
  }, [camera, gl, scene, invalidate]);

  // Frame requests from the UI (F key, toolbar button).
  useEffect(() => {
    if (frameRequest === 0) return;
    const { doc, selection } = useEditor.getState();
    viewport.frame(selection.length ? selectionBounds(doc, selection) : sceneBounds(doc));
  }, [frameRequest]);

  useFrame((_, delta) => {
    const a = anim.current;
    const c = controls.current;
    if (!a || !c) return;
    // Reduced motion: jump straight to the new view.
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    a.t = reduce ? 1 : Math.min(1, a.t + delta / DURATION);
    const k = ease(a.t);
    // Spherical interpolation of the view direction gives a natural orbit arc.
    const q = new THREE.Quaternion().setFromUnitVectors(a.fromDir, a.toDir);
    const dir = a.fromDir.clone().applyQuaternion(new THREE.Quaternion().slerp(q, k));
    if (a.fromDir.dot(a.toDir) < -0.999) dir.lerpVectors(a.fromDir, a.toDir, k).normalize();
    const dist = THREE.MathUtils.lerp(a.fromDist, a.toDist, k);
    c.target.lerpVectors(a.fromTarget, a.toTarget, k);
    camera.position.copy(c.target).addScaledVector(dir, dist);
    c.update();
    if (a.t >= 1) anim.current = null;
    invalidate();
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.12}
      zoomToCursor
      screenSpacePanning
      minDistance={2}
      maxDistance={5000}
      rotateSpeed={0.8}
      mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
      onStart={() => {
        anim.current = null;
      }}
    />
  );
}
