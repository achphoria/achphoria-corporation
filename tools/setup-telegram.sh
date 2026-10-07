#!/usr/bin/env bash
# =====================================================================
#  ACHPHORIA · setup 5 bot Telegram untuk jembatan ach-bridge
# ---------------------------------------------------------------------
#  Membaca (env diutamakan, lalu ~/.config/achphoria/bridge.env):
#    TG_TOKEN_CHIEF TG_TOKEN_RESEARCH TG_TOKEN_OPS TG_TOKEN_CONTENT TG_TOKEN_ENGINEERING
#    TG_WEBHOOK_SECRET   (dibuat oleh tools/deploy-bridge.sh)
#  Untuk tiap bot yang token-nya ada:
#    getMe (cek username) · setWebhook → .../functions/v1/ach-bridge/tg/<id>
#      (secret_token, allowed_updates [message, edited_message, callback_query, my_chat_member],
#       drop_pending_updates) · setMyCommands (/status /tugas /help)
#    · setMyDescription + setMyShortDescription (Indonesia) · ringkasan getWebhookInfo
#  Token & secret TIDAK pernah dicetak dan tidak muncul di argv (dipakai di dalam proses node).
#
#  Pemakaian:
#    tools/setup-telegram.sh              semua bot yang token-nya tersedia
#    tools/setup-telegram.sh --bot ops    satu bot saja
#    tools/setup-telegram.sh --info       hanya tampilkan getWebhookInfo
#    tools/setup-telegram.sh --dry-run    tampilkan rencana tanpa memanggil Telegram
#  Env opsional: PROJECT_REF (default ckoejqzownrujikefgwb), ACH_BRIDGE_URL, ACH_CONF_DIR,
#                TG_API_BASE (hanya untuk tes dengan server tiruan)
# =====================================================================
set -euo pipefail
command -v node >/dev/null || { echo "✖ node (18+) diperlukan" >&2; exit 1; }
export ACH_SETUP_ARGS="$*"
export ACH_CONF_DIR="${ACH_CONF_DIR:-$HOME/.config/achphoria}"
exec node --input-type=module - <<'JS'
import { readFileSync, existsSync } from 'node:fs';

const AGENTS = ['chief', 'research', 'ops', 'content', 'engineering'];
const args = (process.env.ACH_SETUP_ARGS || '').split(/\s+/).filter(Boolean);
const flag = (f) => args.includes(f);
const only = args.includes('--bot') ? args[args.indexOf('--bot') + 1] : null;
if (only && !AGENTS.includes(only)) { console.error('✖ --bot harus salah satu: ' + AGENTS.join(', ')); process.exit(1); }

// muat bridge.env (KEY=VALUE, tanpa eksekusi shell), env proses menang
const file = process.env.ACH_CONF_DIR + '/bridge.env';
const conf = {};
if (existsSync(file)) {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) conf[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
const get = (k) => process.env[k] || conf[k] || '';
const REF = process.env.PROJECT_REF || 'ckoejqzownrujikefgwb';
const BRIDGE = (process.env.ACH_BRIDGE_URL || `https://${REF}.supabase.co/functions/v1/ach-bridge`).replace(/\/+$/, '');
const SECRET = get('TG_WEBHOOK_SECRET');

const INFO = {
  chief: {
    short: 'Chief of Staff ACHPHORIA: koordinasi tim, prioritas & delegasi. Bot privat tim internal.',
    desc: 'Halo! Aku Chief of Staff ACHPHORIA CORPORATION 📜\n\nAku mengoordinasi kelima divisi, menyusun prioritas, dan mendelegasikan tugas ke Research, Ops & Data, Content & Marketing, dan Engineering. Di grup ACHPHORIA HQ aku penerima default.\n\nPerintah: /status · /tugas · /help\n\nBot ini privat untuk tim internal.',
  },
  research: {
    short: 'Divisi Research ACHPHORIA: riset pasar, tren & ringkasan. Bot privat tim internal.',
    desc: 'Halo! Aku divisi Research ACHPHORIA CORPORATION 📚\n\nTugasku riset pasar, tren, kompetitor, dan merangkum bacaan penting untuk tim.\n\nPerintah: /status · /tugas · /help\nDi grup, mention aku atau balas pesanku.\n\nBot ini privat untuk tim internal.',
  },
  ops: {
    short: 'Divisi Ops & Data ACHPHORIA: operasional, data & dashboard. Bot privat tim internal.',
    desc: 'Halo! Aku divisi Ops & Data ACHPHORIA CORPORATION 📊\n\nAku mengurus operasional harian, rekap data, metrik, dan dashboard.\n\nPerintah: /status · /tugas · /help\nDi grup, mention aku atau balas pesanku.\n\nBot ini privat untuk tim internal.',
  },
  content: {
    short: 'Divisi Content & Marketing ACHPHORIA: konten, caption & kampanye. Bot privat tim internal.',
    desc: 'Halo! Aku divisi Content & Marketing ACHPHORIA CORPORATION 📸\n\nAku menyiapkan ide konten, naskah, caption, dan rencana kampanye. Semua yang mau dipublikasikan selalu minta persetujuan dulu.\n\nPerintah: /status · /tugas · /help\nDi grup, mention aku atau balas pesanku.\n\nBot ini privat untuk tim internal.',
  },
  engineering: {
    short: 'Divisi Engineering ACHPHORIA: website, server & otomasi. Bot privat tim internal.',
    desc: 'Halo! Aku divisi Engineering ACHPHORIA CORPORATION 🛠️\n\nAku mengurus website, server, integrasi, dan otomasi. Deploy & perubahan produksi selalu minta persetujuan dulu.\n\nPerintah: /status · /tugas · /help\nDi grup, mention aku atau balas pesanku.\n\nBot ini privat untuk tim internal.',
  },
};
const COMMANDS = [
  { command: 'status', description: 'Status & lokasi kelima agen di kantor' },
  { command: 'tugas', description: 'Tugas terbuka (mis. /tugas research)' },
  { command: 'help', description: 'Bantuan' },
];
const redact = (s, token) => String(s ?? '').split(token).join('[token]').replace(/bot\d+:[A-Za-z0-9_-]{20,}/g, 'bot[token]');
async function call(token, method, payload) {
  try {
    const res = await fetch(`${(process.env.TG_API_BASE || 'https://api.telegram.org').replace(/\/+$/, '')}/bot${token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload ?? {}), signal: AbortSignal.timeout(20000),
    });
    const j = await res.json().catch(() => ({ ok: false, description: 'HTTP ' + res.status }));
    if (!j.ok) j.description = redact(j.description, token);
    return j;
  } catch (e) {
    return { ok: false, description: redact(e?.message ?? e, token) };
  }
}
const wib = (unix) => unix ? new Date(unix * 1000).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false }) + ' WIB' : '';

const bots = only ? [only] : AGENTS;
if (!flag('--info') && !SECRET) { console.error('✖ TG_WEBHOOK_SECRET belum ada (jalankan tools/deploy-bridge.sh dulu atau set env).'); process.exit(1); }
let failures = 0, done = 0;
for (const bot of bots) {
  const token = get('TG_TOKEN_' + bot.toUpperCase());
  const url = `${BRIDGE}/tg/${bot}`;
  console.log(`\n── ${bot} ──`);
  if (!token) { console.log(`  ⏭  TG_TOKEN_${bot.toUpperCase()} belum di-set → dilewati`); continue; }
  if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(token)) { console.log('  ✖ format token tidak valid'); failures++; continue; }
  if (flag('--dry-run')) {
    console.log(`  (dry-run) setWebhook → ${url}\n  (dry-run) setMyCommands /status /tugas /help · setMyDescription · setMyShortDescription`);
    continue;
  }
  done++;
  const me = await call(token, 'getMe');
  if (!me.ok) { console.log('  ✖ getMe gagal: ' + me.description); failures++; continue; }
  const expected = `ach_${bot}_bot`;
  const uname = me.result.username;
  console.log(`  🤖 @${uname} (id ${me.result.id})` + (uname.toLowerCase() === expected ? '' : `  ⚠ bukan @${expected} → set secret TG_USERNAME_${bot.toUpperCase()}=${uname}`));
  console.log(`     privasi grup: ${me.result.can_read_all_group_messages ? 'MATI (bisa baca semua pesan grup)' : 'AKTIF (hanya command/mention/reply)'}${bot === 'chief' && !me.result.can_read_all_group_messages ? '  ⚠ chief perlu privasi grup DIMATIKAN di @BotFather (/setprivacy → Disable)' : ''}`);
  if (!flag('--info')) {
    const steps = [
      ['setWebhook', { url, secret_token: SECRET, allowed_updates: ['message', 'edited_message', 'callback_query', 'my_chat_member'], drop_pending_updates: true, max_connections: 10 }],
      ['setMyCommands', { commands: COMMANDS }],
      ['setMyDescription', { description: INFO[bot].desc }],
      ['setMyShortDescription', { short_description: INFO[bot].short }],
    ];
    for (const [m, p] of steps) {
      const r = await call(token, m, p);
      console.log(`  ${r.ok ? '✔' : '✖'} ${m}${r.ok ? '' : ': ' + r.description}`);
      if (!r.ok) failures++;
    }
  }
  const info = await call(token, 'getWebhookInfo');
  if (info.ok) {
    const i = info.result;
    console.log(`  ℹ url: ${i.url || '(kosong)'}${i.url && i.url !== url ? '  ⚠ beda dari ' + url : ''}`);
    console.log(`    pending: ${i.pending_update_count ?? 0}` + (i.last_error_message ? ` · last_error: ${redact(i.last_error_message, token)} (${wib(i.last_error_date)})` : ' · last_error: -'));
  } else { console.log('  ✖ getWebhookInfo: ' + info.description); failures++; }
}
if (!flag('--info') && !flag('--dry-run')) {
  console.log(`\nCatatan grup ACHPHORIA HQ:
  • Tambahkan kelima bot + owner ke grup. Di @BotFather: /setprivacy → Disable untuk @ach_chief_bot
    (chief = penerima default), dan sebaiknya juga bot lain agar mention biasa selalu sampai.
  • Telegram TIDAK mengirim pesan bot ke bot lain di grup; delegasi antar-divisi lewat Grok Bot.`);
}
console.log(`\n${failures ? '✖ selesai dengan ' + failures + ' kegagalan' : '✔ selesai'} (${done} bot diproses)`);
process.exit(failures ? 2 : 0);
JS
