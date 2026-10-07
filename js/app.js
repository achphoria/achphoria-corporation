/* Aplikasi: loop render, kamera (zoom/follow/pan), input, UI panel */
(function () {
  const ACH = window.ACH, W = ACH.W, H = ACH.H;
  const world = ACH.world, sim = ACH.sim, fx = ACH.fx, store = ACH.store, A = ACH.assets;
  const $ = (id) => document.getElementById(id);
  const esc = ACH.escape;
  const DEBUG = /[?&]debug=1/.test(location.search);

  const scene = $('scene');
  const ctx = scene.getContext('2d');
  let dpr = 1, cw = 0, ch = 0;

  const cam = { x: W / 2, y: H / 2, s: 1, tx: W / 2, ty: H / 2, ts: 1, follow: null, fz: 2.3 };
  const app = (ACH.app = { cam });
  const fit = () => Math.min(cw / W, ch / H);
  // layar potret: overview sedikit diperbesar supaya kantor tidak terlalu kecil (bisa digeser)
  const homeScale = () => (ch > cw * 1.1 ? Math.max(fit(), (ch / H) * 0.52) : fit());
  const UI_FONT = '"Zen Maru Gothic", "Hiragino Maru Gothic ProN", system-ui, sans-serif';

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cw = Math.round(innerWidth * dpr); ch = Math.round(innerHeight * dpr);
    scene.width = cw; scene.height = ch;
    scene.style.width = innerWidth + 'px'; scene.style.height = innerHeight + 'px';
    if (!cam.follow) { cam.ts = Math.max(cam.ts, fit()); if (!app.started || cam.ts < homeScale() * 1.02) { cam.ts = homeScale(); cam.tx = W / 2; cam.ty = H / 2; } }
    if (!app.started) { cam.s = cam.ts; cam.x = cam.tx; cam.y = cam.ty; }
  }
  function clampCam(x, y, s) {
    const vw = cw / s, vh = ch / s;
    x = vw >= W ? W / 2 : ACH.clamp(x, vw / 2, W - vw / 2);
    y = vh >= H ? H / 2 : ACH.clamp(y, vh / 2, H - vh / 2);
    return [x, y];
  }
  const toWorld = (sx, sy) => [(sx * dpr - cw / 2) / cam.s + cam.x, (sy * dpr - ch / 2) / cam.s + cam.y];
  const toScreen = (wx, wy) => [((wx - cam.x) * cam.s + cw / 2) / dpr, ((wy - cam.y) * cam.s + ch / 2) / dpr];

  /* ---------------- render ---------------- */
  function rrect(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  function drawRing(a, t) {
    const g = a.geom(t);
    const col = (a.data && a.data.color) || '#ffffff';
    const y = g.pose === 'stool' || g.pose === 'sit' ? g.y - g.lift + 3 : g.y;
    const rx = (g.pose === 'lie' ? g.dh * 0.6 : g.dw * (g.pose === 'walk' || g.pose === 'stand' ? 0.5 : 0.56)) * (1 + 0.04 * Math.sin(t * 4));
    ctx.save();
    ctx.translate(g.x, y); ctx.scale(1, 0.32);
    ctx.lineWidth = 3.2; ctx.strokeStyle = ACH.alpha(col, 0.95);
    ctx.beginPath(); ctx.arc(0, 0, rx, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(255,250,240,0.9)';
    ctx.beginPath(); ctx.arc(0, 0, rx + 3, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  function render(t, dt) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const vg = ctx.createRadialGradient(cw / 2, ch / 2, 0, cw / 2, ch / 2, Math.max(cw, ch) * 0.7);
    vg.addColorStop(0, '#4a3a2c'); vg.addColorStop(1, '#1f1813');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, cw, ch);
    const ox = cw / 2 - cam.x * cam.s, oy = ch / 2 - cam.y * cam.s;
    ctx.setTransform(cam.s, 0, 0, cam.s, ox, oy);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    const bg = A.bg;
    if (bg) ctx.drawImage(bg, 0, 0, W, H);
    fx.drawBack(ctx, t, dt);
    // urutkan kedalaman: karakter + penghalang depan (kotatsu)
    const items = sim.actors.map((a) => ({ y: a.y + (a.pose() === 'stool' ? 0 : 0.01), a }));
    if (A.kotatsu) items.push({ y: ACH.KOTATSU.sortY, k: true });
    items.sort((p, q) => p.y - q.y);
    const mark = cam.follow || hoverActor;
    for (const it of items) {
      if (it.k) { const K = ACH.KOTATSU; ctx.drawImage(A.kotatsu, K.x, K.y, K.w, K.h); continue; }
      if (it.a === mark) drawRing(it.a, t);
      it.a.draw(ctx, t);
    }
    fx.drawFront(ctx, t);
    if (DEBUG) drawDebug();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawOverlays(t);
  }
  function drawDebug() {
    ctx.save();
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(0,255,120,0.8)';
    ctx.beginPath(); world.FLOOR.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,60,160,0.9)';
    world.EDGES.forEach(([a, b]) => { ctx.beginPath(); ctx.moveTo(...world.NODES[a]); ctx.lineTo(...world.NODES[b]); ctx.stroke(); });
    ctx.fillStyle = '#ff3ca0'; ctx.font = '10px monospace';
    Object.entries(world.NODES).forEach(([k, [x, y]]) => { ctx.fillRect(x - 3, y - 3, 6, 6); ctx.fillText(k, x + 4, y - 4); });
    const all = [].concat(...Object.values(world.SPOTS).map((v) => (Array.isArray(v) ? v : Object.values(v))));
    ctx.fillStyle = '#00e5ff';
    all.forEach((s) => { ctx.beginPath(); ctx.arc(s.x, s.y, 3.5, 0, 7); ctx.fill(); ctx.fillText(s.id, s.x + 5, s.y + 10); });
    ctx.restore();
  }

  // label nama, emote & zzz — digambar di ruang layar supaya tajam
  function drawOverlays(t) {
    const zoom = cam.s / dpr;
    const fs = Math.round(ACH.clamp(zoom * 9.5, 11, 16) * dpr);
    ctx.textBaseline = 'middle';
    const list = sim.actors.slice().sort((p, q) => q.y - p.y); // depan dulu → label depan tetap di tempat
    const placed = [];
    for (const a of list) {
      const d = a.data;
      if (!d) continue;
      const g = a.geom(t);
      const focus = a === cam.follow || a === hoverActor;
      const [sx, sy] = toScreen(g.x, g.top - 4);
      if (sx < -120 || sy < -60 || sx > innerWidth + 120 || sy > innerHeight + 80) continue;
      // label
      ctx.font = `700 ${fs}px ${UI_FONT}`;
      const name = d.name || a.id;
      const tw = ctx.measureText(name).width;
      const pad = 6 * dpr, dot = fs * 0.5;
      const bw = tw + pad * 2.6 + dot, bh = fs + pad * 1.1;
      const bx = Math.round(sx * dpr - bw / 2);
      let by = Math.round(sy * dpr - bh);
      // hindari label saling tumpuk: geser ke atas bila bertabrakan
      for (let n = 0; n < 4; n++) {
        const hit = placed.find((r) => bx < r.x + r.w + 2 * dpr && bx + bw + 2 * dpr > r.x && by < r.y + r.h + 2 * dpr && by + bh + 2 * dpr > r.y);
        if (!hit) break;
        by = hit.y - bh - 3 * dpr;
      }
      placed.push({ x: bx, y: by, w: bw, h: bh });
      ctx.globalAlpha = a.alpha < 0.6 ? 0.7 : focus ? 1 : 0.9;
      ctx.shadowColor = 'rgba(40,25,10,0.35)'; ctx.shadowBlur = 6 * dpr; ctx.shadowOffsetY = 2 * dpr;
      ctx.fillStyle = 'rgba(250,244,232,0.94)'; rrect(ctx, bx, by, bw, bh, bh / 2); ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.lineWidth = Math.max(1, 1.5 * dpr); ctx.strokeStyle = focus ? d.color : 'rgba(46,58,99,0.22)'; ctx.stroke();
      ctx.fillStyle = (ACH.STATUS[d.eff.status] || ACH.STATUS.kerja).color;
      ctx.beginPath(); ctx.arc(bx + pad + dot / 2, by + bh / 2, dot / 2, 0, 7); ctx.fill();
      ctx.fillStyle = '#2b3456'; ctx.fillText(name, bx + pad * 1.6 + dot, by + bh / 2 + dpr * 0.5);
      ctx.globalAlpha = 1;
      // emote
      if (a.emote) {
        const e = a.emote, k = Math.min(1, e.t / 0.25), out = Math.max(0, (e.t - (e.dur - 0.3)) / 0.3);
        const s = (k < 1 ? 0.6 + 0.5 * Math.sin(k * Math.PI * 0.5) * 1.15 : 1) * (1 - out);
        if (s > 0.02) {
          const r = Math.round(ACH.clamp(zoom * 15, 16, 30) * dpr) * s;
          const ex = sx * dpr + bw / 2 + r * 0.6, ey = by - r * 0.4 + Math.sin(t * 3) * dpr;
          ctx.save();
          ctx.shadowColor = 'rgba(40,25,10,0.3)'; ctx.shadowBlur = 5 * dpr;
          ctx.fillStyle = '#fffaf0';
          ctx.beginPath(); ctx.arc(ex, ey, r, 0, 7); ctx.fill();
          ctx.beginPath(); ctx.moveTo(ex - r * 0.7, ey + r * 0.45); ctx.lineTo(ex - r * 1.15, ey + r * 1.05); ctx.lineTo(ex - r * 0.2, ey + r * 0.8); ctx.fill();
          ctx.shadowColor = 'transparent';
          ctx.font = `${Math.round(r * 1.15)}px "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
          ctx.textAlign = 'center'; ctx.fillText(e.ch, ex, ey + r * 0.08);
          ctx.restore();
        }
      }
      // zzz
      if (a.zzz.length) {
        ctx.save(); ctx.textAlign = 'center';
        a.zzz.forEach((z) => {
          const k = z.t / 3;
          const zx = sx * dpr + (k * 26 + Math.sin(z.t * 2) * 5) * dpr * zoom * 0.5, zy = by - k * 40 * dpr * zoom * 0.5;
          ctx.globalAlpha = Math.sin(k * Math.PI) * 0.95;
          ctx.font = `italic 700 ${Math.round((10 + k * 10) * z.s * dpr * ACH.clamp(zoom, 0.9, 2.2))}px "Shippori Mincho", serif`;
          ctx.fillStyle = '#2e3a63'; ctx.fillText('z', zx, zy);
        });
        ctx.restore();
      }
    }
    ctx.textAlign = 'left';
  }

  /* ---------------- loop ---------------- */
  let last = performance.now(), t0 = last;
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const t = (now - t0) / 1000;
    sim.update(dt, t);
    if (cam.follow) {
      const g = cam.follow.geom(t);
      const panel = $('detail').hidden ? 0 : $('detail').offsetWidth + 16;
      const narrow = innerWidth < 760;
      cam.ts = Math.max(fit() * cam.fz, narrow ? (ch / H) * 1.2 : 0);
      cam.tx = g.x - (narrow ? 0 : (panel * dpr) / 2 / cam.ts);
      cam.ty = (g.top + g.y) / 2 + (narrow && panel ? (innerHeight * 0.27 * dpr) / cam.ts : 0);
    }
    const k = 1 - Math.exp(-dt * (cam.follow ? 4 : 5));
    cam.s = Math.exp(ACH.lerp(Math.log(cam.s), Math.log(cam.ts), k));
    const [cx, cy] = clampCam(cam.tx, cam.ty, cam.s);
    cam.x = ACH.lerp(cam.x, cx, k); cam.y = ACH.lerp(cam.y, cy, k);
    [cam.x, cam.y] = clampCam(cam.x, cam.y, cam.s);
    $('logo').classList.toggle('mini', cam.s > homeScale() * 1.35);
    render(t, dt);
    requestAnimationFrame(loop);
  }

  /* ---------------- interaksi ---------------- */
  let hoverActor = null, down = null, dragged = false;
  const nowT = () => (performance.now() - t0) / 1000;
  function actorAt(wx, wy) {
    const t = nowT();
    let best = null;
    for (const a of sim.actors) if (a.hit(wx, wy, t) && (!best || a.y > best.y)) best = a;
    return best;
  }
  const areaAt = (wx, wy) => world.AREAS.find((r) => wx >= r.x0 && wx <= r.x1 && wy >= r.y0 && wy <= r.y1);
  const countIn = (r) => sim.actors.filter((a) => a.x >= r.x0 && a.x <= r.x1 && a.y >= r.y0 && a.y <= r.y1 + 30).length;
  const tip = $('tip');
  function showTip(html, x, y) {
    tip.innerHTML = html; tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = Math.min(innerWidth - tw - 8, x + 14) + 'px';
    tip.style.top = Math.max(8, Math.min(innerHeight - th - 8, y + 14)) + 'px';
  }

  scene.addEventListener('pointerdown', (e) => { tip.hidden = true; down = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y }; dragged = false; scene.setPointerCapture(e.pointerId); });
  scene.addEventListener('pointermove', (e) => {
    if (down) {
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (!dragged && Math.hypot(dx, dy) > 5) dragged = true;
      if (dragged && !cam.follow) {
        const [x, y] = clampCam(down.cx - (dx * dpr) / cam.s, down.cy - (dy * dpr) / cam.s, cam.s);
        cam.x = cam.tx = x; cam.y = cam.ty = y;
        scene.style.cursor = 'grabbing';
      }
      tip.hidden = true;
      return;
    }
    const [wx, wy] = toWorld(e.clientX, e.clientY);
    const a = actorAt(wx, wy);
    hoverActor = a;
    scene.style.cursor = a ? 'pointer' : 'grab';
    if (a && a.data) {
      const d = a.data, st = ACH.STATUS[d.eff.status] || ACH.STATUS.kerja;
      showTip(`<b style="color:${esc(ACH.shade(d.color, -0.35))}">${esc(d.name)}</b><br><i class="dot" style="background:${st.color}"></i>${st.label} · ${esc(ACH.roomLabel(d.eff.location, d.id))}<br><span class="muted">${esc(d.eff.activity || '')}</span>`, e.clientX, e.clientY);
      return;
    }
    const r = areaAt(wx, wy);
    if (r) {
      const n = countIn(r);
      showTip(`<b>${esc(r.label)}</b><br><span class="muted">${esc(r.desc)}</span>${n ? `<br>${n} agen di sini` : ''}`, e.clientX, e.clientY);
    } else tip.hidden = true;
  });
  scene.addEventListener('pointerup', () => {
    scene.style.cursor = 'grab';
    if (!down) return;
    const wasDrag = dragged; const p = down; down = null;
    if (wasDrag) return;
    const [wx, wy] = toWorld(p.x, p.y);
    const a = actorAt(wx, wy);
    if (a) follow(a.id);
    else if (cam.follow) unfollow();
  });
  scene.addEventListener('pointerleave', () => { tip.hidden = true; hoverActor = null; });
  scene.addEventListener('wheel', (e) => {
    e.preventDefault();
    const f = Math.exp(-e.deltaY * 0.0016);
    if (cam.follow) { cam.fz = ACH.clamp(cam.fz * f, 1.3, 4.5); return; }
    const ns = ACH.clamp(cam.s * f, fit(), fit() * 4.5);
    const [wx, wy] = toWorld(e.clientX, e.clientY);
    const nx = wx - (e.clientX * dpr - cw / 2) / ns, ny = wy - (e.clientY * dpr - ch / 2) / ns;
    const [x, y] = clampCam(nx, ny, ns);
    cam.s = cam.ts = ns; cam.x = cam.tx = x; cam.y = cam.ty = y;
  }, { passive: false });

  function follow(id) {
    const a = sim.agents[id];
    if (!a) return;
    cam.follow = a; app.selected = id;
    showPanel('detail', true);
    renderDetail();
  }
  function unfollow() {
    cam.follow = null; app.selected = null;
    showPanel('detail', false);
    home();
  }
  function home() { cam.ts = homeScale(); cam.tx = W / 2; cam.ty = H / 2; }
  Object.assign(app, { follow, unfollow, toScreen, toWorld, home });

  /* ---------------- panel ---------------- */
  const panels = { roster: $('roster'), detail: $('detail'), log: $('logPanel'), board: $('board') };
  function showPanel(name, on) {
    const p = panels[name];
    if (on === undefined) on = p.hidden;
    if (name === 'detail' && on) panels.roster.hidden = true;
    if (name === 'roster' && on && !panels.detail.hidden) { cam.follow = null; app.selected = null; panels.detail.hidden = true; }
    p.hidden = !on;
    if (on) { p.classList.remove('pop'); void p.offsetWidth; p.classList.add('pop'); }
    document.querySelectorAll('#toolbar button').forEach((b) => b.classList.toggle('on', panels[b.dataset.act] ? !panels[b.dataset.act].hidden : false));
    if (name === 'board' && on) renderBoard();
    if (name === 'log' && on) renderLog();
    if (name === 'roster' && on) renderRoster();
  }
  app.showPanel = showPanel;
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => { if (b.dataset.close === 'detail') unfollow(); else showPanel(b.dataset.close, false); }));
  document.querySelectorAll('#toolbar button').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.act === 'home') { if (cam.follow) unfollow(); else home(); return; }
    showPanel(b.dataset.act);
  }));
  addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input,textarea')) return;
    const k = e.key.toLowerCase();
    tip.hidden = true;
    if (k === 't') showPanel('board');
    else if (k === 'l') showPanel('log');
    else if (k === 'k') showPanel('roster');
    else if (k === '0') { if (cam.follow) unfollow(); else home(); }
    else if (k === 'escape') {
      if (cam.follow) unfollow();
      else if (!panels.board.hidden) showPanel('board', false);
      else if (!panels.roster.hidden) showPanel('roster', false);
      else if (!panels.log.hidden) showPanel('log', false);
      else home();
    } else if (/^[1-9]$/.test(k)) { const l = store.agentList().find((x) => x.slot === +k - 1); if (l) follow(l.id); }
  });

  /* ---------------- konten panel ---------------- */
  const statusPill = (s) => { const st = ACH.STATUS[s] || ACH.STATUS.kerja; return `<span class="pill" style="--c:${st.color}"><i></i>${st.label}</span>`; };
  function ago(ts) {
    if (!ts) return '—';
    const m = Math.round((Date.now() - Date.parse(ts)) / 60000);
    if (m < 1) return 'barusan';
    if (m < 60) return m + ' mnt lalu';
    if (m < 1440) return Math.floor(m / 60) + ' jam lalu';
    return Math.floor(m / 1440) + ' hari lalu';
  }
  const ink = (c) => ACH.shade(c || '#8a8378', -0.38);
  function fmtLogText(l) {
    const name = store.agentName(l.agent_id), col = ink(store.agentColor(l.agent_id));
    const msg = String(l.message || '');
    const starts = msg.toLowerCase().startsWith(String(name).toLowerCase());
    return starts ? `<b style="color:${esc(col)}">${esc(name)}</b>${esc(msg.slice(name.length))}` : `<b style="color:${esc(col)}">${esc(name)}</b> ${esc(msg)}`;
  }
  function renderRoster() {
    if (panels.roster.hidden) return;
    $('rosterList').innerHTML = store.agentList().map((a) => `
      <button class="ritem" data-id="${esc(a.id)}" style="--c:${esc(a.color)}">
        <span class="rimg"><img src="${A.mascotSrc(a.id)}" alt="" /></span>
        <span class="rinfo"><b>${esc(a.name)}</b>
        <span class="rmeta">${statusPill(a.eff.status)} <em>${esc(ACH.roomLabel(a.eff.location, a.id))}</em></span>
        <small>${esc(a.eff.activity || '')}</small></span>
        <kbd>${a.slot + 1}</kbd>
      </button>`).join('');
    $('rosterList').querySelectorAll('.ritem').forEach((b) => b.addEventListener('click', () => follow(b.dataset.id)));
  }
  function renderDetail() {
    if (panels.detail.hidden || !app.selected) return;
    const a = store.agents[app.selected] && store.agentList().find((x) => x.id === app.selected);
    if (!a) { unfollow(); return; }
    const prof = ACH.PROFILE[a.id];
    $('dTitle').textContent = 'Agen #' + (a.slot + 1);
    const tasks = store.taskList().filter((t) => t.agent_id === a.id);
    const logs = store.logs.filter((l) => l.agent_id === a.id).slice(0, 8);
    const tgroup = ACH.TASK_COLS.map((c) => {
      const ts = tasks.filter((t) => t.status === c).slice(0, 6);
      if (!ts.length) return '';
      return `<div class="tg"><h4>${c} <small>${ts.length}</small></h4>${ts.map((t) => `<div class="mini-task">${esc(t.title)}${t.due_at && c !== 'Selesai' ? `<small>⏱ ${ACH.isSameWibDay(t.due_at, new Date()) ? '' : ACH.wibShort(t.due_at) + ' '}${ACH.wibHM(t.due_at)} WIB</small>` : ''}</div>`).join('')}</div>`;
    }).join('');
    $('detailBody').innerHTML = `
      <div class="dhead" style="--c:${esc(a.color)}">
        <span class="dimg"><img src="${A.mascotSrc(a.id)}" alt="" /></span>
        <div><h3 style="color:${esc(ink(a.color))}">${esc(a.name)}</h3>
        <div class="muted">${prof ? 'Membawa ' + esc(prof.prop) + ' · zona ' + esc(prof.homeLabel) : esc(a.division)}</div>${statusPill(a.eff.status)}</div>
      </div>
      <dl class="facts">
        <dt>Lokasi</dt><dd>${esc(ACH.roomLabel(a.eff.location, a.id))}</dd>
        <dt>Aktivitas</dt><dd>${esc(a.eff.activity || '—')}${a.eff.stale ? ' <span class="tag">jadwal otomatis</span>' : ''}</dd>
        <dt>Tugas kini</dt><dd>${esc(a.current_task || '—')}</dd>
        <dt>Update</dt><dd>${a.updated_at ? ACH.wibHM(a.updated_at) + ' WIB · ' + ago(a.updated_at) : '—'}</dd>
      </dl>
      <h4 class="sec">Tugas</h4>${tgroup || '<p class="muted">Belum ada tugas.</p>'}
      <h4 class="sec">Log terbaru</h4>
      ${logs.length ? logs.map((l) => `<div class="lrow"><time>${ACH.wibHM(l.created_at)}</time><span>${esc(l.message)}</span></div>`).join('') : '<p class="muted">Belum ada log.</p>'}`;
  }
  let lastLogIds = new Set();
  function renderLog() {
    if (panels.log.hidden) { lastLogIds = new Set(store.logs.map((l) => l.id)); return; }
    const html = store.logs.slice(0, 80).map((l) => {
      const fresh = lastLogIds.size && !lastLogIds.has(l.id);
      const day = ACH.isSameWibDay(l.created_at, new Date()) ? '' : ACH.wibShort(l.created_at) + ' ';
      return `<div class="litem${fresh ? ' fresh' : ''}" data-agent="${esc(l.agent_id)}" style="--c:${esc(store.agentColor(l.agent_id))}"><time>${day}${ACH.wibHM(l.created_at)} WIB</time><p>${fmtLogText(l)}${l.location ? ` <span class="muted">· ${esc(ACH.roomLabel(l.location, l.agent_id))}</span>` : ''}</p></div>`;
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
        const due = t.due_at && c !== 'Selesai' ? ` · ⏱ ${ACH.isSameWibDay(t.due_at, new Date()) ? '' : ACH.wibShort(t.due_at) + ' '}${ACH.wibHM(t.due_at)} WIB` : c === 'Selesai' && t.updated_at ? ` · ✔ ${ACH.wibHM(t.updated_at)} WIB` : '';
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
  function tick() {
    const now = new Date();
    $('clock').textContent = ACH.wibHM(now);
    $('sec').textContent = ACH.wibHMS(now).slice(-2);
    const ph = fx.dayPhase(now);
    const icon = ph.night > 0.5 ? '🌙' : ph.golden > 0.5 ? '🌇' : ph.day > 0.5 ? '☀️' : '🌅';
    $('date').textContent = icon + ' ' + ACH.wibDate(now);
  }

  /* ---------------- data → dunia ---------------- */
  function onAgents() {
    sim.syncAgents(store.agentList());
    renderRoster(); renderDetail();
  }
  store.on('agents', onAgents);
  store.on('tasks', () => { renderBoard(); renderDetail(); });
  store.on('logs', () => { renderLog(); renderDetail(); });
  store.on('log-added', () => { if (panels.log.hidden) { const b = $('toolbar').querySelector('[data-act=log]'); b.classList.add('ping'); setTimeout(() => b.classList.remove('ping'), 2500); } });
  store.on('mode', (m) => { renderBadge(); if (m === 'live' && app.started) toast('Terhubung LIVE ke Supabase ✔'); });

  /* ---------------- start ---------------- */
  function start() {
    if (app.started) return;
    resize();
    addEventListener('resize', resize);
    store.start();
    tick(); setInterval(tick, 1000);
    setInterval(() => { renderDetail(); }, 5000);
    renderBadge();
    app.started = true;
    $('loading').classList.add('done');
    setTimeout(() => $('loading').remove(), 900);
    requestAnimationFrame((n) => { last = n; t0 = n; loop(n); });
  }
  const fontsReady = document.fonts && document.fonts.load
    ? Promise.race([Promise.all([document.fonts.load('700 12px "Zen Maru Gothic"'), document.fonts.load('600 12px "Shippori Mincho"')]), new Promise((r) => setTimeout(r, 1800))])
    : Promise.resolve();
  Promise.all([A.ready, fontsReady.catch(() => null)]).then(start, start);
})();
