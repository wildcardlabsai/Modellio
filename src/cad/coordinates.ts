import * as THREE from 'three';

/**
 * MODELLIO uses a Z-up, millimetre world (the convention of CAD tools and
 * 3D-printer slicers). Three.js defaults to Y-up, so we change the default up
 * vector BEFORE any camera or Object3D is created. This module must be
 * imported first (see main.tsx).
 */
THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

export const WORLD_UP = new THREE.Vector3(0, 0, 1);
