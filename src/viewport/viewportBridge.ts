import * as THREE from 'three';

/**
 * A narrow bridge between DOM-side UI (toolbars, drag & drop) and the
 * R3F scene. The CameraController registers the live implementations.
 */
export type ViewName = 'home' | 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right';

export const VIEW_DIRECTIONS: Record<ViewName, THREE.Vector3> = {
  home: new THREE.Vector3(1, -1.25, 0.95).normalize(),
  top: new THREE.Vector3(0, -1e-4, 1).normalize(),
  bottom: new THREE.Vector3(0, 1e-4, -1).normalize(),
  front: new THREE.Vector3(0, -1, 0),
  back: new THREE.Vector3(0, 1, 0),
  left: new THREE.Vector3(-1, 0, 0),
  right: new THREE.Vector3(1, 0, 0),
};

interface Bridge {
  camera: THREE.Camera | null;
  renderer: THREE.WebGLRenderer | null;
  scene: THREE.Scene | null;
  orbitControls: { enabled: boolean } | null;
  /** True while the pointer is over a transform-gizmo axis. */
  gizmoHovered: () => boolean;
  /** Render a small thumbnail of the scene without overlays (data URL). */
  captureThumbnail?: () => string | undefined;
  domElement: HTMLElement | null;
  setView: (dir: THREE.Vector3) => void;
  frame: (box: THREE.Box3 | null) => void;
  /** Timestamp of the last gizmo release — used to ignore the click that ends a drag. */
  lastGizmoRelease: number;
  gizmoActive: boolean;
}

export const viewport: Bridge = {
  camera: null,
  renderer: null,
  scene: null,
  orbitControls: null,
  gizmoHovered: () => false,
  domElement: null,
  setView: () => {},
  frame: () => {},
  lastGizmoRelease: 0,
  gizmoActive: false,
};

export function gizmoRecentlyUsed() {
  return viewport.gizmoActive || performance.now() - viewport.lastGizmoRelease < 200;
}

/** Project a client (screen) point onto the Z = 0 workplane. */
export function screenToWorkplane(clientX: number, clientY: number): THREE.Vector3 | null {
  const { camera, domElement } = viewport;
  if (!camera || !domElement) return null;
  const rect = domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, camera);
  const hit = new THREE.Vector3();
  return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), hit) ? hit : null;
}

/** Project a world point to client (screen) coordinates. Used by tooling and automated tests. */
export function worldToScreen(x: number, y: number, z: number): { x: number; y: number } | null {
  const { camera, domElement } = viewport;
  if (!camera || !domElement) return null;
  const rect = domElement.getBoundingClientRect();
  const v = new THREE.Vector3(x, y, z).project(camera);
  return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
}

export interface SurfaceHit {
  point: THREE.Vector3;
  /** World-space face normal (unit). */
  normal: THREE.Vector3;
  /** Object id of the mesh that was hit (null = workplane). */
  objectName: string | null;
  distance: number;
}

/**
 * Pick the surface under a screen point: the nearest pickable mesh (shapes and
 * Boolean results), falling back to the workplane. `exclude` filters meshes by
 * name (object ids, or "<groupId>:result").
 */
export function pickSurface(clientX: number, clientY: number, exclude?: (name: string) => boolean): SurfaceHit | null {
  const { camera, domElement, scene } = viewport;
  if (!camera || !domElement || !scene) return null;
  const rect = domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, camera);
  const targets: THREE.Object3D[] = [];
  scene.traverseVisible((o) => {
    if ((o as THREE.Mesh).isMesh && o.userData.pickable && !(exclude && exclude(o.name))) targets.push(o);
  });
  const hit = ray.intersectObjects(targets, false)[0];
  if (hit && hit.face) {
    const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
    // Facing away from the camera means we hit a back face: flip so the normal points at the viewer.
    if (normal.dot(ray.ray.direction) > 0) normal.negate();
    return { point: hit.point.clone(), normal, objectName: hit.object.name, distance: hit.distance };
  }
  const p = new THREE.Vector3();
  if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), p)) return null;
  return { point: p, normal: new THREE.Vector3(0, 0, 1), objectName: null, distance: p.distanceTo(ray.ray.origin) };
}

/** Disable/enable camera orbiting (during object drags and handle drags). */
export function setOrbitEnabled(enabled: boolean) {
  const c = viewport.orbitControls;
  if (c) c.enabled = enabled;
}

/** World-space ray through a client (screen) point. */
export function rayFromClient(clientX: number, clientY: number): THREE.Ray | null {
  const { camera, domElement } = viewport;
  if (!camera || !domElement) return null;
  const rect = domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  const r = new THREE.Raycaster();
  r.setFromCamera(ndc, camera);
  return r.ray.clone();
}

/** Is a manipulator (resize handle or gizmo axis) under this screen point? Such presses belong to the tool. */
export function manipulatorAt(clientX: number, clientY: number): boolean {
  if (viewport.gizmoHovered()) return true;
  const ray = rayFromClient(clientX, clientY);
  const { scene } = viewport;
  if (!ray || !scene) return false;
  const targets: THREE.Object3D[] = [];
  scene.traverseVisible((o) => {
    if ((o as THREE.Mesh).isMesh && o.userData.handle) targets.push(o);
  });
  return new THREE.Raycaster(ray.origin, ray.direction).intersectObjects(targets, false).length > 0;
}

/** Visible pickable meshes in the scene (object meshes and Boolean results), minus `exclude`. */
export function pickableMeshes(exclude?: (name: string) => boolean): THREE.Object3D[] {
  const targets: THREE.Object3D[] = [];
  viewport.scene?.traverseVisible((o) => {
    if ((o as THREE.Mesh).isMesh && o.userData.pickable && !(exclude && exclude(o.name))) targets.push(o);
  });
  return targets;
}

/**
 * Highest pickable surface straight below the given X/Y points (for resting
 * objects on top of others). Returns 0 (the plate) where nothing is below.
 */
export function heightUnder(points: [number, number][], exclude?: (name: string) => boolean, meshes?: THREE.Object3D[]): number {
  const targets = meshes ?? pickableMeshes(exclude);
  if (!targets.length) return 0;
  const ray = new THREE.Raycaster();
  let top = 0;
  for (const [x, y] of points) {
    ray.set(new THREE.Vector3(x, y, 1e5), new THREE.Vector3(0, 0, -1));
    const hit = ray.intersectObjects(targets, false)[0];
    if (hit) top = Math.max(top, hit.point.z);
  }
  return top;
}
