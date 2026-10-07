/* Dunia: tata letak, layer statis (langit, batu, ruangan, furnitur) */
(function () {
  const ACH = window.ACH, W = ACH.W, H = ACH.H;
  const FLOOR = [132, 204, 264, 324, 394];
  const TOP = [0, 150, 210, 270, 334];
  const MOD_X = [152, 302, 496], MOD_W = 146;
  const SHAFT = { x0: 452, x1: 492, top: 112, cx: 472, lanes: [463, 481] };
  const R = {
    meeting: { x0: 16, x1: 150, top: 324 }, kantin: { x0: 154, x1: 250 }, arcade: { x0: 254, x1: 350 },
    gym: { x0: 354, x1: 448 }, sleep: { x0: 496, x1: 572 }, shower: { x0: 576, x1: 642 }, dance: { x0: 646, x1: 784, top: 324 },
  };
  const DOME = { cx: 690, cy: 133, rx: 100, ry: 82 };
  const TOWER = { x0: 24, x1: 92 };
  const PAD = { cx: 146 };
  const TEAM_RX = [3, 28, 94, 119], LEAD_RX = 53;

  const world = (ACH.world = { FLOOR, TOP, MOD_X, MOD_W, SHAFT, R, DOME, TOWER, PAD, TEAM_RX, LEAD_RX });
  world.modules = [];
  for (let i = 0; i < 9; i++) world.modules.push({ i, floor: 1 + Math.floor(i / 3), x0: MOD_X[i % 3], x1: MOD_X[i % 3] + MOD_W });

  world.groundTop = (x) => 129 + Math.round(1.6 * (ACH.fbm2(x * 0.035, 3.3, 3, 5) - 0.5) * 2);

  const ICONS = {
    crown: ['0000000', '1001001', '1101011', '1111111', '1111111', '0111110', '0000000'],
    gear: ['0010100', '0111110', '1100011', '0101010', '1100011', '0111110', '0010100'],
    chart: ['0000001', '0000011', '0001011', '0011011', '1011011', '1011011', '1111111'],
    mega: ['0000011', '0001111', '1111111', '1111111', '0001111', '0100011', '0100000'],
    cam: ['0011000', '1111111', '1100011', '1101011', '1100011', '1111111', '0000000'],
    hand: ['0110110', '1111111', '1111111', '0111110', '0011100', '0001000', '0000000'],
    coin: ['0011100', '0111110', '1101011', '1100111', '1110011', '0111110', '0011100'],
    heart: ['0110110', '1111111', '1111111', '1111111', '0111110', '0011100', '0001000'],
    scale: ['0001000', '1111111', '1001001', '1001001', '0101010', '0001000', '0111110'],
    star: ['0001000', '0001000', '1111111', '0111110', '0011100', '0110110', '0100010'],
  };
  function icon(ctx, key, x, y, col) {
    const m = ICONS[key] || ICONS.star;
    ctx.fillStyle = col;
    m.forEach((r, j) => { for (let i = 0; i < 7; i++) if (r[i] === '1') ctx.fillRect(x + i, y + j, 1, 1); });
  }
  world.icon = icon;

  const rect = (c, x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x | 0, y | 0, w | 0, h | 0); };
  world.rect = rect;
  function glow(c, x, y, rx, ry, col, a) {
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.translate(x, y); c.scale(1, ry / rx);
    const g = c.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, ACH.alpha(col, a)); g.addColorStop(1, ACH.alpha(col, 0));
    c.fillStyle = g; c.beginPath(); c.arc(0, 0, rx, 0, Math.PI * 2); c.fill();
    c.restore();
  }
  world.glow = glow;
  function roundRectPath(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h); c.lineTo(x, y + h); c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
  }

  /* ---------------- LANGIT ---------------- */
  function buildSky() {
    const [c, x] = ACH.canvas(W, 150);
    const g = x.createLinearGradient(0, 0, 0, 150);
    g.addColorStop(0, '#03040c'); g.addColorStop(0.6, '#0a0a22'); g.addColorStop(1, '#151233');
    x.fillStyle = g; x.fillRect(0, 0, W, 150);
    // nebula dither
    const img = x.getImageData(0, 0, W, 150);
    for (let py = 0; py < 150; py++)
      for (let px = 0; px < W; px++) {
        const n = ACH.fbm2(px * 0.008, py * 0.016, 4, 11);
        const m = ACH.fbm2(px * 0.012 + 40, py * 0.02, 3, 23);
        const i = (py * W + px) * 4;
        const d = ((px * 7 + py * 13) % 4) / 4 * 0.06;
        const a = Math.max(0, n - 0.52 + d) * 1.6, b = Math.max(0, m - 0.56 + d) * 1.4;
        img.data[i] += a * 70 + b * 10; img.data[i + 1] += a * 18 + b * 40; img.data[i + 2] += a * 90 + b * 80;
      }
    x.putImageData(img, 0, 0);
    return c;
  }

  /* ---------------- BUMI ---------------- */
  world.renderEarth = function (rot) {
    const r = 21, S = r * 2 + 10;
    const [c, x] = ACH.canvas(S, S);
    const img = x.createImageData(S, S);
    const L = [-0.62, -0.45, 0.64];
    for (let py = 0; py < S; py++)
      for (let px = 0; px < S; px++) {
        const dx = (px - S / 2 + 0.5) / r, dy = (py - S / 2 + 0.5) / r, dd = dx * dx + dy * dy;
        const i = (py * S + px) * 4;
        if (dd > 1) {
          const rr = Math.sqrt(dd);
          if (rr < 1.18) { const a = (1 - (rr - 1) / 0.18) * 0.55; img.data[i] = 80; img.data[i + 1] = 160; img.data[i + 2] = 255; img.data[i + 3] = a * 255; }
          continue;
        }
        const dz = Math.sqrt(1 - dd);
        const lon = Math.atan2(dx, dz) + rot, lat = Math.asin(-dy);
        const X = Math.cos(lat) * Math.sin(lon), Y = Math.sin(lat), Z = Math.cos(lat) * Math.cos(lon);
        const land = ACH.noise3(X * 2.2 + 5, Y * 2.2, Z * 2.2) * 0.65 + ACH.noise3(X * 5 + 9, Y * 5, Z * 5) * 0.35;
        const cloud = ACH.noise3(X * 3.5 + 20 + rot * 0.3, Y * 6, Z * 3.5) * 0.6 + ACH.noise3(X * 8, Y * 8 + 3, Z * 8) * 0.4;
        let col;
        if (Math.abs(Y) > 0.86) col = [235, 245, 255];
        else if (land > 0.56) col = land > 0.66 ? [176, 150, 92] : [70, 150, 72];
        else col = land > 0.5 ? [52, 120, 200] : [28, 78, 170];
        if (cloud > 0.6) col = [240, 246, 255];
        let li = dx * L[0] + dy * L[1] + dz * L[2];
        const dith = ((px + py) % 2) * 0.08;
        li = li + dith;
        const lv = li > 0.55 ? 1 : li > 0.25 ? 0.82 : li > 0.02 ? 0.58 : 0.3;
        img.data[i] = col[0] * lv; img.data[i + 1] = col[1] * lv; img.data[i + 2] = col[2] * lv + (1 - lv) * 30; img.data[i + 3] = 255;
        if (dd > 0.86) { img.data[i] = img.data[i] * 0.7 + 30; img.data[i + 1] = img.data[i + 1] * 0.7 + 70; img.data[i + 2] = img.data[i + 2] * 0.6 + 110; }
      }
    x.putImageData(img, 0, 0);
    return c;
  };

  /* ---------------- BATU & PERMUKAAN ---------------- */
  function buildTerrain(x) {
    // bukit jauh
    x.fillStyle = '#2a2b3e';
    x.beginPath(); x.moveTo(0, 140);
    for (let px = 0; px <= W; px += 2) x.lineTo(px, 112 - 14 * ACH.fbm2(px * 0.006, 1, 3, 3) + 6 * Math.sin(px * 0.01));
    x.lineTo(W, 140); x.fill();
    x.fillStyle = '#3a3b50';
    x.beginPath(); x.moveTo(0, 140);
    for (let px = 0; px <= W; px += 2) x.lineTo(px, 122 - 8 * ACH.fbm2(px * 0.012, 7, 3, 9));
    x.lineTo(W, 140); x.fill();
    // highlight puncak bukit
    for (let px = 0; px < W; px++) {
      const y1 = Math.round(112 - 14 * ACH.fbm2(px * 0.006, 1, 3, 3) + 6 * Math.sin(px * 0.01));
      rect(x, px, y1, 1, 1, '#4a4c66');
      const y2 = Math.round(122 - 8 * ACH.fbm2(px * 0.012, 7, 3, 9));
      rect(x, px, y2, 1, 1, '#5c5e78');
    }
    const img = x.getImageData(0, 0, W, H);
    const STR = ['#4b4753', '#433f4b', '#534c57', '#3e3a45', '#48434e', '#3a3540', '#504853', '#45404a'].map(ACH.hex);
    for (let px = 0; px < W; px++) {
      const gt = world.groundTop(px);
      for (let py = gt; py < H; py++) {
        const i = (py * W + px) * 4, d = py - gt;
        const h = ACH.hash2(px, py, 1);
        let col;
        if (d < 13 + Math.round(ACH.noise2(px * 0.2, 1, 4) * 4)) {
          const v = 168 - d * 4.2 + (ACH.noise2(px * 0.3, py * 0.3, 2) - 0.5) * 26 + (h - 0.5) * 14;
          col = [v * 0.97, v * 0.97, v * 1.04];
          if (d === 0) col = [205, 205, 214];
          if (d === 1) col = [186, 186, 196];
        } else {
          const b = Math.floor((py + 9 * ACH.fbm2(px * 0.012, py * 0.008, 3, 31)) / 9);
          const base = STR[((b % STR.length) + STR.length) % STR.length];
          const dk = 1 - Math.min(0.45, (py - 140) / 620);
          const n = (ACH.noise2(px * 0.15, py * 0.3, 8) - 0.5) * 18 + (h - 0.5) * 10;
          col = base.map((v) => v * dk + n);
          if (h > 0.985) col = col.map((v) => v * 0.6);
          else if (h < 0.018) col = col.map((v) => v + 34);
          // garis strata tipis
          const fy = (py + 9 * ACH.fbm2(px * 0.012, py * 0.008, 3, 31)) % 9;
          if (fy < 0.9) col = col.map((v) => v * 0.78);
        }
        img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = 255;
      }
    }
    x.putImageData(img, 0, 0);
    // kawah kecil di permukaan
    const rr = ACH.rng(77);
    for (let k = 0; k < 26; k++) {
      const cx = Math.round(rr() * W), rx = 3 + Math.round(rr() * 9), ry = Math.max(1, Math.round(rx * 0.28));
      if ((cx > 440 && cx < 500) || (cx > 575 && cx < 795) || (cx > 18 && cx < 200)) continue;
      const cy = world.groundTop(cx) + 4 + Math.round(rr() * 5);
      crater(x, cx, cy, rx, ry);
    }
    // batu-batu
    for (let k = 0; k < 40; k++) {
      const cx = Math.round(rr() * W); const cy = world.groundTop(cx) + 2 + Math.round(rr() * 9);
      if (cx > 450 && cx < 495) continue;
      const s = 1 + Math.round(rr() * 2);
      rect(x, cx, cy, s + 1, s, '#6c6c78'); rect(x, cx, cy, s, 1, '#c9c9d3'); rect(x, cx, cy + s, s + 1, 1, '#4a4a55');
    }
    // retakan & kristal di batu
    for (let k = 0; k < 18; k++) {
      let cx = Math.round(rr() * W), cy = 160 + Math.round(rr() * 280);
      x.fillStyle = 'rgba(15,12,22,0.55)';
      for (let s = 0; s < 14; s++) { x.fillRect(cx, cy, 1, 1); cx += rr() < 0.5 ? 1 : 0; cy += 1; if (rr() < 0.3) cx -= 1; }
    }
  }
  function crater(x, cx, cy, rx, ry) {
    for (let yy = -ry; yy <= ry; yy++)
      for (let xx = -rx; xx <= rx; xx++) {
        const e = (xx * xx) / (rx * rx) + (yy * yy) / (ry * ry);
        if (e > 1.15) continue;
        let col;
        if (e > 0.72) col = yy < 0 ? '#7a7a86' : '#d7d7e0';
        else col = yy < 0 ? '#5c5c68' : '#8a8a96';
        rect(x, cx + xx, cy + yy, 1, 1, col);
      }
  }
  world.crater = crater;

  function crystals(x, cx, cy, col) {
    const rr = ACH.rng(cx * 31 + cy);
    glow(x, cx, cy, 14, 10, col, 0.35);
    for (let k = 0; k < 5; k++) {
      const h = 3 + Math.round(rr() * 6), ox = Math.round((rr() - 0.5) * 10);
      for (let j = 0; j < h; j++) { rect(x, cx + ox, cy - j, 2, 1, j === h - 1 ? '#ffffff' : ACH.shade(col, -0.2 + j / h * 0.5)); }
      rect(x, cx + ox, cy - h + 1, 1, h - 1, ACH.shade(col, 0.45));
    }
  }

  function pipe(x, x0, y0, x1, y1, col) {
    if (y0 === y1) {
      rect(x, x0, y0, x1 - x0, 4, '#2b2f3e'); rect(x, x0, y0, x1 - x0, 1, '#6a7286'); rect(x, x0, y0 + 3, x1 - x0, 1, '#171a24');
      for (let px = x0 + 6; px < x1 - 2; px += 18) { rect(x, px, y0 - 1, 3, 6, '#454b5e'); rect(x, px, y0 - 1, 3, 1, '#8a93a8'); }
      if (col) for (let px = x0 + 14; px < x1; px += 18) rect(x, px, y0 + 1, 2, 1, col);
    } else {
      rect(x, x0, y0, 4, y1 - y0, '#2b2f3e'); rect(x, x0, y0, 1, y1 - y0, '#6a7286'); rect(x, x0 + 3, y0, 1, y1 - y0, '#171a24');
      for (let py = y0 + 6; py < y1 - 2; py += 18) { rect(x, x0 - 1, py, 6, 3, '#454b5e'); }
    }
  }

  /* ---------------- KERANGKA RUANGAN ---------------- */
  function carve(x, x0, y0, x1, y1, wall, round) {
    const w = x1 - x0, h = y1 - y0;
    // ambient occlusion di batu
    x.fillStyle = 'rgba(8,6,14,0.35)';
    if (round) { roundRectPath(x, x0 - 6, y0 - 6, w + 12, h + 10, round + 6); x.fill(); }
    else x.fillRect(x0 - 5, y0 - 5, w + 10, h + 9);
    x.fillStyle = 'rgba(8,6,14,0.45)';
    if (round) { roundRectPath(x, x0 - 4, y0 - 4, w + 8, h + 7, round + 4); x.fill(); }
    else x.fillRect(x0 - 3, y0 - 3, w + 6, h + 6);
    // bingkai logam
    x.fillStyle = '#10121b';
    if (round) { roundRectPath(x, x0 - 3, y0 - 3, w + 6, h + 5, round + 3); x.fill(); } else x.fillRect(x0 - 3, y0 - 3, w + 6, h + 5);
    x.fillStyle = '#3a4054';
    if (round) { roundRectPath(x, x0 - 2, y0 - 2, w + 4, h + 3, round + 2); x.fill(); } else x.fillRect(x0 - 2, y0 - 2, w + 4, h + 3);
    x.fillStyle = '#5d6681';
    if (!round) { x.fillRect(x0 - 2, y0 - 2, w + 4, 1); }
    x.fillStyle = wall;
    if (round) { roundRectPath(x, x0, y0, w, h, round); x.fill(); } else x.fillRect(x0, y0, w, h);
    if (!round) for (let px = x0 + 3; px < x1; px += 10) rect(x, px, y0 - 2, 1, 1, '#8a93a8');
  }
  function floorBand(x, x0, x1, fy, col) {
    rect(x, x0, fy - 4, x1 - x0, 4, '#1d2130');
    for (let px = x0; px < x1; px += 6) rect(x, px, fy - 4, 1, 4, '#262b3d');
    rect(x, x0, fy - 4, x1 - x0, 1, ACH.mix(col, '#1d2130', 0.55));
    rect(x, x0, fy, x1 - x0, 1, '#4a5168');
    rect(x, x0, fy + 1, x1 - x0, 4, '#20242f');
    rect(x, x0, fy + 5, x1 - x0, 1, '#10121a');
    for (let px = x0 + 4; px < x1; px += 12) rect(x, px, fy + 2, 2, 1, ACH.alpha(col, 0.5));
  }
  function wallPanels(x, x0, x1, y0, y1, wall) {
    for (let px = x0 + 8; px < x1; px += 16) { rect(x, px, y0, 1, y1 - y0, ACH.shade(wall, -0.25)); rect(x, px + 1, y0, 1, y1 - y0, ACH.shade(wall, 0.08)); }
    rect(x, x0, y1 - 14, x1 - x0, 1, ACH.shade(wall, 0.15));
    rect(x, x0, y1 - 13, x1 - x0, 1, ACH.shade(wall, -0.3));
  }
  function banner(x, x0, x1, y0, text, col, ic) {
    rect(x, x0, y0, x1 - x0, 9, '#0a0b12');
    rect(x, x0, y0 + 9, x1 - x0, 1, ACH.shade(col, -0.2));
    const tw = ACH.textWidth(text) + (ic ? 10 : 0);
    let tx = Math.round((x0 + x1) / 2 - tw / 2);
    if (ic) { icon(x, ic, tx, y0 + 1, col); tx += 10; }
    ACH.pixText(x, text, tx, y0 + 2, col);
  }
  function plant(x, px, py) {
    rect(x, px, py - 4, 5, 4, '#6b4a3a'); rect(x, px, py - 4, 5, 1, '#8d6450');
    const lv = [[2, -10], [0, -8], [4, -8], [1, -6], [3, -6], [-1, -6], [5, -7], [2, -7]];
    lv.forEach(([a, b], k) => { rect(x, px + a, py + b, 1, 3, k % 2 ? '#3fbf5f' : '#2a8f45'); });
    rect(x, px + 2, py - 11, 1, 2, '#6dff7a');
  }
  function mug(x, px, py, col) { rect(x, px, py - 2, 2, 2, col || '#e8e8f0'); rect(x, px + 2, py - 2, 1, 1, '#aab'); }

  /* ---------------- MODUL KANTOR ---------------- */
  function moduleBack(x, m, info) {
    const col = info.color, top = TOP[m.floor], fy = FLOOR[m.floor];
    const wall = ACH.mix('#0d0f1c', col, 0.17);
    carve(x, m.x0, top, m.x1, fy + 6, wall);
    // gradien dinding (lebih terang di atas)
    const g = x.createLinearGradient(0, top, 0, fy);
    g.addColorStop(0, ACH.alpha(col, 0.18)); g.addColorStop(0.5, ACH.alpha(col, 0.05)); g.addColorStop(1, 'rgba(0,0,0,0.25)');
    x.fillStyle = g; x.fillRect(m.x0, top, MOD_W, fy - top);
    wallPanels(x, m.x0, m.x1, top + 10, fy - 4, wall);
    banner(x, m.x0, m.x1, top, info.division, col, info.icon);
    // strip lampu
    rect(x, m.x0 + 4, top + 10, MOD_W - 8, 1, ACH.shade(col, 0.5));
    rect(x, m.x0 + 4, top + 11, MOD_W - 8, 1, ACH.shade(col, -0.3));
    glow(x, (m.x0 + m.x1) / 2, top + 11, 80, 26, col, 0.22);
    // layar dinding besar (bingkai) di atas meja leader
    const lx = m.x0 + LEAD_RX + 8;
    rect(x, lx - 1, top + 14, 30, 17, '#07080d'); rect(x, lx, top + 15, 28, 15, '#0b1020');
    rect(x, lx - 1, top + 14, 30, 1, '#5d6681');
    // dekor dinding di area tim
    const rr = ACH.rng(m.i * 97 + 3);
    TEAM_RX.forEach((rx, k) => {
      const px = m.x0 + rx + 4, py = top + 16;
      const t = (k + m.i) % 4;
      if (t === 0) { // rak buku/binder
        rect(x, px, py + 7, 16, 1, '#5d6681');
        for (let b = 0; b < 7; b++) rect(x, px + 1 + b * 2, py + 7 - (3 + (b % 3)), 1, 3 + (b % 3), ['#ff5fa2', '#3dd6ff', '#ffe14d', col, '#6dff7a', '#b46bff', '#ff9a3d'][(b + k) % 7]);
      } else if (t === 1) { // poster
        rect(x, px + 2, py, 11, 9, '#07080d'); rect(x, px + 3, py + 1, 9, 7, ACH.shade(col, -0.55));
        icon(x, info.icon, px + 4, py + 1, ACH.shade(col, 0.1));
      } else if (t === 2) { // jam dinding + ventilasi
        rect(x, px + 1, py, 7, 7, '#cfd6e6'); rect(x, px + 2, py + 1, 5, 5, '#1a1d2b'); rect(x, px + 4, py + 2, 1, 2, '#fff'); rect(x, px + 4, py + 3, 2, 1, col);
        for (let v = 0; v < 3; v++) rect(x, px + 10, py + 1 + v * 2, 6, 1, '#2c3142');
      } else { // tanaman gantung / papan tulis kecil
        rect(x, px + 1, py, 14, 9, '#dfe6f2'); rect(x, px + 2, py + 1, 12, 7, '#f4f7ff');
        for (let l = 0; l < 3; l++) rect(x, px + 3, py + 2 + l * 2, 4 + Math.round(rr() * 6), 1, [col, '#5c6b8a', '#ff5fa2'][l]);
      }
    });
    floorBand(x, m.x0, m.x1, fy, col);
    // kursi (di belakang yang duduk)
    TEAM_RX.forEach((rx) => chair(x, m.x0 + rx + 7, fy, '#2b3042', col, false));
    chair(x, m.x0 + LEAD_RX + 9, fy, ACH.shade(col, -0.45), col, true);
    // tanaman di sudut
    plant(x, m.x0 + 1, fy - 1);
  }
  function chair(x, sx, fy, base, col, big) {
    const bx = sx - 5;
    rect(x, bx, fy - (big ? 15 : 12), 2, big ? 11 : 8, base);
    rect(x, bx, fy - (big ? 15 : 12), 2, 1, ACH.shade(col, big ? 0.1 : -0.3));
    rect(x, bx, fy - 5, 9, 2, base); rect(x, bx, fy - 5, 9, 1, ACH.shade(base, 0.25));
    rect(x, sx - 1, fy - 3, 2, 2, '#14161f');
    rect(x, sx - 3, fy - 1, 7, 1, '#14161f');
  }
  function moduleFront(x, m, info) {
    const col = info.color, fy = FLOOR[m.floor];
    TEAM_RX.forEach((rx, k) => {
      const dx = m.x0 + rx + 12;
      desk(x, dx, fy, 13, 6, '#3a4156', col);
      monitor(x, dx + 3, fy - 6, 8, 7);
      if (k % 2) mug(x, dx + 10, fy - 6, k === 1 ? ACH.shade(col, 0.2) : null);
      else rect(x, dx + 10, fy - 7, 2, 1, '#cfd6e6');
    });
    const lx = m.x0 + LEAD_RX + 14;
    desk(x, lx, fy, 23, 7, ACH.shade(col, -0.5), col, true);
    monitor(x, lx + 2, fy - 7, 8, 7); monitor(x, lx + 11, fy - 7, 8, 7);
    rect(x, lx + 20, fy - 9, 2, 2, col); rect(x, lx + 20, fy - 10, 2, 1, '#ffffff');
  }
  function desk(x, dx, fy, w, h, top, col, lead) {
    rect(x, dx, fy - h, w, 2, ACH.shade(top, 0.35));
    rect(x, dx, fy - h, w, 1, ACH.shade(top, 0.6));
    rect(x, dx, fy - h + 2, w, h - 2, top);
    rect(x, dx + 1, fy - h + 3, w - 2, 1, ACH.shade(top, -0.25));
    if (lead) { rect(x, dx, fy - 2, w, 1, col); rect(x, dx + 2, fy - h + 4, w - 4, 1, ACH.alpha(col, 0.7)); }
    else rect(x, dx + w - 4, fy - h + 3, 2, 1, col);
    rect(x, dx, fy - 1, w, 1, '#0e1018');
  }
  function monitor(x, mx, by, w, h) {
    rect(x, mx + w / 2 - 1, by - 2, 2, 2, '#4a5168');
    rect(x, mx + w / 2 - 2, by - 1, 4, 1, '#5d6681');
    rect(x, mx, by - h - 1, w, h - 1, '#2b3042');
    rect(x, mx, by - h - 1, w, 1, '#7a849c');
    rect(x, mx, by - 3, w, 1, '#1a1d28');
  }
  world.monitorScreens = []; // diisi saat build: {x,y,w,h,col,owner}

  /* ---------------- RUANG BERSAMA ---------------- */
  function sharedBack(x) {
    const fy = FLOOR[4], top = TOP[4];
    // MEETING ROOM (gua oval)
    const mr = R.meeting;
    carve(x, mr.x0, mr.top, mr.x1, fy + 6, '#0b1430', 22);
    let g = x.createRadialGradient(83, 360, 4, 83, 360, 80);
    g.addColorStop(0, 'rgba(60,140,255,0.32)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(mr.x0, mr.top, mr.x1 - mr.x0, fy - mr.top);
    banner(x, mr.x0 + 26, mr.x1 - 26, mr.top + 1, 'MEETING ROOM', '#7cc4ff');
    // panel layar dinding
    for (let k = 0; k < 4; k++) { const px = mr.x0 + 10 + k * 33; rect(x, px, 345, 16, 12, '#07101f'); rect(x, px, 345, 16, 1, '#3a5a8a'); }
    floorBand(x, mr.x0, mr.x1, fy, '#3d8bff');
    // kursi ujung
    chair(x, 42, fy, '#1f2a48', '#3d8bff', true);
    rect(x, 120, fy - 15, 2, 11, '#1f2a48'); rect(x, 117, fy - 5, 9, 2, '#1f2a48'); rect(x, 121, fy - 3, 2, 2, '#14161f'); rect(x, 118, fy - 1, 7, 1, '#14161f');

    // KANTIN
    const k = R.kantin;
    carve(x, k.x0, top, k.x1, fy + 6, '#2a1a12');
    g = x.createLinearGradient(0, top, 0, fy); g.addColorStop(0, 'rgba(255,170,80,0.22)'); g.addColorStop(1, 'rgba(0,0,0,0.2)');
    x.fillStyle = g; x.fillRect(k.x0, top, k.x1 - k.x0, fy - top);
    wallPanels(x, k.x0, k.x1, top + 10, fy - 4, '#2a1a12');
    banner(x, k.x0, k.x1, top, 'KANTIN', '#ffb35c');
    rect(x, k.x0 + 4, top + 10, k.x1 - k.x0 - 8, 1, '#ffd08a'); glow(x, (k.x0 + k.x1) / 2, top + 11, 60, 24, '#ffaa55', 0.25);
    // papan menu
    rect(x, k.x0 + 6, top + 14, 36, 15, '#07080d'); rect(x, k.x0 + 7, top + 15, 34, 13, '#1a1208');
    ACH.pixText(x, 'MENU', k.x0 + 9, top + 16, '#ffb35c');
    rect(x, k.x0 + 9, top + 23, 14, 1, '#ffe14d'); rect(x, k.x0 + 9, top + 25, 20, 1, '#6dff7a'); rect(x, k.x0 + 30, top + 16, 8, 6, '#ff6a3d');
    // konter & mesin makanan
    rect(x, k.x0 + 4, fy - 30, 14, 26, '#3b4256'); rect(x, k.x0 + 5, fy - 28, 12, 9, '#0c1220'); rect(x, k.x0 + 4, fy - 30, 14, 1, '#7a849c');
    rect(x, k.x0 + 7, fy - 16, 8, 4, '#191d29');
    rect(x, k.x0 + 20, fy - 22, 10, 18, '#c7ccd8'); rect(x, k.x0 + 21, fy - 20, 8, 5, '#1b2232'); rect(x, k.x0 + 20, fy - 22, 10, 1, '#fff');
    rect(x, k.x0 + 23, fy - 12, 4, 3, '#2b2f3e');
    // jendela dapur
    rect(x, k.x0 + 50, top + 14, 40, 13, '#0c0a08'); rect(x, k.x0 + 51, top + 15, 38, 11, '#3a2410');
    for (let p = 0; p < 4; p++) { rect(x, k.x0 + 54 + p * 9, top + 20, 5, 2, '#d8dde8'); rect(x, k.x0 + 55 + p * 9, top + 18, 3, 2, ['#ff9a3d', '#6dff7a', '#ffe14d', '#ff5fa2'][p]); }
    floorBand(x, k.x0, k.x1, fy, '#ff9a3d');

    // ARCADE
    const a = R.arcade;
    carve(x, a.x0, top, a.x1, fy + 6, '#1a0c2c');
    g = x.createLinearGradient(0, top, 0, fy); g.addColorStop(0, 'rgba(190,80,255,0.25)'); g.addColorStop(1, 'rgba(255,40,160,0.1)');
    x.fillStyle = g; x.fillRect(a.x0, top, a.x1 - a.x0, fy - top);
    banner(x, a.x0, a.x1, top, 'ARCADE ROOM', '#ff6ad5');
    // grid neon dinding
    for (let px = a.x0 + 4; px < a.x1; px += 8) rect(x, px, top + 12, 1, 18, 'rgba(255,90,220,0.18)');
    for (let py = top + 12; py < top + 30; py += 6) rect(x, a.x0, py, a.x1 - a.x0, 1, 'rgba(120,90,255,0.2)');
    ['#ff3d6e', '#3dd6ff', '#ffe14d', '#6dff7a'].forEach((c, i) => cabinet(x, a.x0 + 6 + i * 20, fy, c));
    // mesin capit
    const cx0 = a.x1 - 18;
    rect(x, cx0, fy - 30, 15, 30, '#e04a8a'); rect(x, cx0 + 1, fy - 28, 13, 14, 'rgba(180,230,255,0.25)'); rect(x, cx0 + 1, fy - 28, 13, 1, '#fff');
    rect(x, cx0 + 2, fy - 16, 11, 2, '#ffd84d'); rect(x, cx0 + 3, fy - 18, 2, 2, '#6dff7a'); rect(x, cx0 + 7, fy - 18, 3, 2, '#3dd6ff'); rect(x, cx0 + 10, fy - 17, 2, 1, '#ff5fa2');
    rect(x, cx0, fy - 12, 15, 1, '#ff9ac8'); rect(x, cx0 + 5, fy - 9, 5, 3, '#1a0c2c');
    floorBand(x, a.x0, a.x1, fy, '#d24dff');

    // GYM
    const gy = R.gym;
    carve(x, gy.x0, top, gy.x1, fy + 6, '#0e2216');
    g = x.createLinearGradient(0, top, 0, fy); g.addColorStop(0, 'rgba(90,255,120,0.2)'); g.addColorStop(1, 'rgba(0,0,0,0.2)');
    x.fillStyle = g; x.fillRect(gy.x0, top, gy.x1 - gy.x0, fy - top);
    wallPanels(x, gy.x0, gy.x1, top + 10, fy - 4, '#0e2216');
    banner(x, gy.x0, gy.x1, top, 'GYM', '#6dff7a');
    rect(x, gy.x0 + 4, top + 10, gy.x1 - gy.x0 - 8, 1, '#9dffad'); glow(x, (gy.x0 + gy.x1) / 2, top + 11, 60, 22, '#6dff7a', 0.2);
    // cermin & rak dumbel
    rect(x, gy.x0 + 46, top + 13, 30, 18, '#7d93a8'); rect(x, gy.x0 + 47, top + 14, 28, 16, '#a9c2d6');
    rect(x, gy.x0 + 50, top + 15, 3, 14, 'rgba(255,255,255,0.4)'); rect(x, gy.x0 + 56, top + 15, 1, 14, 'rgba(255,255,255,0.3)');
    rect(x, gy.x0 + 78, fy - 20, 14, 2, '#5d6681'); rect(x, gy.x0 + 78, fy - 12, 14, 2, '#5d6681');
    for (let d = 0; d < 4; d++) { rect(x, gy.x0 + 79 + d * 3, fy - 23, 2, 3, '#22252f'); rect(x, gy.x0 + 79 + d * 3, fy - 15, 2, 3, '#ff5f5f'); }
    // treadmill (dasar)
    [gy.x0 + 4, gy.x0 + 25].forEach((tx) => {
      rect(x, tx, fy - 4, 20, 3, '#22252f'); rect(x, tx, fy - 4, 20, 1, '#4a5168');
      rect(x, tx + 17, fy - 18, 2, 14, '#3b4256'); rect(x, tx + 14, fy - 19, 6, 3, '#4a5168'); rect(x, tx + 15, fy - 18, 3, 1, '#6dff7a');
    });
    // samsak gantung
    const bx = gy.x1 - 9;
    rect(x, bx + 2, top + 10, 1, 8, '#8a93a8'); rect(x, bx, top + 18, 5, 14, '#b8333f'); rect(x, bx, top + 18, 5, 1, '#e05560'); rect(x, bx + 1, top + 20, 1, 10, '#d94a57');
    floorBand(x, gy.x0, gy.x1, fy, '#45d660');

    // SLEEP PODS
    const s = R.sleep;
    carve(x, s.x0, top, s.x1, fy + 6, '#0b1428');
    banner(x, s.x0, s.x1, top, 'SLEEP PODS', '#7fa8ff');
    for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) {
      const px = s.x0 + 3 + c * 24, py = fy - 18 - r * 18;
      rect(x, px, py, 22, 17, '#2a3550'); rect(x, px + 1, py + 1, 20, 15, '#0d1a36');
      rect(x, px + 2, py + 12, 18, 3, '#cfd8ee'); rect(x, px + 2, py + 11, 5, 2, '#ffffff');
      rect(x, px, py, 22, 1, '#6d7fa8');
    }
    floorBand(x, s.x0, s.x1, fy, '#5d7dff');

    // SHOWERS
    const sh = R.shower;
    carve(x, sh.x0, top, sh.x1, fy + 6, '#16323c');
    for (let px = sh.x0; px < sh.x1; px += 5) for (let py = top + 10; py < fy - 4; py += 5) { rect(x, px, py, 5, 5, ((px + py) / 5) % 2 ? '#1f4450' : '#1b3c47'); rect(x, px, py, 5, 1, '#2a5562'); }
    banner(x, sh.x0, sh.x1, top, 'SHOWERS', '#7ff3ff');
    for (let c = 0; c < 3; c++) { const px = sh.x0 + 2 + c * 21; rect(x, px + 8, top + 12, 6, 2, '#cfd6e6'); rect(x, px + 10, top + 10, 2, 3, '#8a93a8'); }
    floorBand(x, sh.x0, sh.x1, fy, '#3dd6ff');

    // DANCE FLOOR (gua oval)
    const d = R.dance;
    carve(x, d.x0, d.top, d.x1, fy + 6, '#140821', 22);
    banner(x, d.x0 + 30, d.x1 - 30, d.top + 1, 'DANCE FLOOR', '#ff6ad5');
    // speaker & booth DJ
    [[d.x0 + 6, fy - 22], [d.x1 - 14, fy - 22]].forEach(([px, py]) => {
      rect(x, px, py, 9, 18, '#1a1a24'); rect(x, px, py, 9, 1, '#4a4a5a');
      rect(x, px + 2, py + 2, 5, 5, '#2b2b38'); rect(x, px + 3, py + 3, 3, 3, '#0d0d14'); rect(x, px + 1, py + 9, 7, 7, '#2b2b38'); rect(x, px + 3, py + 11, 3, 3, '#0d0d14');
    });
    rect(x, d.x0 + 10, d.top + 10, d.x1 - d.x0 - 20, 1, '#3a2a55');
    floorBand(x, d.x0, d.x1, fy, '#ff3dd8');

    // pilar/pintu antar ruang di lantai bawah
    [150, 250, 350, 572, 642].forEach((px) => doorPillar(x, px, fy, top));
  }
  function cabinet(x, px, fy, col) {
    rect(x, px, fy - 27, 14, 27, '#18142a'); rect(x, px, fy - 27, 14, 4, col); rect(x, px + 1, fy - 26, 12, 2, ACH.shade(col, 0.4));
    rect(x, px + 2, fy - 22, 10, 9, '#05060a');
    rect(x, px + 1, fy - 12, 12, 3, '#2a2440'); rect(x, px + 3, fy - 12, 1, 1, '#ff3d6e'); rect(x, px + 6, fy - 11, 1, 1, '#3dd6ff'); rect(x, px + 9, fy - 12, 1, 1, '#ffe14d');
    rect(x, px + 1, fy - 9, 12, 9, ACH.shade(col, -0.55)); rect(x, px + 5, fy - 6, 4, 3, '#0d0b18');
    world.monitorScreens.push({ x: px + 2, y: fy - 22, w: 10, h: 9, col, kind: 'arcade' });
  }
  function doorPillar(x, px, fy, top) {
    rect(x, px, top, 4, fy - top - 24, '#2b3040');
    rect(x, px, top, 1, fy - top - 24, '#5d6681'); rect(x, px + 3, top, 1, fy - top - 24, '#151823');
    rect(x, px - 1, fy - 25, 6, 2, '#5d6681');
    rect(x, px + 1, fy - 27, 2, 1, '#6dff7a');
  }
  function sharedFront(x) {
    const fy = FLOOR[4];
    // meja hologram
    rect(x, 50, fy - 9, 68, 3, '#2a3d66'); rect(x, 50, fy - 9, 68, 1, '#6ea8ff');
    rect(x, 52, fy - 6, 64, 5, '#16213c'); rect(x, 54, fy - 6, 60, 1, 'rgba(110,168,255,0.5)');
    rect(x, 78, fy - 11, 12, 2, '#3a5a8a'); rect(x, 80, fy - 12, 8, 1, '#9fd0ff');
    // meja kantin
    const k = R.kantin;
    [[k.x0 + 34, 26], [k.x0 + 64, 28]].forEach(([tx, w]) => {
      rect(x, tx, fy - 8, w, 2, '#e9d7bf'); rect(x, tx, fy - 8, w, 1, '#fff6e8'); rect(x, tx + 1, fy - 6, w - 2, 1, '#9c7d5a');
      rect(x, tx + 2, fy - 6, 2, 6, '#5b4a3a'); rect(x, tx + w - 4, fy - 6, 2, 6, '#5b4a3a');
      for (let p = 0; p < w - 6; p += 9) { rect(x, tx + 3 + p, fy - 9, 5, 1, '#d8dde8'); rect(x, tx + 4 + p, fy - 10, 3, 1, ['#ff9a3d', '#6dff7a', '#ffe14d'][(p / 9) % 3]); }
    });
    // kaca kapsul tidur
    const s = R.sleep;
    for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) {
      const px = s.x0 + 3 + c * 24, py = fy - 18 - r * 18;
      x.fillStyle = 'rgba(140,190,255,0.16)'; x.fillRect(px + 1, py + 1, 20, 15);
      rect(x, px + 3, py + 2, 1, 6, 'rgba(255,255,255,0.35)'); rect(x, px + 4, py + 2, 4, 1, 'rgba(255,255,255,0.3)');
      rect(x, px, py + 16, 22, 1, '#6d7fa8'); rect(x, px + 18, py + 7, 2, 2, '#5dff8a');
    }
    // kaca shower
    const sh = R.shower;
    for (let c = 0; c < 3; c++) {
      const px = sh.x0 + 2 + c * 21;
      x.fillStyle = 'rgba(200,240,255,0.30)'; x.fillRect(px + 2, fy - 26, 17, 22);
      rect(x, px + 1, fy - 27, 1, 27, '#a9c2d6'); rect(x, px + 19, fy - 27, 1, 27, '#a9c2d6'); rect(x, px + 1, fy - 27, 19, 1, '#cfe6f2');
      rect(x, px + 4, fy - 24, 1, 10, 'rgba(255,255,255,0.45)'); rect(x, px + 5, fy - 24, 1, 4, 'rgba(255,255,255,0.35)');
    }
    // booth DJ
    const d = R.dance;
    rect(x, d.x1 - 40, fy - 12, 24, 12, '#1d1530'); rect(x, d.x1 - 40, fy - 12, 24, 1, '#ff6ad5');
    rect(x, d.x1 - 37, fy - 9, 18, 1, 'rgba(255,106,213,0.6)'); rect(x, d.x1 - 36, fy - 14, 5, 2, '#2b2b38'); rect(x, d.x1 - 26, fy - 14, 5, 2, '#2b2b38');
  }

  /* ---------------- PERMUKAAN ---------------- */
  function surfaceBack(x) {
    const gy = FLOOR[0];
    // MENARA KOMANDO
    const t = TOWER;
    rect(x, t.x0 + 14, 46, 40, 60, '#262b3d');
    for (let py = 50; py < 104; py += 8) { rect(x, t.x0 + 14, py, 40, 1, '#3f4660'); }
    rect(x, t.x0 + 14, 46, 1, 60, '#5d6681'); rect(x, t.x0 + 53, 46, 1, 60, '#141722');
    for (let py = 52; py < 100; py += 8) for (let px = t.x0 + 18; px < t.x0 + 52; px += 8) rect(x, px, py, 5, 3, (px + py) % 3 ? '#8a5cff' : '#3dd6ff');
    // papan nama
    rect(x, t.x0 + 4, 80, 60, 9, '#0a0b12'); rect(x, t.x0 + 4, 80, 60, 1, '#b46bff'); rect(x, t.x0 + 4, 88, 60, 1, '#b46bff');
    ACH.pixText(x, 'ACPH-COMMAND', t.x0 + 7, 82, '#d7b8ff');
    // tingkat atas
    rect(x, t.x0 + 18, 30, 32, 16, '#2f3550'); rect(x, t.x0 + 18, 30, 32, 1, '#7a849c');
    rect(x, t.x0 + 20, 34, 28, 6, '#5d3fd0'); for (let px = t.x0 + 21; px < t.x0 + 47; px += 4) rect(x, px, 35, 2, 4, '#b9a4ff');
    rect(x, t.x0 + 31, 18, 6, 12, '#3a4054'); rect(x, t.x0 + 33, 6, 2, 12, '#8a93a8');
    // ruang dasar (cutaway)
    rect(x, t.x0, 104, t.x1 - t.x0, gy - 104 + 1, '#1b1f2e');
    rect(x, t.x0 + 2, 106, t.x1 - t.x0 - 4, gy - 106, '#120f28');
    let g = x.createLinearGradient(0, 106, 0, gy); g.addColorStop(0, 'rgba(160,100,255,0.35)'); g.addColorStop(1, 'rgba(60,40,120,0.1)');
    x.fillStyle = g; x.fillRect(t.x0 + 2, 106, t.x1 - t.x0 - 4, gy - 106);
    rect(x, t.x0, 104, t.x1 - t.x0, 2, '#5d6681');
    for (let k = 0; k < 3; k++) { const px = t.x0 + 8 + k * 20; rect(x, px, gy - 12, 14, 9, '#2b3042'); rect(x, px + 1, gy - 11, 12, 1, '#7a849c'); rect(x, px + 2, gy - 20, 10, 7, '#0b0a1a'); world.monitorScreens.push({ x: px + 3, y: gy - 19, w: 8, h: 5, col: '#b46bff', kind: 'console' }); }
    // tiang antena + panel surya kecil
    rect(x, t.x0 - 2, 70, 2, 62, '#5d6681'); rect(x, t.x0 - 4, 70, 6, 1, '#8a93a8');
    // LANDASAN ROKET
    const pc = PAD.cx;
    rect(x, pc - 40, gy - 2, 80, 4, '#2b3042'); rect(x, pc - 42, gy - 1, 84, 2, '#1d2130');
    x.fillStyle = '#3a4054'; x.beginPath(); x.ellipse(pc, gy - 2, 38, 5, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#525a74'; x.beginPath(); x.ellipse(pc, gy - 3, 34, 4, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#2f3550'; x.beginPath(); x.ellipse(pc, gy - 3, 20, 2.5, 0, 0, Math.PI * 2); x.fill();
    // menara servis
    rect(x, pc + 24, 64, 3, 66, '#5d6681'); rect(x, pc + 32, 64, 3, 66, '#5d6681');
    for (let py = 66; py < 128; py += 6) { x.fillStyle = '#5d6681'; for (let s = 0; s < 8; s++) x.fillRect(pc + 26 + s, py + Math.round(s * 0.7), 1, 1); }
    rect(x, pc + 12, 82, 14, 2, '#8a93a8'); rect(x, pc + 24, 62, 11, 2, '#8a93a8');
    // roket
    rocket(x, pc, gy - 4);
    // PANEL SURYA
    for (let k = 0; k < 3; k++) {
      const px = 210 + k * 26;
      rect(x, px + 9, gy - 12, 2, 10, '#5d6681');
      x.fillStyle = '#1b2f6b'; x.beginPath(); x.moveTo(px, gy - 13); x.lineTo(px + 20, gy - 19); x.lineTo(px + 22, gy - 13); x.lineTo(px + 2, gy - 7); x.closePath(); x.fill();
      x.fillStyle = '#3a5bd0'; for (let s = 0; s < 5; s++) x.fillRect(px + 2 + s * 4, gy - 14 - s, 1, 6);
      rect(x, px + 1, gy - 13, 20, 1, 'rgba(160,200,255,0.5)');
    }
    // ROVER
    const rx = 336;
    rect(x, rx, gy - 12, 30, 6, '#d9dde8'); rect(x, rx, gy - 12, 30, 1, '#ffffff'); rect(x, rx + 2, gy - 17, 12, 5, '#9fb4cc'); rect(x, rx + 3, gy - 16, 10, 3, '#1b2a44');
    rect(x, rx + 20, gy - 20, 1, 8, '#8a93a8'); rect(x, rx + 18, gy - 22, 5, 2, '#cfd6e6');
    rect(x, rx + 2, gy - 8, 26, 2, '#ffc940');
    [rx + 3, rx + 13, rx + 23].forEach((wx) => { rect(x, wx, gy - 6, 6, 5, '#22252f'); rect(x, wx + 2, gy - 4, 2, 1, '#6a7286'); });
    // bendera
    rect(x, 300, gy - 30, 1, 29, '#cfd6e6'); rect(x, 301, gy - 30, 14, 9, '#ffffff'); rect(x, 301, gy - 30, 14, 4, '#e8323c');
    // HATCH ELEVATOR di permukaan
    const hx = SHAFT.x0 - 2;
    x.fillStyle = '#3a4054'; x.beginPath(); x.ellipse(SHAFT.cx, gy - 16, 25, 16, 0, Math.PI, 0); x.fill();
    rect(x, hx - 2, gy - 17, 48, 18, '#3a4054');
    x.fillStyle = '#5d6681'; x.beginPath(); x.ellipse(SHAFT.cx, gy - 16, 23, 14, 0, Math.PI, 0); x.fill();
    rect(x, hx, gy - 17, 44, 17, '#5d6681');
    rect(x, hx + 4, gy - 22, 36, 22, '#0d1426');
    x.fillStyle = 'rgba(80,200,255,0.25)'; x.fillRect(hx + 4, gy - 22, 36, 22);
    rect(x, hx + 4, gy - 23, 36, 1, '#3dd6ff'); rect(x, hx + 21, gy - 22, 2, 22, '#2b3042');
    ACH.pixText(x, 'LIFT', SHAFT.cx - 7, gy - 30, '#bdeeff');
    // pintu airlock kubah
    const ax = DOME.cx - DOME.rx - 6;
    rect(x, ax, gy - 20, 18, 20, '#3a4054'); rect(x, ax + 2, gy - 18, 14, 18, '#1b2232'); rect(x, ax, gy - 20, 18, 1, '#8a93a8');
    rect(x, ax + 3, gy - 16, 12, 16, 'rgba(61,214,255,0.25)'); rect(x, ax + 7, gy - 24, 4, 3, '#3a4054');
  }
  function rocket(x, cx, by) {
    // badan
    const body = [[0, 4], [1, 6], [2, 8], [3, 9], [4, 10], [6, 11], [8, 12]];
    const top = by - 62;
    for (let py = top; py < by - 8; py++) {
      const d = py - top;
      let hw = 12;
      for (const [k, w] of body) if (d <= k * 2) { hw = w / 2 + 1; break; }
      hw = Math.min(hw, 7);
      if (d < 3) hw = 2; else if (d < 7) hw = 3; else if (d < 12) hw = 5; else if (d < 18) hw = 6;
      rect(x, cx - hw, py, hw * 2, 1, '#e9edf5');
      rect(x, cx - hw, py, 2, 1, '#ffffff');
      rect(x, cx + hw - 3, py, 3, 1, '#a9b3c7');
    }
    rect(x, cx - 2, top, 4, 3, '#b46bff');
    rect(x, cx - 7, top + 24, 14, 3, '#8a5cff'); rect(x, cx - 7, top + 40, 14, 2, '#b46bff');
    // jendela
    rect(x, cx - 3, top + 14, 6, 6, '#3a4054'); rect(x, cx - 2, top + 15, 4, 4, '#5dd6ff'); rect(x, cx - 2, top + 15, 2, 2, '#c8f4ff');
    // sirip
    x.fillStyle = '#8a5cff';
    x.beginPath(); x.moveTo(cx - 7, by - 22); x.lineTo(cx - 13, by - 6); x.lineTo(cx - 7, by - 9); x.closePath(); x.fill();
    x.beginPath(); x.moveTo(cx + 7, by - 22); x.lineTo(cx + 13, by - 6); x.lineTo(cx + 7, by - 9); x.closePath(); x.fill();
    rect(x, cx - 1, by - 20, 2, 12, '#6a3fd0');
    // nosel
    rect(x, cx - 4, by - 8, 8, 4, '#3a4054'); rect(x, cx - 5, by - 5, 10, 2, '#22252f');
  }
  function surfaceFront(x) {
    // isi kubah: tanah kebiruan, perosotan, tanaman alien
    const d = DOME, gy = FLOOR[0];
    // perosotan
    const sx = d.cx + 46;
    rect(x, sx + 14, gy - 34, 2, 34, '#ffc940'); rect(x, sx + 24, gy - 34, 2, 34, '#ffc940');
    for (let py = gy - 32; py < gy; py += 5) rect(x, sx + 14, py, 12, 1, '#ffd96b');
    rect(x, sx + 12, gy - 36, 16, 3, '#8a5cff'); rect(x, sx + 14, gy - 42, 12, 6, '#b46bff'); rect(x, sx + 14, gy - 42, 12, 1, '#d7b8ff');
    x.fillStyle = '#ff5fa2';
    for (let s = 0; s < 22; s++) x.fillRect(sx + 12 - s, gy - 34 + Math.round(s * 1.45), 4, 2);
    x.fillStyle = '#ff9ac8'; for (let s = 0; s < 22; s++) x.fillRect(sx + 12 - s, gy - 34 + Math.round(s * 1.45), 4, 1);
    // tanaman alien
    [[d.cx - 76, '#6dff7a'], [d.cx - 20, '#b46bff'], [d.cx + 80, '#3dd6ff']].forEach(([px, c]) => {
      for (let k = 0; k < 4; k++) { const h = 5 + k * 2; rect(x, px + k * 2, gy - h, 1, h, ACH.shade(c, -0.35)); rect(x, px + k * 2 - 1, gy - h - 1, 3, 2, c); }
    });
  }

  /* ---------------- LIFT (latar) ---------------- */
  function shaftBack(x) {
    const s = SHAFT;
    const top = FLOOR[0] - 22, bot = FLOOR[4] + 2;
    rect(x, s.x0 - 3, top, s.x1 - s.x0 + 6, bot - top + 4, '#0e111b');
    rect(x, s.x0, top, s.x1 - s.x0, bot - top, '#081426');
    const g = x.createLinearGradient(s.x0, 0, s.x1, 0);
    g.addColorStop(0, 'rgba(61,214,255,0.35)'); g.addColorStop(0.5, 'rgba(61,214,255,0.06)'); g.addColorStop(1, 'rgba(61,214,255,0.35)');
    x.fillStyle = g; x.fillRect(s.x0, top, s.x1 - s.x0, bot - top);
    for (let py = top + 4; py < bot; py += 10) rect(x, s.x0, py, s.x1 - s.x0, 1, 'rgba(120,230,255,0.18)');
    rect(x, s.x0 - 2, top, 2, bot - top, '#3dd6ff'); rect(x, s.x1, top, 2, bot - top, '#3dd6ff');
    rect(x, s.x0 - 3, top, 1, bot - top, '#9ff6ff'); rect(x, s.x1 + 2, top, 1, bot - top, '#1d6f8a');
    rect(x, s.cx - 1, top, 2, bot - top, '#16324a');
    // platform tiap lantai
    for (let f = 1; f <= 4; f++) {
      const fy = FLOOR[f];
      rect(x, s.x0, fy, s.x1 - s.x0, 2, '#4a5168'); rect(x, s.x0, fy, s.x1 - s.x0, 1, '#9ff6ff');
      ACH.pixText(x, String(f === 4 ? 'B' : f), s.x0 + 2, fy - 22, 'rgba(160,240,255,0.7)');
    }
    glow(x, s.cx, (top + bot) / 2, 40, 150, '#3dd6ff', 0.15);
  }

  /* ---------------- BUILD ---------------- */
  world.build = function (modInfo) {
    world.monitorScreens = [];
    world.sky = buildSky();
    const [m, mx] = ACH.canvas(W, H);
    buildTerrain(mx);
    // pipa & kristal di sisi batu
    pipe(mx, 4, 176, 150, 176, '#3dd6ff'); pipe(mx, 644, 236, 796, 236, '#ff5fa2'); pipe(mx, 4, 300, 150, 300, '#6dff7a');
    pipe(mx, 120, 150, 120, 176); pipe(mx, 690, 140, 690, 236); pipe(mx, 30, 300, 30, 322);
    pipe(mx, 644, 296, 760, 296, '#ffe14d');
    crystals(mx, 60, 222, '#3dd6ff'); crystals(mx, 740, 190, '#b46bff'); crystals(mx, 96, 262, '#b46bff');
    crystals(mx, 720, 276, '#3dd6ff'); crystals(mx, 90, 430, '#6dff7a'); crystals(mx, 700, 432, '#3dd6ff'); crystals(mx, 40, 360, '#ff5fa2');
    // ruang kecil penyimpanan di sisi kiri & kanan
    carve(mx, 30, 196, 104, 214, '#141824'); ACH.pixText(mx, 'GUDANG', 34, 198, '#7d8494');
    for (let k = 0; k < 6; k++) { rect(mx, 34 + k * 11, 207, 9, 7, ['#6b4a2e', '#4a5168', '#6b4a2e', '#3a5a8a', '#6b4a2e', '#4a5168'][k]); rect(mx, 34 + k * 11, 207, 9, 1, '#8a93a8'); }
    carve(mx, 686, 252, 778, 270, '#1a1024'); ACH.pixText(mx, 'REAKTOR', 690, 254, '#ff9ac8');
    for (let k = 0; k < 3; k++) { rect(mx, 694 + k * 28, 260, 18, 10, '#2b2440'); rect(mx, 699 + k * 28, 262, 8, 6, '#ff5fa2'); }
    glow(mx, 732, 264, 60, 18, '#ff5fa2', 0.3);
    // hidroponik (kiri)
    world.leds = [];
    carve(mx, 22, 238, 114, 264, '#0d1a12'); ACH.pixText(mx, 'HIDROPONIK', 26, 240, '#6dff7a');
    rect(mx, 24, 247, 88, 1, '#ff5fa2'); glow(mx, 68, 250, 50, 12, '#ff5fa2', 0.28);
    for (let k = 0; k < 11; k++) {
      const px = 25 + k * 8; rect(mx, px, 259, 6, 4, '#3a4054'); rect(mx, px, 259, 6, 1, '#6a7286');
      const hh = 5 + ((k * 7) % 5);
      for (let j = 0; j < hh; j++) { rect(mx, px + 2 + ((j % 2) ? 1 : 0), 258 - j, 1, 1, j % 3 ? '#3fbf5f' : '#2a8f45'); if (j % 2) { rect(mx, px + 1, 258 - j, 1, 1, '#4fd16f'); rect(mx, px + 4, 257 - j, 1, 1, '#2a8f45'); } }
      if (k % 3 === 0) rect(mx, px + 3, 258 - hh, 2, 2, '#ff6a6a'); else if (k % 3 === 1) rect(mx, px + 3, 258 - hh, 1, 2, '#ffe14d');
    }
    // ruang server (kanan)
    carve(mx, 672, 166, 782, 192, '#0b1120'); ACH.pixText(mx, 'SERVER', 676, 168, '#3dd6ff');
    for (let k = 0; k < 6; k++) {
      const px = 676 + k * 17; rect(mx, px, 175, 13, 17, '#1a1f2e'); rect(mx, px, 175, 13, 1, '#4a5168');
      for (let r = 0; r < 4; r++) { rect(mx, px + 2, 178 + r * 3, 9, 2, '#0e121c'); world.leds.push({ x: px + 3 + ((r + k) % 3) * 3, y: 178 + r * 3, c: ['#5dff8a', '#3dd6ff', '#ffc940'][(r + k) % 3], ph: k * 1.7 + r }); }
    }
    glow(mx, 727, 182, 60, 14, '#3dd6ff', 0.18);
    // terowongan tambang helium-3 (bawah)
    carve(mx, 160, 412, 640, 438, '#120f18');
    ACH.pixText(mx, 'TAMBANG HELIUM-3', 168, 414, '#c9a46a');
    for (let px = 162; px < 640; px += 5) rect(mx, px, 434, 3, 2, '#4a3a2a');
    rect(mx, 160, 433, 480, 1, '#9aa3b5'); rect(mx, 160, 435, 480, 1, '#6a7286');
    for (let px = 200; px < 640; px += 56) {
      rect(mx, px, 413, 3, 21, '#6b4a2e'); rect(mx, px, 413, 1, 21, '#8d6450'); rect(mx, px - 6, 413, 15, 3, '#6b4a2e');
      rect(mx, px + 5, 418, 3, 3, '#ffd36a'); glow(mx, px + 6, 420, 14, 10, '#ffb347', 0.35);
    }
    for (let k = 0; k < 9; k++) { const px = 230 + k * 47; crystals(mx, px, 432 - (k % 2) * 2, k % 2 ? '#3dd6ff' : '#9ff6ff'); }
    shaftBack(mx);
    world.modules.forEach((mod) => moduleBack(mx, mod, modInfo[mod.i]));
    // pilar pintu antar modul
    for (let f = 1; f <= 3; f++) { doorPillar(mx, 298, FLOOR[f], TOP[f]); }
    sharedBack(mx);
    surfaceBack(mx);
    world.main = m;

    const [fg, fx] = ACH.canvas(W, H);
    world.modules.forEach((mod) => moduleFront(fx, mod, modInfo[mod.i]));
    sharedFront(fx);
    surfaceFront(fx);
    world.fg = fg;

    // daftar layar monitor dinamis
    world.modules.forEach((mod) => {
      const fy = FLOOR[mod.floor], col = modInfo[mod.i].color;
      TEAM_RX.forEach((rx, k) => world.monitorScreens.push({ x: mod.x0 + rx + 16, y: fy - 14, w: 6, h: 5, col, kind: 'desk', mod: mod.i, seat: k }));
      const lx = mod.x0 + LEAD_RX + 14;
      world.monitorScreens.push({ x: lx + 3, y: fy - 15, w: 6, h: 5, col, kind: 'lead', mod: mod.i });
      world.monitorScreens.push({ x: lx + 12, y: fy - 15, w: 6, h: 5, col, kind: 'lead', mod: mod.i });
      world.monitorScreens.push({ x: mod.x0 + LEAD_RX + 8, y: TOP[mod.floor] + 15, w: 28, h: 15, col, kind: 'wall', mod: mod.i, icon: modInfo[mod.i].icon });
    });

    // area hover ruangan
    world.areas = [];
    world.modules.forEach((mod) => world.areas.push({ key: 'desk', mod: mod.i, x0: mod.x0, y0: TOP[mod.floor], x1: mod.x1, y1: FLOOR[mod.floor] + 4 }));
    Object.entries(R).forEach(([k, r]) => world.areas.push({ key: k, x0: r.x0, y0: r.top || TOP[4], x1: r.x1, y1: FLOOR[4] + 4 }));
    world.areas.push({ key: 'outdoor', x0: DOME.cx - DOME.rx, y0: DOME.cy - DOME.ry, x1: DOME.cx + DOME.rx, y1: FLOOR[0] + 4 });
    world.areas.push({ key: 'command', x0: TOWER.x0, y0: 6, x1: TOWER.x1, y1: FLOOR[0] + 4 });
    world.areas.push({ key: 'rocket', x0: PAD.cx - 40, y0: 60, x1: PAD.cx + 40, y1: FLOOR[0] + 4 });
    world.areas.push({ key: 'lift', x0: SHAFT.x0, y0: FLOOR[0] - 30, x1: SHAFT.x1, y1: FLOOR[4] + 4 });
  };
})();
