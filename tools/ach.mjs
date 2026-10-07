#!/usr/bin/env node
/**
 * ACHPHORIA — CLI jembatan Telegram untuk asisten AI (Node 18+, tanpa dependensi)
 *
 * Bicara ke Edge Function ach-bridge (bukan langsung ke Supabase), jadi asisten
 * TIDAK perlu service_role key. Cukup BRIDGE_KEY.
 *
 * Env / file:
 *   ACH_BRIDGE_URL  default https://ckoejqzownrujikefgwb.supabase.co/functions/v1/ach-bridge
 *   ACH_BRIDGE_KEY  atau file ~/.config/achphoria/bridge_key (chmod 600)   ⚠️ RAHASIA, jangan dicetak
 *   ACH_BOT         id bot default (chief|research|ops|content|engineering) bila --bot tidak diisi
 *
 * Contoh:
 *   node tools/ach.mjs report --bot research --status kerja --location desk --activity "riset tren" \
 *        --task "Riset tren skincare" --task-status "Sedang kerja" --log "mulai riset"
 *   node tools/ach.mjs send  --bot research --text "Siap, aku cek dulu ya" --inbox 12 [--chat <id>] [--reply <msgid>]
 *   node tools/ach.mjs send-photo --bot research --file /tmp/grafik.png [--caption ".."] [--chat <id>] [--reply <msgid>] [--inbox 12]
 *   node tools/ach.mjs send-file  --bot research --file /tmp/laporan.pdf [--caption ".."]
 *   node tools/ach.mjs inbox --bot research [--status baru|diproses|selesai|gagal|semua] [--limit 20]
 *   node tools/ach.mjs claim 12 · done 12 --note "beres" · fail 12 --note "butuh akses"
 *   node tools/ach.mjs chats --bot chief          (cari chat_id grup ACHPHORIA HQ)
 *   v4 grup ACHPHORIA LOGS (bridge memposting update tugas otomatis):
 *   node tools/ach.mjs task new   --bot research --title "Tes grup log"
 *   node tools/ach.mjs claim --bot research --task "Tes grup log" [--inbox 12] --note "mulai cek sumber"
 *   node tools/ach.mjs done  --bot research --task "Tes grup log" [--inbox 12] --note "ringkasan dikirim"
 *   node tools/ach.mjs log   --bot research --text "progres 50%" [--task "Tes grup log" | --task-id 1a2b3c4d]
 */
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_URL = 'https://ckoejqzownrujikefgwb.supabase.co/functions/v1/ach-bridge';
export const AGENTS = ['chief', 'research', 'ops', 'content', 'engineering'];
export const ROOMS = ['desk', 'meeting', 'tea', 'ramen', 'tatami', 'vending', 'whiteboard', 'offline'];
export const STATUSES = ['kerja', 'terjadwal', 'santai', 'istirahat', 'offline'];
export const TASK_STATUSES = ['Sedang kerja', 'Terjadwal', 'Selesai'];
export const INBOX_STATUSES = ['baru', 'diproses', 'selesai', 'gagal', 'semua'];
export const TASK_EVENTS = ['new', 'start', 'done', 'fail', 'approval'];
const REPORT_TASK_EVENTS = ['gagal', 'approval'];
const BOOL_FLAGS = new Set(['html', 'silent', 'full', 'json', 'dry_run', 'help']);
const COMMANDS = ['report', 'send', 'send-photo', 'send-file', 'typing', 'inbox', 'claim', 'done', 'fail', 'task', 'log', 'chats', 'ping'];

export const HELP = `ACHPHORIA · CLI jembatan Telegram (ach-bridge)

Pemakaian: node tools/ach.mjs <perintah> [opsi]

  report  --bot <id> [--status <s>] [--location <ruang>] [--activity <teks>]
          [--task <judul> | --task-id <id>] [--task-status "Sedang kerja"|Terjadwal|Selesai] [--log <pesan>]
          [--task-event gagal|approval] [--task-note <catatan untuk grup log>]
  send    --bot <id> (--text <teks> | --text-file <path> | --text -  [stdin])
          [--chat <chat_id>] [--reply <message_id>] [--inbox <inbox_id>] [--html] [--silent]
          (tanpa --chat → chat pribadi owner dengan bot ini)
  send-photo --bot <id> --file <png|jpg> [--caption <teks>] [--chat <id>] [--reply <msg_id>] [--inbox <id>] [--silent]
  send-file  --bot <id> --file <pdf|png|jpg> [--caption <teks>] [...sama]
          foto maks 10MB (lebih besar/ditolak → otomatis dikirim sebagai dokumen), dokumen maks 20MB
  typing  --bot <id> [--chat <chat_id>]
  inbox   --bot <id> [--status baru|diproses|selesai|gagal|semua] [--limit N] [--full]
  claim   <inbox_id> [--bot <id>]          tandai 'diproses' (gagal bila sudah diklaim)
  done    <inbox_id> [--note <teks>]       tandai 'selesai'
  fail    <inbox_id> [--note <teks>]       tandai 'gagal'
          claim/done/fail + --task <judul> | --task-id <id>  → event tugas (mulai/selesai/gagal) +
          posting otomatis ke grup LOGS; <inbox_id>/--inbox opsional ikut diubah statusnya
  task    new|start|done|fail|approval --bot <id> (--title <judul> | --task-id <id>)
          [--note <catatan>] [--agent <id> (hanya new: Chief menugaskan divisi)] [--inbox <inbox_id>]
  log     --bot <id> --text <teks> [--task <judul> | --task-id <id>]
          posting bebas ke grup ACHPHORIA LOGS sebagai bot sendiri (berutas di bawah tugas)
  chats   --bot <id>                       chat yang dikenal bot (mis. grup HQ)
  ping    [--bot <id>]                     cek koneksi & konfigurasi (tanpa membuka rahasia)

Opsi umum: --dry-run (cetak payload, tidak mengirim) · --url <bridge-url>
Env: ACH_BRIDGE_URL, ACH_BRIDGE_KEY (atau ~/.config/achphoria/bridge_key), ACH_BOT
Bot     : ${AGENTS.join(' ')}
Ruang   : ${ROOMS.join(' ')}  ('' = jadwal otomatis)
Status  : ${STATUSES.join(' ')}
Tugas   : "Sedang kerja" | Terjadwal | Selesai
Grup LOGS: report/task otomatis memposting 📋 tugas baru, 🔄 mulai, ✅ selesai, ❌ gagal, ⏳ nunggu approval`;

export class UsageError extends Error {}

export const PHOTO_MAX = 10 * 1024 * 1024;
export const DOC_MAX = 20 * 1024 * 1024;
const EXT_KIND = { png: 'png', jpg: 'jpg', jpeg: 'jpg', pdf: 'pdf' };
/** Jenis file dari magic bytes (sama dengan server). */
export function sniffKind(b) {
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length >= 5 && String.fromCharCode(...b.subarray(0, 5)) === '%PDF-') return 'pdf';
  return null;
}
/** Validasi lokal sebelum unggah; lempar UsageError bila tidak valid. */
export function checkLocalFile(name, bytes, mode) {
  const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase();
  const kind = EXT_KIND[ext];
  const allowed = mode === 'photo' ? ['png', 'jpg'] : ['png', 'jpg', 'pdf'];
  if (!kind || !allowed.includes(kind)) throw new UsageError(`ekstensi .${ext || '?'} tidak didukung (${mode === 'photo' ? 'png/jpg' : 'pdf/png/jpg'})`);
  if (!bytes.length) throw new UsageError('file kosong');
  const sniff = sniffKind(bytes);
  if (sniff !== kind) throw new UsageError(`isi file tidak cocok dengan ekstensi .${ext} (terdeteksi: ${sniff ?? 'tidak dikenal'})`);
  if (bytes.length > DOC_MAX) throw new UsageError(`file terlalu besar (${(bytes.length / 1048576).toFixed(1)}MB > 20MB)`);
  return kind;
}

/** Parser argumen: --k v, --k=v, flag boolean, sisanya posisional. Kunci '-' → '_'. */
export function parseArgs(argv) {
  const opts = {}, pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h') { opts.help = true; continue; }
    if (a === '--') { pos.push(...argv.slice(i + 1)); break; }
    if (a.startsWith('--') && a.length > 2) {
      const eq = a.indexOf('=');
      const k = (eq > 0 ? a.slice(2, eq) : a.slice(2)).replace(/-/g, '_');
      if (eq > 0) opts[k] = a.slice(eq + 1);
      else if (BOOL_FLAGS.has(k)) opts[k] = true;
      else {
        if (i + 1 >= argv.length) throw new UsageError(`opsi --${k.replace(/_/g, '-')} butuh nilai`);
        opts[k] = argv[++i];
      }
    } else pos.push(a);
  }
  return { cmd: pos[0], pos: pos.slice(1), opts };
}

/** Pola sensitif (sama dengan server): nominal Rp/IDR, ≥9 digit berurutan, pola nomor HP. */
export function sensitiveReason(s) {
  if (!s) return null;
  if (/\b(?:Rp|IDR)(?:\b|\s*\d)/i.test(s)) return 'mengandung nominal uang (Rp/IDR)';
  if (/\d{9,}/.test(s)) return 'mengandung deretan angka panjang (≥9 digit)';
  if (/(?:\+62|\b62|\b0)[\s.-]?8\d{1,3}[\s.-]?\d{3,4}[\s.-]?\d{3,5}\b/.test(s)) return 'mengandung pola nomor telepon';
  return null;
}

const int = (v, name) => {
  if (v === undefined || v === null || v === '' || v === true) throw new UsageError(`${name} wajib berupa angka`);
  if (!/^-?\d+$/.test(String(v))) throw new UsageError(`${name} harus bilangan bulat (dapat: ${v})`);
  return Number(v);
};
const optInt = (v, name) => (v === undefined ? undefined : int(v, name));

/** Bangun body JSON untuk /api dari argumen. readText(path|'-') dipakai untuk --text-file / stdin. */
export function buildRequest(parsed, { env = process.env, readText, readFile } = {}) {
  const { cmd, pos, opts } = parsed;
  if (!cmd || opts.help) throw new UsageError('');
  if (!COMMANDS.includes(cmd)) throw new UsageError(`perintah "${cmd}" tidak dikenal. Pilihan: ${COMMANDS.join(', ')}`);
  const bot = opts.bot ?? env.ACH_BOT;
  const needBot = () => {
    if (!bot) throw new UsageError('--bot wajib (atau set env ACH_BOT)');
    if (!AGENTS.includes(bot)) throw new UsageError(`bot "${bot}" tidak valid. Pilihan: ${AGENTS.join(', ')}`);
    return bot;
  };
  switch (cmd) {
    case 'report': {
      const b = { action: 'report', bot: needBot() };
      if (opts.status !== undefined) {
        if (!STATUSES.includes(opts.status)) throw new UsageError('status tidak valid. Pilih: ' + STATUSES.join(', '));
        b.status = opts.status;
      }
      if (opts.location !== undefined) {
        if (opts.location !== '' && !ROOMS.includes(opts.location)) throw new UsageError('lokasi tidak valid. Pilih: ' + ROOMS.join(', ') + " ('' = jadwal otomatis)");
        b.location = opts.location;
      }
      const hasTask = opts.task !== undefined || opts.task_id !== undefined;
      if (opts.task_status !== undefined) {
        if (!TASK_STATUSES.includes(opts.task_status)) throw new UsageError('status tugas tidak valid. Pilih: ' + TASK_STATUSES.join(' | '));
        if (!hasTask) throw new UsageError('--task-status butuh --task');
        b.task_status = opts.task_status;
      }
      if (opts.task_id !== undefined) b.task_id = String(opts.task_id);
      if (opts.task_event !== undefined) {
        if (!REPORT_TASK_EVENTS.includes(opts.task_event)) throw new UsageError('--task-event: ' + REPORT_TASK_EVENTS.join(' | '));
        if (!hasTask) throw new UsageError('--task-event butuh --task atau --task-id');
        b.task_event = opts.task_event;
      }
      if (opts.task_note !== undefined && !hasTask) throw new UsageError('--task-note butuh --task atau --task-id');
      for (const k of ['activity', 'task', 'log', 'task_note']) {
        if (opts[k] === undefined) continue;
        const why = sensitiveReason(opts[k]);
        if (why) throw new UsageError(`--${k.replace(/_/g, '-')} ditolak: ${why}. Teks ini tampil publik (website kantor / grup log).`);
        b[k] = opts[k];
      }
      if (Object.keys(b).length === 2) throw new UsageError('report butuh minimal satu dari --status/--location/--activity/--task/--log');
      return b;
    }
    case 'send': {
      const b = { action: 'send', bot: needBot() };
      let text = opts.text;
      if (opts.text_file !== undefined) {
        if (!readText) throw new UsageError('--text-file tidak didukung di sini');
        text = readText(opts.text_file);
      } else if (text === '-') {
        if (!readText) throw new UsageError('stdin tidak didukung di sini');
        text = readText('-');
      }
      if (text === undefined && pos.length) text = pos.join(' ');
      if (!text || !String(text).trim()) throw new UsageError('--text wajib (atau --text-file <path> / --text - untuk stdin)');
      b.text = String(text);
      if (opts.chat !== undefined) b.chat_id = int(opts.chat, '--chat');
      if (opts.reply !== undefined) b.reply_to_message_id = int(opts.reply, '--reply');
      if (opts.inbox !== undefined) b.inbox_id = int(opts.inbox, '--inbox');
      if (opts.html) b.parse_mode = 'HTML';
      if (opts.silent) b.silent = true;
      return b;
    }
    case 'send-photo':
    case 'send-file': {
      const mode = cmd === 'send-photo' ? 'photo' : 'document';
      const b = { action: cmd === 'send-photo' ? 'send_photo' : 'send_file', bot: needBot() };
      const file = opts.file ?? pos[0];
      if (!file || file === true) throw new UsageError('--file <path> wajib');
      if (!readFile) throw new UsageError('--file tidak didukung di sini');
      const bytes = readFile(String(file));
      checkLocalFile(String(file), bytes, mode);
      b.filename = basename(String(file));
      if (opts.caption !== undefined) {
        const why = sensitiveReason(opts.caption);
        if (why) throw new UsageError(`--caption ditolak: ${why}.`);
        if (String(opts.caption).length > 1024) throw new UsageError('--caption maks 1024 karakter');
        b.caption = String(opts.caption);
      }
      if (opts.chat !== undefined) b.chat_id = int(opts.chat, '--chat');
      if (opts.reply !== undefined) b.reply_to_message_id = int(opts.reply, '--reply');
      if (opts.inbox !== undefined) b.inbox_id = int(opts.inbox, '--inbox');
      if (opts.silent) b.silent = true;
      b.file_base64 = Buffer.from(bytes).toString('base64');
      return b;
    }
    case 'typing': {
      const b = { action: 'typing', bot: needBot() };
      if (opts.chat !== undefined) b.chat_id = int(opts.chat, '--chat');
      return b;
    }
    case 'inbox': {
      const b = { action: 'inbox', bot: needBot(), status: opts.status ?? 'baru' };
      if (!INBOX_STATUSES.includes(b.status)) throw new UsageError('status inbox: ' + INBOX_STATUSES.join(', '));
      const lim = optInt(opts.limit, '--limit');
      if (lim !== undefined) b.limit = lim;
      if (opts.full) b.full = true;
      return b;
    }
    case 'claim':
    case 'done':
    case 'fail': {
      if (opts.task !== undefined || opts.task_id !== undefined) {
        const ev = { claim: 'start', done: 'done', fail: 'fail' }[cmd];
        return taskBody(ev, needBot(), opts, opts.inbox ?? opts.id ?? pos[0]);
      }
      const b = { action: cmd, inbox_id: int(opts.inbox ?? opts.id ?? pos[0], 'inbox_id (posisional atau --inbox)') };
      if (bot) b.bot = needBot();
      if (opts.note !== undefined) b.note = opts.note;
      return b;
    }
    case 'task': {
      const ev = pos[0] ?? opts.event;
      if (!TASK_EVENTS.includes(ev)) throw new UsageError('task butuh event: ' + TASK_EVENTS.join(' | '));
      return taskBody(ev, needBot(), opts, opts.inbox);
    }
    case 'log': {
      const b = { action: 'log', bot: needBot() };
      const text = opts.text ?? (pos.length ? pos.join(' ') : undefined);
      if (!text || !String(text).trim()) throw new UsageError('--text wajib');
      const why = sensitiveReason(text);
      if (why) throw new UsageError(`--text ditolak: ${why}.`);
      b.text = String(text);
      if (opts.task !== undefined) b.task = String(opts.task);
      if (opts.task_id !== undefined) b.task_id = String(opts.task_id);
      return b;
    }
    case 'chats':
      return { action: 'chats', bot: needBot() };
    case 'ping':
      return bot ? { action: 'ping', bot: needBot() } : { action: 'ping' };
  }
}

function taskBody(event, bot, opts, inbox) {
  const b = { action: 'task', bot, event };
  const title = opts.title ?? opts.task;
  if (title !== undefined) b.title = String(title);
  if (opts.task_id !== undefined) b.task_id = String(opts.task_id);
  if (b.title === undefined && b.task_id === undefined) throw new UsageError('--title/--task (judul tugas) atau --task-id wajib');
  if (event === 'new' && b.title === undefined) throw new UsageError('task new butuh --title');
  if (opts.agent !== undefined) {
    if (!AGENTS.includes(opts.agent)) throw new UsageError(`agent "${opts.agent}" tidak valid. Pilihan: ${AGENTS.join(', ')}`);
    if (event !== 'new') throw new UsageError('--agent hanya untuk task new');
    b.agent = opts.agent;
  }
  for (const k of ['title', 'note']) {
    const v = k === 'title' ? b.title : opts.note;
    const why = sensitiveReason(v);
    if (why) throw new UsageError(`--${k} ditolak: ${why}. Teks ini tampil publik (website kantor / grup log).`);
  }
  if (opts.note !== undefined) b.note = String(opts.note);
  if (inbox !== undefined) b.inbox_id = int(inbox, '--inbox');
  return b;
}

/** Baca BRIDGE_KEY dari env atau ~/.config/achphoria/bridge_key. Tidak pernah dicetak. */
export function loadKey({ env = process.env, home = homedir(), warn = (m) => console.error(m) } = {}) {
  if (env.ACH_BRIDGE_KEY) return env.ACH_BRIDGE_KEY.trim();
  const file = join(home, '.config', 'achphoria', 'bridge_key');
  try {
    const st = statSync(file);
    if ((st.mode & 0o077) !== 0) warn(`⚠ ${file} bisa dibaca user lain — jalankan: chmod 600 ${file}`);
    return readFileSync(file, 'utf8').trim();
  } catch {
    return '';
  }
}

export async function main(argv = process.argv.slice(2), { env = process.env, fetchImpl = globalThis.fetch, out = console.log, err = console.error, home } = {}) {
  let parsed, body;
  try {
    parsed = parseArgs(argv);
    body = buildRequest(parsed, {
      env,
      readText: (p) => (p === '-' ? readFileSync(0, 'utf8') : readFileSync(p, 'utf8')),
      readFile: (p) => {
        let st;
        try { st = statSync(p); } catch { throw new UsageError(`file tidak ditemukan: ${p}`); }
        if (!st.isFile()) throw new UsageError(`bukan file: ${p}`);
        if (st.size > DOC_MAX) throw new UsageError(`file terlalu besar (${(st.size / 1048576).toFixed(1)}MB > 20MB)`);
        return new Uint8Array(readFileSync(p));
      },
    });
  } catch (e) {
    if (e instanceof UsageError) {
      if (e.message) err('✖ ' + e.message + '\n');
      out(HELP);
      return parsed?.opts?.help ? 0 : 1;
    }
    err('✖ ' + e.message);
    return 1;
  }
  const url = String(parsed.opts.url ?? env.ACH_BRIDGE_URL ?? DEFAULT_URL).replace(/\/+$/, '') + '/api';
  if (parsed.opts.dry_run) {
    const shown = body.file_base64 ? { ...body, file_base64: `<${body.file_base64.length} karakter base64>` } : body;
    out(JSON.stringify({ url, body: shown }, null, 2));
    return 0;
  }
  const key = loadKey({ env, home, warn: err });
  if (!key) {
    err('✖ BRIDGE_KEY tidak ditemukan. Set env ACH_BRIDGE_KEY atau isi ~/.config/achphoria/bridge_key (chmod 600).');
    return 1;
  }
  let res, text;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ach-key': key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(body.file_base64 ? 120000 : 30000),
    });
    text = await res.text();
  } catch (e) {
    err('✖ Gagal menghubungi bridge: ' + String(e?.message ?? e).split(key).join('[rahasia]'));
    return 2;
  }
  let data;
  try { data = JSON.parse(text); } catch { data = { ok: false, error: text.slice(0, 500) }; }
  out(JSON.stringify(data, null, 2));
  if (!res.ok || data?.ok === false) {
    err(`✖ HTTP ${res.status}${data?.error ? ': ' + data.error : ''}`);
    return 2;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code));
}
