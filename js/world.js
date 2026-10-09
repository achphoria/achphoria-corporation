/* Peta dunia v5 — denah B "koridor": 5 ruang divisi berjajar di satu koridor engawa, Chief paling besar
   di tengah, ruang bersama memanjang di bawah, taman Jepang di sekeliling gedung.
   Semua koordinat = "piksel denah" (1200×760 untuk gedung; taman melebar ke luar). Renderer 3D
   (scene3d.js) memetakan 40 piksel denah = 1 unit dunia. Rute: ruang → pintu → koridor → pintu → ruang,
   di dalam ruang menghindari meja & kotatsu (graf visibilitas sudut halangan). */
(function () {
  const ACH = window.ACH;

  // tinggi maskot berdiri (px denah) — dipakai sim untuk kecepatan & animasi; denah 3D tanpa perspektif
  const scaleAt = () => 130;

  const MID = 445; // garis tengah koridor
  const HALLS = [{ x: 20, y: 410, w: 1160, h: 70 }];
  const ROOMS = {
    research: { x: 20, y: 20, w: 200, h: 380, door: 'b' },
    ops: { x: 230, y: 20, w: 200, h: 380, door: 'b' },
    chief: { x: 440, y: 20, w: 320, h: 380, door: 'b' },
    content: { x: 770, y: 20, w: 200, h: 380, door: 'b' },
    engineering: { x: 980, y: 20, w: 200, h: 380, door: 'b' },
    common: { x: 20, y: 490, w: 1160, h: 250, door: 't' },
  };
  const ROOM_META = {
    research: { label: 'Perpustakaan Research', desc: 'Rak buku tinggi & lantai tatami — markas Research' },
    ops: { label: 'Ruang Monitor Ops & Data', desc: 'Dinding layar grafik — markas Ops & Data' },
    chief: { label: 'Ruang Chief of Staff', desc: 'Meja Chief, shoji & kotatsu rapat 20 kursi' },
    content: { label: 'Studio Content & Marketing', desc: 'Kamera tripod, ring light & corkboard ide' },
    engineering: { label: 'Ruang Server Engineering', desc: 'Rak server berkaca dengan LED berkedip' },
    common: { label: 'Ruang Bersama', desc: 'Stasiun teh, konter ramen, tatami & vending' },
  };
  Object.entries(ROOMS).forEach(([id, r]) => {
    r.id = id; r.cx = r.x + r.w / 2; r.cy = r.y + r.h / 2;
    if (r.door === 'b') { r.doorP = [r.cx, r.y + r.h]; r.inn = [r.cx, r.y + r.h - 28]; r.out = [r.cx, MID]; }
    else { r.doorP = [r.cx, r.y]; r.inn = [r.cx, r.y + 28]; r.out = [r.cx, MID]; }
    r.obs = [];
  });
  // pintu luar ruang bersama → taman (jalan batu ke gerbang)
  const EXIT = { inn: [600, 712], door: [600, 740], out: [600, 792] };
  const GATE = [600, 1016];

  const sp = (id, x, y, room, o) => Object.assign({ id, x, y, room, via: [], pose: 'stand', lift: 0, face: 1, face3: 0 }, o || {});
  const toward = (x, y, tx, ty) => Math.atan2(tx - x, ty - y); // arah hadap 3D (0 = menghadap ke depan/kamera)

  /* ---------- meja per ruang divisi: 1 meja kepala + 3 meja admin ---------- */
  const DESKS = {};
  let TABLE = null;
  const SPOTS = { home: {}, spare: [], meeting: [], tea: [], ramen: [], tatami: [], vending: [], whiteboard: [], window: [], offline: [] };
  ['chief', 'research', 'ops', 'content', 'engineering'].forEach((id) => {
    const r = ROOMS[id], chief = id === 'chief';
    const area = chief ? { x: r.x, w: r.w } : { x: r.x, w: r.w };
    const hw = Math.min(84, area.w - 40);
    const head = { x: area.x + area.w / 2 - hw / 2, y: r.y + 76, w: hw, h: 28 };
    const aw = Math.min(54, (area.w - 64) / 3), gap = Math.min(22, (area.w - 40 - 3 * aw) / 2), total = 3 * aw + 2 * gap;
    const ay = chief ? r.y + 142 : r.y + Math.max(162, r.h * 0.6);
    const admins = [0, 1, 2].map((i) => { const x = area.x + area.w / 2 - total / 2 + i * (aw + gap); return { x, y: ay, w: aw, h: 20 }; });
    DESKS[id] = { head, admins };
    r.obs.push(head, ...admins);
    SPOTS.home[id] = sp('home-' + id, head.x + hw / 2, head.y - 20, id, { pose: 'sit', work: true, read: id === 'research', glow: id === 'ops' || id === 'engineering' });
    admins.forEach((a, i) => SPOTS.spare.push(sp(`desk-${id}-${i + 1}`, a.x + aw / 2, a.y - 18, id, { pose: 'sit', work: true })));
  });

  /* ---------- kotatsu rapat di ruang Chief (20 bantal) ---------- */
  {
    const r = ROOMS.chief;
    TABLE = { x: r.x + 50, y: r.y + 208, w: r.w - 100, h: r.h - 260 };
    r.obs.push(TABLE);
    const off = 26, n = 20, x0 = TABLE.x - off, y0 = TABLE.y - off, w = TABLE.w + 2 * off, h = TABLE.h + 2 * off, P = 2 * (w + h);
    const cx = TABLE.x + TABLE.w / 2, cy = TABLE.y + TABLE.h / 2;
    for (let i = 0; i < n; i++) {
      const s = (w / 2 + (i * P) / n) % P;
      let x, y;
      if (s < w) { x = x0 + s; y = y0; } else if (s < w + h) { x = x0 + w; y = y0 + s - w; } else if (s < 2 * w + h) { x = x0 + w - (s - w - h); y = y0 + h; } else { x = x0; y = y0 + h - (s - 2 * w - h); }
      SPOTS.meeting.push(sp('k-' + i, x, y, 'chief', { pose: 'sit', face: x < cx ? 1 : -1, face3: toward(x, y, cx, cy) }));
    }
  }
  // kursi rapat favorit: Chief di kepala meja (menghadap kamera), kepala divisi menyebar
  const MEET_PREF = { chief: 'k-0', research: 'k-16', ops: 'k-4', content: 'k-12', engineering: 'k-8' };
  const MEET_CENTER = [TABLE.x + TABLE.w / 2, TABLE.y + TABLE.h / 2];

  /* ---------- fasilitas ruang bersama ---------- */
  const FAC = [
    { key: 'tea', label: 'Stasiun Teh', desc: 'Kyusu, teh hijau & cangkir keramik', x: 50, y: 518, w: 130, h: 44 },
    { key: 'ramen', label: 'Konter Ramen', desc: '3 bangku untuk makan siang bareng', x: 220, y: 518, w: 170, h: 44 },
    { key: 'whiteboard', label: 'Papan Tulis', desc: 'Rencana sprint & papan "Hari ini"', x: 430, y: 506, w: 120, h: 16 },
    { key: 'tatami', label: 'Pojok Tatami', desc: 'Tikar untuk tidur siang sebentar', x: 660, y: 520, w: 190, h: 96 },
    { key: 'vending', label: 'Mesin Minuman', desc: 'Teh botol, kopi kaleng & camilan', x: 900, y: 512, w: 110, h: 46 },
    { key: 'lounge', label: 'Sofa Santai', desc: 'Tempat ngobrol & lihat taman', x: 1045, y: 640, w: 110, h: 60 },
  ];
  const facOf = (k) => FAC.find((f) => f.key === k);
  FAC.forEach((f) => { if (f.key !== 'whiteboard') ROOMS.common.obs.push(f); });
  {
    const t = facOf('tea'), m = facOf('ramen'), w = facOf('whiteboard'), tt = facOf('tatami'), v = facOf('vending');
    const front = (f, u) => [f.x + f.w * u, f.y + f.h + 22];
    [0.22, 0.55, 0.85].forEach((u, i) => { const [x, y] = front(t, u); SPOTS.tea.push(sp('tea-' + (i + 1), x, y, 'common', { face3: Math.PI, face: i ? -1 : 1 })); });
    [0.2, 0.5, 0.8].forEach((u, i) => { const [x, y] = front(m, u); SPOTS.ramen.push(sp('stool-' + (i + 1), x, y, 'common', { pose: 'stool', lift: 0, face3: Math.PI })); });
    [0.15, 0.85].forEach((u, i) => { const [x, y] = front(m, u); SPOTS.ramen.push(sp('ramen-' + (i + 4), x, y + 24, 'common', { face3: Math.PI })); });
    [0.3, 0.75].forEach((u, i) => SPOTS.whiteboard.push(sp('wb-' + (i + 1), w.x + w.w * u, w.y + 46, 'common', { face3: Math.PI, face: i ? -1 : 1 })));
    [[0.3, 0.45, 1], [0.7, 0.55, -1]].forEach(([u, vv, f], i) => SPOTS.tatami.push(sp('tatami-' + (i + 1), tt.x + tt.w * u, tt.y + tt.h * vv, 'common', { pose: 'lie', face: f, face3: Math.PI / 2 * f })));
    [0.3, 0.75].forEach((u, i) => { const [x, y] = front(v, u); SPOTS.vending.push(sp('vend-' + (i + 1), x, y, 'common', { face3: Math.PI })); });
    [[330, 708], [870, 708]].forEach(([x, y], i) => SPOTS.window.push(sp('win-' + (i + 1), x, y, 'common', { face3: 0 })));
  }
  // offline: keluar lewat pintu taman, menunggu di dekat gerbang
  [[600, 935], [545, 960], [655, 960], [575, 990], [625, 990]].forEach(([x, y], i) => SPOTS.offline.push(sp('door-' + (i + 1), x, y, 'garden', { face3: 0 })));

  /* ---------- area tooltip (urut dari yang paling spesifik) ---------- */
  const R2 = (key, label, desc, x0, y0, x1, y1) => ({ key, label, desc, x0, y0, x1, y1 });
  const AREAS = [
    ...FAC.map((f) => R2(f.key, f.label, f.desc, f.x - 6, f.y - 6, f.x + f.w + 6, f.y + f.h + 6)),
    R2('kotatsu', 'Kotatsu Rapat', 'Meja rapat hangat — semua kumpul di sini saat ada perintah', TABLE.x - 30, TABLE.y - 30, TABLE.x + TABLE.w + 30, TABLE.y + TABLE.h + 30),
    ...Object.values(ROOMS).map((r) => R2(r.id, ROOM_META[r.id].label, ROOM_META[r.id].desc, r.x, r.y, r.x + r.w, r.y + r.h)),
    R2('hall', 'Koridor Engawa', 'Lorong kayu yang menghubungkan semua ruang', 20, 410, 1180, 480),
    R2('gate', 'Gerbang 達成', 'Pintu masuk taman — agen offline menunggu di sini', 520, 900, 680, 1040),
    R2('pond', 'Kolam Koi', 'Empat ikan koi berenang santai', 4, 820, 268, 956),
    R2('zen', 'Taman Batu', 'Kerikil bergaris & tiga batu berlumut', 944, 824, 1184, 952),
    R2('garden', 'Taman Jepang', 'Sakura, momiji, pinus & bambu di sekeliling kantor', -240, -180, 1440, 1060),
  ];

  /* ---------- geometri bantu ---------- */
  const inRect = (p, r, m = 0) => p[0] > r.x - m && p[0] < r.x + r.w + m && p[1] > r.y - m && p[1] < r.y + r.h + m;
  function roomAt(x, y) {
    for (const r of Object.values(ROOMS)) if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r.id;
    for (const h of HALLS) if (x >= h.x && x <= h.x + h.w && y >= h.y - 12 && y <= h.y + h.h + 12) return 'hall';
    if (x < 10 || x > 1190 || y < 10 || y > 750) return 'garden';
    return 'hall'; // celah dinding/pintu
  }
  const inFloor = (x, y) => { const r = roomAt(x, y); return r !== 'garden'; };
  // segmen a→b memotong bagian dalam persegi (Liang–Barsky)
  function segHits(a, b, r) {
    let t0 = 0, t1 = 1;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const P = [-dx, dx, -dy, dy], Q = [a[0] - r.x, r.x + r.w - a[0], a[1] - r.y, r.y + r.h - a[1]];
    for (let i = 0; i < 4; i++) {
      if (P[i] === 0) { if (Q[i] <= 0) return false; continue; }
      const t = Q[i] / P[i];
      if (P[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
    return t1 - t0 > 1e-4;
  }
  const M = 16; // jarak aman badan maskot dari tepi meja (px denah)
  const grow = (o, m) => ({ x: o.x - m, y: o.y - m, w: o.w + 2 * m, h: o.h + 2 * m });
  // jalur di dalam satu ruang dari p ke q yang tidak menembus meja (graf visibilitas)
  function roomPath(roomId, p, q) {
    const R = ROOMS[roomId];
    if (!R) return [q];
    const obs = R.obs.map((o) => grow(o, M)).filter((o) => !inRect(p, o) && !inRect(q, o));
    const clear = (a, b) => obs.every((o) => !segHits(a, b, o));
    if (clear(p, q)) return [q];
    const nodes = [p, q];
    obs.forEach((o) => [[o.x - 3, o.y - 3], [o.x + o.w + 3, o.y - 3], [o.x + o.w + 3, o.y + o.h + 3], [o.x - 3, o.y + o.h + 3]].forEach((c) => {
      if (c[0] < R.x + 8 || c[0] > R.x + R.w - 8 || c[1] < R.y + 8 || c[1] > R.y + R.h - 8) return;
      if (obs.some((o2) => inRect(c, o2, -0.5))) return;
      nodes.push(c);
    }));
    const n = nodes.length, dist = new Array(n).fill(Infinity), prev = new Array(n).fill(-1), done = new Array(n).fill(false);
    dist[0] = 0;
    for (let k = 0; k < n; k++) {
      let u = -1; for (let i = 0; i < n; i++) if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0 || dist[u] === Infinity) break;
      done[u] = true;
      if (u === 1) break;
      for (let v = 0; v < n; v++) {
        if (done[v] || v === u) continue;
        const d = dist[u] + Math.hypot(nodes[v][0] - nodes[u][0], nodes[v][1] - nodes[u][1]);
        if (d < dist[v] && clear(nodes[u], nodes[v])) { dist[v] = d; prev[v] = u; }
      }
    }
    if (prev[1] < 0) return [q]; // tidak ada jalan bersih → langsung (jarang)
    const out = [];
    for (let v = 1; v > 0; v = prev[v]) out.unshift(nodes[v]);
    return out;
  }
  const P = (p) => [p[0], p[1]];
  // rute dari (x,y) ke titik tujuan: ruang → pintu → koridor → pintu → ruang (dan pintu taman bila perlu)
  function route(x, y, spot) {
    const pts = [];
    let cur = [x, y], a = roomAt(x, y);
    const b = spot.room || roomAt(spot.x, spot.y);
    const goal = [spot.x, spot.y];
    if (a === 'garden' && b === 'garden') return [goal];
    if (a === 'garden') { pts.push(P(EXIT.out), P(EXIT.door), P(EXIT.inn)); cur = EXIT.inn; a = 'common'; }
    const tRoom = b === 'garden' ? 'common' : b;
    const target = b === 'garden' ? EXIT.inn : goal;
    if (a === tRoom) pts.push(...roomPath(a, cur, target));
    else {
      if (a !== 'hall') { const R = ROOMS[a]; pts.push(...roomPath(a, cur, R.inn), P(R.doorP), P(R.out)); }
      const B = ROOMS[tRoom];
      pts.push(P(B.out), P(B.doorP), P(B.inn), ...roomPath(tRoom, B.inn, target));
    }
    if (b === 'garden') pts.push(P(EXIT.door), P(EXIT.out), goal);
    // buang titik ganda berturut-turut
    return pts.filter((p, i) => i === 0 ? Math.hypot(p[0] - x, p[1] - y) > 0.5 : Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 0.5);
  }
  // titik kunjungan dinamis di samping rekan (untuk ngobrol)
  function visitSpot(target, fromX) {
    const room = roomAt(target.x, target.y);
    if (room === 'garden' || room === 'hall') return null;
    const side = fromX < target.x ? -1 : 1;
    const cand = [[side * 52, 6], [-side * 52, 6], [side * 40, 40], [-side * 40, 40], [0, 54]];
    const R = ROOMS[room];
    for (const [dx, dy] of cand) {
      const x = target.x + dx, y = target.y + dy;
      if (roomAt(x, y) !== room) continue;
      if (x < R.x + 14 || x > R.x + R.w - 14 || y < R.y + 14 || y > R.y + R.h - 14) continue;
      if (R.obs.some((o) => inRect([x, y], grow(o, M - 2)))) continue;
      return sp('visit-' + target.id, x, y, room, { face: dx > 0 ? -1 : 1, face3: toward(x, y, target.x, target.y) });
    }
    return null;
  }
  const nearestNodes = () => [];

  ACH.world = { scaleAt, MID, HALLS, ROOMS, ROOM_META, EXIT, GATE, DESKS, TABLE, FAC, SPOTS, MEET_PREF, MEET_CENTER, AREAS, route, roomAt, roomPath, inFloor, visitSpot, nearestNodes };
})();
