import * as THREE from 'three';

// M0 sanity boot: verifies vendored three.js + tsc + import map + headless capture.
// Replaced by the full engine boot in M2.

declare global {
  interface Window {
    __RAIDFIT_READY?: boolean;
  }
}

const app = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#141c30');

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(2.5, 2.5, 2.5);
camera.lookAt(0, 0, 0);

const sun = new THREE.DirectionalLight('#fff2d8', 2.2);
sun.position.set(3, 5, 2);
scene.add(sun, new THREE.HemisphereLight('#8fb3ff', '#5a4a33', 0.8));

const cube = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: '#e8b64c', roughness: 0.6 })
);
scene.add(cube);

const params = new URLSearchParams(location.search);
const frozen = params.get('freeze') === '1';

let frames = 0;
renderer.setAnimationLoop((t: number) => {
  if (!frozen) cube.rotation.set(t / 1400, t / 900, 0);
  renderer.render(scene, camera);
  if (++frames === 3) window.__RAIDFIT_READY = true;
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
