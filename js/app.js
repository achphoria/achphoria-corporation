/* Aplikasi: loop render (diorama 3D lewat scene3d.js + kanvas overlay 2D untuk label), kamera
   (overview / fokus ruang / taman / ikuti agen, putar dengan seret), label + gelembung aktivitas,
   top bar, sidebar dasbor (kartu agen, ringkasan hari ini, log langsung), panel T/L/K */
(function () {
  const ACH = window.ACH;
  const world = ACH.world, sim = ACH.sim, fx = ACH.fx, store = ACH.store, A = ACH.assets, S3 = ACH.scene3d;
  const $ = (id) => document.getElementById(id);
  const esc = ACH.escape;
  const DEBUG = /[?&]debug=1/.test(location.search);

  const stage = $('stage'), scene = $('scene'), gl = $('gl');
  const ctx = scene.getContext('2d');
  let dpr = 1, cw = 0, ch = 0, sw = 0, sh = 0; // cw/ch = piksel perangkat overlay, sw/sh = piksel CSS
  let stageRect = { left: 0, top: 0 };
  const app = (ACH.app = { selected: null });
  const narrow = () => innerWidth <= 760;
  const UI_FONT = '"Zen Maru Gothic", "Hiragino Maru Gothic ProN", system-ui, sans-serif';
  const EMOJI_FONT = '"Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
  let followA = null; // aktor yang sedang diikuti kamera

  function resize() {
    const r = stage.getBoundingClientRect();
    stageRect = r;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    sw = Math.max(1, Math.round(r.width)); sh = Math.max(1, Math.round(r.height));
    cw = Math.round(sw * dpr); ch = Math.round(sh * dpr);
    if (scene.width !== cw || scene.height !== ch) { scene.width = cw; scene.height = ch; }
    S3.resize();
  }
  // posisi kepala maskot di layar (piksel perangkat overlay)
  const headDev = (a) => { const [x, y] = S3.headOf(a); return [x * dpr, y * dpr]; };
  const zoomNow = () => (S3.ok ? ACH.clamp(S3.pxPerPlan() * 1.25, 0.6, 3.2) : 1);

  /* ---------------- render ---------------- */
  function rrect(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  function render(t, dt) {
    const mark = followA || hoverActor;
    S3.frame(dt, t, sim.actors, mark);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    if (!S3.ok) return;
    drawRoomLabels();
    if (ACH.life) {
      const sc = S3.pxPerPlan() * dpr;
      ACH.life.drawParticles(ctx, t, (x, base, h) => { const [X, Y] = S3.project(x, base, h * S3.K); return [X * dpr, Y * dpr]; }, sc);
    }
    if (DEBUG) drawDebug();
    drawOverlays(t, dt);
  }
  // papan nama ruangan kecil di sudut depan tiap ruang
  function drawRoomLabels() {
    const fs = Math.round(ACH.clamp(zoomNow() * 11, 10.5, 15) * dpr);
    ctx.save(); ctx.textBaseline = 'middle';
    for (const L of S3.roomLabels()) {
      if (!L.vis) continue;
      const x = L.x * dpr, y = L.y * dpr;
      if (x < -200 || y < -40 || x > cw + 40 || y > ch + 40) continue;
      ctx.font = `800 ${fs}px "Shippori Mincho", serif`;
      const kw = ctx.measureText(L.kanji).width + fs * 0.6;
      ctx.font = `700 ${fs}px ${UI_FONT}`;
      const nw = ctx.measureText(L.name).width;
      const h = fs * 1.7, w = kw + nw + fs * 1.1;
      ctx.globalAlpha = followA ? 0.55 : 0.92;
      ctx.fillStyle = 'rgba(246,239,225,0.92)'; ctx.shadowColor = 'rgba(30,18,8,0.3)'; ctx.shadowBlur = 5 * dpr;
      rrect(ctx, x, y - h / 2, w, h, h / 3); ctx.fill(); ctx.shadowColor = 'transparent';
      ctx.fillStyle = L.color; rrect(ctx, x + fs * 0.25, y - h / 2 + fs * 0.25, kw, h - fs * 0.5, fs * 0.25); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = `800 ${fs}px "Shippori Mincho", serif`; ctx.fillText(L.kanji, x + fs * 0.55, y + dpr * 0.5);
      ctx.fillStyle = '#2e3a63'; ctx.font = `700 ${fs}px ${UI_FONT}`; ctx.fillText(L.name, x + kw + fs * 0.6, y + dpr * 0.5);
    }
    ctx.restore();
  }
  function drawDebug() {
    const P = (x, y, h) => { const [X, Y] = S3.project(x, y, h || 0); return [X * dpr, Y * dpr]; };
    ctx.save(); ctx.lineWidth = 1.5 * dpr; ctx.font = `${10 * dpr}px monospace`;
    Object.values(world.ROOMS).forEach((r) => {
      ctx.strokeStyle = 'rgba(255,60,160,0.9)';
      r.obs.forEach((o) => { ctx.beginPath(); [[o.x, o.y], [o.x + o.w, o.y], [o.x + o.w, o.y + o.h], [o.x, o.y + o.h]].forEach(([x, y], i) => { const [X, Y] = P(x, y); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }); ctx.closePath(); ctx.stroke(); });
      ctx.fillStyle = '#00ff88'; [r.inn, r.doorP, r.out].forEach(([x, y]) => { const [X, Y] = P(x, y); ctx.fillRect(X - 3, Y - 3, 6, 6); });
    });
    const all = [].concat(...Object.values(world.SPOTS).map((v) => (Array.isArray(v) ? v : Object.values(v))));
    ctx.fillStyle = '#00e5ff';
    all.forEach((s) => { const [X, Y] = P(s.x, s.y); ctx.beginPath(); ctx.arc(X, Y, 3.5 * dpr, 0, 7); ctx.fill(); ctx.fillText(s.id, X + 5 * dpr, Y + 10 * dpr); });
    ctx.strokeStyle = 'rgba(255,220,0,0.9)';
    sim.actors.forEach((a) => { if (!a.path.length) return; ctx.beginPath(); ctx.moveTo(...P(a.x, a.y)); a.path.forEach(([x, y]) => ctx.lineTo(...P(x, y))); ctx.stroke(); });
    ctx.restore();
  }

  /* -------- label nama + gelembung aktivitas (ruang layar, tajam, tidak saling tumpuk) -------- */
  function tagLayout(t) {
    const zoom = zoomNow();
    const fs = Math.round(ACH.clamp(zoom * 12, narrow() ? 11.5 : 12.5, 18) * dpr); // nama
    const fa = Math.round(fs * 0.84);                           // aktivitas
    const pad = Math.round(fs * 0.62), gap = Math.round(fs * 0.22), tail = Math.round(fs * 0.5);
    const tags = [];
    for (const a of sim.actors) {
      const d = a.data;
      if (!d) continue;
      const [ax, ay0] = headDev(a), ay = ay0 - 3 * dpr;
      if (ax < 4 * dpr || ay < -40 * dpr || ax > cw - 4 * dpr || ay > ch - 10 * dpr) continue; // jangkar di luar panggung → tanpa label
      const name = d.name || a.id;
      // label panggung (detour/kantuk/bicara) hanya di panggung; sidebar & log tetap data resmi
      const [emo, txt] = a.stageLabel() || ACH.activityShort(a.id, d.eff, { walking: a.walking && !a.detour, room: a.room });
      ctx.font = `700 ${fs}px ${UI_FONT}`;
      const wn = ctx.measureText(name).width + fs * 0.85;
      ctx.font = `500 ${fa}px ${UI_FONT}`;
      const wa = ctx.measureText(txt).width + fa * 1.45;
      const w = Math.round(Math.max(wn, wa) + pad * 2), h = Math.round(fs * 1.18 + fa * 1.2 + gap + pad * 0.95);
      tags.push({ a, d, ax, ay, name, emo, txt, w, h, x: ax - w / 2, y: ay - tail - h, fs, fa, pad, gap, tail });
    }
    // relaksasi: dorong kotak yang bertabrakan (lebih suka geser horizontal), tarik balik ke jangkar
    const M = 5 * dpr, top0 = 6 * dpr;
    for (let it = 0; it < 40; it++) {
      let moved = false;
      for (let i = 0; i < tags.length; i++) for (let j = i + 1; j < tags.length; j++) {
        const p = tags[i], q = tags[j];
        const ox = Math.min(p.x + p.w, q.x + q.w) + M - Math.max(p.x, q.x);
        const oy = Math.min(p.y + p.h, q.y + q.h) + M - Math.max(p.y, q.y);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        if (ox < oy * 1.6) { const s = (p.x + p.w / 2 < q.x + q.w / 2 ? -1 : 1) * ox / 2; p.x += s; q.x -= s; }
        else { const s = (p.y + p.h / 2 < q.y + q.h / 2 ? -1 : 1) * oy / 2; p.y += s; q.y -= s; }
      }
      for (const p of tags) {
        p.x += (p.ax - p.w / 2 - p.x) * 0.04; p.y += (p.ay - p.tail - p.h - p.y) * 0.04;
        p.x = ACH.clamp(p.x, 6 * dpr, cw - p.w - 6 * dpr); p.y = ACH.clamp(p.y, top0, ch - p.h - 6 * dpr);
      }
      if (!moved && it > 3) break;
    }
    return tags;
  }
  function drawOverlays(t, dt) {
    const zoom = zoomNow();
    const tags = tagLayout(t);
    const k = 1 - Math.exp(-dt * 10);
    ctx.textBaseline = 'middle';
    // urutan gambar: belakang dulu, yang difokus terakhir
    tags.sort((p, q) => (p.a === followA) - (q.a === followA) || p.ay - q.ay);
    for (const T of tags) {
      const a = T.a, d = T.d;
      // haluskan offset relatif ke jangkar (tidak tertinggal saat kamera bergerak)
      const dx = T.x - (T.ax - T.w / 2), dy = T.y - (T.ay - T.tail - T.h);
      if (a.tagOff === undefined || Math.hypot(a.tagOff[0] - dx, a.tagOff[1] - dy) > 260 * dpr) a.tagOff = [dx, dy];
      else { a.tagOff[0] += (dx - a.tagOff[0]) * k; a.tagOff[1] += (dy - a.tagOff[1]) * k; }
      const bx = Math.round(T.ax - T.w / 2 + a.tagOff[0]), by = Math.round(T.ay - T.tail - T.h + a.tagOff[1]);
      const focus = a === followA || a === hoverActor;
      const off = d.eff.status === 'offline';
      const st = ACH.dispStatus(d.eff);
      ctx.save();
      ctx.globalAlpha = off ? 0.72 : 1;
      // ekor/penunjuk ke kepala maskot
      const tx = ACH.clamp(T.ax, bx + 12 * dpr, bx + T.w - 12 * dpr), far = Math.hypot(tx - T.ax, by + T.h - T.ay) > T.tail * 2.2;
      ctx.fillStyle = 'rgba(252,247,237,0.97)';
      if (far) {
        ctx.strokeStyle = ACH.alpha(d.color || '#2e3a63', 0.8); ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath(); ctx.moveTo(tx, by + T.h - 2); ctx.lineTo(T.ax, T.ay - 2 * dpr); ctx.stroke();
        ctx.beginPath(); ctx.arc(T.ax, T.ay - 2 * dpr, 2.6 * dpr, 0, 7); ctx.fillStyle = d.color || '#2e3a63'; ctx.fill();
        ctx.fillStyle = 'rgba(252,247,237,0.97)';
      }
      ctx.shadowColor = 'rgba(30,18,8,0.38)'; ctx.shadowBlur = 8 * dpr; ctx.shadowOffsetY = 2 * dpr;
      rrect(ctx, bx, by, T.w, T.h, Math.min(T.h / 2.4, 12 * dpr));
      if (!far) { // ekor kecil
        ctx.moveTo(tx - T.tail * 0.8, by + T.h - 1); ctx.lineTo(tx, by + T.h + T.tail * 0.9); ctx.lineTo(tx + T.tail * 0.8, by + T.h - 1);
      }
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.lineWidth = (focus ? 2.2 : 1.2) * dpr;
      ctx.strokeStyle = focus ? d.color || '#2e3a63' : 'rgba(46,58,99,0.2)';
      rrect(ctx, bx, by, T.w, T.h, Math.min(T.h / 2.4, 12 * dpr)); ctx.stroke();
      // garis aksen warna agen di kiri
      ctx.save(); rrect(ctx, bx, by, T.w, T.h, Math.min(T.h / 2.4, 12 * dpr)); ctx.clip();
      ctx.fillStyle = d.color || '#2e3a63'; ctx.fillRect(bx, by, 3.5 * dpr, T.h); ctx.restore();
      // baris 1: titik status + nama
      const y1 = by + T.pad * 0.5 + T.fs * 0.62, y2 = y1 + T.fs * 0.6 + T.gap + T.fa * 0.62;
      const dotR = T.fs * 0.24;
      ctx.fillStyle = st.color; ctx.beginPath(); ctx.arc(bx + T.pad + dotR, y1, dotR, 0, 7); ctx.fill();
      ctx.fillStyle = '#26305a'; ctx.font = `700 ${T.fs}px ${UI_FONT}`; ctx.textAlign = 'left';
      ctx.fillText(T.name, bx + T.pad + T.fs * 0.85, y1 + dpr * 0.5);
      // baris 2: emoji + aktivitas singkat. Emote berkala (💬☕🍜💡👋) = emoji yang memantul di label
      let emo = T.emo, es = 1;
      if (a.emote) {
        const e = a.emote, kk = Math.min(1, e.t / 0.3), out = Math.max(0, (e.t - (e.dur - 0.35)) / 0.35);
        emo = e.ch;
        es = 1 + 0.55 * Math.sin(kk * Math.PI) * (1 - out) + 0.12 * Math.abs(Math.sin(e.t * 6)) * (1 - out) * (e.t < 1.6 ? 1 : 0);
      }
      const ex = bx + T.pad + T.fa * 0.5 - 1 * dpr;
      ctx.save(); ctx.translate(ex, y2 + dpr * 0.5); ctx.scale(es, es);
      ctx.font = `${Math.round(T.fa * 1.08)}px ${EMOJI_FONT}`; ctx.textAlign = 'center';
      ctx.fillText(emo, 0, 0); ctx.restore();
      ctx.fillStyle = '#6d6252'; ctx.font = `500 ${T.fa}px ${UI_FONT}`;
      ctx.fillText(T.txt, bx + T.pad + T.fa * 1.45, y2 + dpr * 0.5);
      ctx.restore();
      // zzz naik dari kepala (di sisi kanan label)
      if (a.zzz.length) {
        ctx.save(); ctx.textAlign = 'center';
        a.zzz.forEach((z) => {
          const kz = z.t / 3;
          const zx = bx + T.w + (6 + kz * 22 + Math.sin(z.t * 2) * 4) * dpr * ACH.clamp(zoom, 0.9, 2), zy = by + T.h - kz * 34 * dpr * ACH.clamp(zoom, 0.9, 2);
          ctx.globalAlpha = Math.sin(kz * Math.PI) * 0.95;
          ctx.font = `italic 700 ${Math.round((11 + kz * 10) * z.s * dpr * ACH.clamp(zoom, 0.9, 2))}px "Shippori Mincho", serif`;
          ctx.fillStyle = '#f6efe1'; ctx.strokeStyle = 'rgba(46,58,99,0.85)'; ctx.lineWidth = 3 * dpr;
          ctx.strokeText('z', zx, zy); ctx.fillText('z', zx, zy);
        });
        ctx.restore();
      }
      // pop reaksi data (❗ ✨ ❕) di atas label
      if (a.pop) {
        const p = a.pop, kk = Math.min(1, p.t / 0.28), out = Math.max(0, (p.t - (p.dur - 0.3)) / 0.3);
        const sz = ACH.clamp(zoom * 15, 15, 26) * dpr;
        const sc = (0.4 + 0.6 * kk + 0.35 * Math.sin(kk * Math.PI)) * (1 - out * 0.4);
        ctx.save(); ctx.globalAlpha = 1 - out;
        ctx.translate(bx + T.w / 2, by - sz * 0.62 - Math.sin(Math.min(1, p.t / 0.5) * Math.PI) * 6 * dpr); ctx.scale(sc, sc);
        ctx.fillStyle = 'rgba(252,247,237,0.96)'; ctx.shadowColor = 'rgba(30,18,8,0.35)'; ctx.shadowBlur = 6 * dpr;
        ctx.beginPath(); ctx.arc(0, 0, sz * 0.62, 0, 7); ctx.fill(); ctx.shadowColor = 'transparent';
        ctx.lineWidth = 1.6 * dpr; ctx.strokeStyle = p.ch === '✨' ? '#e0a64a' : '#c0392b'; ctx.stroke();
        ctx.font = `${Math.round(sz * 0.78)}px ${EMOJI_FONT}`; ctx.textAlign = 'center';
        ctx.fillText(p.ch, 0, sz * 0.04); ctx.restore();
      }
      // blip 📝 (log baru) naik dari sudut kanan atas label
      if (a.blips.length) {
        ctx.save(); ctx.textAlign = 'center';
        a.blips.forEach((b, i) => {
          const kb = b.t / 1.6;
          ctx.globalAlpha = Math.min(1, b.t / 0.2) * (1 - kb);
          ctx.font = `${Math.round(ACH.clamp(zoom * 11, 11, 18) * dpr)}px ${EMOJI_FONT}`;
          ctx.fillText(b.ch, bx + T.w - 4 * dpr + i * 9 * dpr, by - 4 * dpr - kb * 26 * dpr);
        });
        ctx.restore();
      }
    }
    drawBubbles(t, zoom);
    ctx.textAlign = 'left';
  }
  // gelembung obrolan kecil di samping kepala, ke arah hadapan maskot
  function drawBubbles(t, zoom) {
    for (const a of sim.actors) {
      const b = a.bubble;
      if (!b || !a.data) continue;
      const side = a.facing() || 1;
      const [h0x, h0y] = headDev(a), hx = h0x + side * 16 * zoom * dpr, hy = h0y + 12 * zoom * dpr;
      if (hx < 0 || hy < 0 || hx > cw || hy > ch) continue;
      const r = ACH.clamp(zoom * 10.5, 10, 19) * dpr;
      const kk = Math.min(1, b.t / 0.22), out = Math.max(0, (b.t - (b.dur - 0.28)) / 0.28);
      const sc = (0.5 + 0.5 * kk + 0.18 * Math.sin(kk * Math.PI)) * (1 - 0.3 * out);
      const cx = hx + side * r * 1.15, cy = hy - r * 0.75 - Math.sin(b.t * 2.4) * 1.5 * dpr;
      ctx.save(); ctx.globalAlpha = 1 - out;
      ctx.translate(cx, cy); ctx.scale(sc, sc);
      ctx.fillStyle = 'rgba(253,249,240,0.97)'; ctx.shadowColor = 'rgba(30,18,8,0.32)'; ctx.shadowBlur = 5 * dpr; ctx.shadowOffsetY = 1.5 * dpr;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
      // ekor ke kepala
      ctx.beginPath(); ctx.moveTo(-side * r * 0.35, r * 0.7); ctx.lineTo(-side * r * 1.15, r * 1.15); ctx.lineTo(-side * r * 0.75, r * 0.2); ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.beginPath(); ctx.arc(-side * r * 1.35, r * 1.4, r * 0.16, 0, 7); ctx.fill();
      ctx.lineWidth = 1 * dpr; ctx.strokeStyle = 'rgba(46,58,99,0.22)'; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.stroke();
      ctx.font = `${Math.round(r * 1.12)}px ${EMOJI_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(b.ch, 0, r * 0.06);
      ctx.restore();
    }
  }


  /* ---------------- loop ---------------- */
  let last = performance.now(), t0 = last;
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const t = (now - t0) / 1000;
    sim.update(dt, t);
    render(t, dt);
    requestAnimationFrame(loop);
  }

  /* ---------------- interaksi panggung: klik maskot = ikuti, klik ruang = fokus, seret = putar ---------------- */
  let hoverActor = null, down = null, dragged = false;
  const areaAt = (x, y) => world.AREAS.find((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1);
  const countIn = (r) => sim.actors.filter((a) => a.x >= r.x0 && a.x <= r.x1 && a.y >= r.y0 && a.y <= r.y1).length;
  const tip = $('tip');
  function showTip(html, x, y) {
    tip.innerHTML = html; tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = Math.min(innerWidth - tw - 8, x + 14) + 'px';
    tip.style.top = Math.max(8, Math.min(innerHeight - th - 8, y + 14)) + 'px';
  }
  function setHover(a) {
    if (hoverActor === a) return;
    hoverActor = a;
    document.querySelectorAll('.acard').forEach((el) => el.classList.toggle('hover', !!a && el.dataset.id === a.id));
  }
  const pickActor = (e) => (S3.ok ? S3.actorAt(e.clientX, e.clientY, sim.actors) : null);

  scene.addEventListener('pointerdown', (e) => { tip.hidden = true; down = { x: e.clientX, y: e.clientY }; dragged = false; scene.setPointerCapture(e.pointerId); S3.dragStart(); });
  scene.addEventListener('pointermove', (e) => {
    if (!S3.ok) return;
    if (down) {
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (!dragged && Math.hypot(dx, dy) > 5) dragged = true;
      if (dragged) { S3.dragMove(dx, dy); scene.style.cursor = 'grabbing'; }
      tip.hidden = true;
      return;
    }
    const a = pickActor(e);
    setHover(a);
    scene.style.cursor = a ? 'pointer' : 'grab';
    if (a && a.data) {
      const d = a.data, st = ACH.dispStatus(d.eff);
      showTip(`<b style="color:${esc(ACH.shade(d.color, -0.35))}">${esc(d.name)}</b><br><i class="dot" style="background:${st.color}"></i>${st.label} · ${esc(ACH.roomLabel(d.eff.location, d.id))}<br><span class="muted">${esc(d.eff.activity || '')}</span>`, e.clientX, e.clientY);
      return;
    }
    const p = S3.planAt(e.clientX, e.clientY), r = p && areaAt(p[0], p[1]);
    if (r) {
      const n = countIn(r);
      showTip(`<b>${esc(r.label)}</b><br><span class="muted">${esc(r.desc)}</span>${n ? `<br>${n} agen di sini` : ''}`, e.clientX, e.clientY);
    } else tip.hidden = true;
  });
  scene.addEventListener('pointerup', (e) => {
    scene.style.cursor = 'grab';
    if (!down) return;
    const wasDrag = dragged; down = null;
    S3.dragEnd();
    if (wasDrag || !S3.ok) return;
    const a = pickActor(e);
    if (a) return follow(a.id);
    if (followA) return unfollow();
    const p = S3.planAt(e.clientX, e.clientY), room = p && world.roomAt(p[0], p[1]);
    if (room && world.ROOMS[room] && app.focus !== room) focusRoom(room);
    else home();
  });
  scene.addEventListener('pointerleave', () => { tip.hidden = true; setHover(null); });
  scene.addEventListener('wheel', (e) => { e.preventDefault(); S3.zoomBy(Math.exp(-e.deltaY * 0.0016)); }, { passive: false });

  function follow(id) {
    const a = sim.agents[id];
    if (!a) return;
    followA = a; app.selected = id; app.focus = null;
    S3.follow(a, narrow() ? 0.85 : 1);
    if (!panels.roster.hidden) showPanel('roster', false); // detail kini ada di kartu sidebar
    renderCards(true);
    const el = document.querySelector(`.acard[data-id="${CSS.escape(id)}"]`);
    if (el) setTimeout(() => el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 60);
  }
  function unfollow() {
    followA = null; app.selected = null;
    renderCards(true);
    $('sidebar').scrollTo({ top: 0, behavior: 'smooth' });
    home();
  }
  function home() { app.focus = null; S3.home(); }
  function focusRoom(id) { app.focus = id; S3.focusRoom(id); }
  function garden() { if (followA) { followA = null; app.selected = null; renderCards(true); } app.focus = 'garden'; S3.garden(); }
  Object.assign(app, { follow, unfollow, home, focusRoom, garden });

  /* ---------------- panel overlay ---------------- */
  const panels = { roster: $('roster'), log: $('logPanel'), board: $('board') };
  function showPanel(name, on) {
    const p = panels[name];
    if (!p) return;
    if (on === undefined) on = p.hidden;
    if (on) Object.keys(panels).forEach((n) => { if (n !== name) panels[n].hidden = true; }); // satu overlay sekaligus
    p.hidden = !on;
    if (on) { p.classList.remove('pop'); void p.offsetWidth; p.classList.add('pop'); }
    document.querySelectorAll('#toolbar button').forEach((b) => b.classList.toggle('on', panels[b.dataset.act] ? !panels[b.dataset.act].hidden : false));
    if (name === 'board' && on) renderBoard();
    if (name === 'log' && on) renderLog();
    if (name === 'roster' && on) renderRoster();
  }
  app.showPanel = showPanel;
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => showPanel(b.dataset.close, false)));
  document.querySelectorAll('#toolbar button').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.act === 'home') { if (followA) unfollow(); else home(); return; }
    if (b.dataset.act === 'garden') { garden(); return; }
    showPanel(b.dataset.act);
  }));
  $('feedAll').addEventListener('click', () => showPanel('log'));
  $('sheetHandle').addEventListener('click', () => $('sidebar').classList.toggle('expanded'));
  addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input,textarea')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    tip.hidden = true;
    if (k === 't') showPanel('board');
    else if (k === 'l') showPanel('log');
    else if (k === 'k') showPanel('roster');
    else if (k === '0') { if (followA) unfollow(); else home(); }
    else if (k === 'g') garden();
    else if (k === 'escape') {
      if (followA) unfollow();
      else if (!panels.board.hidden) showPanel('board', false);
      else if (!panels.roster.hidden) showPanel('roster', false);
      else if (!panels.log.hidden) showPanel('log', false);
      else if ($('sidebar').classList.contains('expanded')) $('sidebar').classList.remove('expanded');
      else home();
    } else if (/^[1-9]$/.test(k)) { const l = store.agentList().find((x) => x.slot === +k - 1); if (l) follow(l.id); }
  });

  /* ---------------- helper konten ---------------- */
  const pill = (eff) => { const st = ACH.dispStatus(eff); return `<span class="pill" style="--c:${st.color}"><i></i>${st.label}</span>`; };
  function ago(ts) {
    if (!ts) return '—';
    const m = Math.round((Date.now() - Date.parse(ts)) / 60000);
    if (m < 1) return 'barusan';
    if (m < 60) return m + ' mnt lalu';
    if (m < 1440) return Math.floor(m / 60) + ' jam lalu';
    return Math.floor(m / 1440) + ' hari lalu';
  }
  const ink = (c) => ACH.shade(c || '#8a8378', -0.38);
  const dayLbl = (ts) => (ACH.isSameWibDay(ts, new Date()) ? '' : ACH.wibShort(ts) + ' ');
  function fmtLogText(l) {
    const name = store.agentName(l.agent_id), col = ink(store.agentColor(l.agent_id));
    const msg = String(l.message || '');
    const starts = msg.toLowerCase().startsWith(String(name).toLowerCase());
    return starts ? `<b style="color:${esc(col)}">${esc(name)}</b>${esc(msg.slice(name.length))}` : `<b style="color:${esc(col)}">${esc(name)}</b> ${esc(msg)}`;
  }
  const TASK_K = { 'Sedang kerja': '#5f9e6e', Terjadwal: '#4a6fa5', Selesai: '#9a9389' };
  function todayStats() {
    const tasks = store.taskList(), now = new Date();
    const kerja = tasks.filter((t) => t.status === 'Sedang kerja').length;
    const jadwal = tasks.filter((t) => t.status === 'Terjadwal').length;
    const selesai = tasks.filter((t) => t.status === 'Selesai' && t.updated_at && ACH.isSameWibDay(t.updated_at, now)).length;
    return { kerja, jadwal, selesai };
  }

  /* ---------------- top bar: ringkasan tim ---------------- */
  function renderSummary() {
    const list = store.agentList();
    const cnt = {};
    list.forEach((a) => { const s = ACH.dispStatus(a.eff); (cnt[s.key] = cnt[s.key] || { n: 0, s }).n++; });
    const chips = ACH.DISP_ORDER.filter((k) => cnt[k]).map((k) => `<span class="chip" style="--c:${cnt[k].s.color}"><i></i><b>${cnt[k].n}</b> ${esc(cnt[k].s.label.toLowerCase())}</span>`).join('');
    const html = `<span class="lead">${list.length} agen</span>${chips || '<span class="chip">memuat…</span>'}`;
    $('sumBar').innerHTML = html; $('sumBarM').innerHTML = html;
    $('sumBar').title = list.map((a) => `${a.name}: ${ACH.dispStatus(a.eff).label}`).join('\n');
  }

  /* ---------------- sidebar: kartu agen ---------------- */
  let cardIds = '';
  function cardShell(a) {
    return `<div class="acard" data-id="${esc(a.id)}" style="--c:${esc(a.color)}">
      <button class="amain" aria-label="Ikuti ${esc(a.name)}">
        <span class="aimg"><img src="${A.mascotSrc(a.id)}" alt="" /></span>
        <span class="ainfo">
          <span class="ar1"><b class="aname"></b><span class="apill"></span></span>
          <span class="ar2"><span class="aloc"></span><time class="aago"></time></span>
          <span class="aact"></span>
        </span>
      </button>
      <div class="aexp" hidden></div>
    </div>`;
  }
  function renderCards(force) {
    const list = store.agentList();
    const ids = list.map((a) => a.id + ':' + a.color).join('|');
    const box = $('agentCards');
    if (ids !== cardIds) {
      cardIds = ids;
      box.innerHTML = list.map(cardShell).join('');
      box.querySelectorAll('.acard').forEach((el) => {
        el.querySelector('.amain').addEventListener('click', () => (app.selected === el.dataset.id ? unfollow() : follow(el.dataset.id)));
        el.addEventListener('mouseenter', () => { const a = sim.agents[el.dataset.id]; if (a) hoverActor = a; });
        el.addEventListener('mouseleave', () => { hoverActor = null; });
      });
    }
    const active = list.filter((a) => a.eff.status !== 'offline').length;
    $('teamMeta').textContent = `${active}/${list.length} di kantor`;
    list.forEach((a) => {
      const el = box.querySelector(`.acard[data-id="${CSS.escape(a.id)}"]`);
      if (!el) return;
      const actor = sim.agents[a.id];
      el.querySelector('.aname').textContent = a.name;
      const p = pill(a.eff);
      const pe = el.querySelector('.apill'); if (pe.innerHTML !== p) pe.innerHTML = p;
      const walking = actor && actor.walking && actor.room !== a.eff.location;
      el.querySelector('.aloc').textContent = '📍 ' + ACH.roomLabel(a.eff.location, a.id);
      el.querySelector('.aago').textContent = a.eff.stale ? 'jadwal otomatis' : 'update ' + ago(a.updated_at);
      el.querySelector('.aago').title = a.updated_at ? 'Update terakhir ' + ACH.wibHM(a.updated_at) + ' WIB' : '';
      const act = a.eff.activity || '—';
      el.querySelector('.aact').textContent = act + (a.current_task && !act.includes(a.current_task) ? ' · ' + a.current_task : '');
      el.querySelector('.aact').title = el.querySelector('.aact').textContent;
      el.classList.toggle('on', app.selected === a.id);
      el.classList.toggle('off', a.eff.status === 'offline');
      const exp = el.querySelector('.aexp');
      if (app.selected === a.id) {
        if (exp.hidden || force !== false) exp.innerHTML = expandedHtml(a);
        exp.hidden = false;
        exp.querySelectorAll('[data-x]').forEach((b) => (b.onclick = (ev) => { ev.stopPropagation(); if (b.dataset.x === 'close') unfollow(); else showPanel('board', true); }));
      } else { exp.hidden = true; exp.innerHTML = ''; }
      void walking;
    });
  }
  function expandedHtml(a) {
    const prof = ACH.PROFILE[a.id];
    const now = new Date();
    const tasks = store.taskList().filter((t) => t.agent_id === a.id);
    const order = { 'Sedang kerja': 0, Terjadwal: 1, Selesai: 2 };
    const shown = tasks.filter((t) => t.status !== 'Selesai' || (t.updated_at && ACH.isSameWibDay(t.updated_at, now)))
      .sort((x, y) => order[x.status] - order[y.status]).slice(0, 4);
    const logs = store.logs.filter((l) => l.agent_id === a.id).slice(0, 3);
    const tl = shown.map((t) => {
      const when = t.status === 'Selesai' ? '✔ ' + ACH.wibHM(t.updated_at) : t.due_at ? '⏱ ' + dayLbl(t.due_at) + ACH.wibHM(t.due_at) : t.status === 'Sedang kerja' ? 'dikerjakan' : '';
      return `<div class="mini-task" style="--k:${TASK_K[t.status] || '#888'}" title="${esc(t.status)}"><i></i><span>${esc(t.title)}</span><small>${esc(when)}</small></div>`;
    }).join('');
    return `
      <dl class="facts">
        <dt>Zona</dt><dd>${esc(prof ? prof.homeLabel : a.division || '—')}</dd>
        <dt>Tugas kini</dt><dd>${esc(a.current_task || '—')}</dd>
        <dt>Update</dt><dd>${a.updated_at ? ACH.wibHM(a.updated_at) + ' WIB · ' + ago(a.updated_at) : '—'}${a.eff.stale ? ' <span class="tag">jadwal otomatis</span>' : ''}</dd>
      </dl>
      <div class="xh">Tugas (${tasks.filter((t) => t.status !== 'Selesai').length} aktif)</div>
      ${tl || '<p class="muted" style="font-size:12px;margin:0">Belum ada tugas.</p>'}
      <div class="xh">Log terbaru</div>
      ${logs.length ? logs.map((l) => `<div class="lrow"><time>${dayLbl(l.created_at)}${ACH.wibHM(l.created_at)}</time><span>${esc(l.message)}</span></div>`).join('') : '<p class="muted" style="font-size:12px;margin:0">Belum ada log.</p>'}
      <div class="xbtns"><button data-x="board">📋 Papan tugas</button><button data-x="close">✕ Tutup <kbd>Esc</kbd></button></div>`;
  }

  /* ---------------- sidebar: ringkasan hari ini ---------------- */
  function renderToday() {
    const s = todayStats();
    const tot = Math.max(1, s.kerja + s.jadwal + s.selesai);
    const pct = Math.round((s.selesai / tot) * 100);
    $('sumDate').textContent = ACH.wibShort(new Date());
    $('todaySum').innerHTML = `
      <div class="stats">
        <div class="stat" style="--k:#3f7a4f"><b>${s.kerja}</b><span>Sedang kerja</span></div>
        <div class="stat" style="--k:#3d5a99"><b>${s.jadwal}</b><span>Terjadwal</span></div>
        <div class="stat" style="--k:#c0392b"><b>${s.selesai}</b><span>Selesai hari ini</span></div>
      </div>
      <div class="sbar" title="Proporsi tugas hari ini"><i style="--k:#c0392b;width:${(s.selesai / tot) * 100}%"></i><i style="--k:#6fae7e;width:${(s.kerja / tot) * 100}%"></i><i style="--k:#8ea3d1;width:${(s.jadwal / tot) * 100}%"></i></div>
      <p><span>${pct}% beres hari ini</span><span>${s.kerja + s.jadwal} tugas aktif</span></p>`;
    fx.setBoard(s);
  }

  /* ---------------- sidebar: log langsung ---------------- */
  let feedSeen = null;
  function renderFeed() {
    const logs = store.logs.slice(0, 8);
    const first = feedSeen === null;
    $('feed').innerHTML = logs.map((l) => {
      const fresh = !first && !feedSeen.has(l.id);
      return `<div class="fitem${fresh ? ' fresh' : ''}" data-agent="${esc(l.agent_id)}" style="--c:${esc(store.agentColor(l.agent_id))}">
        <span class="fimg"><img src="${A.mascotSrc(l.agent_id)}" alt="" /></span>
        <p>${fmtLogText(l)}</p><time>${dayLbl(l.created_at)}${ACH.wibHM(l.created_at)}</time></div>`;
    }).join('') || '<p class="muted" style="font-size:12.5px">Belum ada log.</p>';
    $('feed').querySelectorAll('.fitem').forEach((el) => el.addEventListener('click', () => sim.agents[el.dataset.agent] && follow(el.dataset.agent)));
    feedSeen = new Set(store.logs.map((l) => l.id));
  }

  /* ---------------- panel overlay: roster / log / papan ---------------- */
  function renderRoster() {
    if (panels.roster.hidden) return;
    $('rosterList').innerHTML = store.agentList().map((a) => `
      <button class="ritem" data-id="${esc(a.id)}" style="--c:${esc(a.color)}">
        <span class="rimg"><img src="${A.mascotSrc(a.id)}" alt="" /></span>
        <span class="rinfo"><b>${esc(a.name)}</b>
        <span class="rmeta">${pill(a.eff)} <em>${esc(ACH.roomLabel(a.eff.location, a.id))}</em></span>
        <small>${esc(a.eff.activity || '')}</small></span>
        <kbd>${a.slot + 1}</kbd>
      </button>`).join('');
    $('rosterList').querySelectorAll('.ritem').forEach((b) => b.addEventListener('click', () => { showPanel('roster', false); follow(b.dataset.id); }));
  }
  let lastLogIds = new Set();
  function renderLog() {
    if (panels.log.hidden) { lastLogIds = new Set(store.logs.map((l) => l.id)); return; }
    const html = store.logs.slice(0, 80).map((l) => {
      const fresh = lastLogIds.size && !lastLogIds.has(l.id);
      return `<div class="litem${fresh ? ' fresh' : ''}" data-agent="${esc(l.agent_id)}" style="--c:${esc(store.agentColor(l.agent_id))}"><time>${dayLbl(l.created_at)}${ACH.wibHM(l.created_at)} WIB</time><p>${fmtLogText(l)}${l.location ? ` <span class="muted">· ${esc(ACH.roomLabel(l.location, l.agent_id))}</span>` : ''}</p></div>`;
    }).join('');
    $('logList').innerHTML = html || '<p class="muted pad">Belum ada log.</p>';
    $('logList').querySelectorAll('.litem').forEach((el) => el.addEventListener('click', () => sim.agents[el.dataset.agent] && follow(el.dataset.agent)));
    lastLogIds = new Set(store.logs.map((l) => l.id));
  }
  let lastTaskSig = {};
  function renderBoard() {
    const tasks = store.taskList();
    $('boardCount').textContent = tasks.length + ' tugas';
    if (panels.board.hidden) return;
    $('boardCols').innerHTML = ACH.TASK_COLS.map((c, ci) => {
      const ts = tasks.filter((t) => t.status === c);
      return `<div class="col c${ci}"><h3>${c}<span>${ts.length}</span></h3><div class="cards">${ts.slice(0, 40).map((t) => {
        const sig = t.status + t.updated_at + t.title;
        const changed = lastTaskSig[t.id] !== undefined && lastTaskSig[t.id] !== sig;
        const col = store.agentColor(t.agent_id);
        const due = t.due_at && c !== 'Selesai' ? ` · ⏱ ${dayLbl(t.due_at)}${ACH.wibHM(t.due_at)} WIB` : c === 'Selesai' && t.updated_at ? ` · ✔ ${dayLbl(t.updated_at)}${ACH.wibHM(t.updated_at)} WIB` : '';
        return `<div class="card${changed ? ' flash' : ''}" style="--c:${esc(col)}" data-agent="${esc(t.agent_id)}"><b>${esc(t.title)}</b>${t.detail ? `<p>${esc(t.detail)}</p>` : ''}<small><i style="background:${esc(col)}"></i>${esc(store.agentName(t.agent_id))}${due}</small></div>`;
      }).join('') || '<p class="muted pad">Kosong</p>'}</div></div>`;
    }).join('');
    $('boardCols').querySelectorAll('.card').forEach((el) => el.addEventListener('click', () => sim.agents[el.dataset.agent] && follow(el.dataset.agent)));
    lastTaskSig = {}; tasks.forEach((t) => (lastTaskSig[t.id] = t.status + t.updated_at + t.title));
  }

  /* ---------------- badge / jam ---------------- */
  function renderBadge() {
    const b = $('badge');
    const live = store.mode === 'live';
    b.className = 'badge ' + (live ? 'live' : 'demo');
    b.innerHTML = live ? '<i></i>LIVE' : `<i></i>DEMO${store.errorShort ? `<small>${esc(store.errorShort)}</small>` : ''}`;
    b.title = live
      ? 'Terhubung ke Supabase Realtime' + (store.realtime && store.realtime !== 'SUBSCRIBED' ? ' (realtime: ' + store.realtime + ', cadangan polling aktif)' : '')
      : 'Mode demo: ' + (store.error || 'data simulasi') + '. Akan otomatis pindah ke LIVE begitu data Supabase v2 tersedia.';
  }
  $('badge').addEventListener('click', () => toast($('badge').title));
  let toastT = null;
  function toast(msg) { const el = $('toast'); el.textContent = msg; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (el.hidden = true), 5200); }
  app.toast = toast;
  function tick() {
    const now = new Date();
    $('clock').textContent = ACH.wibHM(now);
    $('sec').textContent = ACH.wibHMS(now).slice(-2);
    const ph = fx.dayPhase(now);
    const icon = ph.night > 0.5 ? '🌙' : ph.golden > 0.5 ? '🌇' : ph.day > 0.5 ? '☀️' : '🌅';
    $('date').textContent = icon + ' ' + ACH.wibDate(now);
  }

  /* ---------------- data → dunia & dasbor ---------------- */
  function onAgents() {
    sim.syncAgents(store.agentList());
    renderSummary(); renderCards(); renderRoster();
  }
  store.on('agents', onAgents);
  store.on('tasks', () => { renderBoard(); renderToday(); if (app.selected) renderCards(true); });
  store.on('logs', () => { renderLog(); renderFeed(); if (app.selected) renderCards(true); });
  store.on('log-added', () => { if (panels.log.hidden) { const b = $('toolbar').querySelector('[data-act=log]'); b.classList.add('ping'); setTimeout(() => b.classList.remove('ping'), 2500); } });
  store.on('mode', (m) => { renderBadge(); if (m === 'live' && app.started) toast('Terhubung LIVE ke Supabase ✔'); });

  /* ---------------- start ---------------- */
  function start() {
    if (app.started) return;
    if (!S3.init(gl, stage)) {
      const m = document.createElement('div'); m.className = 'nogl';
      m.innerHTML = '<b>Kantor 3D tidak bisa ditampilkan</b><span>' + esc(S3.error || 'WebGL tidak tersedia') + '. Dasbor di samping tetap terbarui LIVE.</span>';
      stage.appendChild(m);
    }
    resize();
    addEventListener('resize', resize);
    if (window.ResizeObserver) new ResizeObserver(resize).observe(stage);
    store.start();
    tick(); setInterval(tick, 1000);
    setInterval(() => { renderCards(false); renderToday(); }, 15000);
    renderBadge(); renderSummary(); renderToday(); renderFeed();
    app.started = true;
    $('loading').classList.add('done');
    setTimeout(() => $('loading').remove(), 900);
    requestAnimationFrame((n) => { last = n; t0 = n; loop(n); });
  }
  const fontsReady = document.fonts && document.fonts.load
    ? Promise.race([Promise.all([document.fonts.load('700 12px "Zen Maru Gothic"'), document.fonts.load('500 12px "Zen Maru Gothic"'), document.fonts.load('900 12px "Zen Maru Gothic"'), document.fonts.load('600 12px "Shippori Mincho"')]), new Promise((r) => setTimeout(r, 1800))])
    : Promise.resolve();
  Promise.all([A.ready, fontsReady.catch(() => null)]).then(start, start);
})();
