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
/** Orthographic cameras sit this far from the target (inside the fog range; the frustum, not the distance, sets the scale, and the near plane is negative so nothing is clipped). */
const ORTHO_DISTANCE = 500;
const PERSP_FOV = 40;
/** Orbit target to restore after the camera (and so the controls) are replaced. */
let pendingTarget: THREE.Vector3 | null = null;
const isOrtho = (c: THREE.Camera): c is THREE.OrthographicCamera => (c as THREE.OrthographicCamera).isOrthographicCamera === true;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Orbit / pan / zoom camera with animated standard views.
 * Left-drag: orbit · Right-drag (or Shift+left): pan · Wheel: zoom to cursor.
 */
export function CameraController() {
  const controls = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera | THREE.OrthographicCamera;
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
    // The camera was just swapped (projection change): keep looking at the same point.
    if (pendingTarget && controls.current) {
      controls.current.target.copy(pendingTarget);
      controls.current.update();
      pendingTarget = null;
      invalidate();
    }

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
      if (isOrtho(camera)) {
        // Orthographic: fit by zoom, keep the view direction.
        const fit = Math.min(camera.top - camera.bottom, camera.right - camera.left) / (2 * radius * 1.15);
        camera.zoom = fit;
        camera.updateProjectionMatrix();
        start(camera.position.clone().sub(c.target), sphere.center, ORTHO_DISTANCE);
        return;
      }
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
    <>
      <ProjectionSwitch controls={controls} />
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
    </>
  );
}

/**
 * Perspective ⇄ orthographic. Swaps the scene camera for one of the other kind showing the same
 * view at the same scale (at the orbit target), so switching never jumps.
 */
function ProjectionSwitch({ controls }: { controls: React.RefObject<OrbitControlsImpl | null> }) {
  const projection = useEditor((s) => s.projection);
  const camera = useThree((s) => s.camera);
  const set = useThree((s) => s.set);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const perspective = useRef<THREE.PerspectiveCamera | null>(null);

  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const target = c.target.clone();
    const dir = camera.position.clone().sub(target).normalize();
    if (projection === 'orthographic' && !isOrtho(camera)) {
      const p = camera as THREE.PerspectiveCamera;
      perspective.current = p;
      const h = 2 * camera.position.distanceTo(target) * Math.tan(THREE.MathUtils.degToRad(p.fov) / 2);
      const aspect = size.width / Math.max(1, size.height);
      const o = new THREE.OrthographicCamera((-h * aspect) / 2, (h * aspect) / 2, h / 2, -h / 2, -20000, 20000);
      (o as unknown as { manual: boolean }).manual = true;
      o.up.set(0, 0, 1);
      o.position.copy(target).addScaledVector(dir, ORTHO_DISTANCE);
      o.lookAt(target);
      o.updateProjectionMatrix();
      pendingTarget = target;
      set({ camera: o });
    } else if (projection === 'perspective' && isOrtho(camera)) {
      const p = perspective.current ?? new THREE.PerspectiveCamera(PERSP_FOV, size.width / Math.max(1, size.height), 0.5, 20000);
      p.up.set(0, 0, 1);
      const h = (camera.top - camera.bottom) / camera.zoom;
      const dist = h / 2 / Math.tan(THREE.MathUtils.degToRad(p.fov) / 2);
      p.aspect = size.width / Math.max(1, size.height);
      p.position.copy(target).addScaledVector(dir, dist);
      p.lookAt(target);
      p.updateProjectionMatrix();
      pendingTarget = target;
      set({ camera: p });
    }
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projection]);

  // Keep the orthographic frustum's shape when the view is resized.
  useEffect(() => {
    if (!isOrtho(camera)) return;
    const h = camera.top - camera.bottom;
    const aspect = size.width / Math.max(1, size.height);
    camera.left = (-h * aspect) / 2;
    camera.right = (h * aspect) / 2;
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, size.width, size.height, invalidate]);
  return null;
}
