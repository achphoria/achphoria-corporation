/* Peta dunia: lantai, graf waypoint, titik-titik bernama, area hover.
   Semua koordinat = piksel pada gambar latar 1280×720 (dipetakan manual). */
(function () {
  const ACH = window.ACH;

  // Tinggi maskot berdiri (px dunia) sesuai kedalaman y — perspektif ringan
  // v3: ±22% lebih besar dari v2 supaya maskot terbaca jelas tanpa zoom (tetap proporsional dgn perabot)
  const scaleAt = (y) => 127 * (0.74 + 0.3 * ACH.clamp((y - 300) / 370, -0.2, 1.15));

  // Lantai yang bisa dilalui (untuk debug overlay & dokumentasi)
  const FLOOR = [
    [296, 470], [350, 478], [378, 402], [470, 416], [552, 392], [800, 378], [940, 404], [1050, 440], [1072, 520],
    [1092, 590], [1130, 640], [1060, 690], [800, 696], [470, 692], [300, 682], [262, 660], [330, 600], [300, 520],
  ]

  // Node graf jalan
  const N = {
    nook: [372, 598], wb: [336, 498], lft: [425, 520], dk: [486, 428], b1: [600, 396], b2: [700, 389],
    b3: [784, 393], b4: [872, 404], bk: [978, 432], vd: [1030, 470], r1: [1032, 540], r2: [1040, 640],
    f1: [790, 672], f2: [610, 668], f0: [450, 640],
  };
  const E = [
    ['nook', 'wb'], ['nook', 'f0'], ['wb', 'lft'], ['lft', 'dk'], ['lft', 'f0'], ['dk', 'b1'], ['b1', 'b2'], ['b2', 'b3'],
    ['b3', 'b4'], ['b4', 'bk'], ['bk', 'vd'], ['vd', 'r1'], ['r1', 'r2'], ['r2', 'f1'], ['f1', 'f2'], ['f2', 'f0'],
  ];
  const ADJ = {};
  Object.keys(N).forEach((k) => (ADJ[k] = []));
  E.forEach(([a, b]) => { const d = Math.hypot(N[a][0] - N[b][0], N[a][1] - N[b][1]); ADJ[a].push([b, d]); ADJ[b].push([a, d]); });

  // Titik bernama. pose: stand | sit | lie | stool ; lift = tinggi dudukan (px dunia) ; work = animasi mengetik
  const sp = (id, x, y, via, o) => Object.assign({ id, x, y, via: [].concat(via), pose: 'stand', lift: 0, face: 1 }, o || {});
  const SPOTS = {
    // zona "desk" milik masing-masing agen
    home: {
      chief: null, // = kursi depan kotatsu (diisi di bawah)
      research: sp('home-research', 214, 566, 'nook', { pose: 'sit', lift: 10, work: true, face: 1, read: true }),
      ops: sp('home-ops', 436, 446, ['dk', 'lft'], { work: true, face: -1, glow: '#9fd0ff' }),
      content: sp('home-content', 1062, 594, ['r1', 'r2'], { work: true, face: 1 }),
      engineering: sp('home-engineering', 1004, 420, 'bk', { work: true, face: 1, glow: '#7fb8ff' }),
    },
    // meja cadangan untuk agen tambahan (id di luar 5 agen v2)
    spare: [sp('spare-1', 330, 640, 'nook'), sp('spare-2', 700, 680, 'f1'), sp('spare-3', 1110, 660, 'r2')],
    meeting: [
      sp('k-front', 832, 600, 'f1', { pose: 'sit', lift: 7 }),
      sp('k-left', 538, 580, ['f0', 'f2'], { pose: 'sit', lift: 7 }),
      sp('k-fright', 936, 568, 'r1', { pose: 'sit', lift: 7, face: -1 }),
      sp('k-bleft', 540, 462, 'lft', { pose: 'sit', lift: 6 }),
      sp('k-bright', 908, 470, ['b4', 'bk'], { pose: 'sit', lift: 6, face: -1 }),
    ],
    tea: [sp('tea-1', 636, 394, 'b1', { face: 1 }), sp('tea-2', 586, 404, 'b1'), sp('tea-3', 680, 398, 'b2', { face: -1 })],
    ramen: [
      sp('stool-1', 699, 380, 'b2', { pose: 'stool', lift: 66 }),
      sp('stool-3', 777, 358, 'b3', { pose: 'stool', lift: 68, face: -1 }),
      sp('ramen-4', 636, 398, 'b1'),
      sp('ramen-5', 822, 398, 'b3', { face: -1 }),
      sp('stool-2', 738, 372, ['b2', 'b3'], { pose: 'stool', lift: 70 }),
    ],
    tatami: [sp('tatami-1', 334, 640, 'nook', { pose: 'lie' }), sp('tatami-2', 560, 668, 'f2', { pose: 'lie', face: -1 })],
    vending: [sp('vend-1', 1032, 452, ['vd', 'bk'], { face: 1 }), sp('vend-2', 994, 474, 'vd', { face: 1 })],
    whiteboard: [sp('wb-1', 318, 480, 'wb', { face: -1 }), sp('wb-2', 382, 498, ['wb', 'lft'], { face: -1 })],
    offline: [
      sp('door-1', 818, 322, 'b3'), sp('door-2', 850, 326, ['b3', 'b4']), sp('door-3', 795, 330, 'b3'),
      sp('door-4', 868, 336, 'b4'), sp('door-5', 834, 344, 'b3'),
    ],
  };
  SPOTS.home.chief = Object.assign(SPOTS.meeting[0], { work: true });
  // preferensi kursi rapat per agen (Chief of Staff selalu di depan)
  const MEET_PREF = { chief: 'k-front', research: 'k-left', content: 'k-fright', ops: 'k-bleft', engineering: 'k-bright' };

  // Area untuk tooltip hover (urut dari yang paling spesifik)
  const AREAS = [
    { key: 'whiteboard', label: 'Papan Tulis', desc: 'Corat-coret rencana sprint & ide', x0: 244, y0: 112, x1: 402, y1: 236 },
    { key: 'vending', label: 'Mesin Minuman', desc: 'Teh botol, kopi kaleng & camilan', x0: 1044, y0: 262, x1: 1134, y1: 432 },
    { key: 'offline', label: 'Pintu Noren', desc: 'Jalan keluar-masuk kantor', x0: 780, y0: 92, x1: 880, y1: 312 },
    { key: 'tea', label: 'Stasiun Teh', desc: 'Kyusu, teh hijau & cangkir keramik', x0: 556, y0: 150, x1: 672, y1: 380 },
    { key: 'ramen', label: 'Konter Ramen', desc: '3 bangku untuk makan siang bareng', x0: 672, y0: 230, x1: 800, y1: 380 },
    { key: 'server', label: 'Booth Server', desc: 'Rak server berkaca — markas Engineering', x0: 940, y0: 110, x1: 1044, y1: 405 },
    { key: 'studio', label: 'Pojok Konten', desc: 'Corkboard ide, kamera tripod & rak tanaman', x0: 1100, y0: 160, x1: 1280, y1: 640 },
    { key: 'tatami', label: 'Pojok Tatami', desc: 'Tikar untuk tidur siang sebentar', x0: 286, y0: 586, x1: 420, y1: 690 },
    { key: 'desk', label: 'Meja Multi-Monitor', desc: 'Tiga layar dashboard — markas Ops & Data', x0: 284, y0: 236, x1: 552, y1: 476 },
    { key: 'kotatsu', label: 'Kotatsu', desc: 'Meja rapat hangat dengan 5 bantal duduk', x0: 482, y0: 390, x1: 1010, y1: 660 },
    { key: 'nook', label: 'Pojok Baca', desc: 'Jendela shoji, rak buku, taman zen & bonsai', x0: 0, y0: 70, x1: 300, y1: 660 },
  ];

  function nearestNodes(x, y, k) {
    return Object.keys(N).map((n) => [n, Math.hypot(N[n][0] - x, N[n][1] - y)]).sort((a, b) => a[1] - b[1]).slice(0, k || 3);
  }
  function dijkstra(src) {
    const dist = {}, prev = {}, todo = new Set(Object.keys(N));
    Object.keys(N).forEach((n) => (dist[n] = Infinity));
    dist[src] = 0;
    while (todo.size) {
      let u = null; for (const n of todo) if (u === null || dist[n] < dist[u]) u = n;
      todo.delete(u);
      for (const [v, d] of ADJ[u]) if (dist[u] + d < dist[v]) { dist[v] = dist[u] + d; prev[v] = u; }
    }
    return { dist, prev };
  }
  const DJ = {}; Object.keys(N).forEach((n) => (DJ[n] = dijkstra(n)));

  // rute dari (x,y) ke titik tujuan: masuk graf di node terdekat, keluar di salah satu node "via"
  function route(x, y, spot) {
    const direct = Math.hypot(spot.x - x, spot.y - y);
    if (direct < 60) return [[spot.x, spot.y]];
    let best = null;
    for (const [s, ds] of nearestNodes(x, y, 3)) {
      for (const v of spot.via) {
        const dv = DJ[s].dist[v];
        const tot = ds + dv + Math.hypot(N[v][0] - spot.x, N[v][1] - spot.y);
        if (!best || tot < best.tot) best = { s, v, tot };
      }
    }
    const nodes = [];
    for (let n = best.v; n; n = DJ[best.s].prev[n]) { nodes.unshift(n); if (n === best.s) break; }
    const pts = nodes.map((n) => N[n].slice());
    // pangkas node pertama bila kita sudah melewatinya
    if (pts.length > 1) {
      const [a, b] = pts;
      const ab = Math.hypot(b[0] - a[0], b[1] - a[1]), pb = Math.hypot(b[0] - x, b[1] - y);
      if (pb < ab) pts.shift();
    }
    pts.push([spot.x, spot.y]);
    return pts;
  }

  ACH.world = { scaleAt, FLOOR, NODES: N, EDGES: E, SPOTS, MEET_PREF, AREAS, route };
})();
