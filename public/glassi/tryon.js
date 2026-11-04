/* Camera try-on, ported from the world page. Loaded on demand; the camera is only requested from open().
   Uses the selected version's own GLB. Callers must not open it for a version without a model. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { FRAMES, LENSES } from './catalog.js';

const V3 = THREE.Vector3;
const MP_VER = '0.10.21';
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}`;
const MP_MODEL_REMOTE = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const IPD = .063;   // average adult pupil distance, metres

export function createTryon({ root, canvas, status, onClose }) {
  const t = { open: false, busy: false, renderer: null, scene: null, cam: null, video: null, stream: null, lm: null, lmPromise: null,
    anchor: null, glasses: null, bg: null, fit: null, lastVT: -1, has: false, lostAt: 0, prevT: 0, mats: {}, models: new Map(), glb: null,
    p: new V3(), q: new THREE.Quaternion(), s: 1, tp: new V3(), tq: new THREE.Quaternion(), ts: 1, finish: { frame: 0, lens: 0 }, lettered: true };
  const say = m => { status.textContent = m || ''; status.hidden = !m; };

  function loadLandmarker() {
    return t.lmPromise ??= (async () => {
      const { FaceLandmarker, FilesetResolver } = await import(`${MP_BASE}/vision_bundle.mjs`);
      const fileset = await FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
      let modelPath = MP_MODEL_REMOTE;
      try { const r = await fetch('/glassi/models/face_landmarker.task', { method: 'HEAD' }); if (r.ok) modelPath = '/glassi/models/face_landmarker.task'; } catch { }
      const make = delegate => FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: modelPath, delegate }, runningMode: 'VIDEO', numFaces: 1,
        minFaceDetectionConfidence: .5, minFacePresenceConfidence: .5, minTrackingConfidence: .5 });
      try { return await make('GPU'); } catch { return await make('CPU'); }
    })();
  }
  function loadModel(url) {
    if (!t.models.has(url)) t.models.set(url, new Promise((res, rej) => new GLTFLoader().load(url, g => res(g.scene), undefined, rej)));
    return t.models.get(url);
  }
  function upgrade(root) {
    const shared = new Map(), mats = {};
    root.traverse(o => {
      if (!o.isMesh) return;
      const old = o.material, n = old.name; let m = shared.get(n);
      if (!m) {
        if (n.startsWith('Lenses')) m = mats.lens = new THREE.MeshPhysicalMaterial({ name: n, roughness: .02, transmission: .78, thickness: .0025, ior: 1.52,
          attenuationDistance: Infinity, clearcoat: 1, clearcoatRoughness: .01, envMapIntensity: 1.6, iridescence: .15, iridescenceIOR: 1.6 });
        else if (n.startsWith('Print')) m = mats.print = new THREE.MeshPhysicalMaterial({ name: n, color: '#2b3236', roughness: .5 });
        else if (n.startsWith('Hinges')) m = new THREE.MeshPhysicalMaterial({ name: n, color: '#9aa4a8', metalness: 1, roughness: .18, envMapIntensity: 1.4 });
        else {
          m = new THREE.MeshPhysicalMaterial({ name: n, color: old.color.clone(), metalness: old.metalness, roughness: old.roughness, clearcoat: .6, clearcoatRoughness: .05, envMapIntensity: 1.35 });
          if (n.startsWith('Frame')) mats.frame = m; if (n.startsWith('Temple facets')) mats.facet = m;
        }
        shared.set(n, m);
      }
      o.material = m;
    });
    return mats;
  }
  function applyFinish() {
    const f = FRAMES[t.finish.frame], l = LENSES[t.finish.lens], m = t.mats;
    if (m.frame) { Object.assign(m.frame, { metalness: f.metal, roughness: f.rough, clearcoat: f.coat }); m.frame.color.set(f.hex); }
    if (m.facet) { m.facet.color.set(f.facet); m.facet.metalness = Math.min(1, f.metal + .1); m.facet.roughness = f.rough + .08; }
    if (m.lens) {
      m.lens.color.set(l.mirror ? '#c9d2d6' : l.tint).lerp(new THREE.Color(l.hex), .45); m.lens.attenuationColor.set(l.hex);
      m.lens.metalness = l.mirror ? .85 : 0; m.lens.iridescence = l.mirror ? .75 : .15; m.lens.transmission = l.mirror ? 0 : .78;
    }
    if (m.print) { const c = new THREE.Color(f.hex); m.print.color.set(.2126 * c.r + .7152 * c.g + .0722 * c.b > .35 ? '#2b3236' : '#f2f2ee'); }
  }
  function buildScene() {
    if (t.renderer) return;
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.15;
    const scene = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(r); scene.environment = pm.fromScene(new RoomEnvironment(), .04).texture; pm.dispose();
    scene.add(new THREE.HemisphereLight('#ffffff', '#776e66', .5));
    const key = new THREE.DirectionalLight('#fff6ec', 1.7); key.position.set(.4, 1, 1.2); scene.add(key);
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 40000); cam.position.z = 8000;
    const vtex = new THREE.VideoTexture(t.video); vtex.colorSpace = THREE.SRGBColorSpace;
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: vtex, toneMapped: false, side: THREE.DoubleSide, depthWrite: false }));
    bg.position.z = -15000; bg.renderOrder = -2; scene.add(bg);
    const anchor = new THREE.Group(); anchor.visible = false; scene.add(anchor);
    const occ = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), new THREE.MeshBasicMaterial({ colorWrite: false }));
    occ.scale.set(.084, .118, .1); occ.position.set(0, .012, -.122); occ.renderOrder = -1; anchor.add(occ);
    Object.assign(t, { renderer: r, scene, cam, bg, anchor });
  }
  async function placeGlasses(url) {
    if (t.glasses && t.glb === url) return;
    const src = await loadModel(url);
    if (t.glasses) t.anchor.remove(t.glasses);
    const g = src.clone(true);
    g.traverse(o => { if (o.isMesh) o.material = o.material.clone(); if (/^Temple[._ ]?[LR]$/.test(o.name)) o.rotation.set(0, 0, 0); });
    g.position.set(0, -.002, 0);
    t.mats = upgrade(g); t.glasses = g; t.glb = url; t.anchor.add(g); applyFinish(); applyTemple();
  }
  // plain arms: hide the glassi lettering meshes
  function applyTemple() { t.glasses?.traverse(o => { if (/^Logo/.test(o.name)) o.visible = t.lettered; }); }
  function fitVideo() {
    const v = t.video, W = innerWidth, H = innerHeight; if (!v?.videoWidth || !t.renderer) return;
    const k = Math.max(W / v.videoWidth, H / v.videoHeight), dispW = v.videoWidth * k, dispH = v.videoHeight * k;
    t.fit = { W, H, dispW, dispH, offX: (W - dispW) / 2, offY: (H - dispH) / 2 };
    t.renderer.setSize(W, H, false);
    Object.assign(t.cam, { left: -W / 2, right: W / 2, top: H / 2, bottom: -H / 2 }); t.cam.updateProjectionMatrix();
    t.bg.scale.set(-dispW, dispH, 1);
  }
  const _a = new V3(), _b = new V3(), _x = new V3(), _y = new V3(), _z = new V3(), _m = new THREE.Matrix4();
  function solveFace(f) {
    const { W, H, dispW, dispH, offX, offY } = t.fit;
    const P = (i, out) => { const l = f[i]; return out.set(offX + (1 - l.x) * dispW - W / 2, H / 2 - (offY + l.y * dispH), -l.z * dispW); };
    const rE = P(33, new V3()), lE = P(263, new V3()), top = P(10, new V3()), chin = P(152, new V3());
    const iR = P(468, _a), iL = P(473, _b);
    _x.subVectors(rE, lE).normalize(); _y.subVectors(top, chin).normalize();
    _z.crossVectors(_x, _y).normalize(); _y.crossVectors(_z, _x).normalize();
    _m.makeBasis(_x, _y, _z); t.tq.setFromRotationMatrix(_m);
    const ppm = iR.distanceTo(iL) / IPD; t.ts = ppm;
    t.tp.copy(iR).add(iL).multiplyScalar(.5).addScaledVector(_z, .012 * ppm).addScaledVector(_y, -.001 * ppm);
  }
  function frame(now) {
    if (!t.open) return;
    requestAnimationFrame(frame);
    const v = t.video, dt = Math.min(.1, (now - (t.prevT || now)) / 1000); t.prevT = now;
    if (t.lm && v.readyState >= 2 && v.currentTime !== t.lastVT) {
      t.lastVT = v.currentTime;
      let res = null; try { res = t.lm.detectForVideo(v, now); } catch { }
      const f = res?.faceLandmarks?.[0];
      if (f && f.length > 473) {
        solveFace(f);
        if (!t.has) { t.p.copy(t.tp); t.q.copy(t.tq); t.s = t.ts; t.has = true; t.anchor.visible = true; say(''); }
        t.lostAt = 0;
      } else if (t.has) {
        t.lostAt ||= now;
        if (now - t.lostAt > 450) { t.has = false; t.anchor.visible = false; say('Move your face into the frame'); }
      }
    }
    if (t.has) {
      const move = t.p.distanceTo(t.tp) / Math.max(t.s, 1);
      const kp = 1 - Math.exp(-dt * (move > .01 ? 30 : 14)), kr = 1 - Math.exp(-dt * 16), ks = 1 - Math.exp(-dt * 8);
      t.p.lerp(t.tp, kp); t.q.slerp(t.tq, kr); t.s += (t.ts - t.s) * ks;
      t.anchor.position.copy(t.p); t.anchor.quaternion.copy(t.q); t.anchor.scale.setScalar(t.s);
    }
    t.renderer.render(t.scene, t.cam);
  }
  const stopStream = () => { t.stream?.getTracks().forEach(s => s.stop()); t.stream = null; };

  async function open(glbUrl, finish, opts = {}) {
    if (!glbUrl || t.open || t.busy) return;
    t.busy = true; t.finish = { ...finish }; t.lettered = opts.lettered !== false; applyTemple();
    root.hidden = false; t.open = true; t.has = false; document.body.style.overflow = 'hidden';
    say('Starting your camera');
    if (!navigator.mediaDevices?.getUserMedia) { say('This browser cannot use a camera here. Open the site over https on a phone or laptop with a camera.'); t.busy = false; return; }
    const lmP = loadLandmarker();
    lmP.catch(() => { });
    try {
      t.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    } catch (e) {
      const n = e?.name;
      say(n === 'NotAllowedError' ? 'Camera access was turned down. Allow camera access for this site in your browser settings, then try again.'
        : n === 'NotFoundError' ? 'No camera was found on this device.' : 'The camera could not start. Close other apps using it and try again.');
      t.busy = false; return;
    }
    if (!t.open) { stopStream(); t.busy = false; return; }
    if (!t.video) { const v = document.createElement('video'); v.playsInline = true; v.muted = true; v.setAttribute('playsinline', ''); t.video = v; }
    t.video.srcObject = t.stream;
    try { await t.video.play(); } catch { }
    await new Promise(r => t.video.videoWidth ? r() : t.video.addEventListener('loadedmetadata', r, { once: true }));
    buildScene();
    say('Loading the frame');
    try { await placeGlasses(glbUrl); } catch { say('The frame model could not load. Check your connection and try again.'); t.busy = false; return; }
    fitVideo(); t.prevT = 0; requestAnimationFrame(frame);
    say('Loading face tracking');
    try { t.lm = await lmP; say(t.has ? '' : 'Look at the camera'); } catch { say('Face tracking could not load. Check your connection and try again.'); }
    t.busy = false;
  }
  function close() {
    if (!t.open && root.hidden) return;
    t.open = false; stopStream(); if (t.video) t.video.srcObject = null;
    root.hidden = true; t.has = false; if (t.anchor) t.anchor.visible = false; document.body.style.overflow = '';
    onClose?.();
  }
  function setFinish(f) { t.finish = { ...f }; applyFinish(); }
  function setTemple(lettered) { t.lettered = lettered; applyTemple(); }
  addEventListener('resize', () => { if (t.open) fitVideo(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && t.open) close(); });
  return { open, close, setFinish, setTemple, get isOpen() { return t.open; } };
}
