/* Aplikasi: loop render, kamera (zoom/follow/pan), input, UI panel */
(function () {
  const ACH = window.ACH, W = ACH.W, H = ACH.H;
  const world = ACH.world, sim = ACH.sim, fx = ACH.fx, store = ACH.store;
  const $ = (id) => document.getElementById(id);
  const esc = ACH.escape;

  const scene = $('scene');
  const ctx = scene.getContext('2d');
  const [wc, w] = ACH.canvas(W, H);
  let dpr = 1, cw = 0, ch = 0;

  const cam = { x: W / 2, y: H / 2, s: 1, tx: W / 2, ty: H / 2, ts: 1, follow: null, fz: 3.2 };
  const app = (ACH.app = { cam });
  const fit = () => Math.min(cw / W, ch / H);

  /* ---------------- modul info dari data ---------------- */
  let modSig = '';
  function modInfo() {
    const list = store.agentList();
    const info = ACH.AGENTS_SEED.map((s) => ({ color: s.color, division: s.division, icon: s.icon }));
    list.forEach((a) => { info[a.slot] = { color: a.color || '#8a93a8', division: (a.division || a.name || '').slice(0, 26), icon: (ACH.PROFILE[a.id] || {}).icon || 'star' }; });
    return info;
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cw = Math.round(innerWidth * dpr); ch = Math.round(innerHeight * dpr);
    scene.width = cw; scene.height = ch;
    scene.style.width = innerWidth + 'px'; scene.style.height = innerHeight + 'px';
    if (!cam.follow) { cam.ts = fit(); cam.tx = W / 2; cam.ty = H / 2; }
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
  function drawActor(a) {
    const [pose, f] = a.pose();
    const spr = ACH.sprite(a.vis, a.key, pose, f);
    const [x, y] = a.pos();
    if (a.dim) w.globalAlpha = 0.55;
    if (pose === 'sleep') ACH.drawSprite(w, spr, x + 9, y, 1, -Math.PI / 2);
    else ACH.drawSprite(w, spr, x, y, a.facing);
    w.globalAlpha = 1;
  }
  function drawCar(L, front) {
    const x = Math.round(L.x), y = Math.round(L.y);
    if (!front) {
      w.fillStyle = 'rgba(16,48,80,0.65)'; w.fillRect(x - 8, y - 25, 17, 25);
      w.fillStyle = 'rgba(120,230,255,0.12)'; w.fillRect(x - 7, y - 24, 15, 23);
    } else {
      world.rect(w, x - 9, y - 27, 19, 3, '#4a5168'); world.rect(w, x - 9, y - 27, 19, 1, '#9ff6ff');
      world.rect(w, x - 9, y - 1, 19, 2, '#4a5168'); world.rect(w, x - 9, y - 1, 19, 1, '#9ff6ff');
      world.rect(w, x - 9, y - 24, 1, 23, '#3dd6ff'); world.rect(w, x + 9, y - 24, 1, 23, '#3dd6ff');
      w.fillStyle = 'rgba(200,250,255,0.18)'; w.fillRect(x - 6, y - 23, 2, 18);
      world.rect(w, x - 1, y - 26, 3, 1, L.state === 'idle' ? '#5dff8a' : '#ffe14d');
      world.glow(w, x, y - 26, 10, 5, '#3dd6ff', 0.35);
    }
  }
  function render(t) {
    fx.drawSky(w, t);
    w.drawImage(world.main, 0, 0);
    fx.drawBack(w, t);
    const z0 = [], z1 = [];
    for (const a of sim.actors) ((a.mode === 'act' && a.spot && a.spot.z === 0) ? z0 : z1).push(a);
    const byY = (p, q) => p.pos()[1] - q.pos()[1];
    z0.sort(byY).forEach(drawActor);
    w.drawImage(world.fg, 0, 0);
    fx.drawMid(w, t);
    sim.lanes.forEach((L) => drawCar(L, false));
    z1.sort(byY).forEach(drawActor);
    sim.lanes.forEach((L) => drawCar(L, true));
    fx.drawFront(w, t);
    // penanda agen yang diikuti / di-hover
    const mark = cam.follow || hoverActor;
    if (mark && mark.kind === 'agent') {
      const [x, y] = mark.pos();
      const top = mark.pose()[0] === 'sleep' ? y - 12 : y - 26 - Math.round(Math.abs(Math.sin(t * 4)) * 2);
      const col = (mark.data && mark.data.color) || '#fff';
      world.rect(w, x - 2, top, 5, 1, col); world.rect(w, x - 1, top + 1, 3, 1, col); world.rect(w, x, top + 2, 1, 1, col);
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // latar di luar dunia: langit di atas garis tanah, batuan di bawahnya
    const gy = ACH.clamp(Math.round((130 - cam.y) * cam.s + ch / 2), 0, ch);
    const g = ctx.createLinearGradient(0, 0, 0, Math.max(1, gy));
    g.addColorStop(0, '#03040c'); g.addColorStop(1, '#151233');
    ctx.fillStyle = g; ctx.fillRect(0, 0, cw, gy);
    ctx.fillStyle = '#2b2833'; ctx.fillRect(0, gy, cw, ch - gy);
    ctx.imageSmoothingEnabled = false;
    const ox = Math.round(cw / 2 - cam.x * cam.s), oy = Math.round(ch / 2 - cam.y * cam.s);
    ctx.setTransform(cam.s, 0, 0, cam.s, ox, oy);
    ctx.drawImage(wc, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawTags();
  }

  function drawTags() {
    const zoom = cam.s / dpr;
    const fs = Math.round(ACH.clamp(zoom * 3.6, 9, 15) * dpr);
    ctx.font = `${fs}px Silkscreen, "Press Start 2P", monospace`;
    ctx.textBaseline = 'middle';
    for (const id in sim.agents) {
      const a = sim.agents[id], d = a.data;
      if (!d) continue;
      const [x, y] = a.pos();
      const lying = a.pose()[0] === 'sleep';
      const [sx, sy] = toScreen(x, lying ? y - 9 : y - 24 - (a === cam.follow || a === hoverActor ? 4 : 0));
      if (sx < -80 || sy < -40 || sx > innerWidth + 80 || sy > innerHeight + 40) continue;
      const name = d.name || id;
      const tw = ctx.measureText(name).width;
      const pad = 4 * dpr, dot = fs * 0.55;
      const bw = tw + pad * 3 + dot, bh = fs + pad * 1.2;
      const bx = Math.round(sx * dpr - bw / 2), by = Math.round(sy * dpr - bh);
      ctx.globalAlpha = a.dim ? 0.6 : 0.92;
      ctx.fillStyle = 'rgba(6,8,18,0.82)'; ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = d.color || '#fff'; ctx.fillRect(bx, by + bh - Math.max(1, dpr), bw, Math.max(1, dpr)); ctx.fillRect(bx, by, Math.max(1, dpr), bh);
      ctx.fillStyle = (ACH.STATUS[d.eff.status] || ACH.STATUS.kerja).color;
      ctx.fillRect(bx + pad, Math.round(by + bh / 2 - dot / 2), dot, dot);
      ctx.fillStyle = '#ffffff'; ctx.fillText(name, bx + pad * 2 + dot, by + bh / 2 + dpr * 0.5);
      ctx.globalAlpha = 1;
    }
  }

  /* ---------------- loop ---------------- */
  let last = performance.now(), t0 = last;
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    sim.update(dt);
    // kamera
    if (cam.follow) {
      const [x, y] = cam.follow.pos();
      cam.ts = fit() * cam.fz;
      const panel = $('detail').hidden ? 0 : $('detail').offsetWidth + 16;
      const narrow = innerWidth < 760;
      cam.tx = x - (narrow ? 0 : (panel * dpr) / 2 / cam.ts);
      cam.ty = y - 10 + (narrow && panel ? (innerHeight * 0.22 * dpr) / cam.ts : 0);
    }
    const k = 1 - Math.exp(-dt * (cam.follow ? 4.5 : 5));
    cam.s = Math.exp(ACH.lerp(Math.log(cam.s), Math.log(cam.ts), k));
    const [cx, cy] = clampCam(cam.tx, cam.ty, cam.s);
    cam.x = ACH.lerp(cam.x, cx, k); cam.y = ACH.lerp(cam.y, cy, k);
    [cam.x, cam.y] = clampCam(cam.x, cam.y, cam.s);
    $('logo').classList.toggle('mini', cam.s > fit() * 1.4);
    render((now - t0) / 1000);
    requestAnimationFrame(loop);
  }

  /* ---------------- interaksi ---------------- */
  let hoverActor = null, down = null, dragged = false;
  function actorAt(wx, wy) {
    let best = null, bd = 1e9;
    for (const a of sim.actors) {
      const [x, y] = a.pos();
      const lying = a.pose()[0] === 'sleep';
      const inside = lying ? Math.abs(wx - x) < 11 && Math.abs(wy - y) < 8 : Math.abs(wx - x) < 7 && wy > y - 21 && wy < y + 2;
      if (!inside) continue;
      const d = Math.abs(wx - x) + Math.abs(wy - (y - 10)) - (a.kind === 'agent' ? 20 : 0);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }
  function areaAt(wx, wy) { return world.areas.find((r) => wx >= r.x0 && wx <= r.x1 && wy >= r.y0 && wy <= r.y1); }
  function countIn(r) {
    return sim.actors.filter((a) => { const [x, y] = a.pos(); return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1 + 6; });
  }
  const tip = $('tip');
  function showTip(html, x, y) {
    tip.innerHTML = html; tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = Math.min(innerWidth - tw - 8, x + 14) + 'px';
    tip.style.top = Math.max(8, Math.min(innerHeight - th - 8, y + 14)) + 'px';
  }
  function areaLabel(r) {
    if (r.key === 'desk') { const info = modInfo()[r.mod]; return 'Modul ' + info.division; }
    if (r.key === 'lift') return 'Lift Kaca';
    return ACH.ROOM_LABEL[r.key];
  }
  const AREA_DESC = {
    meeting: 'Meja hologram untuk rapat lintas divisi', kantin: 'Makan, ngopi, ngobrol', arcade: 'Game retro & mesin capit', gym: 'Olahraga gravitasi 1/6',
    sleep: '9 kapsul tidur kru', shower: 'Mandi air daur ulang', dance: 'Lantai disko + DJ bot', outdoor: 'Kubah force-field, taman main alien',
    command: 'Radar & komunikasi ke Bumi', rocket: 'Roket logistik siap terbang', lift: 'Penghubung semua lantai & permukaan',
  };

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
    if (a) {
      if (a.kind === 'agent') {
        const d = a.data, st = ACH.STATUS[d.eff.status] || ACH.STATUS.kerja;
        showTip(`<b style="color:${esc(d.color)}">${esc(d.name)}</b> <span class="muted">· ${esc(d.division)}</span><br><i class="dot" style="background:${st.color}"></i>${st.label} · ${esc(ACH.ROOM_LABEL[d.eff.location])}<br><span class="muted">${esc(d.eff.activity || '')}</span>`, e.clientX, e.clientY);
      } else if (a.kind === 'npc') {
        const busy = a.state === 'desk' ? (a.nap ? 'Tidur di meja (shift malam)' : 'Lagi ngetik di meja') : a.state === 'kantin' ? 'Ngopi di kantin' : a.state === 'stretch' ? 'Peregangan sebentar' : 'Jalan-jalan sebentar';
        showTip(`<b>${esc(a.name)}</b><br><span class="muted">${busy}</span>`, e.clientX, e.clientY);
      } else if (a.patrol) showTip(`<b>Kru Patroli</b><br><span class="muted">Cek panel surya, rover & landasan</span>`, e.clientX, e.clientY);
      else showTip(`<b>Kru Lapangan</b><br><span class="muted">Jaga kubah & main bareng alien</span>`, e.clientX, e.clientY);
      return;
    }
    const r = areaAt(wx, wy);
    if (r) {
      const n = countIn(r).length;
      const desc = r.key === 'desk' ? '1 meja leader + 4 meja tim' : AREA_DESC[r.key] || '';
      showTip(`<b>${esc(areaLabel(r))}</b><br><span class="muted">${esc(desc)}</span><br>${n} orang di sini`, e.clientX, e.clientY);
    } else tip.hidden = true;
  });
  scene.addEventListener('pointerup', (e) => {
    scene.style.cursor = 'grab';
    if (!down) return;
    const wasDrag = dragged; down = null;
    if (wasDrag) return;
    const [wx, wy] = toWorld(e.clientX, e.clientY);
    const a = actorAt(wx, wy);
    if (a && a.kind === 'agent') follow(a.id);
    else if (cam.follow) unfollow();
  });
  scene.addEventListener('pointerleave', () => { tip.hidden = true; hoverActor = null; });
  scene.addEventListener('wheel', (e) => {
    e.preventDefault();
    const f = Math.exp(-e.deltaY * 0.0016);
    if (cam.follow) { cam.fz = ACH.clamp(cam.fz * f, 1.6, 7); return; }
    const ns = ACH.clamp(cam.s * f, fit(), fit() * 8);
    const [wx, wy] = toWorld(e.clientX, e.clientY);
    const nx = wx - (e.clientX * dpr - cw / 2) / ns, ny = wy - (e.clientY * dpr - ch / 2) / ns;
    const [x, y] = clampCam(nx, ny, ns);
    cam.s = cam.ts = ns; cam.x = cam.tx = x; cam.y = cam.ty = y;
  }, { passive: false });

  function follow(id) {
    const a = sim.agents[id];
    if (!a) return;
    cam.follow = a;
    app.selected = id;
    showPanel('detail', true);
    renderDetail();
  }
  function unfollow() {
    cam.follow = null; app.selected = null;
    showPanel('detail', false);
    home();
  }
  function home() { cam.ts = fit(); cam.tx = W / 2; cam.ty = H / 2; }
  app.follow = follow; app.unfollow = unfollow; app.toScreen = toScreen; app.toWorld = toWorld;

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
  const portraitCache = {};
  function portrait(a, scale) {
    const act = sim.agents[a.id];
    const key = a.id + a.color + scale;
    if (portraitCache[key]) return portraitCache[key];
    const [c, x] = ACH.canvas(19 * scale, 23 * scale);
    if (act) x.drawImage(ACH.sprite(act.vis, act.key, 'idle', 0), 0, 0, 19 * scale, 23 * scale);
    return (portraitCache[key] = c.toDataURL());
  }
  const statusPill = (s) => { const st = ACH.STATUS[s] || ACH.STATUS.kerja; return `<span class="pill" style="--c:${st.color}"><i></i>${st.label}</span>`; };
  function ago(ts) {
    if (!ts) return '—';
    const m = Math.round((Date.now() - Date.parse(ts)) / 60000);
    if (m < 1) return 'barusan';
    if (m < 60) return m + ' mnt lalu';
    if (m < 1440) return Math.floor(m / 60) + ' jam lalu';
    return Math.floor(m / 1440) + ' hari lalu';
  }
  function fmtLogText(l) {
    const name = store.agentName(l.agent_id), col = store.agentColor(l.agent_id);
    const msg = String(l.message || '');
    const starts = msg.toLowerCase().startsWith(String(name).toLowerCase());
    return starts ? `<b style="color:${esc(col)}">${esc(name)}</b>${esc(msg.slice(name.length))}` : `<b style="color:${esc(col)}">${esc(name)}</b> ${esc(msg)}`;
  }
  function renderRoster() {
    if (panels.roster.hidden) return;
    $('rosterList').innerHTML = store.agentList().map((a) => `
      <button class="ritem" data-id="${esc(a.id)}" style="--c:${esc(a.color)}">
        <img src="${portrait(a, 2)}" alt="" />
        <span class="rinfo"><b>${esc(a.name)}</b><small>${esc(a.division)}</small>
        <span class="rmeta">${statusPill(a.eff.status)} <em>${esc(ACH.ROOM_LABEL[a.eff.location])}</em></span></span>
        <kbd>${a.slot + 1}</kbd>
      </button>`).join('');
    $('rosterList').querySelectorAll('.ritem').forEach((b) => b.addEventListener('click', () => follow(b.dataset.id)));
  }
  function renderDetail() {
    if (panels.detail.hidden || !app.selected) return;
    const a = store.agents[app.selected] && store.agentList().find((x) => x.id === app.selected);
    if (!a) { unfollow(); return; }
    $('dTitle').textContent = 'AGEN #' + (a.slot + 1);
    const tasks = store.taskList().filter((t) => t.agent_id === a.id);
    const logs = store.logs.filter((l) => l.agent_id === a.id).slice(0, 8);
    const tgroup = ACH.TASK_COLS.map((c) => {
      const ts = tasks.filter((t) => t.status === c).slice(0, 6);
      if (!ts.length) return '';
      return `<div class="tg"><h4>${c} <small>${ts.length}</small></h4>${ts.map((t) => `<div class="mini-task">${esc(t.title)}${t.due_at && c !== 'Selesai' ? `<small>⏱ ${ACH.wibHM(t.due_at)} WIB</small>` : ''}</div>`).join('')}</div>`;
    }).join('');
    $('detailBody').innerHTML = `
      <div class="dhead" style="--c:${esc(a.color)}">
        <img src="${portrait(a, 4)}" alt="" />
        <div><h3 style="color:${esc(a.color)}">${esc(a.name)}</h3><div class="muted">${esc(a.division)}</div>${statusPill(a.eff.status)}</div>
      </div>
      <dl class="facts">
        <dt>Lokasi</dt><dd>${esc(ACH.ROOM_LABEL[a.eff.location])}${a.eff.location === 'desk' ? ' · Modul ' + esc(a.division) : ''}</dd>
        <dt>Aktivitas</dt><dd>${esc(a.eff.activity || '—')}${a.eff.stale ? ' <span class="tag">jadwal otomatis</span>' : ''}</dd>
        <dt>Tugas kini</dt><dd>${esc(a.current_task || '—')}</dd>
        <dt>Update</dt><dd>${a.updated_at ? ACH.wibHM(a.updated_at) + ' WIB · ' + ago(a.updated_at) : '—'}</dd>
      </dl>
      <h4 class="sec">TUGAS</h4>${tgroup || '<p class="muted">Belum ada tugas.</p>'}
      <h4 class="sec">LOG TERBARU</h4>
      ${logs.length ? logs.map((l) => `<div class="lrow"><time>${ACH.wibHM(l.created_at)}</time><span>${esc(l.message)}</span></div>`).join('') : '<p class="muted">Belum ada log.</p>'}`;
  }
  let lastLogIds = new Set();
  function renderLog() {
    if (panels.log.hidden) { lastLogIds = new Set(store.logs.map((l) => l.id)); return; }
    const html = store.logs.slice(0, 80).map((l) => {
      const fresh = lastLogIds.size && !lastLogIds.has(l.id);
      const day = ACH.isSameWibDay(l.created_at, new Date()) ? '' : ACH.wibShort(l.created_at) + ' ';
      return `<div class="litem${fresh ? ' fresh' : ''}" data-agent="${esc(l.agent_id)}"><time>${day}${ACH.wibHM(l.created_at)} WIB</time><p>${fmtLogText(l)}${l.location ? ` <span class="muted">· ${esc(ACH.ROOM_LABEL[l.location] || l.location)}</span>` : ''}</p></div>`;
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
    b.textContent = live ? '● LIVE' : '● DEMO';
    b.title = live
      ? 'Terhubung ke Supabase Realtime' + (store.realtime && store.realtime !== 'SUBSCRIBED' ? ' (realtime: ' + store.realtime + ', cadangan polling aktif)' : '')
      : 'Mode demo: ' + (store.error || 'data simulasi') + '. Akan otomatis pindah ke LIVE begitu data Supabase tersedia.';
  }
  $('badge').addEventListener('click', () => toast($('badge').title));
  let toastT = null;
  function toast(msg) { const el = $('toast'); el.textContent = msg; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (el.hidden = true), 4200); }
  function tick() {
    const now = new Date();
    $('clock').textContent = ACH.wibHMS(now);
    $('date').textContent = ACH.wibDate(now);
  }

  /* ---------------- data → dunia ---------------- */
  function onAgents() {
    const info = modInfo();
    const sig = JSON.stringify(info);
    if (sig !== modSig) { modSig = sig; world.build(info); sim.recolorTeams(info); Object.keys(portraitCache).forEach((k) => delete portraitCache[k]); }
    sim.syncAgents(store.agentList());
    renderRoster(); renderDetail();
  }
  store.on('agents', onAgents);
  store.on('tasks', () => { renderBoard(); renderDetail(); });
  store.on('logs', () => { renderLog(); renderDetail(); });
  store.on('log-added', (l) => { if (panels.log.hidden) { $('toolbar').querySelector('[data-act=log]').classList.add('ping'); setTimeout(() => $('toolbar').querySelector('[data-act=log]').classList.remove('ping'), 2500); } });
  store.on('mode', (m) => { renderBadge(); if (m === 'live' && app.started) toast('Terhubung LIVE ke Supabase ✔'); });

  /* ---------------- start ---------------- */
  function start() {
    const info = modInfo();
    modSig = JSON.stringify(info);
    world.build(info);
    sim.init(info);
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
  // tunggu font pixel (maks 1.5 dtk) agar label rapi
  const fontsReady = document.fonts && document.fonts.load ? Promise.race([Promise.all([document.fonts.load('12px Silkscreen'), document.fonts.load('12px "Press Start 2P"')]), new Promise((r) => setTimeout(r, 1500))]) : Promise.resolve();
  fontsReady.then(start, start);
})();
