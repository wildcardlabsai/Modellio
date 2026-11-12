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
