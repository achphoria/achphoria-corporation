/* Renderer 3D (Three.js r128): diorama kantor denah B + taman Jepang, maskot kacang clay yang
   mengikuti simulasi (sim.js / life.js), efek yang bereaksi pada data, pencahayaan siang/senja/malam.
   40 piksel denah = 1 unit dunia. Label & gelembung tetap digambar app.js di kanvas overlay 2D. */
(function () {
  const ACH = window.ACH, world = ACH.world;
  // stub aman: bila Three.js/WebGL tidak ada, dasbor tetap jalan dan semua panggilan kamera jadi no-op
  const noop = () => {};
  const S3 = (ACH.scene3d = { ok: false, K: 0, init: () => false, resize: noop, frame: noop, home: noop, focusRoom: noop, garden: noop, follow: noop, followMul: noop, zoomBy: noop,
    dragStart: noop, dragMove: noop, dragEnd: noop, setBoard: noop, mode: () => 'home', project: () => [0, 0, false], headOf: () => [0, 0], pxPerPlan: () => 1, planAt: () => null, actorAt: () => null, roomLabels: () => [] });
  if (!window.THREE) { S3.error = 'Three.js gagal dimuat'; return; }
  const T = window.THREE;
  const W = ACH.W, H = ACH.H, S = 1 / 40, FY = 0.12, GY = -0.12;
  const wx = (x) => (x - W / 2) * S, wz = (y) => (y - H / 2) * S;
  const px = (X) => X / S + W / 2, pz = (Z) => Z / S + H / 2;
  const BEAN_H = 0.725, AG_SCALE = 1.55, K = (BEAN_H * AG_SCALE) / world.scaleAt(); // unit dunia per px denah tinggi maskot
  const RM = () => !!(ACH.sim && ACH.sim.rhythm.reduced);
  const lowPower = () => innerWidth <= 760 || (navigator.deviceMemory && navigator.deviceMemory <= 4);

  let renderer, scene, camera, helper, sun, hemi, amb, stage;
  const lin = (c) => new T.Color(c).convertSRGBToLinear();
  const MATS = {};
  const mat = (c, o) => { const k = c + (o ? JSON.stringify(o) : ''); return MATS[k] || (MATS[k] = new T.MeshStandardMaterial(Object.assign({ color: lin(c), roughness: 0.86, metalness: 0 }, o || {}))); };
  const glow = (c, i) => new T.MeshStandardMaterial({ color: lin(c), emissive: lin(c), emissiveIntensity: i == null ? 1 : i, roughness: 0.6 });
  function rrShape(w, d, r) {
    const s = new T.Shape(), x = -w / 2, y = -d / 2; r = Math.max(0.001, Math.min(r, w / 2, d / 2));
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
    s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s;
  }
  function rbox(w, d, h, r, m, cast) {
    const b = Math.min(r * 0.6, h * 0.3, 0.06);
    const g = new T.ExtrudeGeometry(rrShape(Math.max(w - 2 * b, 0.01), Math.max(d - 2 * b, 0.01), Math.max(r - b, 0.001)), { depth: Math.max(h - 2 * b, 0.001), bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 3, curveSegments: 5 });
    g.rotateX(-Math.PI / 2); g.translate(0, b, 0);
    const o = new T.Mesh(g, typeof m === 'string' ? mat(m) : m); o.castShadow = cast !== false; o.receiveShadow = true; return o;
  }
  function mesh(geo, m, cast) { const o = new T.Mesh(geo, typeof m === 'string' ? mat(m) : m); o.castShadow = cast !== false; o.receiveShadow = true; return o; }
  const at = (o, x, y, z) => { o.position.set(x, y, z); return o; };
  function cvs(w, h, draw) {
    const c = document.createElement('canvas'); c.width = Math.max(2, Math.round(w)); c.height = Math.max(2, Math.round(h)); draw(c.getContext('2d'), c.width, c.height);
    const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.anisotropy = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 1; return t;
  }
  const hashRand = (seed) => { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };

  /* ---------------- tekstur ---------------- */
  const tatamiTex = (w, h, tint) => cvs(w * 1.5, h * 1.5, (c, cw, ch) => {
    c.fillStyle = '#d4c38c'; c.fillRect(0, 0, cw, ch); c.globalAlpha = 0.16; c.fillStyle = tint; c.fillRect(0, 0, cw, ch); c.globalAlpha = 1;
    const mw = 135, mh = 67; let row = 0;
    for (let y = 0; y < ch; y += mh, row++) for (let x = -(row % 2) * mh; x < cw; x += mw) {
      c.fillStyle = `rgba(120,100,40,${0.03 + ((x + y) % 3) * 0.015})`; c.fillRect(x + 2, y + 2, mw - 4, mh - 4);
      c.strokeStyle = 'rgba(110,90,40,.08)'; c.lineWidth = 1; for (let i = 4; i < mw - 4; i += 4) { c.beginPath(); c.moveTo(x + i, y + 4); c.lineTo(x + i, y + mh - 4); c.stroke(); }
      c.fillStyle = '#3e4a3a'; c.fillRect(x, y, mw, 4); c.fillRect(x, y + mh - 4, mw, 4);
    }
  });
  const plankTex = (w, h, base, seed) => { const rnd = hashRand(seed); return cvs(w * 1.5, h * 1.5, (c, cw, ch) => {
    c.fillStyle = base; c.fillRect(0, 0, cw, ch); const ph = 30;
    for (let y = 0; y < ch; y += ph) {
      let x = -rnd() * 200;
      while (x < cw) {
        const len = 140 + rnd() * 160, l = (rnd() - 0.5) * 0.14;
        c.fillStyle = l > 0 ? `rgba(255,240,210,${l})` : `rgba(60,35,15,${-l})`; c.fillRect(x, y, len, ph);
        c.fillStyle = 'rgba(60,35,15,.28)'; c.fillRect(x, y, 2, ph);
        c.strokeStyle = 'rgba(80,50,25,.07)'; for (let k = 0; k < 3; k++) { c.beginPath(); const yy = y + 5 + rnd() * (ph - 10); c.moveTo(x, yy); c.bezierCurveTo(x + len * 0.3, yy + 3, x + len * 0.6, yy - 3, x + len, yy); c.stroke(); }
        x += len;
      }
      c.fillStyle = 'rgba(60,35,15,.35)'; c.fillRect(0, y, cw, 2);
    }
  }); };
  const studioTex = (w, h) => { const rnd = hashRand(7); return cvs(w * 1.5, h * 1.5, (c, cw, ch) => {
    c.fillStyle = '#ddd4c6'; c.fillRect(0, 0, cw, ch);
    for (let i = 0; i < (cw * ch) / 90; i++) { c.fillStyle = `rgba(${rnd() < 0.5 ? '90,80,70' : '255,255,255'},${rnd() * 0.08})`; c.fillRect(rnd() * cw, rnd() * ch, 2, 2); }
    c.strokeStyle = 'rgba(90,80,70,.12)'; c.lineWidth = 2;
    for (let x = 0; x < cw; x += 180) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, ch); c.stroke(); }
    for (let y = 0; y < ch; y += 180) { c.beginPath(); c.moveTo(0, y); c.lineTo(cw, y); c.stroke(); }
  }); };
  const shojiTex = () => cvs(512, 256, (c, w, h) => { c.fillStyle = '#fbf4e4'; c.fillRect(0, 0, w, h); c.strokeStyle = '#8a6440'; c.lineWidth = 5; c.strokeRect(2, 2, w - 4, h - 4);
    c.lineWidth = 3; for (let x = 0; x < w; x += 42) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); } for (let y = 0; y < h; y += 52) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); } });
  const chartTex = () => { const t = cvs(512, 192, (c, w, h) => { c.fillStyle = '#16203d'; c.fillRect(0, 0, w, h); c.strokeStyle = 'rgba(143,184,222,.18)'; c.lineWidth = 1;
    for (let y = 16; y < h; y += 24) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
    const cols = ['#8fae8b', '#8fb8de', '#e0a64a']; for (let i = 0; i < 24; i++) { const bh = 30 + Math.abs(Math.sin(i * 1.7)) * 100; c.fillStyle = cols[i % 3]; c.fillRect(8 + i * 21, h - 12 - bh, 13, bh); }
    c.strokeStyle = '#f6efe1'; c.lineWidth = 3; c.beginPath(); for (let x = 0; x <= w; x += 16) { const y = 70 + Math.sin(x / 40) * 30 + Math.sin(x / 13) * 8; x ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke(); });
    t.wrapS = T.RepeatWrapping; t.repeat.set(0.5, 1); return t; };
  const corkTex = () => cvs(256, 160, (c, w, h) => { c.fillStyle = '#b98a58'; c.fillRect(0, 0, w, h); const r = hashRand(3); for (let i = 0; i < 900; i++) { c.fillStyle = `rgba(80,50,20,${r() * 0.25})`; c.fillRect(r() * w, r() * h, 2, 2); }
    ['#fff1a8', '#f6c1c1', '#bfe0f5', '#d8f0c4', '#fff'].forEach((col, i) => { c.save(); c.translate(30 + i * 46, 40 + (i % 2) * 55); c.rotate((r() - 0.5) * 0.3); c.fillStyle = col; c.fillRect(-18, -16, 36, 32); c.fillStyle = '#c0392b'; c.beginPath(); c.arc(0, -12, 3, 0, 7); c.fill(); c.restore(); }); });
  const scrollTex = () => cvs(96, 256, (c, w, h) => { c.fillStyle = '#f3ead6'; c.fillRect(0, 0, w, h); c.fillStyle = '#5c6b4f'; c.fillRect(0, 0, w, 18); c.fillRect(0, h - 18, w, 18);
    c.strokeStyle = '#26221c'; c.lineWidth = 7; c.lineCap = 'round'; c.beginPath(); c.arc(w / 2, h / 2 - 10, 26, 0.4, Math.PI * 2 - 0.2); c.stroke(); c.fillStyle = '#c0392b'; c.fillRect(w / 2 + 12, h - 60, 12, 12); });
  const vendTex = () => cvs(128, 256, (c, w, h) => { c.fillStyle = '#e9f1f7'; c.fillRect(0, 0, w, h); const cols = ['#c0392b', '#4a6fa5', '#5f9e6e', '#e0a64a', '#8a6440'];
    for (let r = 0; r < 5; r++) for (let k = 0; k < 4; k++) { c.fillStyle = cols[(r + k) % 5]; c.fillRect(12 + k * 28, 14 + r * 40, 16, 30); c.fillStyle = 'rgba(255,255,255,.5)'; c.fillRect(14 + k * 28, 16 + r * 40, 4, 24); }
    c.fillStyle = '#2e3a63'; c.fillRect(0, h - 48, w, 48); c.fillStyle = '#f6efe1'; c.font = 'bold 22px sans-serif'; c.fillText('お茶', 38, h - 17); });
  const norenTex = (col, kanji) => cvs(128, 96, (c, w, h) => { c.fillStyle = col; c.fillRect(0, 0, w, h); c.fillStyle = 'rgba(0,0,0,.18)'; c.fillRect(w / 2 - 2, 0, 4, h);
    c.fillStyle = '#fffaf0'; c.font = 'bold 40px serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(kanji, w / 2, h / 2 + 6); });
  const grassTex = () => { const t = cvs(256, 256, (c, w, h) => { const r = hashRand(42); c.fillStyle = '#86ad63'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) { const x = r() * w, y = r() * h; c.strokeStyle = r() < 0.5 ? 'rgba(60,95,40,' + (0.1 + r() * 0.15) + ')' : 'rgba(200,225,140,' + (0.08 + r() * 0.12) + ')'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(x, y); c.lineTo(x + (r() - 0.5) * 3, y - 3 - r() * 4); c.stroke(); }
    for (let i = 0; i < 14; i++) { c.fillStyle = ['#f6efe1', '#f4b6c8', '#ffe08a'][i % 3]; c.beginPath(); c.arc(r() * w, r() * h, 1.6, 0, 7); c.fill(); } });
    t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(10, 7); return t; };
  const gravelTex = (w, h) => cvs(w * 40, h * 40, (c, cw, ch) => { const r = hashRand(9); c.fillStyle = '#e4ddcf'; c.fillRect(0, 0, cw, ch);
    for (let i = 0; i < (cw * ch) / 30; i++) { c.fillStyle = 'rgba(' + (r() < 0.5 ? '120,110,95' : '255,255,255') + ',' + r() * 0.25 + ')'; c.fillRect(r() * cw, r() * ch, 2, 2); }
    c.strokeStyle = 'rgba(130,118,100,.35)'; c.lineWidth = 2; for (let y = 8; y < ch; y += 10) { c.beginPath(); for (let x = 0; x <= cw; x += 8) { const yy = y + Math.sin(x / 40) * 2; x ? c.lineTo(x, yy) : c.moveTo(x, yy); } c.stroke(); } });
  const waterTex = () => { const t = cvs(256, 256, (c, w, h) => { c.fillStyle = '#5d93a8'; c.fillRect(0, 0, w, h); const r = hashRand(5); c.strokeStyle = 'rgba(255,255,255,.25)'; c.lineWidth = 2;
    for (let i = 0; i < 40; i++) { const x = r() * w, y = r() * h, l = 10 + r() * 30; c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + l / 2, y - 3, x + l, y); c.stroke(); } });
    t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(0.45, 0.45); return t; };

  /* ---------------- bahan & bentuk bersama ---------------- */
  let M, BEAN, JACKET, EYE, BLUSH, RING;
  function initShared() {
    M = { wood: mat('#a9825a'), woodD: mat('#7a5636'), woodL: mat('#c9a476'), plaster: mat('#efe4cf'), beam: mat('#5e4330'), pot: mat('#c47a52'), leaf: mat('#7fa36b'), leaf2: mat('#6b9160'),
      rack: mat('#3a3f4f', { roughness: 0.6 }), white: mat('#f6efe1'), paper: mat('#fff7e6'), iron: mat('#3b3634', { roughness: 0.5, metalness: 0.3 }) };
    BEAN = new T.LatheGeometry([[0, 0], [0.16, 0.012], [0.25, 0.08], [0.29, 0.2], [0.29, 0.36], [0.265, 0.5], [0.2, 0.62], [0.1, 0.7], [0, 0.725]].map((p) => new T.Vector2(p[0], p[1])), 30);
    JACKET = new T.LatheGeometry([[0.2, 0.018], [0.262, 0.075], [0.3, 0.19], [0.302, 0.3], [0.25, 0.315]].map((p) => new T.Vector2(p[0], p[1])), 30);
    EYE = new T.SphereGeometry(0.036, 12, 10); BLUSH = new T.SphereGeometry(0.05, 12, 8);
    RING = new T.TorusGeometry(0.42, 0.035, 8, 40);
  }

  /* ---------------- objek kantor ---------------- */
  let FX = null, OUT = null, floors = [], building = null;
  function plant(x, z, s, y) { const g = new T.Group(); g.add(at(rbox(0.32 * s, 0.32 * s, 0.3 * s, 0.1 * s, M.pot), 0, 0, 0));
    [[0, 0.55, 0, 0.22], [0.12, 0.45, 0.05, 0.16], [-0.11, 0.47, -0.04, 0.17], [0.03, 0.68, -0.06, 0.15]].forEach(([x1, y1, z1, r], i) => g.add(at(mesh(new T.SphereGeometry(r * s, 14, 12), i % 2 ? M.leaf2 : M.leaf), x1 * s, y1 * s, z1 * s)));
    return at(g, x, y == null ? FY : y, z); }
  function lantern(x, z, y, big, color) {
    const g = new T.Group(), r = big ? 0.32 : 0.2, m = glow(color || '#ffd59a', 0.85);
    const body = mesh(new T.SphereGeometry(r, 20, 16), m, false); body.scale.set(1, 1.3, 1); g.add(body);
    g.add(at(mesh(new T.CylinderGeometry(r * 0.55, r * 0.55, 0.06, 16), M.iron, false), 0, r * 1.25, 0)); g.add(at(mesh(new T.CylinderGeometry(r * 0.5, r * 0.5, 0.05, 16), M.iron, false), 0, -r * 1.25, 0));
    g.add(at(mesh(new T.CylinderGeometry(0.01, 0.01, 1.4, 4), M.iron, false), 0, r * 1.3 + 0.7, 0));
    const pl = S3.low ? null : new T.PointLight(lin('#ffb866'), big ? 0.9 : 0.5, big ? 9 : 6, 2); if (pl) g.add(pl);
    g.userData = { m, pl, base: big ? 0.9 : 0.5 }; return at(g, x, y, z);
  }
  function wallSeg(x1, z1, x2, z2, h, m) { const len = Math.hypot(x2 - x1, z2 - z1); if (len < 0.05) return null;
    const s = rbox(len, 0.16, h, 0.05, m); s.position.set((x1 + x2) / 2, FY, (z1 + z2) / 2); s.rotation.y = -Math.atan2(z2 - z1, x2 - x1); return s; }
  function doorFrame(x, z, vertical, color, kanji, y) {
    const g = new T.Group(), half = 0.62;
    [-half, half].forEach((o) => g.add(at(rbox(0.12, 0.12, 1.7, 0.03, M.beam), vertical ? 0 : o, 0, vertical ? o : 0)));
    const beam = rbox(vertical ? 0.14 : half * 2 + 0.2, vertical ? half * 2 + 0.2 : 0.14, 0.12, 0.03, M.beam); beam.position.y = 1.68; g.add(beam);
    const nm = new T.MeshStandardMaterial({ map: norenTex(color, kanji), side: T.DoubleSide, roughness: 0.95 });
    [-1, 1].forEach((s) => { const p = mesh(new T.PlaneGeometry(half * 0.95, 0.55), nm, true); p.position.set(vertical ? 0 : s * half * 0.5, 1.36, vertical ? s * half * 0.5 : 0); if (vertical) p.rotation.y = Math.PI / 2; g.add(p); });
    return at(g, x, y == null ? FY : y, z);
  }
  function deskMesh(k, div, isHead) {
    const g = new T.Group(), w = k.w * S, d = k.h * S, top = isHead ? 0.34 : 0.3;
    g.add(at(rbox(w, d + 0.04, 0.07, 0.06, isHead ? '#8a6440' : '#a9825a'), 0, top - 0.07, 0));
    [-1, 1].forEach((s) => g.add(at(rbox(0.08, d * 0.8, top - 0.07, 0.03, M.woodD), s * (w / 2 - 0.09), 0, 0)));
    const bulbM = glow('#ffe1a6', 0.05);
    const lamp = new T.Group(); lamp.add(mesh(new T.CylinderGeometry(0.05, 0.06, 0.02, 12), M.iron)); lamp.add(at(mesh(new T.CylinderGeometry(0.012, 0.012, 0.2, 6), M.iron), 0, 0.1, 0));
    const shade = mesh(new T.ConeGeometry(0.09, 0.09, 16, 1, true), new T.MeshStandardMaterial({ color: lin('#2e3a63'), side: T.DoubleSide, roughness: 0.7 })); shade.position.y = 0.22; lamp.add(shade);
    lamp.add(at(mesh(new T.SphereGeometry(0.035, 10, 8), bulbM, false), 0, 0.19, 0));
    g.add(at(lamp, -w / 2 + 0.14, top, d / 4));
    const P = new T.Group(), s = isHead ? 1 : 0.75;
    if (div === 'chief') { const sc = mesh(new T.CylinderGeometry(0.045, 0.045, 0.34, 12), M.paper); sc.rotation.z = Math.PI / 2; P.add(at(sc, 0, 0.05, 0)); P.add(at(rbox(0.18, 0.12, 0.02, 0.01, '#c0392b'), 0.12, 0, -0.1)); }
    if (div === 'research') ['#c0392b', '#4a6fa5', '#e0a64a'].forEach((c, i) => { const b = rbox(0.22 - i * 0.02, 0.16, 0.05, 0.01, c); b.position.y = i * 0.05; b.rotation.y = i * 0.25; P.add(b); });
    if (div === 'ops') { P.add(rbox(0.24, 0.17, 0.02, 0.02, M.rack)); const sc = mesh(new T.PlaneGeometry(0.2, 0.13), glow('#8fd0a0', 0.7), false); sc.rotation.x = -Math.PI / 2; P.add(at(sc, 0, 0.022, 0)); }
    if (div === 'content') { P.add(rbox(0.18, 0.12, 0.12, 0.03, M.rack)); const l = mesh(new T.CylinderGeometry(0.045, 0.05, 0.08, 14), M.iron); l.rotation.x = Math.PI / 2; P.add(at(l, 0, 0.06, 0.09)); }
    if (div === 'engineering') { P.add(rbox(0.3, 0.2, 0.02, 0.02, M.rack)); const scr = at(rbox(0.3, 0.02, 0.2, 0.01, M.rack), 0, 0.02, 0.1); scr.rotation.x = 0.25; P.add(scr);
      const gs = mesh(new T.PlaneGeometry(0.26, 0.16), glow('#7fb8ff', 0.8), false); gs.position.set(0, 0.12, 0.088); gs.rotation.set(0.25, Math.PI, 0); P.add(gs); }
    P.scale.setScalar(s); g.add(at(P, w / 2 - (isHead ? 0.35 : 0.22), top, 0));
    g.position.set(wx(k.x + k.w / 2), FY, wz(k.y + k.h / 2));
    return { g, bulbM };
  }
  const zabuton = (p, c) => at(rbox(0.42, 0.42, 0.07, 0.12, c), wx(p.x), FY, wz(p.y));
  function backSlots(r) { const L = r.x + 18, R = r.x + r.w - 18; return r.door === 't' ? [[L, r.cx - 44], [r.cx + 44, R]] : [[L, R]]; }
  function decorate(r, B) {
    const z1 = wz(r.y), slots = backSlots(r), wide = slots.reduce((a, s) => (s[1] - s[0] > a[1] - a[0] ? s : a));
    if (r.id === 'research') {
      slots.forEach(([a, b]) => { const n = Math.max(1, Math.floor((b - a) / 74)); for (let i = 0; i < n; i++) {
        const sx = wx(a + ((b - a) * (i + 0.5)) / n), sh = new T.Group(); sh.add(rbox(1.6, 0.42, 1.45, 0.04, M.woodD));
        for (let row = 0; row < 3; row++) { sh.add(at(rbox(1.5, 0.38, 0.04, 0.01, M.wood), 0, 0.12 + row * 0.44, 0.02));
          let x = -0.68; const rr = hashRand(i * 7 + row + r.x); while (x < 0.62) { const bw = 0.06 + rr() * 0.07, bh = 0.26 + rr() * 0.1; sh.add(at(rbox(bw, 0.26, bh, 0.01, ['#c0392b', '#4a6fa5', '#e0a64a', '#5f9e6e', '#f6efe1', '#8a6440'][Math.floor(rr() * 6)], false), x + bw / 2, 0.16 + row * 0.44, 0.04)); x += bw + 0.01; } }
        sh.scale.set(Math.min(1, (((b - a) / n) * S - 0.1) / 1.6), 1, 1); B.add(at(sh, sx, FY, z1 + 0.32)); } });
      B.add(plant(wx(r.x + r.w - 26), wz(r.y + r.h - 40), 1.1));
    }
    if (r.id === 'ops') {
      const [a, b] = wide, ww = Math.min((b - a) * S * 0.85, 6), tex = chartTex(), m = new T.MeshStandardMaterial({ map: tex, emissive: new T.Color(1, 1, 1), emissiveMap: tex, emissiveIntensity: 0.5, roughness: 0.5 });
      B.add(at(rbox(ww + 0.16, 0.1, 1.0, 0.04, M.rack), wx((a + b) / 2), FY + 0.35, z1 + 0.15));
      const sc = mesh(new T.PlaneGeometry(ww, 0.86), m, false); sc.position.set(wx((a + b) / 2), FY + 0.85, z1 + 0.21); B.add(sc); FX.screens.push({ tex, m });
      B.add(plant(wx(r.x + 24), wz(r.y + r.h - 40), 1)); B.add(plant(wx(r.x + r.w - 24), wz(r.y + r.h - 40), 0.9));
    }
    if (r.id === 'content') {
      const [a, b] = slots[0], cw = Math.min((b - a) * S * 0.7, 3.2);
      const ck = mesh(new T.PlaneGeometry(cw, 0.8), new T.MeshStandardMaterial({ map: corkTex(), roughness: 1 }), false); ck.position.set(wx(a) + cw / 2 + 0.1, FY + 0.85, z1 + 0.1); B.add(ck);
      const rx = wx(r.x + r.w - 30), rz = wz(r.y + r.h * 0.4), ring = mesh(new T.TorusGeometry(0.32, 0.045, 12, 40), glow('#fff6e0', 0.3), false); ring.position.set(rx, FY + 1.1, rz); B.add(ring); FX.rings.push(ring.material);
      B.add(at(mesh(new T.CylinderGeometry(0.02, 0.02, 1.1, 6), M.iron), rx, FY + 0.55, rz));
      const tp = new T.Group(); [0, 2.1, 4.2].forEach((an) => { const leg = mesh(new T.CylinderGeometry(0.015, 0.015, 1.0, 6), M.iron); leg.position.set(Math.cos(an) * 0.15, 0.48, Math.sin(an) * 0.15); leg.rotation.set(Math.sin(an) * 0.3, 0, -Math.cos(an) * 0.3); tp.add(leg); });
      tp.add(at(rbox(0.3, 0.18, 0.2, 0.04, M.rack), 0, 0.98, 0)); const lens = mesh(new T.CylinderGeometry(0.07, 0.08, 0.16, 16), M.iron); lens.rotation.x = Math.PI / 2; tp.add(at(lens, 0, 1.08, 0.16));
      B.add(at(tp, wx(r.x + 30), FY, wz(r.y + r.h * 0.4))); B.add(plant(wx(r.x + r.w - 24), wz(r.y + r.h - 40), 1));
    }
    if (r.id === 'engineering') {
      slots.forEach(([a, b]) => { const n = Math.max(1, Math.min(4, Math.floor((b - a) / 48))); for (let i = 0; i < n; i++) {
        const sx = wx(a + ((b - a) * (i + 0.5)) / n), rk = new T.Group(); rk.add(rbox(0.8, 0.6, 1.6, 0.05, M.rack)); rk.add(at(rbox(0.7, 0.02, 1.45, 0.02, '#2a2e3a', false), 0, 0.07, 0.3));
        for (let yy = 0; yy < 7; yy++) for (let xx = 0; xx < 3; xx++) { const lm = glow(['#7fe0a0', '#7fb8ff', '#ffcf6a'][(xx + yy) % 3], 1); const led = mesh(new T.BoxGeometry(0.05, 0.03, 0.01), lm, false); led.position.set(-0.22 + xx * 0.1, 0.22 + yy * 0.19, 0.315); rk.add(led); FX.leds.push(lm); }
        B.add(at(rk, sx, FY, z1 + 0.42)); } });
      B.add(plant(wx(r.x + 24), wz(r.y + r.h - 40), 0.9));
    }
    if (r.id === 'chief') {
      const sm = new T.MeshStandardMaterial({ map: shojiTex(), emissive: lin('#fff2d8'), emissiveIntensity: 0.18, roughness: 0.9 });
      slots.forEach(([a, b]) => { const p = mesh(new T.PlaneGeometry((b - a) * S, 1.25), sm, false); p.position.set(wx((a + b) / 2), FY + 0.75, z1 + 0.1); B.add(p); });
      const kk = mesh(new T.PlaneGeometry(0.42, 1.05), new T.MeshStandardMaterial({ map: scrollTex(), roughness: 1 }), false); kk.position.set(wx(r.x + 44), FY + 0.8, z1 + 0.12); B.add(kk);
      B.add(plant(wx(r.x + r.w - 24), wz(r.y + 34), 1.15)); B.add(plant(wx(r.x + 24), wz(r.y + r.h - 34), 0.9));
    }
  }
  function boardTex(info) {
    info = info || { kerja: 0, jadwal: 0, selesai: 0 };
    return cvs(320, 200, (c, w, h) => {
      c.fillStyle = '#fbfaf5'; c.fillRect(0, 0, w, h); c.strokeStyle = '#b9b1a3'; c.lineWidth = 8; c.strokeRect(4, 4, w - 8, h - 8);
      c.fillStyle = '#c0392b'; c.font = 'bold 26px serif'; c.fillText('HARI INI · 本日', 22, 42);
      c.font = 'bold 24px sans-serif';
      [['Sedang kerja', info.kerja, '#3f7a4f'], ['Terjadwal', info.jadwal, '#3d5a99'], ['Selesai', info.selesai, '#c0392b']].forEach(([l, n, col], i) => {
        c.fillStyle = '#2e3a63'; c.fillText(l, 26, 90 + i * 38); c.fillStyle = col; c.textAlign = 'right'; c.fillText(String(n), w - 28, 90 + i * 38); c.textAlign = 'left';
      });
    });
  }
  function facility(f, B) {
    const g = new T.Group(), w = f.w * S, d = f.h * S;
    if (f.key === 'tea') { g.add(rbox(w, d, 0.5, 0.06, M.wood)); g.add(at(rbox(w - 0.06, d - 0.06, 0.03, 0.05, M.woodL), 0, 0.5, 0));
      const k = mesh(new T.SphereGeometry(0.13, 16, 12), M.iron); k.scale.y = 0.8; g.add(at(k, -w * 0.2, 0.62, 0)); g.add(at(mesh(new T.CylinderGeometry(0.02, 0.03, 0.14, 8), M.iron), -w * 0.2 + 0.14, 0.64, 0));
      [0, 1, 2].forEach((i) => g.add(at(mesh(new T.CylinderGeometry(0.045, 0.035, 0.07, 12), M.white), w * 0.08 + i * 0.14, 0.565, 0.04)));
      FX.steam.push({ kind: 'tea', x: wx(f.x + f.w / 2) - w * 0.2, y: FY + 0.75, z: wz(f.y + f.h / 2), parts: [] }); }
    if (f.key === 'ramen') { g.add(rbox(w, d, 0.55, 0.06, '#7a3b2e')); g.add(at(rbox(w + 0.04, d + 0.04, 0.04, 0.05, M.woodL), 0, 0.55, 0));
      [0, 1, 2].forEach((i) => { const b = mesh(new T.SphereGeometry(0.09, 14, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), M.white); b.rotation.x = Math.PI; g.add(at(b, -w * 0.3 + i * w * 0.3, 0.68, 0.05));
        const soup = mesh(new T.CircleGeometry(0.08, 14), mat('#e8b86a'), false); soup.rotation.x = -Math.PI / 2; g.add(at(soup, -w * 0.3 + i * w * 0.3, 0.681, 0.05)); });
      world.SPOTS.ramen.filter((s) => s.pose === 'stool').forEach((s) => B.add(at(rbox(0.3, 0.3, 0.4, 0.1, '#5e4330'), wx(s.x), FY, wz(s.y))));
      const ak = lantern(w / 2 - 0.1, -d / 2, 1.2, false, '#ff8a6a'); ak.scale.setScalar(0.8); g.add(ak); FX.lanterns.push(ak);
      FX.steam.push({ kind: 'ramen', x: wx(f.x + f.w / 2), y: FY + 0.75, z: wz(f.y + f.h / 2) + 0.05, parts: [] }); }
    if (f.key === 'whiteboard') { [-1, 1].forEach((s) => g.add(at(rbox(0.06, 0.06, 1.5, 0.02, M.iron), s * (w / 2 - 0.05), 0, 0)));
      const bm = new T.MeshStandardMaterial({ map: boardTex(), roughness: 0.6 }); const bp = mesh(new T.PlaneGeometry(w - 0.04, 0.92), bm, false); bp.position.set(0, 1.0, 0.04); g.add(bp);
      g.add(at(rbox(w, 0.08, 0.96, 0.03, '#d9d4c7'), 0, 0.52, -0.02)); FX.board = bm; }
    if (f.key === 'tatami') { g.add(rbox(w, d, 0.18, 0.08, M.woodD)); const t = mesh(new T.PlaneGeometry(w - 0.08, d - 0.08), new T.MeshStandardMaterial({ map: tatamiTex(f.w, f.h, '#8fae8b'), roughness: 0.95 }), false); t.rotation.x = -Math.PI / 2; g.add(at(t, 0, 0.181, 0));
      world.SPOTS.tatami.forEach((s) => B.add(at(rbox(0.42, 0.3, 0.06, 0.1, '#5a669c'), wx(s.x) - s.face * 0.55, FY + 0.18, wz(s.y)))); }
    if (f.key === 'vending') { const vw = Math.min(w * 0.6, 1.0); g.add(at(rbox(vw, 0.62, 1.55, 0.06, '#c0392b'), -w / 2 + vw / 2, 0, 0)); const tex = vendTex();
      const p = mesh(new T.PlaneGeometry(vw - 0.14, 1.2), new T.MeshStandardMaterial({ map: tex, emissive: new T.Color(1, 1, 1), emissiveMap: tex, emissiveIntensity: 0.55 }), false); g.add(at(p, -w / 2 + vw / 2, 0.85, 0.312));
      g.add(at(rbox(w - vw - 0.1, 0.4, 0.42, 0.05, '#4a6fa5'), w / 2 - (w - vw - 0.1) / 2, 0, 0)); }
    if (f.key === 'lounge') { g.add(at(rbox(w, 0.5, 0.3, 0.12, '#5a669c'), 0, 0, -d / 2 + 0.25)); g.add(at(rbox(w, 0.18, 0.62, 0.08, '#4a5688'), 0, 0, -d / 2 + 0.09));
      [-1, 1].forEach((s) => g.add(at(rbox(w * 0.42, 0.42, 0.1, 0.12, '#e7d9bf'), s * w * 0.23, 0.3, -d / 2 + 0.27))); g.add(at(rbox(0.7, 0.4, 0.24, 0.08, M.woodD), 0, 0, d / 2 - 0.2)); }
    return at(g, wx(f.x + f.w / 2), FY, wz(f.y + f.h / 2));
  }

  /* ---------------- taman ---------------- */
  function rock(sz, c) { const m = mesh(new T.IcosahedronGeometry(sz, 0), c || '#a8a397'); m.scale.set(1, 0.55, 0.85); m.rotation.y = sz * 17; return m; }
  function sakura(g, x, z, s, cols) { const t = new T.Group(), bark = mat('#6b4a3a');
    const tr = mesh(new T.CylinderGeometry(0.11 * s, 0.18 * s, 1.7 * s, 8), bark); tr.position.y = 0.85 * s; tr.rotation.z = 0.08; t.add(tr);
    [[0.5, 1.45, 0.1, -0.7], [-0.45, 1.5, -0.15, 0.6]].forEach(([bx, by, bz, rz]) => { const b = mesh(new T.CylinderGeometry(0.05 * s, 0.08 * s, 0.9 * s, 6), bark); b.position.set(bx * s * 0.5, by * s, bz * s); b.rotation.z = rz; t.add(b); });
    const pal = cols || ['#f4b6c8', '#f7c9d6', '#eea3bb', '#fbd9e3'], r = hashRand(Math.round(Math.abs(x * 13 + z * 7)) + 3);
    for (let i = 0; i < 9; i++) { const a = r() * Math.PI * 2, d = r() * 0.75 * s, sp = mesh(new T.SphereGeometry((0.45 + r() * 0.35) * s, 14, 12), pal[i % 4]); sp.position.set(Math.cos(a) * d, (1.9 + r() * 0.6) * s, Math.sin(a) * d); t.add(sp); }
    if (!cols) OUT.trees.push({ x, z }); g.add(at(t, x, GY, z)); }
  function pine(g, x, z, s) { const t = new T.Group(), tr = mesh(new T.CylinderGeometry(0.1 * s, 0.16 * s, 1.2 * s, 8), '#5e4636'); tr.position.y = 0.6 * s; t.add(tr);
    [[0, 1.1, 0, 0.85], [0.35, 1.55, 0.1, 0.65], [-0.25, 1.9, -0.1, 0.55], [0.05, 2.25, 0, 0.4]].forEach(([x1, y1, z1, r], i) => { const l = mesh(new T.SphereGeometry(r * s, 14, 10), i % 2 ? '#4f7a52' : '#5b8a5c'); l.scale.y = 0.42; l.position.set(x1 * s, y1 * s, z1 * s); t.add(l); });
    g.add(at(t, x, GY, z)); }
  function bamboo(g, x, z) { const t = new T.Group(), r = hashRand(77);
    for (let i = 0; i < 14; i++) { const h = 2.6 + r() * 1.6, bx = (r() - 0.5) * 2.2, bz = (r() - 0.5) * 1.6, st = mesh(new T.CylinderGeometry(0.05, 0.06, h, 6), '#7fae5a'); st.position.set(bx, h / 2, bz); st.rotation.z = (r() - 0.5) * 0.12; t.add(st);
      for (let k = 0; k < 3; k++) { const lf = mesh(new T.SphereGeometry(0.22 + r() * 0.15, 10, 8), '#8fbf6a'); lf.scale.y = 0.5; lf.position.set(bx + (r() - 0.5) * 0.5, h - 0.2 - k * 0.45, bz + (r() - 0.5) * 0.5); t.add(lf); } }
    g.add(at(t, x, GY, z)); }
  function toro(g, x, z) { const t = new T.Group(), st = '#aaa69b', lm = glow('#ffd59a', 0.9);
    t.add(at(mesh(new T.CylinderGeometry(0.22, 0.26, 0.14, 6), st), 0, 0.07, 0)); t.add(at(mesh(new T.CylinderGeometry(0.08, 0.1, 0.6, 6), st), 0, 0.44, 0));
    t.add(at(mesh(new T.CylinderGeometry(0.24, 0.2, 0.08, 6), st), 0, 0.78, 0)); t.add(at(rbox(0.3, 0.3, 0.26, 0.03, lm, false), 0, 0.82, 0));
    t.add(at(mesh(new T.ConeGeometry(0.36, 0.24, 6), st), 0, 1.2, 0)); t.add(at(mesh(new T.SphereGeometry(0.06, 8, 6), st), 0, 1.34, 0));
    OUT.toro.push(lm); g.add(at(t, x, GY, z)); }
  function gate(g, x, z) { const t = new T.Group(), red = '#b8432f';
    [-1.15, 1.15].forEach((o) => t.add(at(rbox(0.22, 0.22, 2.4, 0.04, red), o, 0, 0)));
    t.add(at(rbox(2.9, 0.24, 0.18, 0.04, red), 0, 2.0, 0)); t.add(at(rbox(3.5, 0.6, 0.14, 0.06, '#3d3a3a'), 0, 2.4, 0));
    const tex = cvs(180, 100, (c, w, h) => { c.fillStyle = '#2e3a63'; c.fillRect(0, 0, w, h); c.strokeStyle = '#e0a64a'; c.lineWidth = 6; c.strokeRect(3, 3, w - 6, h - 6); c.fillStyle = '#f6efe1'; c.font = 'bold 52px serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('達成', w / 2, h / 2 + 3); });
    t.add(at(mesh(new T.PlaneGeometry(0.9, 0.5), new T.MeshStandardMaterial({ map: tex, roughness: 0.8 }), false), 0, 1.62, 0.13));
    g.add(at(t, x, GY, z)); }
  function bench(g, x, z, ry) { const t = new T.Group(); t.add(at(rbox(1.3, 0.42, 0.08, 0.04, M.wood), 0, 0.36, 0)); t.add(at(rbox(1.3, 0.08, 0.38, 0.03, M.wood), 0, 0.42, -0.18));
    [-0.5, 0.5].forEach((o) => t.add(at(rbox(0.08, 0.36, 0.36, 0.02, M.beam), o, 0, 0))); t.rotation.y = ry; g.add(at(t, x, GY, z)); }
  function pond(g, x, z, w, d) { const p = new T.Group(), sh = new T.Shape(), N = 32, rr = (a) => 1 + 0.12 * Math.sin(a * 3) + 0.06 * Math.cos(a * 5);
    for (let i = 0; i <= N; i++) { const a = (i / N) * Math.PI * 2, X = Math.cos(a) * (w / 2) * rr(a), Y = Math.sin(a) * (d / 2) * rr(a); i ? sh.lineTo(X, Y) : sh.moveTo(X, Y); }
    const deep = mesh(new T.ShapeGeometry(sh), '#2f5566', false); deep.rotation.x = -Math.PI / 2; deep.position.y = 0.006; p.add(deep);
    const wt = waterTex(), wm = new T.MeshStandardMaterial({ map: wt, transparent: true, opacity: 0.8, roughness: 0.15, metalness: 0.1, emissive: lin('#2c5a6e'), emissiveIntensity: 0.25 });
    const water = mesh(new T.ShapeGeometry(sh), wm, false); water.rotation.x = -Math.PI / 2; water.position.y = 0.07; p.add(water); OUT.water = wt;
    for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; p.add(at(rock(0.17 + ((i * 37) % 10) / 60), Math.cos(a) * (w / 2) * rr(a) * 1.04, 0.03, -Math.sin(a) * (d / 2) * rr(a) * 1.04)); }
    [['#f08a3c', 0], ['#f6efe1', 1.6], ['#e0572f', 3.1], ['#f2b04a', 4.4]].forEach(([c, ph], i) => { const k = mesh(new T.SphereGeometry(0.13, 12, 8), c, false); k.scale.set(0.45, 0.35, 1); p.add(k);
      const tail = mesh(new T.ConeGeometry(0.06, 0.14, 6), c, false); tail.rotation.x = -Math.PI / 2; tail.position.z = -0.16; k.add(tail);
      OUT.koi.push({ m: k, a: ph, sp: 0.35 + i * 0.07, rx: w * 0.3, rz: d * 0.26 }); });
    g.add(at(p, x, GY, z)); }
  function outdoor() {
    OUT = { toro: [], koi: [], water: null, petals: null, trees: [] };
    const g = new T.Group(), X0 = -21, X1 = 21, Z0 = -14, Z1 = 16.5, cz = (Z0 + Z1) / 2;
    g.add(at(rbox(X1 - X0, Z1 - Z0, 0.78, 1.4, '#6b4a33'), 0, -0.9, cz));
    const gr = mesh(new T.PlaneGeometry(X1 - X0 - 0.5, Z1 - Z0 - 0.5), new T.MeshStandardMaterial({ map: grassTex(), roughness: 0.95 }), false); gr.rotation.x = -Math.PI / 2; gr.position.set(0, GY + 0.002, cz); g.add(gr);
    const hedge = (x1, z1, x2, z2) => { const len = Math.hypot(x2 - x1, z2 - z1), n = Math.max(1, Math.round(len / 3.6)); for (let i = 0; i < n; i++) {
      const ax = x1 + ((x2 - x1) * i) / n, az = z1 + ((z2 - z1) * i) / n, bx = x1 + ((x2 - x1) * (i + 1)) / n, bz = z1 + ((z2 - z1) * (i + 1)) / n;
      const h = rbox(Math.hypot(bx - ax, bz - az) - 0.15, 0.6, 0.55, 0.25, '#6f9a58'); h.position.set((ax + bx) / 2, GY, (az + bz) / 2); h.rotation.y = -Math.atan2(bz - az, bx - ax); g.add(h); } };
    hedge(X0 + 0.6, Z0 + 0.6, X1 - 0.6, Z0 + 0.6); hedge(X0 + 0.6, Z0 + 0.6, X0 + 0.6, Z1 - 0.6); hedge(X1 - 0.6, Z0 + 0.6, X1 - 0.6, Z1 - 0.6); hedge(X0 + 0.6, Z1 - 0.6, -2.1, Z1 - 0.6); hedge(2.1, Z1 - 0.6, X1 - 0.6, Z1 - 0.6);
    const gx = wx(world.GATE[0]);
    gate(g, gx, Z1 - 0.6);
    for (let i = 0, z = (H * S) / 2 + 1.1; z < Z1 - 1; z += 0.85, i++) { const st = mesh(new T.CylinderGeometry(0.36 + ((i * 7) % 3) * 0.04, 0.4, 0.08, 9), '#b7b2a6'); st.position.set(gx + (i % 2 ? 0.28 : -0.28), GY, z); st.rotation.y = i; g.add(st); }
    toro(g, gx - 1.7, 12.3); toro(g, gx + 1.7, 12.3); toro(g, -15.6, 10.9); toro(g, 16, 11.2); toro(g, -8.5, -11.9);
    pond(g, -11.6, 12.7, 6.6, 3.4);
    const zx = 11.6, zz = 12.7, zw = 6, zd = 3.2; g.add(at(rbox(zw + 0.3, zd + 0.3, 0.1, 0.08, M.woodD), zx, GY, zz));
    const gv = mesh(new T.PlaneGeometry(zw, zd), new T.MeshStandardMaterial({ map: gravelTex(zw, zd), roughness: 1 }), false); gv.rotation.x = -Math.PI / 2; gv.position.set(zx, GY + 0.105, zz); g.add(gv);
    [[-1.6, -0.3, 0.45], [0.9, 0.5, 0.6], [1.9, -0.6, 0.3]].forEach(([ox, oz, sz]) => { const r = rock(sz, '#8f8a80'); r.position.set(zx + ox, GY + 0.12, zz + oz); g.add(r); const m = mesh(new T.SphereGeometry(sz * 0.9, 12, 8), '#6f9a58'); m.scale.y = 0.2; m.position.set(zx + ox, GY + 0.11, zz + oz); g.add(m); });
    [[-5.3, 13.9, 1.1], [5.5, 14.2, 1], [-18.2, 6, 1.2], [18.3, -3, 1.15], [-17, -11, 1], [3, -12.3, 0.9], [19.2, 12.3, 1], [-19.3, -6.5, 0.95]].forEach(([x, z, s]) => sakura(g, x, z, s));
    [[-19, 1.2, 1], [14.2, -12.4, 0.95], [19.2, -8.4, 1.05]].forEach(([x, z, s]) => sakura(g, x, z, s, ['#d9583b', '#e8823f', '#c9442f', '#f0a04b']));
    [[-9.5, -12.1, 1.1], [11, -12.2, 1.2], [-18.6, -2, 1], [18.5, 7.8, 1.1], [-13.6, -12.4, 0.9], [7.4, -12.6, 0.85]].forEach(([x, z, s]) => pine(g, x, z, s));
    bamboo(g, 16.6, -11.2); bench(g, -16.9, 13.6, 0.35); bench(g, 17.6, 1.9, -Math.PI / 2);
    const bush = (x, z, sc, c) => { const b = mesh(new T.SphereGeometry(0.45 * sc, 14, 10), c); b.scale.y = 0.7; b.position.set(x, GY + 0.22 * sc, z); g.add(b); };
    [[-16.5, -12.6, 1, '#6f9a58'], [-4, -12.7, 0.9, '#e58fb0'], [0, -12.6, 1.1, '#6f9a58'], [16.6, 6, 1, '#e58fb0'], [-16.8, 3, 1.1, '#6f9a58'], [-16.6, -4.5, 0.9, '#e58fb0'], [16.8, -5.5, 1, '#6f9a58'],
      [-2.8, 15.2, 0.8, '#e58fb0'], [2.8, 15.2, 0.8, '#e58fb0'], [-8, 15.3, 0.9, '#6f9a58'], [8, 15.4, 0.9, '#6f9a58'], [-15.2, 15, 1, '#e58fb0'], [15, 15.2, 1, '#6f9a58'], [-17.8, 9.6, 0.8, '#6f9a58'],
      [17.9, 4.3, 0.8, '#6f9a58'], [-12, -13, 0.85, '#6f9a58'], [12.5, -13, 0.85, '#e58fb0']].forEach(([x, z, sc, c]) => bush(x, z, sc, c));
    [[-17.5, 12], [17.5, 9.5], [-17.8, -9], [17.8, -1], [-6.5, -12.8], [5, -12.9], [-3.3, 11.6], [3.4, 11.6]].forEach(([x, z]) => { const r = hashRand(Math.round(Math.abs(x * 31 + z * 17)) + 1);
      for (let i = 0; i < 14; i++) { const fl = mesh(new T.SphereGeometry(0.07, 8, 6), ['#f6efe1', '#f4b6c8', '#ffe08a', '#c9a0dc'][i % 4], false); fl.position.set(x + (r() - 0.5) * 1.6, GY + 0.08, z + (r() - 0.5)); g.add(fl); } });
    const stones = (x1, z1, x2, z2) => { const len = Math.hypot(x2 - x1, z2 - z1), n = Math.floor(len / 0.8); for (let i = 1; i < n; i++) { const t = i / n, st = mesh(new T.CylinderGeometry(0.27, 0.3, 0.07, 8), '#b7b2a6');
      st.position.set(x1 + (x2 - x1) * t + (i % 2 ? 0.12 : -0.12), GY, z1 + (z2 - z1) * t + (i % 2 ? -0.1 : 0.1)); st.rotation.y = i * 1.3; g.add(st); } };
    stones(gx - 0.6, 13.2, -7.6, 13.1); stones(gx + 0.6, 13.2, 8.3, 13);
    const N = 150, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { pos[i * 3] = X0 + Math.random() * (X1 - X0); pos[i * 3 + 1] = Math.random() * 5; pos[i * 3 + 2] = Z0 + Math.random() * (Z1 - Z0); }
    const pg = new T.BufferGeometry(); pg.setAttribute('position', new T.BufferAttribute(pos, 3));
    const petal = cvs(32, 32, (c) => { c.fillStyle = '#ffd3df'; c.beginPath(); c.ellipse(16, 16, 12, 7, 0.6, 0, 7); c.fill(); });
    g.add(new T.Points(pg, new T.PointsMaterial({ size: 7, map: petal, transparent: true, depthWrite: false }))); OUT.petals = { pos, pg, N };
    return g;
  }

  /* ---------------- kantor ---------------- */
  function build() {
    FX = { heads: {}, desks: {}, screens: [], leds: [], rings: [], lanterns: [], chiefLantern: null, board: null, steam: [] };
    floors = [];
    const B = (building = new T.Group()); scene.add(B);
    B.add(outdoor());
    B.add(at(rbox(W * S + 1.4, H * S + 1.4, 0.5, 0.6, '#4a3829'), 0, -0.5, 0));
    B.add(at(rbox(W * S + 0.9, H * S + 0.9, 0.06, 0.4, '#5b4532'), 0, -0.06, 0));
    world.HALLS.forEach((h, i) => {
      B.add(at(rbox(h.w * S, h.h * S, 0.08, 0.08, '#8f6c4a'), wx(h.x + h.w / 2), 0, wz(h.y + h.h / 2)));
      const p = mesh(new T.PlaneGeometry(h.w * S - 0.08, h.h * S - 0.08), new T.MeshStandardMaterial({ map: plankTex(h.w, h.h, '#c9a477', 11 + i), roughness: 0.8 }), false);
      p.rotation.x = -Math.PI / 2; p.position.set(wx(h.x + h.w / 2), 0.081, wz(h.y + h.h / 2)); B.add(p);
    });
    for (const r of Object.values(world.ROOMS)) {
      const isDiv = !!ACH.PROFILE[r.id], color = isDiv ? ACH.PROFILE[r.id].color : '#c9a77a', kanji = isDiv ? ACH.PROFILE[r.id].kanji : '共用';
      const cx = wx(r.cx), cz = wz(r.cy), w = r.w * S, d = r.h * S;
      B.add(at(rbox(w, d, FY, 0.16, new T.Color(color).multiplyScalar(0.78).getStyle()), cx, 0, cz));
      const tex = r.id === 'chief' || r.id === 'research' ? tatamiTex(r.w, r.h, color) : r.id === 'content' ? studioTex(r.w, r.h) : plankTex(r.w, r.h, r.id === 'common' ? '#d2b183' : r.id === 'ops' ? '#b9946a' : '#a98560', r.w + r.h);
      const fl = mesh(new T.PlaneGeometry(w - 0.16, d - 0.16), new T.MeshStandardMaterial({ map: tex, roughness: 0.92 }), false);
      fl.rotation.x = -Math.PI / 2; fl.position.set(cx, FY + 0.002, cz); fl.userData.room = r.id; B.add(fl); floors.push(fl);
      const x1 = wx(r.x), x2 = wx(r.x + r.w), z1 = wz(r.y), z2 = wz(r.y + r.h), gap = 0.7;
      const gaps = { t: [], b: [], l: [], r: [] };
      gaps[r.door].push(r.door === 'l' || r.door === 'r' ? wz(r.doorP[1]) : wx(r.doorP[0]));
      if (r.id === 'common') gaps.b.push(wx(world.EXIT.door[0]));
      const run = (s, a1, b1, a2, b2, h, m) => {
        const horiz = s === 't' || s === 'b', g = gaps[s].slice().sort((p, q) => p - q);
        let from = horiz ? a1 : b1; const to = horiz ? a2 : b2;
        g.forEach((c) => { const seg = horiz ? wallSeg(from, b1, c - gap, b1, h, m) : wallSeg(a1, from, a1, c - gap, h, m); if (seg) B.add(seg); from = c + gap; });
        const seg = horiz ? wallSeg(from, b1, to, b1, h, m) : wallSeg(a1, from, a1, to, h, m); if (seg) B.add(seg);
      };
      run('t', x1, z1, x2, z1, 1.55, M.plaster); run('b', x1, z2, x2, z2, 0.42, M.woodL); run('l', x1, z1, x1, z2, 0.42, M.woodL); run('r', x2, z1, x2, z2, 0.42, M.woodL);
      B.add(at(rbox(w - 0.2, 0.05, 0.1, 0.02, color), cx, FY + 1.32, z1 + 0.1));
      B.add(doorFrame(wx(r.doorP[0]), wz(r.doorP[1]), r.door === 'l' || r.door === 'r', color, kanji));
      const lt = lantern(x2 - 0.6, z1 + 0.7, 2.15, false); B.add(lt); FX.lanterns.push(lt);
      decorate(r, B);
    }
    B.add(doorFrame(wx(world.EXIT.door[0]), wz(world.EXIT.door[1]), false, '#2e3a63', '出'));
    // meja kepala & admin
    Object.entries(world.DESKS).forEach(([id, k]) => {
      const color = ACH.PROFILE[id].color, h = deskMesh(k.head, id, true); B.add(h.g); FX.heads[id] = h.bulbM;
      B.add(zabuton(world.SPOTS.home[id], color));
      k.admins.forEach((a, i) => { const m = deskMesh(a, id, false); B.add(m.g); FX.desks[`desk-${id}-${i + 1}`] = m.bulbM; });
    });
    world.SPOTS.spare.forEach((s) => B.add(zabuton(s, '#c9b48f')));
    // kotatsu rapat
    const t = world.TABLE, tg = new T.Group();
    tg.add(rbox(t.w * S + 0.3, t.h * S + 0.3, 0.2, 0.25, '#3d4a7a'));
    tg.add(at(rbox(t.w * S, t.h * S, 0.06, 0.2, M.woodD), 0, 0.2, 0)); tg.add(at(rbox(t.w * S - 0.2, t.h * S - 0.2, 0.03, 0.18, '#8e6844'), 0, 0.26, 0));
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; tg.add(at(mesh(new T.CylinderGeometry(0.05, 0.04, 0.08, 12), M.white), Math.cos(a) * t.w * S * 0.32, 0.33, Math.sin(a) * t.h * S * 0.32)); }
    tg.add(at(rbox(t.w * S * 0.45, 0.14, 0.02, 0.04, '#5c6b4f'), 0, 0.29, 0));
    B.add(at(tg, wx(t.x + t.w / 2), FY, wz(t.y + t.h / 2)));
    world.SPOTS.meeting.forEach((s) => { const owner = Object.keys(world.MEET_PREF).find((k) => world.MEET_PREF[k] === s.id); B.add(zabuton(s, owner ? ACH.PROFILE[owner].color : '#d9c49c')); });
    const cl = lantern(wx(t.x + t.w / 2), wz(t.y + t.h / 2), 2.5, true); B.add(cl); FX.chiefLantern = cl;
    world.FAC.forEach((f) => B.add(facility(f, B)));
    B.add(plant(wx(1165), wz(505), 1)); B.add(plant(wx(35), wz(725), 1.1)); B.add(plant(wx(1165), wz(725), 0.9));
  }

  /* ---------------- maskot ---------------- */
  const actors = new Map();
  function agentMesh(a) {
    const color = (a.data && a.data.color) || (ACH.PROFILE[a.id] && ACH.PROFILE[a.id].color) || '#8a93a8';
    const mk = (c, o) => new T.MeshStandardMaterial(Object.assign({ color: lin(c), roughness: 0.78 }, o || {}));
    const mats = { body: mk(color), jacket: mk('#2e3a63', { roughness: 0.9, side: T.DoubleSide }), eye: mk('#231f24', { roughness: 0.4 }), blush: mk('#f0a3a0') };
    const g = new T.Group(), inner = new T.Group(); g.add(inner);
    inner.add(mesh(BEAN, mats.body)); inner.add(mesh(JACKET, mats.jacket));
    const eyes = [];
    [-1, 1].forEach((s) => { const e = at(mesh(EYE, mats.eye, false), s * 0.075, 0.47, 0.262); inner.add(e); eyes.push(e); const b = mesh(BLUSH, mats.blush, false); b.scale.set(1, 0.55, 0.4); inner.add(at(b, s * 0.16, 0.4, 0.23)); });
    const ring = mesh(RING, new T.MeshBasicMaterial({ color: lin(color), transparent: true, opacity: 0.95 }), false); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; ring.visible = false; g.add(ring);
    g.scale.setScalar(AG_SCALE); scene.add(g);
    return { g, inner, eyes, ring, mats, color, heading: 0, alpha: 1 };
  }
  function syncActors(list) {
    const seen = new Set();
    list.forEach((a) => {
      seen.add(a);
      let m = actors.get(a);
      const color = a.data && a.data.color;
      if (m && color && color !== m.color) { m.mats.body.color.copy(lin(color)); m.ring.material.color.copy(lin(color)); m.color = color; }
      if (!m) { m = agentMesh(a); actors.set(a, m); m.heading = a.at && a.at.face3 != null ? a.at.face3 : 0; }
    });
    for (const [a, m] of actors) if (!seen.has(a)) { scene.remove(m.g); Object.values(m.mats).forEach((x) => x.dispose()); m.ring.material.dispose(); actors.delete(a); }
  }
  const angleLerp = (a, b, k) => { let d = b - a; d = Math.atan2(Math.sin(d), Math.cos(d)); return a + d * k; };
  function groundY(a) { return world.roomAt(a.x, a.y) === 'garden' ? GY : FY; }
  function poseActor(a, m, t, dt, mark) {
    const g = a.geom(t), pose = g.pose;
    let base = groundY(a), lift = 0;
    // arah hadap
    let hd = m.heading;
    if (a.walking && a.path.length) { const [tx, ty] = a.path[0]; if (Math.hypot(tx - a.x, ty - a.y) > 0.5) hd = Math.atan2(tx - a.x, ty - a.y); }
    else if (a.lookFace) {
      const other = a.chat ? (a.chat.a === a ? a.chat.b : a.chat.a) : a.inMeeting ? ACH.sim.actors.find((o) => o !== a && o.inMeeting && o.speakT > 0) : null;
      hd = other ? Math.atan2(other.x - a.x, other.y - a.y) : (a.at && a.at.face3 != null ? a.at.face3 : 0) + a.lookFace * 0.6;
    }
    else if (a.at && a.at.face3 != null) hd = a.at.face3;
    if (pose === 'lie') hd = 0;
    m.heading = angleLerp(m.heading, hd, Math.min(1, dt * 9));
    if (pose === 'stool') lift = 0.4;
    if (pose === 'sit') lift = 0.06;
    if (pose === 'lie') lift = 0.18;
    m.g.position.set(wx(a.x), base + lift, wz(a.y));
    m.g.rotation.y = m.heading;
    const inner = m.inner;
    let sy = g.sy, sx = g.sx;
    if (pose === 'sit' || pose === 'stool') sy *= 0.92;
    inner.position.set((g.jx || 0) * K / AG_SCALE, (g.hop || 0) * K / AG_SCALE, 0);
    inner.scale.set(sx, sy, sx);
    if (pose === 'lie') { inner.rotation.set(0, 0, (a.at && a.at.face ? -a.at.face : 1) * Math.PI / 2); inner.position.y = 0.29; }
    else inner.rotation.set((g.skew || 0) * 0.6, (g.skew || 0) * 2.5, -g.tilt);
    const blink = g.closed ? 0.12 : 1;
    m.eyes.forEach((e) => (e.scale.y = blink));
    // transparansi (offline memudar)
    const al = a.alpha;
    if (Math.abs(al - m.alpha) > 0.01) {
      m.alpha = al;
      const tr = al < 0.98;
      Object.values(m.mats).forEach((mt) => { if (mt.transparent !== tr) { mt.transparent = tr; mt.depthWrite = !tr; mt.needsUpdate = true; } mt.opacity = al; });
    }
    m.ring.visible = a === mark;
    if (m.ring.visible) { m.ring.scale.setScalar(1 + 0.05 * Math.sin(t * 4)); m.ring.position.y = 0.02 - lift / AG_SCALE + (pose === 'lie' ? 0 : 0); }
  }

  /* ---------------- efek bereaksi pada data & waktu ---------------- */
  const react = { mon: 0, srv: 0, ring: 0, meet: 0, tea: 0, ramen: 0 };
  S3.react = react;
  S3.K = K;
  function effects(dt, t, acts) {
    const k = 1 - Math.exp(-dt * 2);
    const settledAt = (a, room) => a.room === room && !a.walking && !a.detour;
    const working = (a) => a.data && a.data.eff && a.data.eff.status === 'kerja';
    const by = (id) => acts.find((a) => a.id === id);
    const ops = by('ops'), eng = by('engineering'), con = by('content');
    const tgt = {
      mon: ops && settledAt(ops, 'desk') && working(ops) ? 1 : 0,
      srv: eng && settledAt(eng, 'desk') && working(eng) ? 1 : 0,
      ring: con && settledAt(con, 'desk') && working(con) ? 1 : 0,
      meet: acts.filter((a) => a.settled && a.at && /^k-/.test(a.at.id)).length >= 2 ? 1 : 0,
      tea: Math.min(1, acts.filter((a) => a.settled && a.at && /^tea-/.test(a.at.id)).length * 0.7),
      ramen: Math.min(1, acts.filter((a) => a.settled && a.at && /^(stool|ramen)-/.test(a.at.id)).length * 0.5),
    };
    for (const key in tgt) react[key] += (tgt[key] - react[key]) * k;
    // lampu meja: menyala bila ada yang duduk di meja itu
    const occ = new Set(acts.filter((a) => a.settled && a.at && a.room === 'desk').map((a) => a.at.id));
    Object.entries(FX.heads).forEach(([id, m]) => { const on = occ.has('home-' + id) ? 1.7 : 0.05; m.emissiveIntensity += (on - m.emissiveIntensity) * k; });
    Object.entries(FX.desks).forEach(([id, m]) => { const on = occ.has(id) ? 1.5 : 0.05; m.emissiveIntensity += (on - m.emissiveIntensity) * k; });
    FX.screens.forEach((s) => { s.tex.offset.x += dt * (0.012 + react.mon * 0.05); s.m.emissiveIntensity = 0.4 + react.mon * 0.7; });
    FX.leds.forEach((m) => { if (Math.random() < dt * (1.2 + react.srv * 6)) m.emissiveIntensity = m.emissiveIntensity > 0.5 ? 0.15 : 1.6; });
    FX.rings.forEach((m) => (m.emissiveIntensity = 0.25 + react.ring * 1.25));
    // uap teh & ramen
    FX.steam.forEach((s) => {
      const amt = s.kind === 'tea' ? react.tea : react.ramen;
      if (!s.parts.length) for (let i = 0; i < 5; i++) { const p = mesh(new T.SphereGeometry(0.07, 10, 8), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }), false); p.userData.ph = i / 5; building.add(p); s.parts.push(p); }
      s.parts.forEach((p, i) => { const ph = (p.userData.ph + t * 0.35) % 1; p.position.set(s.x + Math.sin(t * 2 + i) * 0.06, s.y + ph * 0.8, s.z); p.scale.setScalar(0.6 + ph * 1.4); p.material.opacity = (0.08 + amt * 0.4) * Math.sin(ph * Math.PI); });
    });
  }
  function dayLight(dt, t) {
    const ph = ACH.fx.phase();
    const night = ph.night, gold = ph.golden;
    const sunCol = new T.Color().copy(lin('#ffe3bd')).lerp(lin('#ffb36b'), gold).lerp(lin('#8fa6d6'), night);
    sun.color.copy(sunCol); sun.intensity = 1.25 * (1 - night * 0.78) * (1 - gold * 0.1);
    hemi.intensity = 0.55 * (1 - night * 0.5); amb.intensity = 0.12 + night * 0.05;
    const lamp = 0.85 + night * 0.9 + gold * 0.3;
    FX.lanterns.forEach((l, i) => { l.userData.m.emissiveIntensity = lamp; if (l.userData.pl) l.userData.pl.intensity = l.userData.base * (0.6 + night * 1.6); l.rotation.z = RM() ? 0 : Math.sin(t * 1.3 + i) * 0.04; });
    const L = FX.chiefLantern, pulse = 0.9 + night * 0.6 + react.meet * (0.6 + 0.35 * Math.sin(t * 5));
    L.userData.m.emissiveIntensity = pulse; if (L.userData.pl) L.userData.pl.intensity = pulse * (0.9 + night);
    OUT.toro.forEach((m, i) => (m.emissiveIntensity = 0.6 + night * 1.0 + Math.sin(t * 2 + i * 1.7) * 0.12));
    stage.classList.toggle('night', night > 0.5);
  }
  function animOutdoor(dt, t) {
    if (OUT.water) { OUT.water.offset.x += dt * 0.03; OUT.water.offset.y += dt * 0.012; }
    OUT.koi.forEach((k) => { k.a += dt * k.sp; k.m.position.set(Math.cos(k.a) * k.rx, 0.04, Math.sin(k.a) * k.rz); k.m.rotation.y = Math.atan2(-Math.sin(k.a) * k.rx, Math.cos(k.a) * k.rz); });
    const P = OUT.petals; if (!P || RM()) return;
    const p = P.pos;
    for (let i = 0; i < P.N; i++) {
      p[i * 3 + 1] -= dt * 0.45; p[i * 3] += Math.sin(t * 1.3 + i) * dt * 0.35; p[i * 3 + 2] += dt * 0.12;
      if (p[i * 3 + 1] < GY) { const tr = OUT.trees[i % OUT.trees.length]; p[i * 3] = tr.x + (Math.random() - 0.5) * 4; p[i * 3 + 1] = 2.4 + Math.random() * 2; p[i * 3 + 2] = tr.z + (Math.random() - 0.5) * 4; }
    }
    P.pg.attributes.position.needsUpdate = true;
  }

  /* ---------------- kamera ---------------- */
  const VIEW = 12;
  const cur = { target: new T.Vector3(), zoom: 1, yaw: -0.5, pitch: 0.92 }, goal = { target: new T.Vector3(), zoom: 1, yaw: -0.5, pitch: 0.92 };
  let mode = { kind: 'home' }, homeZoom = 1, zoomMul = 1;
  function poseCam(c, st) { const R = 60; c.position.set(st.target.x + Math.sin(st.yaw) * Math.cos(st.pitch) * R, st.target.y + Math.sin(st.pitch) * R, st.target.z + Math.cos(st.yaw) * Math.cos(st.pitch) * R); c.lookAt(st.target); }
  function setFrustum(c) { const sw = stage.clientWidth || 1, sh = stage.clientHeight || 1, a = sw / sh; c.left = (-VIEW * a) / 2; c.right = (VIEW * a) / 2; c.top = VIEW / 2; c.bottom = -VIEW / 2; c.updateProjectionMatrix(); }
  function fit(x1, x2, z1, z2, h, pad) {
    const st = { target: new T.Vector3((x1 + x2) / 2, 0, (z1 + z2) / 2), yaw: goal.yaw, pitch: goal.pitch };
    poseCam(helper, st); helper.updateMatrixWorld(); helper.matrixWorldInverse.copy(helper.matrixWorld).invert();
    let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9; const v = new T.Vector3();
    for (const x of [x1, x2]) for (const z of [z1, z2]) for (const y of [-0.5, h]) { v.set(x, y, z).applyMatrix4(helper.matrixWorldInverse); mnx = Math.min(mnx, v.x); mxx = Math.max(mxx, v.x); mny = Math.min(mny, v.y); mxy = Math.max(mxy, v.y); }
    const sw = stage.clientWidth || 1, sh = stage.clientHeight || 1, a = sw / sh;
    const right = new T.Vector3().setFromMatrixColumn(helper.matrixWorld, 0), up = new T.Vector3().setFromMatrixColumn(helper.matrixWorld, 1);
    goal.target.copy(st.target).addScaledVector(right, (mnx + mxx) / 2).addScaledVector(up, (mny + mxy) / 2);
    goal.zoom = Math.min((VIEW * a) / ((mxx - mnx) * pad), VIEW / ((mxy - mny) * pad));
  }
  function refit() {
    const narrow = innerWidth <= 760;
    fit(-16.5, 16.5, -11, narrow ? 12 : 13.5, 1.6, narrow ? 1.12 : 1.03); homeZoom = goal.zoom;
    if (mode.kind === 'room') { const r = world.ROOMS[mode.id]; fit(wx(r.x), wx(r.x + r.w), wz(r.y), wz(r.y + r.h), 1.6, 1.14); }
    else if (mode.kind === 'garden') fit(-21.5, 21.5, -14.5, 17, 3, 1.03);
    goal.zoom *= zoomMul;
  }
  S3.home = () => { mode = { kind: 'home' }; zoomMul = 1; refit(); };
  S3.focusRoom = (id) => { if (!world.ROOMS[id]) return; mode = { kind: 'room', id }; zoomMul = 1; refit(); };
  S3.garden = () => { mode = { kind: 'garden' }; zoomMul = 1; refit(); };
  S3.follow = (a, mul) => { mode = { kind: 'follow', a, mul: mul || 1 }; };
  S3.followMul = (f) => { if (mode.kind === 'follow') mode.mul = Math.min(2.4, Math.max(0.55, mode.mul * f)); };
  S3.mode = () => mode.kind;
  S3.zoomBy = (f) => { if (mode.kind === 'follow') return S3.followMul(f); const z = Math.min(homeZoom * 6, Math.max(homeZoom * 0.7, goal.zoom * f)); zoomMul *= z / goal.zoom; goal.zoom = z; };
  let dragStart = null;
  S3.dragStart = () => (dragStart = { yaw: goal.yaw, pitch: goal.pitch });
  S3.dragMove = (dx, dy) => { if (!dragStart) return; goal.yaw = dragStart.yaw - dx * 0.006; goal.pitch = Math.min(1.3, Math.max(0.5, dragStart.pitch + dy * 0.004)); };
  S3.dragEnd = () => { dragStart = null; if (mode.kind !== 'follow') refit(); };

  /* ---------------- proyeksi & picking ---------------- */
  const pv = new T.Vector3();
  // titik denah (x,y) setinggi h unit di atas lantai → piksel CSS relatif panggung
  S3.project = (x, y, h) => {
    pv.set(wx(x), (world.roomAt(x, y) === 'garden' ? GY : FY) + (h || 0), wz(y)).project(camera);
    return [((pv.x + 1) / 2) * (stage.clientWidth || 1), ((1 - pv.y) / 2) * (stage.clientHeight || 1), pv.z < 1];
  };
  // kepala maskot (untuk label & gelembung)
  S3.headOf = (a) => { const m = actors.get(a); if (!m) return S3.project(a.x, a.y, 1.2); pv.set(m.g.position.x, m.g.position.y + (m.inner.position.y + 0.78 * m.inner.scale.y) * AG_SCALE, m.g.position.z).project(camera); return [((pv.x + 1) / 2) * stage.clientWidth, ((1 - pv.y) / 2) * stage.clientHeight]; };
  // berapa piksel CSS per piksel denah (skala label & partikel)
  S3.pxPerPlan = () => (camera.zoom * (stage.clientHeight || 1)) / VIEW / 40;
  const ray = new T.Raycaster(), ndc = new T.Vector2(), plane = new T.Plane(new T.Vector3(0, 1, 0), -FY), hitP = new T.Vector3();
  S3.planAt = (clientX, clientY) => {
    const r = stage.getBoundingClientRect(); ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (!ray.ray.intersectPlane(plane, hitP)) return null;
    return [px(hitP.x), pz(hitP.z)];
  };
  S3.actorAt = (clientX, clientY, list) => {
    const r = stage.getBoundingClientRect(), x = clientX - r.left, y = clientY - r.top;
    const rad = Math.max(16, S3.pxPerPlan() * 22);
    let best = null, bd = Infinity;
    for (const a of list) {
      const m = actors.get(a); if (!m) continue;
      pv.set(m.g.position.x, m.g.position.y + 0.5 * AG_SCALE * m.inner.scale.y, m.g.position.z).project(camera);
      const sx = ((pv.x + 1) / 2) * r.width, sy = ((1 - pv.y) / 2) * r.height, d = Math.hypot(sx - x, (sy - y) * 0.8);
      if (d < rad && d < bd) { bd = d; best = a; }
    }
    return best;
  };
  S3.roomLabels = () => Object.values(world.ROOMS).map((r) => {
    const prof = ACH.PROFILE[r.id];
    const [x, y, vis] = S3.project(r.x + 8, r.y + r.h - 6, 0.5);
    return { id: r.id, x, y, vis, kanji: prof ? prof.kanji : '共用', name: prof ? prof.name : 'Ruang Bersama', color: prof ? prof.color : '#c9a77a' };
  });
  let pendingBoard = null;
  S3.setBoard = (info) => { if (!FX || !FX.board) { pendingBoard = info; return; } const old = FX.board.map; FX.board.map = boardTex(info); FX.board.needsUpdate = true; if (old) old.dispose(); };

  /* ---------------- siklus hidup ---------------- */
  ['home', 'focusRoom', 'garden', 'follow', 'followMul', 'zoomBy', 'dragStart', 'dragMove', 'dragEnd'].forEach((k) => { const f = S3[k]; S3[k] = (...args) => (S3.ok ? f(...args) : undefined); });
  S3.init = function (canvas, stageEl) {
    stage = stageEl;
    try {
      renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch (e) { S3.error = 'WebGL tidak tersedia di perangkat ini'; return false; }
    const low = lowPower();
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, low ? 1.5 : 2));
    renderer.outputEncoding = T.sRGBEncoding; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = !low; renderer.shadowMap.type = T.PCFSoftShadowMap;
    scene = new T.Scene();
    camera = new T.OrthographicCamera(-10, 10, 10, -10, 0.1, 300); helper = new T.OrthographicCamera(-10, 10, 10, -10, 0.1, 300);
    hemi = new T.HemisphereLight(lin('#fff3dd'), lin('#5a4634'), 0.55); scene.add(hemi);
    sun = new T.DirectionalLight(lin('#ffe3bd'), 1.25); sun.position.set(-9, 22, 13); sun.castShadow = !low;
    sun.shadow.mapSize.set(low ? 1024 : 3072, low ? 1024 : 3072); Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 21, bottom: -21, near: 1, far: 70 }); sun.shadow.bias = -0.0006;
    scene.add(sun); amb = new T.AmbientLight(lin('#ffe9cf'), 0.12); scene.add(amb);
    S3.low = low; initShared(); build();
    S3.ok = true;
    if (pendingBoard) S3.setBoard(pendingBoard);
    S3.resize(); Object.assign(cur, { zoom: goal.zoom, yaw: goal.yaw, pitch: goal.pitch }); cur.target.copy(goal.target);
    return true;
  };
  S3.resize = function () {
    if (!S3.ok) return;
    const sw = stage.clientWidth, sh = stage.clientHeight; if (!sw || !sh) return;
    renderer.setSize(sw, sh, false); setFrustum(camera); setFrustum(helper); refit();
  };
  S3.frame = function (dt, t, acts, mark) {
    if (!S3.ok) return;
    syncActors(acts);
    for (const [a, m] of actors) poseActor(a, m, t, dt, mark);
    effects(dt, t, acts); dayLight(dt, t); animOutdoor(dt, t);
    if (mode.kind === 'follow') {
      const m = actors.get(mode.a);
      if (m) { goal.target.set(m.g.position.x, m.g.position.y + 0.6, m.g.position.z); goal.zoom = homeZoom * 2.6 * mode.mul; }
    }
    const k = Math.min(1, dt * (RM() ? 20 : 4.5));
    cur.target.lerp(goal.target, k); cur.zoom += (goal.zoom - cur.zoom) * k; cur.yaw += (goal.yaw - cur.yaw) * k; cur.pitch += (goal.pitch - cur.pitch) * k;
    poseCam(camera, cur); camera.zoom = cur.zoom; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    renderer.render(scene, camera);
  };
})();
