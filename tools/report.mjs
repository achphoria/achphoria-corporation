#!/usr/bin/env node
/**
 * ACHPHORIA — CLI laporan aktivitas agen (Node 18+, tanpa dependensi)
 *
 * Env:
 *   SUPABASE_URL                 https://xxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY    secret key (sb_secret_...) atau service_role JWT lama
 *                                (alias: SUPABASE_SECRET_KEY)
 *   ⚠️ Key ini RAHASIA: hanya untuk agen/server, JANGAN taruh di website / config.js.
 *
 * Contoh:
 *   node tools/report.mjs --agent commander --status kerja --location meeting \
 *     --activity "Memimpin rapat mingguan" --task "Sinkronisasi OKR Q4" \
 *     --task-status "Sedang kerja" --log "mulai rapat di Meeting Room"
 *
 *   node tools/report.mjs commander santai kantin "Ngopi dulu"          # bentuk singkat (posisional)
 *
 * Kunci lokasi : desk meeting kantin arcade gym sleep shower dance outdoor command rocket
 *                ('' = kosongkan → website pakai jadwal harian otomatis)
 * Status       : kerja terjadwal santai istirahat offline
 * Status tugas : "Sedang kerja" | "Terjadwal" | "Selesai"
 */
const HELP = `Pemakaian:
  node tools/report.mjs --agent <id> [--status <s>] [--location <ruang>] [--activity <teks>]
                        [--task <judul>] [--task-status <"Sedang kerja"|Terjadwal|Selesai>] [--log <pesan>]
  node tools/report.mjs <agent> <status> <location> <activity> [task] [task_status] [log]

Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (atau SUPABASE_SECRET_KEY)`;

const ROOMS = ['desk', 'meeting', 'kantin', 'arcade', 'gym', 'sleep', 'shower', 'dance', 'outdoor', 'command', 'rocket'];
const STATUSES = ['kerja', 'terjadwal', 'santai', 'istirahat', 'offline'];
const TASK_STATUSES = ['Sedang kerja', 'Terjadwal', 'Selesai'];

function parse(argv) {
  const out = {}, pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { out.help = true; continue; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const k = (eq > 0 ? a.slice(2, eq) : a.slice(2)).replace(/-/g, '_');
      out[k] = eq > 0 ? a.slice(eq + 1) : argv[++i];
    } else pos.push(a);
  }
  const names = ['agent', 'status', 'location', 'activity', 'task', 'task_status', 'log'];
  pos.forEach((v, i) => { if (names[i] && out[names[i]] === undefined) out[names[i]] = v; });
  return out;
}

const args = parse(process.argv.slice(2));
if (args.help || !args.agent) { console.log(HELP); process.exit(args.help ? 0 : 1); }

const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';
if (!url || !key) { console.error('✖ Set env SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY terlebih dahulu.'); process.exit(1); }
if (key.startsWith('sb_publishable_')) { console.error('✖ Itu publishable key (hanya baca). Pakai secret / service_role key.'); process.exit(1); }

if (args.status && !STATUSES.includes(args.status)) { console.error('✖ Status tidak valid. Pilih: ' + STATUSES.join(', ')); process.exit(1); }
if (args.location && !ROOMS.includes(args.location)) { console.error('✖ Lokasi tidak valid. Pilih: ' + ROOMS.join(', ')); process.exit(1); }
if (args.task_status && !TASK_STATUSES.includes(args.task_status)) { console.error('✖ Status tugas tidak valid. Pilih: ' + TASK_STATUSES.join(' | ')); process.exit(1); }

const body = {
  p_agent_id: args.agent,
  p_status: args.status ?? null,
  p_location: args.location ?? null,
  p_activity: args.activity ?? null,
  p_task: args.task ?? null,
  p_task_status: args.task_status ?? null,
  p_log: args.log ?? null,
};
const headers = { apikey: key, 'Content-Type': 'application/json' };
// key lama (JWT service_role) juga dikirim sebagai Bearer; secret key baru (sb_secret_) cukup di header apikey
if (!key.startsWith('sb_')) headers.Authorization = 'Bearer ' + key;

try {
  const res = await fetch(`${url}/rest/v1/rpc/ach_report_activity`, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) { console.error(`✖ HTTP ${res.status}: ${text}`); process.exit(2); }
  console.log('✔ Terkirim:', text);
} catch (e) {
  console.error('✖ Gagal menghubungi Supabase:', e.message);
  process.exit(2);
}
