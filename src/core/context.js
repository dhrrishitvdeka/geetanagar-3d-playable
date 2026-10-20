import * as THREE from 'three';

const $ = id => document.getElementById(id);
const stage = $('app'), canvas = $('gl'), labelLayer = $('labels');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' }); }
catch (err) { $('nogl').hidden = false; throw err; }
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.9; renderer.outputColorSpace = THREE.SRGBColorSpace;

canvas.addEventListener('webglcontextlost', e => { console.error('WebGL context lost', e); });

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 9500);

export { $, stage, canvas, labelLayer, renderer, scene, camera };
