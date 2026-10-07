/* Data: Supabase (LIVE) dengan fallback DEMO otomatis */
(function () {
  const ACH = window.ACH;
  const CFG = Object.assign({ TABLE_PREFIX: 'ach_', STALE_HOURS: 3, RETRY_SECONDS: 30, POLL_SECONDS: 60 }, window.ACH_CONFIG || {});
  const P = CFG.TABLE_PREFIX;
  const T_AGENTS = P + 'agents', T_TASKS = P + 'tasks', T_LOGS = P + 'logs';

  const store = (ACH.store = { mode: 'connecting', agents: {}, tasks: {}, logs: [], error: null, ev: {}, cfg: CFG });
  store.on = (e, f) => (store.ev[e] = store.ev[e] || []).push(f);
  store.emit = (e, d) => (store.ev[e] || []).forEach((f) => { try { f(d); } catch (err) { console.error(err); } });

  /* ---------------- normalisasi ---------------- */
  function effective(a) {
    const age = a.updated_at ? Date.now() - Date.parse(a.updated_at) : Infinity;
    const stale = !(age < CFG.STALE_HOURS * 3600e3);
    if (stale || !a.location) {
      if (!stale && a.status === 'offline') return { location: 'offline', status: 'offline', activity: a.activity || 'Sedang offline', stale: false };
      return Object.assign(ACH.scheduleFor(a.id), { stale: true });
    }
    if (a.status === 'offline' || a.location === 'offline') return { location: 'offline', status: 'offline', activity: a.activity || 'Sedang offline', stale: false };
    const loc = ACH.ROOM_KEYS.includes(a.location) ? a.location : 'desk'; // kunci tak dikenal → desk
    return { location: loc, status: ACH.STATUS[a.status] ? a.status : 'kerja', activity: a.activity || '', stale: false };
  }
  store.agentList = function () {
    const list = Object.values(store.agents);
    const seedIdx = (id) => { const p = ACH.PROFILE[id]; return p ? p.slot : 99; };
    list.sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999) || seedIdx(a.id) - seedIdx(b.id) || String(a.id).localeCompare(String(b.id)));
    // slot: pakai sort_order 1..MAX bila valid & unik, sisanya mengisi slot kosong berurutan
    const MAX = ACH.MAX_AGENTS, used = new Array(MAX).fill(null), rest = [];
    list.forEach((a) => { const so = a.sort_order; if (so >= 1 && so <= MAX && !used[so - 1]) used[so - 1] = a; else rest.push(a); });
    rest.forEach((a) => { const i = used.indexOf(null); if (i >= 0) used[i] = a; });
    const out = [];
    used.forEach((a, i) => { if (a) { a.slot = i; a.eff = effective(a); out.push(a); } });
    return out;
  };
  store.agentName = (id) => (store.agents[id] ? store.agents[id].name : id || 'Sistem');
  store.agentColor = (id) => (store.agents[id] ? store.agents[id].color : '#8a93a8');
  store.taskList = () => Object.values(store.tasks).sort((a, b) => Date.parse(b.updated_at || b.created_at || 0) - Date.parse(a.updated_at || a.created_at || 0));

  function setMode(m, err, short) {
    store.mode = m; store.error = err || null; store.errorShort = short || null;
    store.emit('mode', m);
  }
  function emitAll() { store.emit('agents'); store.emit('tasks'); store.emit('logs'); }

  /* ---------------- DEMO ---------------- */
  const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
  // tenggat contoh: besok (WIB) pada jam kerja, mis. 10.00 / 14.00 / 16.00 WIB
  const dueWib = (days, hour) => {
    const d = new Date(Date.now() + 7 * 3600e3 + days * 86400e3).toISOString().slice(0, 10);
    return new Date(d + 'T' + String(hour).padStart(2, '0') + ':00:00+07:00').toISOString();
  };
  const SEED_STATE = {
    chief: ['meeting', 'kerja', 'Memimpin sinkronisasi prioritas minggu ini', 'Rencana prioritas Q4'],
    research: ['desk', 'kerja', 'Membaca laporan riset pasar di pojok baca', 'Riset tren pasar Asia Tenggara'],
    ops: ['meeting', 'terjadwal', 'Presentasi dashboard metrik di kotatsu', 'Dashboard metrik operasional'],
    content: ['tea', 'istirahat', 'Seduh teh hijau sambil cari ide konten', 'Seri video "Sehari di Kantor"'],
    engineering: ['desk', 'kerja', 'Memantau server & deploy patch keamanan', 'Migrasi database ke region Jakarta'],
  };
  const TASK_POOL = {
    chief: ['Rencana prioritas Q4', 'Agenda rapat mingguan', 'Review laporan semua divisi', 'Memo arah strategi untuk direksi'],
    research: ['Riset tren pasar Asia Tenggara', 'Analisis kompetitor utama', 'Ringkasan 5 paper AI terbaru', 'Survei kepuasan pengguna'],
    ops: ['Dashboard metrik operasional', 'Rekap data penjualan mingguan', 'Otomasi laporan harian', 'Audit kualitas data CRM'],
    content: ['Seri video "Sehari di Kantor"', 'Kalender konten November', 'Caption & thumbnail minggu ini', 'Foto produk di pojok kamera'],
    engineering: ['Migrasi database ke region Jakarta', 'Perbaiki bug sinkronisasi realtime', 'Optimasi pipeline CI', 'Hardening keamanan server'],
  };
  const deskLabel = (id) => (ACH.PROFILE[id] ? ACH.PROFILE[id].homeLabel : 'meja');
  const EVENTS = [
    { loc: 'desk', status: 'kerja', w: 34, act: (t) => 'Fokus mengerjakan: ' + t, log: (t, id) => 'balik ke ' + deskLabel(id) + ', lanjut "' + t + '"' },
    { loc: 'meeting', status: 'terjadwal', w: 10, act: () => 'Rapat lintas divisi di kotatsu', log: () => 'gabung rapat di kotatsu' },
    { loc: 'tea', status: 'istirahat', w: 10, act: () => 'Seduh teh hijau di stasiun teh', log: () => 'menyeduh teh hijau di stasiun teh ☕' },
    { loc: 'ramen', status: 'istirahat', w: 6, act: () => 'Makan ramen di konter', log: () => 'makan ramen dulu di konter 🍜' },
    { loc: 'tatami', status: 'istirahat', w: 4, act: () => 'Power nap 20 menit di tatami', log: () => 'tidur siang sebentar di pojok tatami' },
    { loc: 'vending', status: 'santai', w: 5, act: () => 'Beli minuman dingin', log: () => 'jajan minuman di vending machine' },
    { loc: 'whiteboard', status: 'kerja', w: 7, act: (t) => 'Brainstorm di papan tulis: ' + t, log: () => 'corat-coret ide di papan tulis 💡' },
    { loc: 'offline', status: 'offline', w: 2, act: () => 'Keluar sebentar', log: () => 'keluar lewat noren, offline sebentar' },
  ];
  let demoTimer = null, uid = 1;
  const uuid = () => 'demo-' + Date.now().toString(36) + '-' + (uid++);

  function seedDemo() {
    store.agents = {}; store.tasks = {}; store.logs = [];
    ACH.AGENTS_SEED.forEach((a, i) => {
      const [loc, st, act, task] = SEED_STATE[a.id];
      store.agents[a.id] = { id: a.id, name: a.name, division: a.division, color: a.color, sort_order: i + 1, status: st, location: loc, activity: act, current_task: task, updated_at: iso(Math.random() * 600e3) };
      const pool = TASK_POOL[a.id];
      pool.forEach((title, k) => {
        const status = k === 0 ? 'Sedang kerja' : k === 1 || k === 2 ? 'Terjadwal' : 'Selesai';
        const id = uuid();
        store.tasks[id] = { id, agent_id: a.id, title, detail: 'Tugas divisi ' + a.division + '.', status, due_at: status === 'Terjadwal' ? dueWib(k, [10, 14, 16][(i + k) % 3]) : null, created_at: iso((k + 1) * 3600e3), updated_at: iso(k * 900e3 + Math.random() * 600e3) };
      });
    });
    const intro = [
      ['chief', 'membuka hari dengan stand-up di kotatsu', 'meeting', 95], ['engineering', 'deploy patch keamanan ke server ✔', 'desk', 80],
      ['content', 'menyeduh teh hijau di stasiun teh ☕', 'tea', 41], ['research', 'balik ke Pojok Baca, lanjut "Riset tren pasar Asia Tenggara"', 'desk', 33],
      ['ops', 'gabung rapat di kotatsu', 'meeting', 18], ['chief', 'gabung rapat di kotatsu', 'meeting', 17], ['engineering', 'menjadwalkan migrasi database jam 21.00', 'desk', 6],
    ];
    intro.forEach(([aid, msg, loc, minAgo], i) => store.logs.push({ id: 'd' + i, agent_id: aid, message: msg, location: loc, created_at: iso(minAgo * 60e3) }));
    store.logs.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  }
  function demoTick() {
    const ids = Object.keys(store.agents);
    const a = store.agents[ids[Math.floor(Math.random() * ids.length)]];
    let tot = EVENTS.reduce((s, e) => s + e.w, 0), r = Math.random() * tot, ev = EVENTS[0];
    for (const e of EVENTS) { r -= e.w; if (r <= 0) { ev = e; break; } }
    if (ev.loc === a.location) ev = EVENTS[0];
    const mine = Object.values(store.tasks).filter((t) => t.agent_id === a.id);
    let working = mine.find((t) => t.status === 'Sedang kerja');
    const now = new Date().toISOString();
    // alur tugas
    if (ev.loc === 'desk') {
      if (working && Math.random() < 0.4) {
        working.status = 'Selesai'; working.updated_at = now;
        pushLog(a.id, 'menyelesaikan tugas "' + working.title + '" ✔', 'desk');
        working = null;
      }
      if (!working) {
        const next = mine.find((t) => t.status === 'Terjadwal');
        if (next) { next.status = 'Sedang kerja'; next.updated_at = now; working = next; }
        else {
          const pool = TASK_POOL[a.id] || ['Tugas baru'];
          const id = uuid();
          working = store.tasks[id] = { id, agent_id: a.id, title: pool[Math.floor(Math.random() * pool.length)] + ' (lanjutan)', detail: 'Tugas baru dari demo.', status: 'Sedang kerja', due_at: null, created_at: now, updated_at: now };
        }
      }
      if (Math.random() < 0.3) {
        const pool = TASK_POOL[a.id] || ['Tugas baru'];
        const id = uuid();
        store.tasks[id] = { id, agent_id: a.id, title: pool[Math.floor(Math.random() * pool.length)] + ' #' + (2 + Math.floor(Math.random() * 8)), detail: 'Dijadwalkan otomatis (demo).', status: 'Terjadwal', due_at: dueWib(1 + Math.floor(Math.random() * 3), 9 + Math.floor(Math.random() * 8)), created_at: now, updated_at: now };
      }
    }
    const task = working ? working.title : a.current_task;
    Object.assign(a, { location: ev.loc, status: ev.status, activity: ev.act(task), current_task: task, updated_at: now });
    pushLog(a.id, ev.log(task, a.id), ev.loc);
    // bersihkan tugas selesai yang terlalu banyak
    const done = Object.values(store.tasks).filter((t) => t.status === 'Selesai').sort((x, y) => Date.parse(x.updated_at) - Date.parse(y.updated_at));
    while (done.length > 14) delete store.tasks[done.shift().id];
    store.emit('agents'); store.emit('tasks');
  }
  function pushLog(agent_id, message, location) {
    const row = { id: 'd' + Date.now() + Math.random(), agent_id, message, location, created_at: new Date().toISOString() };
    store.logs.unshift(row);
    if (store.logs.length > 150) store.logs.length = 150;
    store.emit('logs'); store.emit('log-added', row);
  }
  function scheduleDemo() {
    clearTimeout(demoTimer);
    demoTimer = setTimeout(() => { if (store.mode === 'demo' && !store.demoPaused) { demoTick(); scheduleDemo(); } }, 12000 + Math.random() * 14000);
  }
  function startDemo(err, short) {
    if (store.mode !== 'demo') {
      seedDemo();
      setMode('demo', err, short);
      emitAll();
      scheduleDemo();
    } else if (err !== store.error) setMode('demo', err, short); // perbarui alasan di badge
  }
  store.demoTick = demoTick; // dipakai untuk uji
  store.demoPause = () => { clearTimeout(demoTimer); store.demoPaused = true; };
  // dipakai untuk uji/screenshot: pindahkan agen demo ke ruangan tertentu
  store.demoMove = function (id, loc, status, act) {
    const a = store.agents[id];
    if (!a || store.mode !== 'demo') return false;
    const ev = EVENTS.find((e) => e.loc === loc) || EVENTS[0];
    Object.assign(a, { location: loc, status: status || ev.status, activity: act || ev.act(a.current_task), updated_at: new Date().toISOString() });
    pushLog(id, ev.log(a.current_task, id), loc);
    store.emit('agents');
    return true;
  };

  /* ---------------- LIVE (Supabase) ---------------- */
  let client = null, channel = null, retryTimer = null, pollTimer = null, failCount = 0;
  const configured = () => {
    const u = CFG.SUPABASE_URL || '', k = CFG.SUPABASE_ANON_KEY || '';
    return /^https:\/\/.+/.test(u) && k.length > 20 && !/YOUR|GANTI|xxxx/i.test(u + k);
  };
  const tagged = (msg, short) => Object.assign(new Error(msg), { short });
  // situs v2 butuh 5 agen baru; data v1 (9 agen markas bulan) → tetap DEMO sampai migrasi dijalankan
  function checkV2(rows) {
    const ids = new Set(rows.map((r) => r.id));
    const old = ACH.V1_IDS.filter((id) => ids.has(id));
    const missing = ACH.V2_IDS.filter((id) => !ids.has(id));
    if (old.length) throw tagged('Database masih versi lama (agen v1: ' + old.join(', ') + ') — jalankan supabase/migrate-v2-kantor.sql di SQL Editor', 'DB v1');
    if (missing.length) throw tagged('Agen v2 belum lengkap di ' + T_AGENTS + ' (kurang: ' + missing.join(', ') + ') — jalankan supabase/migrate-v2-kantor.sql', 'agen kurang');
  }
  async function fetchAll() {
    // cek tabel agen dulu (1 request) supaya tidak membanjiri console bila skema belum dijalankan
    const a = await client.from(T_AGENTS).select('*');
    if (a.error) throw tagged(a.error.message || a.error.code || 'Query gagal', /does not exist|schema cache|not find/i.test(a.error.message || '') ? 'tabel belum ada' : 'gagal query');
    if (!a.data || !a.data.length) throw tagged('Tabel ' + T_AGENTS + ' masih kosong — jalankan supabase/schema.sql', 'tabel kosong');
    checkV2(a.data);
    const [t, l] = await Promise.all([
      client.from(T_TASKS).select('*').order('updated_at', { ascending: false }).limit(300),
      client.from(T_LOGS).select('*').order('created_at', { ascending: false }).limit(150),
    ]);
    const err = t.error || l.error;
    if (err) throw new Error(err.message || err.code || 'Query gagal');
    return { agents: a.data, tasks: t.data || [], logs: l.data || [] };
  }
  function applyAll(d) {
    store.agents = {}; d.agents.forEach((r) => (store.agents[r.id] = r));
    store.tasks = {}; d.tasks.forEach((r) => (store.tasks[r.id] = r));
    store.logs = d.logs.slice();
  }
  function subscribe() {
    if (channel) return;
    channel = client
      .channel('ach-office-' + Math.random().toString(36).slice(2, 8))
      .on('postgres_changes', { event: '*', schema: 'public', table: T_AGENTS }, (p) => {
        if (p.eventType === 'DELETE') delete store.agents[p.old.id]; else store.agents[p.new.id] = p.new;
        store.emit('agents');
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: T_TASKS }, (p) => {
        if (p.eventType === 'DELETE') delete store.tasks[p.old.id]; else store.tasks[p.new.id] = p.new;
        store.emit('tasks');
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: T_LOGS }, (p) => {
        if (p.eventType === 'INSERT') {
          if (!store.logs.some((x) => x.id === p.new.id)) { store.logs.unshift(p.new); if (store.logs.length > 150) store.logs.length = 150; store.emit('logs'); store.emit('log-added', p.new); }
        } else if (p.eventType === 'DELETE') { store.logs = store.logs.filter((x) => x.id !== p.old.id); store.emit('logs'); }
      })
      .subscribe((status) => { store.realtime = status; store.emit('mode', store.mode); });
  }
  async function tryLive() {
    clearTimeout(retryTimer);
    try {
      if (!client) client = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
      const d = await fetchAll();
      clearTimeout(demoTimer);
      applyAll(d);
      failCount = 0;
      setMode('live');
      emitAll();
      subscribe();
      clearInterval(pollTimer);
      pollTimer = setInterval(poll, CFG.POLL_SECONDS * 1000);
    } catch (e) {
      console.warn('[ACHPHORIA] Supabase belum siap → mode DEMO:', e.message || e);
      startDemo(e.message || String(e), e.short || 'offline');
      retryTimer = setTimeout(tryLive, CFG.RETRY_SECONDS * 1000);
    }
  }
  async function poll() {
    if (store.mode !== 'live') return;
    try { applyAll(await fetchAll()); failCount = 0; emitAll(); }
    catch (e) {
      if (++failCount >= 2) {
        clearInterval(pollTimer);
        if (channel) { client.removeChannel(channel); channel = null; }
        store.mode = 'x'; startDemo(e.message, e.short || 'putus'); retryTimer = setTimeout(tryLive, CFG.RETRY_SECONDS * 1000);
      }
    }
  }

  store.start = function () {
    const forceDemo = /[?&]demo=1/.test(location.search);
    if (forceDemo) return startDemo('Mode demo dipaksa lewat ?demo=1', '?demo=1');
    if (!configured()) return startDemo('config.js belum diisi', 'tanpa config');
    if (!window.supabase || !window.supabase.createClient) return startDemo('Library Supabase gagal dimuat', 'lib gagal');
    // tampilkan demo dulu supaya langsung hidup, lalu coba LIVE
    startDemo('Menghubungkan ke Supabase…', 'menghubungkan');
    tryLive();
  };
  // evaluasi ulang jadwal tiap menit
  setInterval(() => store.emit('agents'), 60000);
})();
