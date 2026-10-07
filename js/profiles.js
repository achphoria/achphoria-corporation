/* Profil visual agen, label ruangan & status */
(function () {
  const ACH = window.ACH;

  // Urutan = posisi modul (lantai 1 kiri→kanan, lantai 2, lantai 3)
  ACH.AGENTS_SEED = [
    { id: 'commander', name: 'Commander', division: 'Chief of Staff', color: '#ffc940', hair: '#3a2416', skin: '#f2c49b', prop: 'coat', icon: 'crown' },
    { id: 'engineering', name: 'Engineer', division: 'Engineering', color: '#2ee6c5', hair: '#16161f', skin: '#e9b98f', prop: 'wrench', icon: 'gear' },
    { id: 'research', name: 'Researcher', division: 'Research & Data', color: '#3dd6ff', hair: '#1e2c66', skin: '#f3c9a3', prop: 'tablet', icon: 'chart' },
    { id: 'marketing', name: 'Marketer', division: 'Marketing & Growth', color: '#ff5fa2', hair: '#5a3220', skin: '#f5caa6', prop: 'headset', icon: 'mega' },
    { id: 'content', name: 'Creator', division: 'Content & Creative', color: '#ff9a3d', hair: '#a8401e', skin: '#f2c29a', prop: 'camera', icon: 'cam' },
    { id: 'sales', name: 'Closer', division: 'Sales & Partnership', color: '#4d7dff', hair: '#121420', skin: '#e3b088', prop: 'briefcase', icon: 'hand' },
    { id: 'finance', name: 'Treasurer', division: 'Finance', color: '#ffe14d', hair: '#1a1a22', skin: '#f0c49c', prop: 'glasses', icon: 'coin' },
    { id: 'success', name: 'Helper', division: 'Customer Success', color: '#6dff7a', hair: '#6b4426', skin: '#f2c8a0', prop: 'robot', icon: 'heart' },
    { id: 'hr', name: 'Counsel', division: 'HR & Legal', color: '#b46bff', hair: '#1c1d3a', skin: '#ecbd96', prop: 'clipboard', icon: 'scale' },
  ];
  ACH.PROFILE = {};
  ACH.AGENTS_SEED.forEach((a, i) => (ACH.PROFILE[a.id] = Object.assign({ slot: i }, a)));

  ACH.ROOM_KEYS = ['desk', 'meeting', 'kantin', 'arcade', 'gym', 'sleep', 'shower', 'dance', 'outdoor', 'command', 'rocket'];
  ACH.ROOM_LABEL = {
    desk: 'Meja Kerja',
    meeting: 'Meeting Room',
    kantin: 'Kantin',
    arcade: 'Arcade',
    gym: 'Gym',
    sleep: 'Sleep Pod',
    shower: 'Shower',
    dance: 'Dance Floor',
    outdoor: 'Kubah Luar',
    command: 'Menara Komando',
    rocket: 'Landasan Roket',
  };
  ACH.STATUS = {
    kerja: { label: 'Kerja', color: '#5dff8a' },
    terjadwal: { label: 'Terjadwal', color: '#5cb8ff' },
    santai: { label: 'Santai', color: '#ffd84d' },
    istirahat: { label: 'Istirahat', color: '#c08bff' },
    offline: { label: 'Offline', color: '#7d8494' },
  };
  ACH.TASK_COLS = ['Sedang kerja', 'Terjadwal', 'Selesai'];

  // fallback jadwal harian WIB (dipakai bila lokasi kosong / basi)
  ACH.scheduleFor = function (agentId, date) {
    const { h, dayKey } = ACH.wibNow(date);
    const idx = ACH.PROFILE[agentId] ? ACH.PROFILE[agentId].slot : Math.floor(ACH.hash2(agentId.length, agentId.charCodeAt(0)) * 9);
    const r = ACH.hash2(idx, dayKey, 7); // variasi per hari
    const evening = ['dance', 'outdoor', 'arcade', 'dance', 'outdoor', 'kantin'];
    const afternoon = ['gym', 'arcade', 'desk', 'gym', 'desk'];
    let loc, status, act;
    if (h < 6) { loc = 'sleep'; status = 'istirahat'; act = 'Tidur nyenyak di sleep pod'; }
    else if (h < 6.75) { loc = 'gym'; status = 'santai'; act = 'Olahraga pagi, low-gravity style'; }
    else if (h < 7.25) { loc = 'shower'; status = 'santai'; act = 'Mandi pagi sebelum kerja'; }
    else if (h < 8) { loc = 'kantin'; status = 'santai'; act = 'Sarapan di kantin'; }
    else if (h < 9) { loc = 'desk'; status = 'kerja'; act = 'Cek inbox & prioritas hari ini'; }
    else if (h < 9.5) { loc = 'meeting'; status = 'terjadwal'; act = 'Daily stand-up bareng semua divisi'; }
    else if (h < 12) { loc = idx === 0 && r > 0.6 ? 'command' : 'desk'; status = 'kerja'; act = 'Fokus kerja di modul'; }
    else if (h < 13) { loc = 'kantin'; status = 'istirahat'; act = 'Makan siang di kantin'; }
    else if (h < 15.5) { loc = 'desk'; status = 'kerja'; act = 'Lanjut kerja sesi siang'; }
    else if (h < 16.5) { loc = afternoon[Math.floor(r * afternoon.length)]; status = loc === 'desk' ? 'kerja' : 'santai'; act = loc === 'desk' ? 'Beresin kerjaan sore' : 'Rehat sore sebentar'; }
    else if (h < 18) { loc = 'desk'; status = 'kerja'; act = 'Wrap-up & laporan harian'; }
    else if (h < 19) { loc = 'kantin'; status = 'istirahat'; act = 'Makan malam di kantin'; }
    else if (h < 21) { loc = evening[Math.floor(r * evening.length)]; if (idx === 5 && r > 0.5) loc = 'rocket'; status = 'santai'; act = 'Santai malam di base'; }
    else if (h < 22) { loc = 'shower'; status = 'santai'; act = 'Mandi sebelum tidur'; }
    else { loc = 'sleep'; status = 'istirahat'; act = 'Tidur di sleep pod'; }
    return { location: loc, status, activity: act };
  };
})();
