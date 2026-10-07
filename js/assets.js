/* Pemuat aset gambar + varian pose maskot (dibuat di kode) */
(function () {
  const ACH = window.ACH;
  const BASE = 'assets/';
  const load = (src) => new Promise((res) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => res(im);
    im.onerror = () => { console.warn('[ACHPHORIA] aset gagal dimuat:', src); res(null); };
    im.src = BASE + src;
  });

  const A = (ACH.assets = { mascots: {}, lamps: {} });
  // meta lampion: kotak potongan (koordinat dunia) + titik gantung (pivot)
  ACH.LAMPS = [
    { id: 1, x: 381, y: 0, w: 105.5, h: 144.5, px: 432, py: 0, cx: 433.5, cy: 96, r: 49 },
    { id: 2, x: 545, y: 0, w: 67.5, h: 134.5, px: 577, py: 4, cx: 578.5, cy: 105, r: 30 },
    { id: 3, x: 983, y: 19, w: 74.5, h: 119.5, px: 1022, py: 24, cx: 1020, cy: 105, r: 33.5 },
  ];
  ACH.KOTATSU = { x: 482, y: 390, w: 476, h: 253.5, sortY: 505 };
  const SIT_CUT = 0.835; // bagian atas tubuh yang terlihat saat duduk (kaki "masuk" ke bantal)

  // potong bagian kaki dengan alas membulat → pose duduk
  function makeSit(img) {
    const w = img.width, h = Math.round(img.height * SIT_CUT);
    const [c, x] = ACH.canvas(w, h);
    x.drawImage(img, 0, 0);
    x.globalCompositeOperation = 'destination-in';
    const r = h * 0.16;
    x.beginPath();
    x.moveTo(0, 0); x.lineTo(w, 0); x.lineTo(w, h - r);
    x.ellipse(w / 2, h - r, w / 2, r, 0, 0, Math.PI);
    x.closePath(); x.fill();
    return c;
  }

  A.ready = (async function () {
    const ids = ACH.AGENTS_SEED.map((a) => a.id);
    const [bg, kotatsu, l1, l2, l3, ...ms] = await Promise.all([
      load('kantor-bg.webp'), load('kotatsu-depan.webp'),
      load('lampion-1.webp'), load('lampion-2.webp'), load('lampion-3.webp'),
      ...ids.flatMap((id) => [load('maskot-' + id + '.webp'), load('maskot-' + id + '-tidur.webp')]),
    ]);
    Object.assign(A, { bg, kotatsu });
    A.lamps = { 1: l1, 2: l2, 3: l3 };
    ids.forEach((id, i) => {
      const open = ms[i * 2], closed = ms[i * 2 + 1] || open;
      if (!open) return;
      A.mascots[id] = { stand: open, standC: closed, sit: makeSit(open), sitC: makeSit(closed), w: open.width, h: open.height, sitCut: SIT_CUT };
    });
    return A;
  })();

  A.mascotKey = function (id) {
    if (ACH.PROFILE[id]) return id;
    const keys = ACH.AGENTS_SEED.map((a) => a.id);
    let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) | 0;
    return keys[Math.abs(h) % keys.length];
  };
  A.mascotSrc = (id) => BASE + 'maskot-' + A.mascotKey(id) + '.webp';
  // maskot untuk agen tak dikenal (id di luar 5 agen v2): pakai maskot berdasarkan hash id
  A.mascotFor = function (id) {
    return A.mascots[id] || A.mascots[A.mascotKey(id)] || null;
  };
})();
