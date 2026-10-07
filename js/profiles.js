/* Profil agen, kunci ruangan, status & jadwal fallback WIB */
(function () {
  const ACH = window.ACH;

  // 5 agen v2 — nama tampilan = nama divisi. home = zona "desk" milik agen.
  ACH.AGENTS_SEED = [
    { id: 'chief', name: 'Chief of Staff', division: 'Chief of Staff', color: '#d98c8c', prop: 'gulungan', home: 'kotatsu', homeLabel: 'Kotatsu' },
    { id: 'research', name: 'Research', division: 'Research', color: '#8fb8de', prop: 'tumpukan buku', home: 'nook', homeLabel: 'Pojok Baca' },
    { id: 'ops', name: 'Ops & Data', division: 'Ops & Data', color: '#8fae8b', prop: 'tablet grafik', home: 'desk', homeLabel: 'Meja Multi-Monitor' },
    { id: 'content', name: 'Content & Marketing', division: 'Content & Marketing', color: '#a8a29a', prop: 'secangkir teh', home: 'studio', homeLabel: 'Pojok Konten (corkboard & kamera)' },
    { id: 'engineering', name: 'Engineering', division: 'Engineering', color: '#e0a64a', prop: 'obeng', home: 'server', homeLabel: 'Booth Server' },
  ];
  ACH.V2_IDS = ACH.AGENTS_SEED.map((a) => a.id);
  ACH.V1_IDS = ['commander', 'marketing', 'sales', 'finance', 'success', 'hr'];
  ACH.PROFILE = {};
  ACH.AGENTS_SEED.forEach((a, i) => (ACH.PROFILE[a.id] = Object.assign({ slot: i }, a)));
  ACH.MAX_AGENTS = 8;

  ACH.ROOM_KEYS = ['desk', 'meeting', 'tea', 'ramen', 'tatami', 'vending', 'whiteboard', 'offline'];
  ACH.ROOM_LABEL = {
    desk: 'Meja Kerja',
    meeting: 'Rapat di Kotatsu',
    tea: 'Stasiun Teh',
    ramen: 'Konter Ramen',
    tatami: 'Pojok Tatami',
    vending: 'Mesin Minuman',
    whiteboard: 'Papan Tulis',
    offline: 'Pulang (Noren)',
  };
  ACH.roomLabel = (loc, agentId) => {
    if (loc === 'desk' && ACH.PROFILE[agentId]) return ACH.PROFILE[agentId].homeLabel;
    return ACH.ROOM_LABEL[loc] || loc || '—';
  };
  ACH.STATUS = {
    kerja: { label: 'Kerja', color: '#5f9e6e' },
    terjadwal: { label: 'Terjadwal', color: '#4a6fa5' },
    santai: { label: 'Santai', color: '#d39b3a' },
    istirahat: { label: 'Istirahat', color: '#a8739a' },
    offline: { label: 'Offline', color: '#9a9389' },
  };
  ACH.TASK_COLS = ['Sedang kerja', 'Terjadwal', 'Selesai'];

  /* ------------------------------------------------------------------
     Jadwal fallback harian (WIB) — dipakai bila lokasi agen kosong atau
     update terakhir lebih tua dari STALE_HOURS. Variasi per hari & agen
     (deterministik, jadi semua pengunjung melihat hal yang sama).
     ------------------------------------------------------------------ */
  const S = (location, status, activity) => ({ location, status, activity });
  ACH.scheduleFor = function (agentId, date) {
    const { h, dayKey, weekday } = ACH.wibNow(date);
    const idx = ACH.PROFILE[agentId] ? ACH.PROFILE[agentId].slot : Math.floor(ACH.hash2(agentId.length, agentId.charCodeAt(0)) * 5);
    const r = ACH.hash2(idx, dayKey, 7);          // acak per agen per hari
    const turn = (dayKey + idx) % 5;              // giliran rotasi 0..4
    const weekend = weekday === 'Sat' || weekday === 'Sun';
    const friday = weekday === 'Fri';

    if (weekend) {
      if (agentId === 'engineering' && h >= 10 && h < 11) return S('desk', 'kerja', 'Cek server akhir pekan');
      return S('offline', 'offline', 'Libur akhir pekan');
    }
    if (h < 7.5) return S('offline', 'offline', 'Belum masuk kantor');
    if (h < 8.5) return turn < 2 ? S('tea', 'santai', 'Teh pagi sebelum mulai kerja') : S('desk', 'kerja', 'Datang pagi, cek inbox');
    if (h < 9) return S('desk', 'kerja', 'Cek inbox & prioritas hari ini');
    if (h < 9.5) return S('meeting', 'terjadwal', 'Stand-up pagi di kotatsu');
    if (h < 10.5) return S('desk', 'kerja', 'Fokus kerja sesi pagi');
    if (h < 10.84) return turn === 0 || turn === 3 ? S('tea', 'istirahat', 'Rehat teh pagi') : S('desk', 'kerja', 'Fokus kerja sesi pagi');
    if (h < 12) {
      if ((agentId === 'chief' || agentId === 'ops') && r > 0.5 && h >= 11 && h < 11.67) return S('whiteboard', 'kerja', 'Rencana sprint di papan tulis');
      return S('desk', 'kerja', 'Lanjut kerja sebelum makan siang');
    }
    if (h < 13) return S('ramen', 'istirahat', 'Makan siang ramen bareng');
    if (h < 14.5) return S('desk', 'kerja', 'Kerja sesi siang');
    if (h < 15) return r < 0.4 ? S('tatami', 'istirahat', 'Tidur siang 20 menit di tatami') : S('desk', 'kerja', 'Kerja sesi siang');
    if (h < 15.34) return turn === 1 || turn === 4 ? S('vending', 'santai', 'Jajan camilan jam tiga') : S('desk', 'kerja', 'Kerja sesi siang');
    if (h < 16) return S('desk', 'kerja', 'Kerja sesi sore');
    if (h < 16.34) return turn === 2 || turn === 0 ? S('tea', 'istirahat', 'Rehat teh sore') : S('desk', 'kerja', 'Kerja sesi sore');
    if (friday && h >= 16.5 && h < 17) return S('meeting', 'terjadwal', 'Retro mingguan di kotatsu');
    if (h < 17.5) return S('desk', 'kerja', 'Kerja sesi sore');
    if (h < 18) return agentId === 'chief' ? S('whiteboard', 'kerja', 'Rekap harian di papan tulis') : S('desk', 'kerja', 'Wrap-up & laporan harian');
    if (h < 19 && (agentId === 'engineering' || (agentId === 'content' && r > 0.5))) return S('desk', 'kerja', 'Lembur sebentar');
    return S('offline', 'offline', 'Sudah pulang');
  };
})();
