/* Data: Supabase (LIVE) dengan fallback DEMO otomatis */
(function () {
  const ACH = window.ACH;
  const CFG = Object.assign({ TABLE_PREFIX: 'ach_', STALE_HOURS: 3, RETRY_SECONDS: 30, POLL_SECONDS: 60 }, window.ACH_CONFIG || {});
  const P = CFG.TABLE_PREFIX;
  const T_AGENTS = P + 'agents', T_TASKS = P + 'tasks', T_LOGS = P + 'logs';

  const store = (ACH.store = { mode: 'connecting', agents: {}, tasks: {}, logs: [], error: null, ev: {} });
  store.on = (e, f) => (store.ev[e] = store.ev[e] || []).push(f);
  store.emit = (e, d) => (store.ev[e] || []).forEach((f) => { try { f(d); } catch (err) { console.error(err); } });

  /* ---------------- normalisasi ---------------- */
  function effective(a) {
    const age = a.updated_at ? Date.now() - Date.parse(a.updated_at) : Infinity;
    const stale = !(age < CFG.STALE_HOURS * 3600e3);
    if (a.status === 'offline' && !stale) return { location: 'sleep', status: 'offline', activity: a.activity || 'Sedang offline', stale: false };
    if (!a.location || stale) {
      const s = ACH.scheduleFor(a.id);
      return Object.assign(s, { stale: true });
    }
    const loc = ACH.ROOM_KEYS.includes(a.location) ? a.location : 'desk';
    return { location: loc, status: ACH.STATUS[a.status] ? a.status : 'kerja', activity: a.activity || '', stale: false };
  }
  store.agentList = function () {
    const list = Object.values(store.agents);
    const seedIdx = (id) => { const p = ACH.PROFILE[id]; return p ? p.slot : 99; };
    list.sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999) || seedIdx(a.id) - seedIdx(b.id) || String(a.id).localeCompare(String(b.id)));
    // slot modul: pakai sort_order 1..9 bila valid & unik, sisanya mengisi slot kosong berurutan
    const used = new Array(9).fill(null), rest = [];
    list.forEach((a) => { const so = a.sort_order; if (so >= 1 && so <= 9 && !used[so - 1]) used[so - 1] = a; else rest.push(a); });
    rest.forEach((a) => { const i = used.indexOf(null); if (i >= 0) used[i] = a; });
    const out = [];
    used.forEach((a, i) => { if (a) { a.slot = i; a.eff = effective(a); out.push(a); } });
    return out;
  };
  store.agentName = (id) => (store.agents[id] ? store.agents[id].name : id || 'Sistem');
  store.agentColor = (id) => (store.agents[id] ? store.agents[id].color : '#8a93a8');
  store.taskList = () => Object.values(store.tasks).sort((a, b) => Date.parse(b.updated_at || b.created_at || 0) - Date.parse(a.updated_at || a.created_at || 0));

  function setMode(m, err) {
    store.mode = m; store.error = err || null;
    store.emit('mode', m);
  }
  function emitAll() { store.emit('agents'); store.emit('tasks'); store.emit('logs'); }

  /* ---------------- DEMO ---------------- */
  const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
  const SEED_STATE = {
    commander: ['meeting', 'kerja', 'Memimpin rapat koordinasi mingguan', 'Sinkronisasi OKR Q4'],
    engineering: ['desk', 'kerja', 'Deploy fitur realtime ke production', 'Migrasi server ke region baru'],
    research: ['meeting', 'kerja', 'Presentasi insight data pengguna', 'Analisis retensi bulan ini'],
    marketing: ['desk', 'kerja', 'Nyiapin kampanye peluncuran', 'Kampanye "Moon Week"'],
    content: ['outdoor', 'santai', 'Rekam konten main bola bareng alien', 'Video behind-the-scenes base'],
    sales: ['desk', 'kerja', 'Follow-up calon partner dari Bumi', 'Proposal kemitraan Lunar Logistics'],
    finance: ['kantin', 'istirahat', 'Ngopi sambil cek cashflow', 'Rekap budget Q4'],
    success: ['gym', 'santai', 'Angkat beban slow-motion (gravitasi 1/6!)', 'Balas tiket pelanggan prioritas'],
    hr: ['desk', 'terjadwal', 'Review kontrak kerja sama', 'Update SOP keselamatan base'],
  };
  const TASK_POOL = {
    commander: ['Sinkronisasi OKR Q4', 'Siapkan agenda all-hands', 'Review laporan semua divisi', 'Rencana ekspansi modul baru'],
    engineering: ['Migrasi server ke region baru', 'Perbaiki bug sensor oksigen', 'Optimasi pipeline CI', 'Upgrade firmware lift kaca'],
    research: ['Analisis retensi bulan ini', 'Dashboard metrik alien-friendly', 'Riset tren pasar Q4', 'Survei kepuasan kru'],
    marketing: ['Kampanye "Moon Week"', 'Jadwal konten media sosial', 'A/B test landing page', 'Brief kolaborasi influencer'],
    content: ['Video behind-the-scenes base', 'Desain banner peluncuran', 'Podcast episode 12', 'Foto produk di kubah luar'],
    sales: ['Proposal kemitraan Lunar Logistics', 'Follow-up 5 lead hangat', 'Demo produk untuk klien Mars', 'Negosiasi kontrak tahunan'],
    finance: ['Rekap budget Q4', 'Rekonsiliasi invoice', 'Proyeksi cashflow 6 bulan', 'Audit pengeluaran oksigen'],
    success: ['Balas tiket pelanggan prioritas', 'Onboarding klien baru', 'Update FAQ pusat bantuan', 'Telepon check-in pelanggan VIP'],
    hr: ['Update SOP keselamatan base', 'Review kontrak kerja sama', 'Rekrutmen kru gelombang 3', 'Program wellness kru'],
  };
  const EVENTS = [
    { loc: 'desk', status: 'kerja', w: 34, act: (t) => 'Fokus mengerjakan: ' + t, log: (t) => 'balik ke meja, lanjut "' + t + '"' },
    { loc: 'meeting', status: 'terjadwal', w: 9, act: () => 'Rapat koordinasi lintas divisi', log: () => 'mulai rapat di Meeting Room' },
    { loc: 'kantin', status: 'istirahat', w: 9, act: () => 'Ngopi & ngemil di kantin', log: () => 'istirahat sebentar di Kantin' },
    { loc: 'gym', status: 'santai', w: 6, act: () => 'Olahraga low-gravity di gym', log: () => 'olahraga dulu di Gym' },
    { loc: 'arcade', status: 'santai', w: 6, act: () => 'Main game retro, cari high score', log: () => 'main game sebentar di Arcade' },
    { loc: 'dance', status: 'santai', w: 5, act: () => 'Joget melayang di dance floor', log: () => 'turun ke Dance Floor' },
    { loc: 'outdoor', status: 'santai', w: 7, act: () => 'Lempar bola bareng alien di kubah', log: () => 'keluar ke Kubah Luar, main bareng alien' },
    { loc: 'sleep', status: 'istirahat', w: 4, act: () => 'Power nap 20 menit', log: () => 'power nap di Sleep Pod' },
    { loc: 'shower', status: 'santai', w: 3, act: () => 'Mandi biar segar lagi', log: () => 'mandi dulu di Shower' },
    { loc: 'command', status: 'kerja', w: 4, act: () => 'Pantau radar & komunikasi ke Bumi', log: () => 'naik ke Menara Komando' },
    { loc: 'rocket', status: 'kerja', w: 3, act: () => 'Inspeksi roket logistik', log: () => 'cek roket di Landasan Roket' },
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
        store.tasks[id] = { id, agent_id: a.id, title, detail: 'Tugas divisi ' + a.division + '.', status, due_at: status === 'Terjadwal' ? new Date(Date.now() + (k + 1) * 3 * 3600e3).toISOString() : null, created_at: iso((k + 1) * 3600e3), updated_at: iso(k * 900e3 + Math.random() * 600e3) };
      });
    });
    const intro = [
      ['commander', 'membuka hari dengan briefing singkat', 'meeting', 110], ['engineering', 'deploy hotfix sensor oksigen ✔', 'desk', 95],
      ['finance', 'istirahat sebentar di Kantin', 'kantin', 70], ['success', 'olahraga dulu di Gym', 'gym', 52],
      ['content', 'keluar ke Kubah Luar, main bareng alien', 'outdoor', 40], ['research', 'mulai rapat di Meeting Room', 'meeting', 25],
      ['commander', 'mulai rapat di Meeting Room', 'meeting', 24], ['sales', 'kirim proposal ke Lunar Logistics', 'desk', 12], ['hr', 'menjadwalkan review kontrak jam 17.00', 'desk', 6],
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
        store.tasks[id] = { id, agent_id: a.id, title: pool[Math.floor(Math.random() * pool.length)] + ' #' + (2 + Math.floor(Math.random() * 8)), detail: 'Dijadwalkan otomatis (demo).', status: 'Terjadwal', due_at: new Date(Date.now() + (2 + Math.random() * 20) * 3600e3).toISOString(), created_at: now, updated_at: now };
      }
    }
    const task = working ? working.title : a.current_task;
    Object.assign(a, { location: ev.loc, status: ev.status, activity: ev.act(task), current_task: task, updated_at: now });
    pushLog(a.id, ev.log(task), ev.loc);
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
    demoTimer = setTimeout(() => { if (store.mode === 'demo') { demoTick(); scheduleDemo(); } }, 20000 + Math.random() * 20000);
  }
  function startDemo(err) {
    if (store.mode !== 'demo') {
      seedDemo();
      setMode('demo', err);
      emitAll();
      scheduleDemo();
    }
  }
  store.demoTick = demoTick; // dipakai untuk uji

  /* ---------------- LIVE (Supabase) ---------------- */
  let client = null, channel = null, retryTimer = null, pollTimer = null, failCount = 0;
  const configured = () => {
    const u = CFG.SUPABASE_URL || '', k = CFG.SUPABASE_ANON_KEY || '';
    return /^https:\/\/.+/.test(u) && k.length > 20 && !/YOUR|GANTI|xxxx/i.test(u + k);
  };
  async function fetchAll() {
    // cek tabel agen dulu (1 request) supaya tidak membanjiri console bila skema belum dijalankan
    const a = await client.from(T_AGENTS).select('*');
    if (a.error) throw new Error(a.error.message || a.error.code || 'Query gagal');
    const [t, l] = await Promise.all([
      client.from(T_TASKS).select('*').order('updated_at', { ascending: false }).limit(300),
      client.from(T_LOGS).select('*').order('created_at', { ascending: false }).limit(150),
    ]);
    const err = t.error || l.error;
    if (err) throw new Error(err.message || err.code || 'Query gagal');
    if (!a.data || !a.data.length) throw new Error('Tabel ' + T_AGENTS + ' masih kosong');
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
      startDemo(e.message || String(e));
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
        store.mode = 'x'; startDemo(e.message); retryTimer = setTimeout(tryLive, CFG.RETRY_SECONDS * 1000);
      }
    }
  }

  store.start = function () {
    const forceDemo = /[?&]demo=1/.test(location.search);
    if (forceDemo) return startDemo('Mode demo dipaksa lewat ?demo=1');
    if (!configured()) return startDemo('config.js belum diisi');
    if (!window.supabase || !window.supabase.createClient) return startDemo('Library Supabase gagal dimuat');
    // tampilkan demo dulu supaya langsung hidup, lalu coba LIVE
    startDemo('Menghubungkan ke Supabase…');
    tryLive();
  };
  // evaluasi ulang jadwal tiap menit
  setInterval(() => store.emit('agents'), 60000);
})();
