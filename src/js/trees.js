import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

const DARK = new THREE.MeshBasicMaterial({ color: 0x020502, side: THREE.FrontSide });

function makeTree(x, z, trunkH, canopyH, canopyR, layers) {
  const group = new THREE.Group();

  // Trunk
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.08, trunkH, 5),
    DARK
  );
  trunk.position.set(x, -0.5 + trunkH / 2, z);
  group.add(trunk);

  // Stacked cones (gives a fuller pine silhouette)
  for (let i = 0; i < layers; i++) {
    const t       = i / layers;
    const r       = canopyR * (1 - t * 0.45);
    const h       = canopyH / layers * 1.4;
    const yBase   = -0.5 + trunkH + canopyH * t * 0.72;
    const cone    = new THREE.Mesh(new THREE.ConeGeometry(r, h, 6), DARK);
    cone.position.set(x, yBase + h / 2, z);
    group.add(cone);
  }

  return group;
}

export function createTreeLine(scene) {
  const TREE_COUNT = 2000;

  for (let i = 0; i < TREE_COUNT; i++) {
    const angle   = Math.random() * Math.PI * 2;
    // Cluster trees in a ring 48–75 units out, irregular so it reads natural
    const dist    = 140 + Math.pow(Math.random(), 0.6) * 35;
    const x       = Math.cos(angle) * dist;
    const z       = Math.sin(angle) * dist;

    const trunkH  = 0.4 + Math.random() * 0.6;
    const canopyH = 2.5 + Math.random() * 4.0;
    const canopyR = 0.5 + Math.random() * 0.8;
    const layers  = 2 + Math.floor(Math.random() * 3);   // 2–4 cone layers

    scene.add(makeTree(x, z, trunkH, canopyH, canopyR, layers));
  }
}
