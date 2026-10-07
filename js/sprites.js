/* Sprite astronot pixel-art prosedural (template + anggota tubuh + outline otomatis) */
(function () {
  const ACH = window.ACH;
  const GW = 17, GH = 21, OX = 2, OY = 2;

  const HEAD_FRONT = ['....VVVVV....', '...WCCCCCW...', '..WWHHHHHWW..', '..WHHSSSHHW..', '..WSESSSESW..', '..WSSSSSSSW..', '..wWSSsSSWw..', '...wWWWWWw...'];
  const TORSO_FRONT = ['.BWWWWCWWWWB.', '....WCCCW....', '....WWWWW....', '....LLLLL....', '....WWWWW....'];
  const HEAD_SIDE = ['.....VVVV....', '....WCCCCVV..', '...WWWWHHHW..', '...WWWHHSSW..', '...WWWHSSEW..', '...WWWWSSSW..', '...wWWWWSsW..', '....wWWWWw...'];
  const TORSO_SIDE = ['...BBWWWCW...', '...BBWWCCW...', '...BBWWWWW...', '...BbLLLLL...', '.....WWWWW...'];
  const HEAD_BACK = ['....VVVVV....', '...WCCCCCW...', '..WWWWWWWWW..', '..WWWWWWWWW..', '..WWWWWWWWW..', '..WWWWWWWWW..', '..wWWWWWWWw..', '...wWWWWWw...'];
  const TORSO_BACK = ['.WWBBBBBBBWW.', '...BbCCCbB...', '...BBBBBBB...', '...BbbbbbB...', '....LLLLL....'];

  const NHEAD_FRONT = ['.....HHH.....', '...HHHHHHH...', '...HSSSSSH...', '...SESSSES...', '....SSsSS....', '.....SSS.....'];
  const NHEAD_SIDE = ['....HHHHH....', '...HHHHHHH...', '...HHHSSSS...', '...HHSSSES...', '....HSSSSs...', '.....SSS.....'];
  const NHEAD_BACK = ['.....HHH.....', '...HHHHHHH...', '...HHHHHHH...', '...HHHHHHH...', '....HHHHH....', '.....SSS.....'];
  const NTORSO_FRONT = ['..JJJJJJJJJ..', '....JJcJJ....', '....JJcJJ....', '....jjjjj....', '....JJJJJ....'];
  const NTORSO_SIDE = ['.....JJJJJ...', '....JJJcJJ...', '....JJJJJJ...', '.....jjjjj...', '.....JJJJJ...'];
  const NTORSO_BACK = ['..JJJJJJJJJ..', '....JJJJJ....', '....JJjJJ....', '....jjjjj....', '....JJJJJ....'];

  const VIEW = {
    idle: 'front', talk: 'front', coffee: 'front', up: 'front', dance: 'front', lift: 'front', stretch: 'front', sleep: 'front', wave: 'front',
    walk: 'side', run: 'side', punch: 'side', repair: 'side', stand: 'side',
    sit: 'sit', type: 'sit', eat: 'sit', nap: 'sit',
    back: 'back',
  };

  function visual(p) {
    // p: {id,color,hair,skin,prop,npc}
    const v = {
      npc: !!p.npc, prop: p.npc ? null : p.prop, color: p.color,
      pal: {
        V: '#bdeeff', W: '#eef1f7', w: '#a9b3c7', C: p.color, c: ACH.shade(p.color, -0.35),
        S: p.skin || '#f0c49c', s: ACH.shade(p.skin || '#f0c49c', -0.18), H: p.hair || '#2a1c14', E: '#1b1b2b',
        B: '#8790a6', b: '#5d6479', L: '#6e4b2f', K: '#3b4156',
        J: ACH.mix(p.color, '#2b3047', 0.38), j: ACH.mix(p.color, '#141726', 0.62),
        g: '#1d1d26', G: '#9aa3b5', M: '#ffffff', N: '#26365f', n: '#1a2442', T: '#9ff6ff', t: '#2bb6d8', Y: '#ffe14d', O: '#7a4a24', P: '#3a2a5c', R: '#c9a0ff',
      },
    };
    if (p.prop === 'briefcase') { v.pal.W = '#2c3e70'; v.pal.w = '#1d2a50'; v.pal.K = '#16161c'; v.pal.L = '#1d2a50'; }
    if (p.prop === 'coat') { v.pal.K = '#5a4632'; }
    return v;
  }
  ACH.visual = visual;

  function makeGrid() { return { d: new Array(GW * GH).fill(null) }; }

  function build(v, pose, f) {
    const g = makeGrid();
    const P = (x, y, k) => { x += OX; y += OY; if (x >= 0 && y >= 0 && x < GW && y < GH) g.d[y * GW + x] = k; };
    const stamp = (rows, oy) => rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] !== '.') P(x, y + oy, r[x]); });
    const line = (x0, y0, x1, y1, k) => {
      const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let e = dx - dy;
      for (;;) { P(x0, y0, k); if (x0 === x1 && y0 === y1) break; const e2 = 2 * e; if (e2 > -dy) { e -= dy; x0 += sx; } if (e2 < dx) { e += dx; y0 += sy; } }
    };
    const npc = v.npc;
    const SUIT = npc ? 'J' : 'W', SH = npc ? 'j' : 'w', KNEE = npc ? 'j' : 'C', HAND = npc ? 'S' : 'C';
    const view = VIEW[pose] || 'front';
    const ph = (f / 4) * Math.PI * 2;
    let dy = 0; // offset badan atas (duduk)

    const legsFront = (sl, sr, ll, lr) => {
      [[4, sl, ll], [7, sr, lr]].forEach(([x0, sp, lift]) => {
        for (let r = 13; r <= 16 - lift; r++) {
          const x = x0 + Math.round((sp * (r - 12)) / 5);
          const k = r === 15 - lift ? KNEE : SUIT;
          P(x, r, k); P(x + 1, r, k);
        }
        const fx = x0 + sp;
        for (let r = 17 - lift; r <= 18 - lift; r++) { P(fx - (x0 === 4 ? 1 : 0), r, 'K'); P(fx + (x0 === 4 ? 0 : 0), r, 'K'); P(fx + 1, r, 'K'); P(fx + (x0 === 4 ? -1 : 2), r, 'K'); }
      });
    };
    const armFront = (side, hx, hy) => {
      const sx = side < 0 ? 2 : 10, sy = 9;
      line(sx, sy, hx, hy, SUIT);
      P(hx, hy, HAND);
    };
    const legsSide = (dx) => {
      const leg = (d, k) => {
        for (let r = 13; r <= 16; r++) { const x = 6 + Math.round((d * (r - 13)) / 4); P(x, r, r === 15 ? (k === SUIT ? KNEE : SH) : k); P(x + 1, r, r === 15 ? (k === SUIT ? KNEE : SH) : k); }
        const fx = 6 + d; for (let r = 17; r <= 18; r++) { P(fx, r, 'K'); P(fx + 1, r, 'K'); P(fx + 2, r, 'K'); }
      };
      leg(-dx, SH); leg(dx, SUIT);
    };
    const armSide = (hx, hy) => { line(7, 9 + dy, hx, hy, npc ? 'j' : 'w'); P(hx, hy, HAND); };

    if (view === 'front') {
      stamp(npc ? NHEAD_FRONT : HEAD_FRONT, npc ? 2 : 0);
      stamp(npc ? NTORSO_FRONT : TORSO_FRONT, 8);
      let L = [2, 12], R = [10, 12], sl = 0, sr = 0, ll = 0, lr = 0;
      if (pose === 'talk' && f % 2 === 0) R = [12, 10];
      if (pose === 'wave') R = f % 2 ? [12, 4] : [11, 3];
      if (pose === 'coffee') R = [9, 10];
      if (pose === 'up') { L = [0, 3]; R = [12, 3]; }
      if (pose === 'stretch') { if (f % 2) { L = [5, 1]; R = [7, 1]; } else { L = [0, 4]; R = [12, 4]; } }
      if (pose === 'lift') { if (f % 2) { L = [0, 2]; R = [12, 2]; } else { L = [0, 8]; R = [12, 8]; } }
      if (pose === 'dance') {
        const fr = f % 4;
        if (fr === 0) { L = [0, 3]; R = [12, 3]; sl = -1; sr = 1; }
        if (fr === 1) { L = [-1, 9]; R = [13, 9]; }
        if (fr === 2) { L = [0, 3]; R = [12, 12]; lr = 2; sr = 1; }
        if (fr === 3) { L = [2, 12]; R = [12, 3]; ll = 2; sl = -1; }
      }
      legsFront(sl, sr, ll, lr);
      armFront(-1, L[0], L[1]);
      armFront(1, R[0], R[1]);
      if (pose === 'coffee') { P(10, 9, 'M'); P(11, 9, 'M'); P(10, 10, 'M'); P(11, 10, 'M'); P(10, 8, '#6b3f22'); P(11, 8, '#6b3f22'); }
      if (pose === 'lift') { const by = f % 2 ? 2 : 8; line(-2, by, 14, by, 'G'); for (const bx of [-2, -1, 13, 14]) { P(bx, by - 1, 'g'); P(bx, by + 1, 'g'); } }
      if (pose === 'sleep' || (pose === 'idle' && f === 1)) {
        if (npc) { P(4, 5, 's'); P(8, 5, 's'); } else { P(4, 4, 's'); P(8, 4, 's'); }
      }
    } else if (view === 'side') {
      stamp(npc ? NHEAD_SIDE : HEAD_SIDE, npc ? 2 : 0);
      stamp(npc ? NTORSO_SIDE : TORSO_SIDE, 8);
      let ldx = 0, hand = [7, 12];
      if (pose === 'walk' || pose === 'run') {
        const a = pose === 'run' ? 3 : 2.4;
        ldx = Math.round(a * Math.sin(ph));
        hand = [7 - Math.round(1.6 * Math.sin(ph)), 12];
      }
      if (pose === 'punch') hand = f % 2 ? [9, 11] : [12, 9];
      if (pose === 'repair') hand = f % 2 ? [11, 11] : [11, 7];
      legsSide(ldx);
      armSide(hand[0], hand[1]);
      if (pose === 'repair') { P(hand[0] + 1, hand[1] - 1, 'G'); P(hand[0] + 2, hand[1] - 2, 'G'); P(hand[0] + 2, hand[1] - 3, 'G'); P(hand[0] + 3, hand[1] - 3, 'G'); }
    } else if (view === 'sit') {
      dy = 2;
      stamp(npc ? NHEAD_SIDE : HEAD_SIDE, (npc ? 2 : 0) + dy);
      stamp(npc ? NTORSO_SIDE : TORSO_SIDE, 8 + dy);
      // paha horizontal + betis
      for (let x = 6; x <= 11; x++) { P(x, 15, SUIT); P(x, 16, x === 10 || x === 11 ? KNEE : SUIT); }
      P(10, 17, SUIT); P(11, 17, SUIT);
      P(10, 18, 'K'); P(11, 18, 'K'); P(12, 18, 'K');
      let hand = [9, 14];
      if (pose === 'type') hand = f % 2 ? [11, 12] : [11, 13];
      if (pose === 'eat') hand = f % 2 ? [10, 7] : [11, 13];
      if (pose === 'nap') hand = [10, 13];
      armSide(hand[0], hand[1]);
      if (pose === 'eat' && f % 2) { P(11, 7, '#ffb35c'); }
      if (pose === 'nap') { if (npc) { P(8, 5 + dy, 's'); } else { P(9, 4 + dy, 's'); } }
    } else {
      stamp(npc ? NHEAD_BACK : HEAD_BACK, npc ? 2 : 0);
      stamp(npc ? NTORSO_BACK : TORSO_BACK, 8);
      legsFront(0, 0, 0, 0);
      const j = f % 2;
      armFront(-1, 3, j ? 11 : 12);
      armFront(1, 9, j ? 12 : 11);
    }

    // ---- properti unik per agen ----
    const pr = v.prop;
    if (pr === 'coat') {
      if (view === 'front') { for (let r = 12; r <= 15; r++) { P(3, r, 'C'); P(9, r, 'C'); if (r > 12) { P(4, r, 'W'); P(8, r, 'W'); } } P(6, 10, 'C'); P(1, 4, 'C'); P(11, 4, 'C'); }
      if (view === 'side' || view === 'sit') { for (let r = 12 + dy; r <= (view === 'sit' ? 15 : 15); r++) { P(4, r, 'W'); P(3, r, 'C'); } P(6, 4 + dy, 'C'); }
      if (view === 'back') { for (let r = 12; r <= 15; r++) for (let x = 3; x <= 9; x++) P(x, r, x === 3 || x === 9 || r === 15 ? 'C' : 'W'); }
    }
    if (pr === 'wrench') {
      if (view === 'front') { P(4, 12, 'O'); P(8, 12, 'O'); P(11, 11, 'G'); P(11, 10, 'G'); P(12, 9, 'G'); P(10, 9, 'G'); P(10, 13, 'G'); }
      if (view === 'side' || view === 'sit') { P(5, 12 + dy, 'O'); P(9, 12 + dy, 'O'); }
    }
    if (pr === 'headset') {
      if (view === 'front') { P(1, 4, 'C'); P(1, 5, 'g'); P(2, 6, 'g'); P(3, 7, 'C'); }
      if (view === 'side' || view === 'sit') { P(6, 4 + dy, 'C'); P(7, 6 + dy, 'g'); P(8, 7 + dy, 'g'); P(9, 7 + dy, 'C'); }
    }
    if (pr === 'camera') {
      if (view === 'front') { for (let x = 5; x <= 8; x++) for (let y = 9; y <= 11; y++) P(x, y, 'g'); P(6, 10, '#6a7cff'); P(7, 10, '#a9b6ff'); P(8, 8, 'g'); }
      if (view === 'side') { P(9, 10, 'g'); P(10, 10, 'g'); P(10, 11, 'g'); P(9, 11, 'g'); P(11, 10, '#6a7cff'); }
      if (view !== 'back') { P(5, 10 + (view === 'front' ? 3 : dy), '#3d9bff'); P(8, 12 + (view === 'front' ? 3 : dy), '#b46bff'); P(4, 15, '#ff5fa2'); P(view === 'front' ? 7 : 8, 14, '#3dd6ff'); }
    }
    if (pr === 'briefcase') {
      if (view === 'front') { P(8, 9, 'M'); P(8, 10, '#5b8cff'); P(8, 11, '#5b8cff'); for (let x = 9; x <= 12; x++) for (let y = 13; y <= 15; y++) P(x, y, 'O'); P(10, 12, 'O'); P(11, 12, 'O'); }
      if (view === 'side') { P(9, 9, 'M'); for (let x = 6; x <= 9; x++) for (let y = 13; y <= 15; y++) P(x, y, 'O'); }
      if (view === 'sit') { P(9, 9 + dy, 'M'); }
    }
    if (pr === 'glasses') {
      if (view === 'front') { P(3, 4, 'g'); P(5, 4, 'g'); P(6, 4, 'g'); P(7, 4, 'g'); P(9, 4, 'g'); P(1, 12, 'Y'); P(2, 11, 'Y'); }
      if (view === 'side' || view === 'sit') { P(8, 4 + dy, 'g'); P(10, 4 + dy, 'g'); P(7, 4 + dy, 'g'); }
    }
    if (pr === 'clipboard') {
      if (view === 'front') { for (let x = 0; x <= 3; x++) for (let y = 9; y <= 13; y++) P(x, y, 'P'); P(1, 10, 'R'); P(2, 10, 'R'); P(1, 12, 'R'); P(2, 11, 'R'); }
      if (view === 'side') { for (let x = 8; x <= 10; x++) for (let y = 9; y <= 12; y++) P(x, y, 'P'); P(9, 10, 'R'); }
    }
    if (pr === 'tablet') {
      if (view === 'front') { for (let x = 8; x <= 12; x++) for (let y = 8; y <= 11; y++) P(x, y, y === 8 || x === 12 ? 'T' : 't'); P(9, 10, 'T'); P(10, 9, 'T'); P(11, 10, 'T'); }
      if (view === 'side') { for (let x = 9; x <= 12; x++) P(x, 9, 'T'); for (let x = 9; x <= 12; x++) P(x, 10, 't'); }
    }
    return g;
  }

  function toCanvas(g, pal, outline) {
    const [c, x] = ACH.canvas(GW + 2, GH + 2);
    const img = x.createImageData(GW + 2, GH + 2);
    const set = (px, py, col) => { const i = (py * (GW + 2) + px) * 4; img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = 255; };
    const cache = {};
    const colOf = (k) => cache[k] || (cache[k] = ACH.hex(k[0] === '#' ? k : pal[k] || '#ff00ff'));
    const at = (px, py) => (px < 0 || py < 0 || px >= GW || py >= GH ? null : g.d[py * GW + px]);
    const OC = ACH.hex(outline || '#12131f');
    for (let py = -1; py <= GH; py++)
      for (let px = -1; px <= GW; px++) {
        const k = at(px, py);
        if (k) set(px + 1, py + 1, colOf(k));
        else if (at(px - 1, py) || at(px + 1, py) || at(px, py - 1) || at(px, py + 1)) set(px + 1, py + 1, OC);
      }
    x.putImageData(img, 0, 0);
    return c;
  }

  const cache = new Map();
  ACH.sprite = function (v, key, pose, f) {
    const k = key + '|' + pose + '|' + f;
    let c = cache.get(k);
    if (!c) { c = toCanvas(build(v, pose, f), v.pal); cache.set(k, c); }
    return c;
  };
  // anchor: titik kaki (tengah bawah)
  ACH.SPR_AX = OX + 6 + 1; // kolom tengah template (6) + padding outline
  ACH.SPR_AY = OY + 18 + 1; // baris kaki
  ACH.drawSprite = function (ctx, spr, x, y, facing, rot) {
    x = Math.round(x); y = Math.round(y);
    ctx.save();
    ctx.translate(x, y);
    if (rot) ctx.rotate(rot);
    if (facing < 0) ctx.scale(-1, 1);
    ctx.drawImage(spr, -ACH.SPR_AX, -ACH.SPR_AY);
    ctx.restore();
  };
})();
