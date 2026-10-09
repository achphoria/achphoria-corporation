/* ACHPHORIA — utilitas umum (namespace global ACH) */
(function () {
  const ACH = (window.ACH = window.ACH || {});

  ACH.W = 1200; // koordinat dunia = "piksel denah" gedung 1200×760 (taman melebar ke luar); 40 px = 1 unit 3D
  ACH.H = 760;

  // RNG deterministik (mulberry32)
  ACH.rng = function (seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  // hash 2D/3D -> [0,1)
  function hash2(x, y, s) {
    let h = (x * 374761393 + y * 668265263 + (s || 0) * 982451653) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function hash3(x, y, z) {
    let h = (x * 374761393 + y * 668265263 + z * 1440662683) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  ACH.hash2 = hash2;
  const sm = (t) => t * t * (3 - 2 * t);
  ACH.noise2 = function (x, y, s) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = sm(x - xi), yf = sm(y - yi);
    const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
  ACH.noise3 = function (x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = sm(x - xi), yf = sm(y - yi), zf = sm(z - zi);
    const l = (a, b, t) => a + (b - a) * t;
    const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz);
    return l(
      l(l(c(0, 0, 0), c(1, 0, 0), xf), l(c(0, 1, 0), c(1, 1, 0), xf), yf),
      l(l(c(0, 0, 1), c(1, 0, 1), xf), l(c(0, 1, 1), c(1, 1, 1), xf), yf),
      zf
    );
  };
  ACH.fbm2 = function (x, y, oct, s) {
    let v = 0, a = 0.5, f = 1;
    for (let i = 0; i < oct; i++) { v += a * ACH.noise2(x * f, y * f, (s || 0) + i * 17); f *= 2; a *= 0.5; }
    return v;
  };

  // warna
  ACH.hex = function (h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  ACH.rgb = (r, g, b, a) =>
    a === undefined ? `rgb(${r | 0},${g | 0},${b | 0})` : `rgba(${r | 0},${g | 0},${b | 0},${a})`;
  ACH.mix = function (c1, c2, t) {
    const a = ACH.hex(c1), b = ACH.hex(c2);
    const r = a.map((v, i) => Math.round(v + (b[i] - v) * t));
    return '#' + r.map((v) => v.toString(16).padStart(2, '0')).join('');
  };
  ACH.alpha = function (c, a) {
    const [r, g, b] = ACH.hex(c);
    return `rgba(${r},${g},${b},${a})`;
  };
  ACH.shade = (c, t) => (t < 0 ? ACH.mix(c, '#000000', -t) : ACH.mix(c, '#ffffff', t));

  ACH.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  ACH.lerp = (a, b, t) => a + (b - a) * t;
  ACH.ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  ACH.canvas = function (w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
    const x = c.getContext('2d');
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    return [c, x];
  };

  /* ---------- Waktu WIB ---------- */
  const TZ = 'Asia/Jakarta';
  const fmtHM = new Intl.DateTimeFormat('id-ID', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
  const fmtHMS = new Intl.DateTimeFormat('id-ID', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const fmtDate = new Intl.DateTimeFormat('id-ID', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
  const fmtShort = new Intl.DateTimeFormat('id-ID', { timeZone: TZ, day: 'numeric', month: 'short' });
  const fmtParts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour12: false });
  ACH.wibHM = (d) => fmtHM.format(d instanceof Date ? d : new Date(d)).replace(':', '.');
  ACH.wibHMS = (d) => fmtHMS.format(d instanceof Date ? d : new Date(d)).replace(/:/g, '.');
  ACH.wibDate = (d) => fmtDate.format(d instanceof Date ? d : new Date(d));
  ACH.wibShort = (d) => fmtShort.format(d instanceof Date ? d : new Date(d));
  // jam desimal WIB (0..24) + nomor hari (untuk variasi jadwal)
  ACH.wibNow = function (d) {
    d = d || new Date();
    const p = {};
    for (const x of fmtParts.formatToParts(d)) p[x.type] = x.value;
    const h = (+p.hour % 24) + (+p.minute) / 60;
    const dayKey = +(p.year + p.month + p.day);
    return { h, dayKey, weekday: p.weekday };
  };
  ACH.isSameWibDay = (a, b) => ACH.wibShort(a) === ACH.wibShort(b);

  ACH.escape = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
})();
