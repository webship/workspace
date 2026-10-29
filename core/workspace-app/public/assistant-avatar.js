// The AI Assistant's avatar: Druplicon, standing at the top of the assistant panel, alive while it is
// shown — breathing, blinking, its eyes on the pointer, thinking while a reply is on its way, its mouth
// moving with the spoken summary, and a gesture where one fits.
//
// Loaded on demand, like Ace: three.js and three-vrm are 1.1 MB and a page that does not show the
// avatar never fetches them. The model, public/avatar/druplicon.vrm, is built in code by the avatar
// app's tools/build-druplicon.mjs (github.com/Natshah/druplicon-avatar); Druplicon is licensed under
// the GPL, and Drupal is a registered trademark of Dries Buytaert.
//
// The stage is extensible (registerStageExtension below): a board, a video or anything else can sit
// beside the avatar later without this file knowing about it.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { MOVE_SETS } from '/assistant-avatar-moves.js';

// ---- The pose: rotations added per bone, on top of the rest pose --------------------------------

const BONES = ['hips', 'spine', 'chest', 'neck', 'head', 'leftShoulder', 'rightShoulder',
  'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'rightUpperLeg', 'rightLowerLeg'];
const DIGITS = { Thumb: ['Metacarpal', 'Proximal', 'Distal'], Index: ['Proximal', 'Intermediate', 'Distal'], Middle: ['Proximal', 'Intermediate', 'Distal'], Ring: ['Proximal', 'Intermediate', 'Distal'], Little: ['Proximal', 'Intermediate', 'Distal'] };
for (const side of ['left', 'right']) for (const [f, joints] of Object.entries(DIGITS)) for (const j of joints) BONES.push(`${side}${f}${j}`);

// Arms down from the T-pose, elbows soft. Normalized bones: the avatar faces +Z and its left is +X.
const REST = {
  leftUpperArm: { z: -1.2, y: 0.05 }, rightUpperArm: { z: 1.2, y: -0.05 },
  leftLowerArm: { y: -0.25 }, rightLowerArm: { y: 0.25 },
  leftHand: { z: -0.1 }, rightHand: { z: 0.1 },
};
// A closed finger, joint by joint; a relaxed hand curls each finger a little more than the one before.
const CLOSE = { Thumb: [0.35, 0.7, 0.8], Index: [1.45, 1.6, 1.0], Middle: [1.5, 1.65, 1.0], Ring: [1.5, 1.65, 1.0], Little: [1.5, 1.6, 1.0] };
const RELAXED = { Thumb: 0.25, Index: 0.12, Middle: 0.16, Ring: 0.2, Little: 0.24 };
const SHAPES = {
  open: { Thumb: -0.25, Index: -0.12, Middle: -0.16, Ring: -0.2, Little: -0.24 },
  point: { Thumb: 0.35, Index: -0.12, Middle: 0.7, Ring: 0.75, Little: 0.75 },
  fist: { Thumb: 0.5, Index: 0.85, Middle: 0.85, Ring: 0.8, Little: 0.76 },
  thumbsup: { Thumb: -0.45, Index: 0.85, Middle: 0.85, Ring: 0.8, Little: 0.76 },
};
function curl(p, side, finger, k) {
  const m = side === 'left' ? -1 : 1;
  DIGITS[finger].forEach((j, i) => {
    const a = CLOSE[finger][i] * k;
    if (finger === 'Thumb') p.add(`${side}Thumb${j}`, a, 0, 0); else p.add(`${side}${finger}${j}`, 0, 0, m * a);
  });
}
for (const side of ['left', 'right']) {
  for (const f of Object.keys(DIGITS)) curl({ add: (b, x, y, z) => { REST[b] = { x, y, z }; } }, side, f, RELAXED[f]);
}
const hand = (p, side, shape, e) => { for (const [f, k] of Object.entries(SHAPES[shape])) curl(p, side, f, k * e); };

class Pose {
  constructor() { this.r = {}; }
  reset() { for (const b of BONES) { const r = REST[b] || {}; this.r[b] = { x: r.x || 0, y: r.y || 0, z: r.z || 0 }; } }
  add(b, x, y, z) { const r = this.r[b]; if (r) { r.x += x; r.y += y; r.z += z; } }
  /** A hand shape ('open', 'point', 'fist', 'thumbsup') at strength e, for the move sets, which cannot import `hand`. */
  hand(side, shape, e) { hand(this, side, shape, e); }
}

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const envelope = (t, a = 0.2, b = 0.2) => (t < a ? ease(t / a) : t > 1 - b ? ease((1 - t) / b) : 1);

// The gestures a colleague uses at work: hello and goodbye, agreeing, thinking it over, explaining,
// pointing the way, an idea, a shrug, well done. Each adds rotations for t in [0, 1].
export const GESTURES = {
  wave: { duration: 2.4, pose(t, p) {
    const e = envelope(t, 0.18, 0.2);
    p.add('rightUpperArm', 0, -0.25 * e, -1.4 * e);
    p.add('rightLowerArm', 0, 0.3 * e, -1.2 * e + Math.sin(t * Math.PI * 10) * 0.35 * e);
    p.add('rightHand', 0, 0, Math.sin(t * Math.PI * 10 + 0.6) * 0.2 * e);
    p.add('head', 0, -0.12 * e, 0.08 * e);
    hand(p, 'right', 'open', e);
  }, face: (t) => ({ happy: envelope(t) }) },
  nod: { duration: 1.4, pose(t, p) {
    const e = envelope(t, 0.1, 0.25);
    p.add('head', Math.max(0, Math.sin(t * Math.PI * 4)) * 0.28 * e, 0, 0);
    p.add('neck', Math.max(0, Math.sin(t * Math.PI * 4)) * 0.1 * e, 0, 0);
  } },
  think: { duration: 3, pose(t, p) {
    const e = envelope(t, 0.2, 0.2);
    p.add('rightUpperArm', 0, 0.9 * e, -0.25 * e);
    p.add('rightLowerArm', 0, 1.9 * e, -0.2 * e);
    p.add('rightHand', 0, 0, -0.3 * e);
    hand(p, 'right', 'fist', 0.5 * e);
    p.add('head', -0.15 * e, -0.15 * e, 0.12 * e + Math.sin(t * Math.PI * 3) * 0.03 * e);
  } },
  explain: { duration: 4, pose(t, p) {
    const e = envelope(t, 0.12, 0.2);
    const a = t * Math.PI * 4;
    p.add('leftUpperArm', 0, -0.5 * e, 0.35 * e);
    p.add('rightUpperArm', 0, 0.5 * e, -0.35 * e);
    p.add('leftLowerArm', 0, -(1.0 + 0.35 * Math.sin(a)) * e, 0);
    p.add('rightLowerArm', 0, (1.0 + 0.35 * Math.sin(a + Math.PI)) * e, 0);
    hand(p, 'left', 'open', 0.6 * e);
    hand(p, 'right', 'open', 0.6 * e);
    p.add('head', 0.06 * Math.sin(a * 1.5) * e, 0, 0);
  }, face: (t) => ({ happy: 0.4 * envelope(t) }) },
  point: { duration: 2, pose(t, p) {
    const e = envelope(t, 0.2, 0.25);
    p.add('rightUpperArm', 0, 1.1 * e, -1.0 * e);
    p.add('rightLowerArm', 0, -0.2 * e, 0);
    hand(p, 'right', 'point', e);
    p.add('head', 0, -0.1 * e, 0);
  } },
  idea: { duration: 2.2, pose(t, p) {
    const e = envelope(t, 0.15, 0.25);
    p.add('rightUpperArm', 0, 0.1 * e, -2.6 * e);
    p.add('rightLowerArm', 0, 0, -0.3 * e);
    hand(p, 'right', 'point', e);
    p.add('head', -0.2 * e, 0, 0.08 * e);
  }, face: (t) => ({ happy: 0.8 * envelope(t), surprised: 0.25 * envelope(t) }) },
  shrug: { duration: 1.8, pose(t, p) {
    const e = envelope(t, 0.25, 0.3);
    p.add('leftUpperArm', 0, -0.2 * e, 0.45 * e);
    p.add('rightUpperArm', 0, 0.2 * e, -0.45 * e);
    p.add('leftLowerArm', 0, -1.3 * e, 0.2 * e);
    p.add('rightLowerArm', 0, 1.3 * e, -0.2 * e);
    hand(p, 'left', 'open', e);
    hand(p, 'right', 'open', e);
    p.add('head', 0, 0, 0.18 * e);
  } },
  thumbsup: { duration: 1.8, pose(t, p) {
    const e = envelope(t, 0.15, 0.25);
    p.add('rightUpperArm', 0, 0.9 * e, -0.6 * e);
    p.add('rightLowerArm', 0, 0, -1.2 * e);
    hand(p, 'right', 'thumbsup', e);
    p.add('head', 0, 0, 0.1 * e);
  }, face: (t) => ({ happy: 0.8 * envelope(t) }) },
  cheer: { duration: 2.2, pose(t, p, o) {
    const e = envelope(t, 0.15, 0.2);
    hand(p, 'left', 'fist', e);
    hand(p, 'right', 'fist', e);
    const pump = Math.sin(t * Math.PI * 8) * 0.15 * e;
    p.add('leftUpperArm', 0, 0, 2.3 * e + pump);
    p.add('rightUpperArm', 0, 0, -2.3 * e - pump);
    p.add('leftLowerArm', 0, 0, 0.3 * e);
    p.add('rightLowerArm', 0, 0, -0.3 * e);
    p.add('head', -0.15 * e, 0, 0);
    o.hipsY += Math.abs(Math.sin(t * Math.PI * 4)) * 0.06 * e;
  }, face: () => ({ happy: 1 }) },
  clap: { duration: 2, pose(t, p) {
    const e = envelope(t, 0.15, 0.2);
    const c = (Math.sin(t * Math.PI * 12) * 0.5 + 0.5) * e;
    p.add('leftUpperArm', 0, -0.9 * e - 0.15 * c, 0.55 * e);
    p.add('rightUpperArm', 0, 0.9 * e + 0.15 * c, -0.55 * e);
    p.add('leftLowerArm', 0, -0.9 * e, 0);
    p.add('rightLowerArm', 0, 0.9 * e, 0);
    hand(p, 'left', 'open', e);
    hand(p, 'right', 'open', e);
  }, face: () => ({ happy: 0.8 }) },
  crossarms: { duration: 3, pose(t, p) {
    const e = envelope(t, 0.2, 0.2);
    p.add('leftUpperArm', 0, -1.0 * e, 0.45 * e);
    p.add('rightUpperArm', 0, 1.0 * e, -0.35 * e);
    p.add('leftLowerArm', 0, -2.1 * e, 0);
    p.add('rightLowerArm', 0, 2.0 * e, 0);
    p.add('head', 0, 0.12 * e, 0.06 * e);
  }, face: (t) => ({ relaxed: 0.3 * envelope(t) }) },
  look: { duration: 3, pose(t, p) {
    const e = envelope(t, 0.1, 0.2);
    const yaw = Math.sin(t * Math.PI * 2) * 0.75 * e;
    p.add('head', 0, yaw, 0);
    p.add('neck', 0, 0.3 * yaw, 0);
    p.add('rightUpperArm', 0, 0.7 * e, -1.6 * e);
    p.add('rightLowerArm', 0, 1.9 * e, 0);
    hand(p, 'right', 'open', e);
  }, face: (t) => ({ surprised: 0.2 * envelope(t) }) },
  // Flying from one place on the page to another: arms out like wings, leaning into it, bobbing.
  fly: { duration: 1.4, pose(t, p, o) {
    const e = envelope(t, 0.2, 0.25);
    const flap = Math.sin(t * Math.PI * 6) * 0.25 * e;
    p.add('leftUpperArm', 0, 0, 1.0 * e + flap);
    p.add('rightUpperArm', 0, 0, -1.0 * e - flap);
    hand(p, 'left', 'open', e);
    hand(p, 'right', 'open', e);
    p.add('spine', 0.18 * e, 0, 0);
    p.add('leftUpperLeg', -0.25 * e, 0, 0);
    p.add('rightUpperLeg', 0.1 * e, 0, 0);
    o.hipsY += Math.sin(t * Math.PI) * 0.08 * e;
  }, face: (t) => ({ happy: 0.7 * envelope(t) }) },
  bye: { duration: 2.4, pose(t, p) {
    const e = envelope(t, 0.15, 0.2);
    const w = Math.sin(t * Math.PI * 10) * 0.35 * e;
    p.add('leftUpperArm', 0, 0.25 * e, 1.4 * e);
    p.add('rightUpperArm', 0, -0.25 * e, -1.4 * e);
    p.add('leftLowerArm', 0, -0.3 * e, 1.0 * e + w);
    p.add('rightLowerArm', 0, 0.3 * e, -1.0 * e - w);
    hand(p, 'left', 'open', e);
    hand(p, 'right', 'open', e);
  }, face: (t) => ({ happy: envelope(t) }) },
  // For the agent's statuses while it works, as the Claude Code CLI names them (assistant-avatar-ui.js,
  // STATUSES): tempering is hammering on an anvil, brewing is stirring, coding is typing, searching is a
  // hand at the brow looking left and right.
  hammer: { duration: 2, pose(t, p, o) {
    const e = envelope(t, 0.12, 0.15);
    const up = Math.max(0, Math.sin(t * Math.PI * 6));
    p.add('rightUpperArm', 0, 0.7 * e, -(0.35 + 0.95 * up) * e);
    p.add('rightLowerArm', 0, (0.5 + 0.9 * up) * e, 0);
    hand(p, 'right', 'fist', e);
    p.add('leftUpperArm', 0, -0.7 * e, 0.2 * e);
    p.add('leftLowerArm', 0, -0.9 * e, 0);
    hand(p, 'left', 'fist', 0.6 * e);
    p.add('head', 0.18 * e, 0, 0);
    p.add('spine', 0.08 * e + 0.04 * (1 - up) * e, 0, 0);
    o.hipsY -= 0.012 * (1 - up) * e;
  }, face: (t) => ({ happy: 0.3 * envelope(t), relaxed: 0.3 }) },
  stir: { duration: 2.4, pose(t, p) {
    const e = envelope(t, 0.15, 0.15);
    const a = t * Math.PI * 6;
    p.add('rightUpperArm', 0, (0.8 + 0.15 * Math.sin(a)) * e, (-0.3 + 0.15 * Math.cos(a)) * e);
    p.add('rightLowerArm', 0, 1.2 * e, 0);
    hand(p, 'right', 'fist', e);
    p.add('leftUpperArm', 0, -0.5 * e, 0.15 * e);
    p.add('leftLowerArm', 0, -0.8 * e, 0);
    p.add('head', 0.15 * e, 0.08 * Math.sin(a / 3) * e, 0.05 * e);
  }, face: (t) => ({ happy: 0.5 * envelope(t) }) },
  type: { duration: 2, pose(t, p) {
    const e = envelope(t, 0.15, 0.15);
    const tap = (k) => Math.max(0, Math.sin(t * Math.PI * 14 + k)) * 0.12 * e;
    p.add('leftUpperArm', 0, -0.55 * e, 0.25 * e);
    p.add('rightUpperArm', 0, 0.55 * e, -0.25 * e);
    p.add('leftLowerArm', 0, -1.35 * e, -tap(0));
    p.add('rightLowerArm', 0, 1.35 * e, tap(Math.PI));
    hand(p, 'left', 'open', 0.5 * e);
    hand(p, 'right', 'open', 0.5 * e);
    p.add('head', 0.2 * e, 0, 0);
  } },
  scan: { duration: 2.4, pose(t, p) {
    const e = envelope(t, 0.15, 0.2);
    p.add('rightUpperArm', 0, 0.9 * e, -1.25 * e);
    p.add('rightLowerArm', 0, 1.9 * e, 0);
    hand(p, 'right', 'open', e);
    p.add('head', -0.06 * e, Math.sin(t * Math.PI * 2) * 0.5 * e, 0);
    p.add('spine', 0, Math.sin(t * Math.PI * 2) * 0.12 * e, 0);
  }, face: (t) => ({ surprised: 0.15 * envelope(t) }) },
  // For the big moves, where the whole figure travels the page (assistant-avatar-ui.js): a stride, a
  // full turn, and a crouch-and-spring.
  walk: { duration: 1.1, pose(t, p, o) {
    const e = envelope(t, 0.12, 0.12);
    const s = Math.sin(t * Math.PI * 2);
    p.add('leftUpperLeg', -0.45 * s * e, 0, 0);
    p.add('rightUpperLeg', 0.45 * s * e, 0, 0);
    p.add('leftLowerLeg', 0.5 * Math.max(0, s) * e, 0, 0);
    p.add('rightLowerLeg', 0.5 * Math.max(0, -s) * e, 0, 0);
    p.add('leftUpperArm', 0.35 * s * e, 0, 0);
    p.add('rightUpperArm', -0.35 * s * e, 0, 0);
    p.add('spine', 0.05 * e, 0.06 * s * e, 0);
    o.hipsY += Math.abs(Math.cos(t * Math.PI * 2)) * 0.02 * e;
  } },
  spin: { duration: 1.6, pose(t, p, o) {
    const e = envelope(t, 0.15, 0.15);
    p.add('hips', 0, Math.PI * 2 * ease(t), 0);
    p.add('leftUpperArm', 0, 0, 0.7 * e);
    p.add('rightUpperArm', 0, 0, -0.7 * e);
    hand(p, 'left', 'open', e);
    hand(p, 'right', 'open', e);
    o.hipsY += Math.sin(t * Math.PI) * 0.05;
  }, face: (t) => ({ happy: envelope(t) }) },
  leap: { duration: 1.3, pose(t, p, o) {
    const crouch = t < 0.25 ? ease(t / 0.25) : t < 0.35 ? 1 - ease((t - 0.25) / 0.1) : t > 0.85 ? Math.sin(((t - 0.85) / 0.15) * Math.PI) : 0;
    const up = t > 0.25 && t < 0.9 ? Math.sin(((t - 0.25) / 0.65) * Math.PI) : 0;
    p.add('leftUpperLeg', -0.6 * crouch + 0.2 * up, 0, 0);
    p.add('rightUpperLeg', -0.6 * crouch - 0.3 * up, 0, 0);
    p.add('leftLowerLeg', 1.0 * crouch + 0.4 * up, 0, 0);
    p.add('rightLowerLeg', 1.0 * crouch + 0.6 * up, 0, 0);
    p.add('leftUpperArm', 0, 0, 2.2 * up);
    p.add('rightUpperArm', 0, 0, -2.2 * up);
    hand(p, 'left', 'open', up);
    hand(p, 'right', 'open', up);
    p.add('spine', 0.25 * crouch - 0.1 * up, 0, 0);
    o.hipsY += -0.07 * crouch;
  }, face: (t) => ({ happy: envelope(t), surprised: 0.3 * envelope(t, 0.3, 0.5) }) },
};

// ---- Stage extensions: what can sit beside the avatar (a board, a video …) -----------------------
//
// registerStageExtension({ id, label, icon, open(stage, avatar), close() }) adds a button to the stage's
// own tool row; open() receives the stage element to draw into and the avatar to gesture with.
const EXTENSIONS = new Map();
export function registerStageExtension(ext) {
  if (!ext || !/^[a-z0-9-]{1,40}$/.test(String(ext.id || '')) || typeof ext.open !== 'function') return false;
  EXTENSIONS.set(ext.id, ext);
  document.dispatchEvent(new CustomEvent('ws-avatar-extensions'));
  return true;
}
export const stageExtensions = () => [...EXTENSIONS.values()];

// ---- The avatar ---------------------------------------------------------------------------------

const VOWELS = { a: 'aa', e: 'ee', i: 'ih', o: 'oh', u: 'ou', y: 'ih' };

// `box()`, when given, returns the rectangle on the page where the figure stands (the card you drag):
// the canvas then covers the whole window and the figure is drawn in that rectangle, so its moves reach
// anywhere on the page with no edge to cut them. Without it the figure fills the canvas.
// `look`: '2d' (flat: no perspective and an even light, a cartoon drawing, the default) or '3d' (perspective, lit).
export async function mountAvatar(canvas, { model = '/avatar/vardot-bot.vrm', moves = '', hair = '', box: boxOf = null, look: lookAs = '2d' } = {}) {
  // The shared moves, and this avatar's own where it has a set: its own win where the names meet.
  const gestures = { ...GESTURES, ...(MOVE_SETS[moves] || {}) };
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const hemi = new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 2.0);
  key.position.set(1.2, 2.5, 2.5);
  scene.add(key);
  // A rim light from behind, cool and faintly brand-tinted, so the figure's edge stands out from the page.
  const rim = new THREE.DirectionalLight(0xdeedff, 1.4);
  rim.position.set(-1.5, 2.2, -2.5);
  scene.add(rim);
  // 2D: one even light, so every colour reads flat, as drawn.
  // As bright as the 3D look's lights together, so a colour reads the same in 2D, not dimmed.
  const even = new THREE.AmbientLight(0xffffff, 2.3);
  scene.add(even);
  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 30);
  const flatCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 30);
  let flat = false;
  function setLook(l) {
    flat = l === '2d';
    hemi.visible = !flat; key.visible = !flat; rim.visible = !flat; even.visible = flat;
    framed = '';
  }

  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const gltf = await loader.loadAsync(model);
  const vrm = gltf.userData.vrm;
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.rotateVRM0(vrm);
  vrm.scene.traverse((o) => { o.frustumCulled = false; });
  scene.add(vrm.scene);
  const bones = {};
  for (const b of BONES) bones[b] = vrm.humanoid.getNormalizedBoneNode(b);
  // A VRM 0 model (most of the open-source avatars) turns the other way about x and z: the same moves,
  // mirrored back, so its arms come down at rest instead of going up.
  const flip = vrm.meta && vrm.meta.metaVersion === '0' ? -1 : 1;
  const hipsBase = bones.hips ? bones.hips.position.clone() : new THREE.Vector3();
  // A clock face keeps the real time: a model's `HourHand`, `MinuteHand` and `SecondHand` (the Vardot Bot's)
  // are built pointing to twelve and turned here, clockwise as the viewer sees them.
  const clockHands = ['HourHand', 'MinuteHand', 'SecondHand'].map((n) => vrm.scene.getObjectByName(n));
  const em = vrm.expressionManager;
  // Colours: the model's materials in parts, by name (every hair material is one part, "Hair"), each with its
  // colour as it came, to go back to. Outlines, seams and the face (drawn in vertex colours) are not parts.
  const parts = new Map();   // part -> [{ m, color, emissive }]
  const partOf = (m) => {
    const name = String(m.name || '');
    if (!m.color || m.vertexColors || /outline|seam|^face$/i.test(name)) return '';
    if (/hair/i.test(name)) return 'Hair';
    return name.replace(/[_.\-]?\d+$/, '').replace(/[_.-]+/g, ' ').trim().slice(0, 24) || 'Body';
  };
  vrm.scene.traverse((o) => {
    for (const m of [].concat(o.material || [])) {
      const part = partOf(m);
      if (!part) continue;
      const list = parts.get(part) || [];
      if (!list.some((x) => x.m === m)) list.push({ m, color: m.color.clone(), emissive: m.emissive ? m.emissive.clone() : null });
      parts.set(part, list);
    }
  });
  const lum = (x) => 0.3 * x.r + 0.59 * x.g + 0.11 * x.b;
  /** Colour a part (#rrggbb); anything else puts it back as the model came. Each material of the part keeps
   *  how much lighter or deeper it was than the first (a hair fall stays deeper than the cap). */
  function setColour(part, hex) {
    const list = parts.get(part) || [];
    const ok = /^#[0-9a-f]{6}$/i.test(String(hex || ''));
    for (const x of list) {
      if (!ok) { x.m.color.copy(x.color); if (x.emissive) x.m.emissive.copy(x.emissive); continue; }
      const c = new THREE.Color(hex);
      const k = Math.min(1.4, lum(x.color) / Math.max(0.05, lum(list[0].color)));
      // A part lit by its own glow (most of the Vardot Bot's) takes the colour as its glow, and a deeper body
      // colour under it, so it reads as the colour picked.
      const glow = x.emissive && lum(x.emissive) > 0;
      x.m.color.copy(c).multiplyScalar(k * (glow ? 0.8 : 1));
      if (glow) x.m.emissive.copy(c).multiplyScalar(k);
    }
  }
  /** The parts and the colour each shows now, as #rrggbb. */
  const colourParts = () => [...parts.entries()].map(([part, list]) => {
    const x = list[0]; const glow = x.m.emissive && lum(x.m.emissive) > 0;
    return { part, hex: `#${(glow ? x.m.emissive : x.m.color).getHexString()}` };
  });
  const setHair = (hex) => setColour('Hair', hex);
  if (hair) setHair(hair);
  vrm.update(0);

  // Frame the whole figure, from its shoes to the tip of the drop.
  const box = new THREE.Box3().setFromObject(vrm.scene);
  const height = box.max.y - box.min.y;
  const aim = new THREE.Vector3(0, box.min.y + height * 0.5, 0);
  // The figure's rectangle, and the last one it was framed for.
  const frameRect = () => (boxOf ? boxOf() : canvas.getBoundingClientRect());
  let framed = '';
  function resize() {
    const w = canvas.clientWidth || 1; const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    framed = '';
    place();
  }
  // Framed for the rectangle: far enough that the figure fits its shorter side, with a little room. With a
  // whole-window canvas, a view offset then draws that framing at the rectangle's place on the page.
  function place() {
    const r = frameRect(); const cw = canvas.clientWidth || 1; const ch = canvas.clientHeight || 1;
    const key = `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)},${cw},${ch}`;
    if (key === framed) return;
    framed = key;
    const bw = Math.max(1, r.width); const bh = Math.max(1, r.height);
    camera.aspect = bw / bh;
    const fitH = (height * 0.62) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const fitW = fitH / Math.min(1, camera.aspect * 1.4);
    camera.position.set(0, aim.y + height * 0.06, Math.max(fitH, fitW));
    camera.lookAt(aim);
    // The flat camera frames the same: the figure's height and a little room, wider when the box is narrow.
    const halfH = (height * 0.62) / Math.min(1, camera.aspect * 1.4);
    flatCam.top = halfH; flatCam.bottom = -halfH; flatCam.left = -halfH * camera.aspect; flatCam.right = halfH * camera.aspect;
    flatCam.position.copy(camera.position); flatCam.lookAt(aim);
    for (const cam of [camera, flatCam]) {
      if (boxOf) {
        const c = canvas.getBoundingClientRect();
        cam.setViewOffset(bw, bh, c.left - r.left, c.top - r.top, cw, ch);
      } else cam.clearViewOffset();
      cam.updateProjectionMatrix();
    }
  }
  const sizer = new ResizeObserver(resize);
  sizer.observe(canvas);
  resize();
  setLook(lookAs);

  const look = new THREE.Vector2(); const lookTo = new THREE.Vector2();
  const onPointer = (e) => {
    const r = frameRect();
    lookTo.set(THREE.MathUtils.clamp(((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1, -1, 1),
      THREE.MathUtils.clamp(((e.clientY - r.top) / Math.max(1, r.height)) * 2 - 1, -1, 1));
  };
  window.addEventListener('pointermove', onPointer);

  const pose = new Pose();
  const timer = new THREE.Timer();
  let active = [];            // gestures playing: { name, start }
  let thinking = false; let nextThink = 0;
  let speaking = false; let mouth = 0; let vowel = 'aa'; let mouthUntil = 0;
  let blink = 0; let nextBlink = 1.5;
  let running = true;
  const expr = (name, v) => { if (em && em.getExpression(name)) em.setValue(name, v); };

  function frame() {
    if (!running) return;
    timer.update();
    const dt = Math.min(0.05, timer.getDelta());
    const t = timer.getElapsed();
    pose.reset();
    const face = { happy: 0.25 };

    // Idle: breathing, a slow sway, the eyes on the pointer.
    const breath = Math.sin(t * 1.6);
    pose.add('spine', breath * 0.012, 0, Math.sin(t * 0.45) * 0.015);
    pose.add('head', 0.02 * Math.sin(t * 0.7) + look.y * 0.12, look.x * 0.25, Math.sin(t * 0.5) * 0.02);
    look.lerp(lookTo, 1 - Math.exp(-dt * 3));
    const o = { hipsX: 0, hipsY: breath * 0.004, hipsZ: 0, mouth: 0, clockSpin: 0 };   // clockSpin: extra turns of a clock face's hands

    // Thinking while a reply is on its way: the think pose, again and again.
    if (thinking && t > nextThink && !active.some((g) => g.name === 'think')) { active.push({ name: 'think', start: t }); nextThink = t + 3.6; }
    active = active.filter((g) => {
      const def = gestures[g.name];
      const k = (t - g.start) / def.duration;
      if (k >= 1) return false;
      def.pose(Math.max(0, k), pose, o);
      if (def.face) Object.assign(face, def.face(k));
      return true;
    });
    for (const b of BONES) { const n = bones[b]; if (n) { const r = pose.r[b]; n.rotation.set(r.x * flip, r.y, r.z * flip); } }
    if (bones.hips) bones.hips.position.set(hipsBase.x + o.hipsX, hipsBase.y + o.hipsY, hipsBase.z + o.hipsZ);
    if (clockHands[0] || clockHands[1] || clockHands[2]) {
      const now = new Date(); const sec = now.getSeconds() + now.getMilliseconds() / 1000; const min = now.getMinutes() + sec / 60;
      const turns = [((now.getHours() % 12) + min / 60) / 12, min / 60, sec / 60];
      clockHands.forEach((h, i) => { if (h) h.rotation.z = -(turns[i] + o.clockSpin * (i === 0 ? 1 / 12 : 1)) * Math.PI * 2; });
    }
    if (o.mouth > mouth) { mouth = Math.min(1, o.mouth); vowel = 'aa'; }

    // The face: a blink now and then, and the mouth with the words being spoken.
    if (t > nextBlink) { blink = 1; nextBlink = t + 2 + Math.random() * 3.5; }
    blink = Math.max(0, blink - dt * 7);
    if (speaking && t < mouthUntil) mouth = Math.min(1, mouth + dt * 14); else mouth = Math.max(0, mouth - dt * 10);
    for (const v of ['aa', 'ee', 'ih', 'oh', 'ou']) expr(v, v === vowel ? mouth * 0.75 : 0);
    for (const [k, v] of Object.entries(face)) expr(k, Math.min(1, v));
    expr('blink', blink > 0.5 ? 1 : blink * 2);
    expr('lookLeft', Math.max(0, look.x)); expr('lookRight', Math.max(0, -look.x));
    expr('lookUp', Math.max(0, -look.y)); expr('lookDown', Math.max(0, look.y));

    vrm.update(dt);
    if (boxOf) place();   // the card flies, resizes and is dragged: the figure follows it
    renderer.render(scene, flat ? flatCam : camera);
  }
  renderer.setAnimationLoop(frame);

  return {
    /** Play a gesture by name; unknown names are ignored. */
    gesture(name) { if (gestures[name] && running) active.push({ name, start: timer.getElapsed() }); },
    /** '3d' or '2d'. */
    setLook,
    /** Whether the model has hair that can take a colour. */
    hasHair: parts.has('Hair'),
    /** Colour the hair (#rrggbb), or put it back as the model came with ''. */
    setHair,
    /** Colour any part (#rrggbb, or '' for the model's own), and list the parts with their colours now. */
    setColour,
    colourParts,
    /** True from a message being sent until its reply arrives. */
    setThinking(on) { thinking = Boolean(on); if (on) nextThink = 0; },
    /** The voice started or stopped. */
    setSpeaking(on) { speaking = Boolean(on); if (!on) mouthUntil = 0; },
    /** A word is being spoken: open the mouth on its first vowel for about the word's length. */
    word(text) {
      const w = String(text || '').toLowerCase();
      const v = (w.match(/[aeiouy]/) || ['a'])[0];
      vowel = VOWELS[v] || 'aa';
      mouthUntil = timer.getElapsed() + Math.min(0.45, 0.09 + w.length * 0.045);
    },
    dispose() {
      running = false;
      renderer.setAnimationLoop(null);
      sizer.disconnect();
      window.removeEventListener('pointermove', onPointer);
      VRMUtils.deepDispose(vrm.scene);
      renderer.dispose();
    },
  };
}
