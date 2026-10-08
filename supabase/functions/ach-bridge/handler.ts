import { createFx } from './fx.ts';
/**
 * ACHPHORIA CORPORATION · ach-bridge — logika Edge Function (Deno, tanpa dependensi)
 *
 * Jembatan Telegram <-> asisten AI (Grok Bot) + API kecil untuk para asisten.
 * File ini murni logika (bisa dites dengan fetch/env tiruan); index.ts hanya
 * memanggil Deno.serve(createHandler(...)).
 *
 * Rute (path sesudah ".../ach-bridge", atau ?action=):
 *   POST /tg/<botId>   webhook Telegram   (header X-Telegram-Bot-Api-Secret-Token = TG_WEBHOOK_SECRET)
 *   POST /api          API asisten        (header x-ach-key = BRIDGE_KEY)
 *   GET  /health       {ok:true}
 *
 * v4 — grup "ACHPHORIA LOGS": feed update tugas otomatis. Grup didaftarkan lewat
 * /start · /logs (judul grup mengandung "LOGS") atau /setlogs oleh owner → ach_tg_chats.role='logs'.
 * Setiap event tugas lewat report/task (baru, mulai, selesai, gagal, nunggu approval) diposting
 * bridge ke grup itu: pesan induk oleh bot Chief, balasan berutas oleh bot divisi.
 * id pesan induk per tugas disimpan di ach_tg_logmsg. Gagal posting tidak pernah memutus respons API.
 *
 * v5 — akses BACA ERP SEMAR (project Supabase yang sama): action erp_query / erp_schema, hanya agen
 * ops (+ chief). Memanggil RPC ach_erp_query / ach_erp_schema (service_role) yang menjalankan SATU SELECT
 * read-only sebagai role ach_erp_reader (allowlist tabel/kolom via GRANT, maks 200 baris). Setiap panggilan
 * dicatat di ach_erp_audit (agen, sql, jumlah baris, ms — TANPA isi hasil). Caption file dari bot ops ke
 * chat owner (pribadi / grup HQ) boleh memuat nominal Rp; deretan ≥12 digit / pola kartu / nomor HP tetap ditolak.
 *
 * ⚠️ Jangan pernah me-log nilai token / key. Semua pesan error dilewatkan redact().
 */

export const AGENTS = ['chief', 'research', 'ops', 'content', 'engineering'] as const;
export type AgentId = (typeof AGENTS)[number];
export const ROOMS = ['desk', 'meeting', 'tea', 'ramen', 'tatami', 'vending', 'whiteboard', 'offline'] as const;
export const STATUSES = ['kerja', 'terjadwal', 'santai', 'istirahat', 'offline'] as const;
export const TASK_STATUSES = ['Sedang kerja', 'Terjadwal', 'Selesai'] as const;
export const INBOX_STATUSES = ['baru', 'diproses', 'selesai', 'gagal'] as const;
export const VERSION = 'v6.0.0';
export const TASK_EVENTS = ['gagal', 'approval'] as const;
/** Agen yang boleh membaca ERP (erp_query / erp_schema). */
export const ERP_AGENTS: readonly AgentId[] = ['ops', 'chief'];
export const ERP_MAX_ROWS = 200;
export const ERP_SQL_MAX = 8000;
/** Grup HQ owner dikenali dari role 'hq' atau judul. */
export const HQ_TITLE = /\bACHPHORIA\s+HQ\b/i;
/** Judul grup yang otomatis dianggap grup log (feed saja). */
export const LOG_TITLE = /\bLOGS\b/i;
/** Pesan layanan Telegram (bukan isi percakapan) — tidak pernah masuk inbox. */
const SERVICE_KEYS = [
  'new_chat_members', 'left_chat_member', 'new_chat_title', 'new_chat_photo', 'delete_chat_photo', 'group_chat_created',
  'supergroup_chat_created', 'channel_chat_created', 'migrate_to_chat_id', 'migrate_from_chat_id', 'pinned_message',
  'message_auto_delete_timer_changed', 'forum_topic_created', 'forum_topic_edited', 'forum_topic_closed', 'forum_topic_reopened',
  'video_chat_started', 'video_chat_ended', 'video_chat_scheduled', 'video_chat_participants_invited', 'boost_added', 'chat_background_set',
];
const FEED_TIMEOUT_MS = 6000;

export const DIVISION: Record<AgentId, { name: string; username: string; home: string; emoji: string }> = {
  chief: { name: 'Chief of Staff', username: 'ach_chief_bot', home: 'Kotatsu', emoji: '📜' },
  research: { name: 'Research', username: 'ach_research_bot', home: 'Pojok Baca', emoji: '📚' },
  ops: { name: 'Ops & Data', username: 'ach_ops_bot', home: 'Meja Multi-Monitor', emoji: '📊' },
  content: { name: 'Content & Marketing', username: 'ach_content_bot', home: 'Pojok Konten', emoji: '📸' },
  engineering: { name: 'Engineering', username: 'ach_engineering_bot', home: 'Booth Server', emoji: '🛠️' },
};
const ROOM_LABEL: Record<string, string> = {
  desk: 'Meja Kerja', meeting: 'Rapat di Kotatsu', tea: 'Stasiun Teh', ramen: 'Konter Ramen',
  tatami: 'Pojok Tatami', vending: 'Mesin Minuman', whiteboard: 'Papan Tulis', offline: 'Pulang (Noren)',
};
const STATUS_LABEL: Record<string, string> = {
  kerja: '🟢 Kerja', terjadwal: '🔵 Terjadwal', santai: '🟡 Santai', istirahat: '🟣 Istirahat', offline: '⚪ Offline',
};
const STALE_HOURS = 3;
const TG_LIMIT = 4000;

// deno-lint-ignore no-explicit-any
type Json = any;

export interface Deps {
  env: (name: string) => string | undefined;
  fetch: typeof fetch;
  /** EdgeRuntime.waitUntil bila tersedia; tanpa ini pekerjaan latar ditunggu dulu sebelum membalas. */
  waitUntil?: (p: Promise<unknown>) => void;
  log?: (...args: unknown[]) => void;
  now?: () => Date;
}

/* ------------------------------------------------------------------ */
/* Utilitas umum                                                       */
/* ------------------------------------------------------------------ */
const enc = new TextEncoder();


/* ---------- file (send-photo / send-file) ---------- */
export const PHOTO_MAX = 10 * 1024 * 1024;
export const DOC_MAX = 20 * 1024 * 1024;
export type FileKind = 'png' | 'jpg' | 'pdf';
const EXT_KIND: Record<string, FileKind> = { png: 'png', jpg: 'jpg', jpeg: 'jpg', pdf: 'pdf' };
export const MIME: Record<FileKind, string> = { png: 'image/png', jpg: 'image/jpeg', pdf: 'application/pdf' };
/** Jenis file dari magic bytes (PNG / JPEG / PDF) atau null. */
export function sniffKind(b: Uint8Array): FileKind | null {
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return 'pdf';
  return null;
}
/** Validasi nama + isi; kembalikan jenis atau pesan error. */
export function checkFile(name: string, bytes: Uint8Array, mode: 'photo' | 'document'): { kind: FileKind } | { error: string } {
  const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase();
  const byExt = EXT_KIND[ext];
  const allowed: FileKind[] = mode === 'photo' ? ['png', 'jpg'] : ['png', 'jpg', 'pdf'];
  if (!byExt || !allowed.includes(byExt)) return { error: `ekstensi .${ext || '?'} tidak didukung untuk ${mode === 'photo' ? 'send-photo (png/jpg)' : 'send-file (pdf/png/jpg)'}` };
  if (!bytes.length) return { error: 'file kosong' };
  const sniff = sniffKind(bytes);
  if (sniff !== byExt) return { error: `isi file tidak cocok dengan ekstensi .${ext} (magic bytes: ${sniff ?? 'tidak dikenal'})` };
  const max = mode === 'photo' ? PHOTO_MAX : DOC_MAX;
  if (mode === 'document' && bytes.length > max) return { error: `file terlalu besar (${(bytes.length / 1048576).toFixed(1)}MB > ${max / 1048576}MB)` };
  if (mode === 'photo' && bytes.length > DOC_MAX) return { error: `file terlalu besar (${(bytes.length / 1048576).toFixed(1)}MB > ${DOC_MAX / 1048576}MB)` };
  return { kind: byExt };
}
export function b64decode(s: string): Uint8Array {
  const bin = atob(s.replace(/^data:[^,]*,/, '').replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
/** Nama file aman untuk Telegram (tanpa path / karakter kontrol). */
export function safeName(n: string): string {
  const base = String(n).split(/[\\/]/).pop()!.replace(/[\x00-\x1f"]/g, '').trim();
  return (base || 'file').slice(0, 120);
}

/** Perbandingan waktu-konstan (hash SHA-256 dulu supaya panjang tidak bocor). */
export async function safeEqual(a: string | null | undefined, b: string | null | undefined): Promise<boolean> {
  if (!a || !b) return false;
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

export const isAgent = (v: unknown): v is AgentId => typeof v === 'string' && (AGENTS as readonly string[]).includes(v);

/** Pola sensitif yang tidak boleh masuk log/aktivitas/tugas publik di website. */
export function sensitiveReason(s: string | null | undefined): string | null {
  if (!s) return null;
  if (/\b(?:Rp|IDR)(?:\b|\s*\d)/i.test(s)) return 'mengandung nominal uang (Rp/IDR)';
  if (/\d{9,}/.test(s)) return 'mengandung deretan angka panjang (≥9 digit, mirip nomor telepon/rekening)';
  if (/(?:\+62|\b62|\b0)[\s.-]?8\d{1,3}[\s.-]?\d{3,4}[\s.-]?\d{3,5}\b/.test(s)) return 'mengandung pola nomor telepon';
  return null;
}

/**
 * Filter longgar untuk bot ops → chat owner (pribadi / grup HQ): nominal penjualan seperti "Rp 1.250.000"
 * boleh, tapi deretan ≥12 digit (mirip nomor kartu/rekening), pola kartu 4-4-4, dan nomor HP tetap ditolak.
 */
export function opsAmountReason(s: string | null | undefined): string | null {
  if (!s) return null;
  if (/\d{12,}/.test(s)) return 'mengandung deretan angka sangat panjang (≥12 digit, mirip nomor kartu/rekening)';
  if (/\b\d{4}[ -]\d{4}[ -]\d{4}\b/.test(s)) return 'mengandung pola nomor kartu';
  if (/(?:\+62|\b62|\b0)[\s.-]?8\d{1,3}[\s.-]?\d{3,4}[\s.-]?\d{3,5}\b/.test(s)) return 'mengandung pola nomor telepon';
  return null;
}

/** Pecah teks panjang jadi potongan ≤ limit, utamakan batas baris/spasi, tanpa memotong pasangan surrogate. */
export function splitText(text: string, limit = TG_LIMIT): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit);
    if (cut < limit * 0.5) cut = rest.lastIndexOf(' ', limit);
    if (cut < limit * 0.5) cut = limit;
    const code = rest.charCodeAt(cut - 1);
    if (code >= 0xd800 && code <= 0xdbff) cut -= 1; // jangan potong emoji
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^[\n ]/, '');
  }
  if (rest.length || !out.length) out.push(rest);
  return out;
}

function fullName(u: Json): string | null {
  if (!u) return null;
  const n = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
  return n || u.title || u.username || null;
}

function wibTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d).replace(/\./g, ':') + ' WIB';
}

function ago(iso: string | null | undefined, now: Date): string {
  if (!iso) return '-';
  const m = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 60000));
  if (m < 1) return 'barusan';
  if (m < 60) return m + ' mnt lalu';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' jam lalu';
  return Math.floor(h / 24) + ' hari lalu';
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/* ------------------------------------------------------------------ */
/* Parsing update Telegram                                              */
/* ------------------------------------------------------------------ */
export interface Incoming {
  kind: 'message' | 'edited_message' | 'channel_post' | 'edited_channel_post' | 'callback_query';
  updateId: number | null;
  msg: Json;
  from: Json | null;
  chat: Json | null;
  text: string;
  entities: Json[];
  messageId: number | null;
  replyTo: number | null;
  callbackId?: string;
}

function describeMedia(m: Json): string {
  if (!m) return '';
  if (m.photo) return '[foto]';
  if (m.document) return '[dokumen' + (m.document.file_name ? ': ' + m.document.file_name : '') + ']';
  if (m.voice) return '[pesan suara]';
  if (m.audio) return '[audio]';
  if (m.video) return '[video]';
  if (m.video_note) return '[video bulat]';
  if (m.sticker) return '[stiker ' + (m.sticker.emoji || '') + ']';
  if (m.location) return '[lokasi]';
  if (m.contact) return '[kontak]';
  if (m.poll) return '[polling: ' + (m.poll.question || '') + ']';
  if (SERVICE_KEYS.some((k) => m[k] !== undefined)) return '';
  return '[pesan tanpa teks]';
}

export function parseUpdate(u: Json): Incoming | null {
  if (!u || typeof u !== 'object') return null;
  const updateId = typeof u.update_id === 'number' ? u.update_id : null;
  for (const kind of ['message', 'edited_message', 'channel_post', 'edited_channel_post'] as const) {
    const m = u[kind];
    if (!m) continue;
    const text = m.text ?? (m.caption ? describeMedia(m) + ' ' + m.caption : describeMedia(m));
    return {
      kind, updateId, msg: m, from: m.from ?? null, chat: m.chat ?? null, text: String(text ?? '').trim(),
      entities: m.entities ?? m.caption_entities ?? [], messageId: m.message_id ?? null,
      replyTo: m.reply_to_message?.message_id ?? null,
    };
  }
  if (u.callback_query) {
    const q = u.callback_query;
    return {
      kind: 'callback_query', updateId, msg: q.message ?? null, from: q.from ?? null, chat: q.message?.chat ?? null,
      text: String(q.data ?? '').trim(), entities: [], messageId: q.message?.message_id ?? null, replyTo: null,
      callbackId: q.id,
    };
  }
  return null;
}

export interface Command { name: string; target: string | null; args: string }
export function parseCommand(text: string): Command | null {
  const m = /^\/([A-Za-z0-9_]{1,64})(?:@([A-Za-z0-9_]{3,64}))?(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!m) return null;
  return { name: m[1].toLowerCase(), target: m[2] ? m[2].toLowerCase() : null, args: (m[3] ?? '').trim() };
}

/* ------------------------------------------------------------------ */
/* Handler                                                              */
/* ------------------------------------------------------------------ */
export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  const env = (k: string) => {
    const v = deps.env(k);
    return v === undefined || v === '' ? undefined : v;
  };
  const f = deps.fetch;
  const log = deps.log ?? ((...a: unknown[]) => console.log(...a));
  const now = deps.now ?? (() => new Date());
  const UP = (b: string) => b.toUpperCase();

  /* ---------- redaksi rahasia ---------- */
  const SECRET_NAMES = [
    'TG_WEBHOOK_SECRET', 'TG_CLAIM_CODE', 'BRIDGE_KEY', 'FX_DEVICE_KEY', 'ACH_SERVICE_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
    ...AGENTS.flatMap((a) => ['TG_TOKEN_' + UP(a), 'WAKE_KEY_' + UP(a)]),
  ];
  function redact(s: unknown): string {
    let out = String((s as Error)?.message ?? s ?? '');
    for (const n of SECRET_NAMES) {
      const v = env(n);
      if (v && v.length >= 6) out = out.split(v).join('[rahasia]');
    }
    return out.replace(/bot\d+:[A-Za-z0-9_-]{20,}/g, 'bot[token]').slice(0, 1000);
  }
  const warn = (...a: unknown[]) => log('[ach-bridge]', ...a.map((x) => (typeof x === 'string' ? redact(x) : x)));

  /* ---------- Supabase PostgREST (service role) ---------- */
  function serviceKey(): string | undefined {
    const k = env('ACH_SERVICE_KEY') ?? env('SUPABASE_SERVICE_ROLE_KEY');
    if (k) return k;
    const multi = env('SUPABASE_SECRET_KEYS');
    if (multi) {
      try {
        const o = JSON.parse(multi);
        const first = Object.values(o)[0];
        if (typeof first === 'string') return first;
      } catch { /* abaikan */ }
    }
    return undefined;
  }
  async function db(path: string, init: { method?: string; body?: unknown; prefer?: string } = {}): Promise<Json> {
    const base = env('SUPABASE_URL');
    const key = serviceKey();
    if (!base || !key) throw new HttpError(500, 'SUPABASE_URL / service role key tidak tersedia di Edge Function');
    const headers: Record<string, string> = { apikey: key, 'Content-Type': 'application/json', Accept: 'application/json' };
    if (!key.startsWith('sb_')) headers.Authorization = 'Bearer ' + key;
    if (init.prefer) headers.Prefer = init.prefer;
    const res = await f(base.replace(/\/+$/, '') + '/rest/v1/' + path, {
      method: init.method ?? 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try { const j = JSON.parse(text); msg = j.message || j.hint || text; } catch { /* teks mentah */ }
      throw new HttpError(res.status >= 500 ? 502 : 400, 'database: ' + redact(msg));
    }
    return text ? JSON.parse(text) : null;
  }
  const q = encodeURIComponent;

  /* ---------- Telegram Bot API ---------- */
  const botUserId = (bot: AgentId): number | null => {
    const t = env('TG_TOKEN_' + UP(bot));
    const m = t ? /^(\d+):/.exec(t) : null;
    return m ? Number(m[1]) : null;
  };
  const botUsername = (bot: AgentId) => (env('TG_USERNAME_' + UP(bot)) ?? DIVISION[bot].username).replace(/^@/, '').toLowerCase();

  async function tg(bot: AgentId, method: string, payload: Json, timeoutMs = 15000): Promise<Json> {
    const token = env('TG_TOKEN_' + UP(bot));
    if (!token) return { ok: false, description: 'TG_TOKEN_' + UP(bot) + ' belum di-set' };
    const base = (env('TG_API_BASE') ?? 'https://api.telegram.org').replace(/\/+$/, '');
    try {
      const res = await f(`${base}/bot${token}/${method}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const j = await res.json().catch(() => ({ ok: false, description: 'HTTP ' + res.status }));
      if (!j.ok) j.description = redact(j.description ?? 'HTTP ' + res.status);
      return j;
    } catch (e) {
      return { ok: false, description: redact(e) };
    }
  }


  /** Panggilan Telegram multipart (unggah file). */
  async function tgUpload(bot: AgentId, method: string, fields: Record<string, string>, field: string, bytes: Uint8Array, name: string, mime: string, timeoutMs = 60000): Promise<Json> {
    const token = env('TG_TOKEN_' + UP(bot));
    if (!token) return { ok: false, description: 'TG_TOKEN_' + UP(bot) + ' belum di-set' };
    const base = (env('TG_API_BASE') ?? 'https://api.telegram.org').replace(/\/+$/, '');
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    form.append(field, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }), name);
    try {
      const res = await f(`${base}/bot${token}/${method}`, { method: 'POST', body: form, signal: AbortSignal.timeout(timeoutMs) });
      const j = await res.json().catch(() => ({ ok: false, description: 'HTTP ' + res.status }));
      if (!j.ok) j.description = redact(j.description ?? 'HTTP ' + res.status);
      return j;
    } catch (e) {
      return { ok: false, description: redact(e) };
    }
  }

  /** Kirim foto/dokumen (+ fallback sendPhoto → sendDocument) dan catat ke ach_outbox. */
  async function sendFile(bot: AgentId, chatId: number, mode: 'photo' | 'document', kind: FileKind, bytes: Uint8Array, name: string,
    opts: { caption?: string | null; replyTo?: number | null; silent?: boolean }) {
    const fields: Record<string, string> = { chat_id: String(chatId) };
    if (opts.caption) fields.caption = opts.caption;
    if (opts.silent) fields.disable_notification = 'true';
    if (opts.replyTo) fields.reply_parameters = JSON.stringify({ message_id: opts.replyTo, allow_sending_without_reply: true });
    let method = 'sendDocument', r: Json = null, fallback: string | null = null;
    if (mode === 'photo') {
      if (bytes.length > PHOTO_MAX) fallback = `foto > ${PHOTO_MAX / 1048576}MB`;
      else {
        method = 'sendPhoto';
        r = await tgUpload(bot, 'sendPhoto', fields, 'photo', bytes, name, MIME[kind]);
        if (!r.ok && /PHOTO|IMAGE|DIMENSION|too big|too large|wrong file|invalid/i.test(String(r.description ?? ''))) {
          fallback = String(r.description); r = null; method = 'sendDocument';
        }
      }
    }
    if (!r) r = await tgUpload(bot, 'sendDocument', fields, 'document', bytes, name, MIME[kind]);
    const row = {
      bot, chat_id: chatId, text: `[${method === 'sendPhoto' ? 'photo' : 'document'}] ${name}${opts.caption ? ' — ' + opts.caption : ''}`,
      reply_to_message_id: opts.replyTo ?? null, telegram_message_id: r.ok ? r.result?.message_id ?? null : null,
      ok: !!r.ok, error: r.ok ? null : String(r.description ?? 'gagal'),
    };
    try { await db('ach_outbox', { method: 'POST', body: row, prefer: 'return=minimal' }); } catch (e) { warn('outbox gagal:', redact(e)); }
    return { ok: !!r.ok, method, fallback, message_id: r.ok ? r.result?.message_id ?? null : null, error: row.error };
  }

  /** Kirim teks (dipecah bila panjang) + catat ke ach_outbox. */
  async function sendText(bot: AgentId, chatId: number, text: string, opts: { replyTo?: number | null; parseMode?: string | null; silent?: boolean; timeoutMs?: number } = {}) {
    const parts = splitText(text);
    const results: { ok: boolean; message_id?: number; error?: string }[] = [];
    for (let i = 0; i < parts.length; i++) {
      const payload: Json = { chat_id: chatId, text: parts[i], link_preview_options: { is_disabled: true } };
      if (opts.parseMode) payload.parse_mode = opts.parseMode;
      if (opts.silent) payload.disable_notification = true;
      if (i === 0 && opts.replyTo) payload.reply_parameters = { message_id: opts.replyTo, allow_sending_without_reply: true };
      const r = await tg(bot, 'sendMessage', payload, opts.timeoutMs);
      const row = {
        bot, chat_id: chatId, text: parts[i], reply_to_message_id: i === 0 ? opts.replyTo ?? null : null,
        telegram_message_id: r.ok ? r.result?.message_id ?? null : null, ok: !!r.ok, error: r.ok ? null : String(r.description ?? 'gagal'),
      };
      try { await db('ach_outbox', { method: 'POST', body: row, prefer: 'return=minimal' }); } catch (e) { warn('outbox gagal:', redact(e)); }
      results.push(r.ok ? { ok: true, message_id: r.result?.message_id } : { ok: false, error: row.error ?? undefined });
      if (!r.ok) break;
    }
    return { ok: results.length === parts.length && results.every((r) => r.ok), parts: parts.length, results };
  }

  /* ---------- akses data kecil ---------- */
  async function isAllowed(fromId: number | null | undefined): Promise<boolean> {
    if (!fromId) return false;
    const rows = await db(`ach_tg_allow?select=from_id&from_id=eq.${fromId}&limit=1`);
    return Array.isArray(rows) && rows.length > 0;
  }
  /** Catat/perbarui chat; kembalikan role chat ('logs' | 'hq' | null). */
  async function upsertChat(bot: AgentId, chat: Json): Promise<string | null> {
    if (!chat?.id) return null;
    try {
      const rows = await db('ach_tg_chats?on_conflict=bot,chat_id&select=role', {
        method: 'POST', prefer: 'resolution=merge-duplicates,return=representation',
        body: { bot, chat_id: chat.id, chat_type: chat.type ?? null, title: chat.title ?? fullName(chat), username: chat.username ?? null, last_seen: now().toISOString() },
      });
      return Array.isArray(rows) && rows.length ? rows[0].role ?? null : null;
    } catch (e) { warn('upsert chat gagal:', redact(e)); return null; }
  }

  /* ---------- grup LOGS (v4) ---------- */
  async function logChatId(): Promise<number | null> {
    const rows: Json[] = await db('ach_tg_chats?select=chat_id&role=eq.logs&order=last_seen.desc&limit=1');
    return Array.isArray(rows) && rows.length ? Number(rows[0].chat_id) : null;
  }
  /** Jadikan chatId satu-satunya grup log (role chat lain 'logs' dikosongkan). */
  async function setLogChat(chatId: number) {
    await db('ach_tg_chats?role=eq.logs', { method: 'PATCH', prefer: 'return=minimal', body: { role: null } });
    await db(`ach_tg_chats?chat_id=eq.${chatId}`, { method: 'PATCH', prefer: 'return=minimal', body: { role: 'logs' } });
  }
  const shortId = (id: string) => String(id).split('-')[0].slice(0, 8);
  const divName = (a: string) => (isAgent(a) ? DIVISION[a].name : a);
  interface TaskRef { id: string; title: string; status: string; agent_id: string }
  type FeedEvent = 'new' | 'start' | 'done' | 'scheduled' | 'gagal' | 'approval' | 'note';
  function feedLine(ev: FeedEvent, agent: string, note: string | null): string {
    const d = divName(agent), tail = note ? ' — ' + note : '';
    switch (ev) {
      case 'start': return `🔄 ${d}: mulai kerja${tail}`;
      case 'done': return `✅ ${d}: selesai${tail}`;
      case 'gagal': return `❌ ${d}: gagal${tail}`;
      case 'approval': return `⏳ ${d}: nunggu approval owner${tail}`;
      case 'scheduled': return `🗓 ${d}: dijadwalkan ulang${tail}`;
      default: return `📝 ${d}: ${note ?? ''}`.trim();
    }
  }
  /** Pesan induk tugas di grup log (dibuat bot Chief bila belum ada). */
  async function ensureRoot(chatId: number, task: TaskRef, note: string | null): Promise<{ message_id: number | null; created: boolean; error?: string }> {
    const have: Json[] = await db(`ach_tg_logmsg?select=message_id&task_id=eq.${q(task.id)}&chat_id=eq.${chatId}&limit=1`);
    if (have.length && have[0].message_id) return { message_id: Number(have[0].message_id), created: false };
    const text = `📋 Tugas #${shortId(task.id)}: ${task.title}\nDivisi: ${divName(task.agent_id)}\nStatus: ${task.status}` + (note ? `\nCatatan: ${note}` : '');
    const r = await sendText('chief', chatId, text, { timeoutMs: FEED_TIMEOUT_MS });
    const mid = r.ok ? r.results[0]?.message_id ?? null : null;
    if (!mid) return { message_id: null, created: false, error: r.results.find((x) => !x.ok)?.error ?? 'gagal' };
    try {
      await db('ach_tg_logmsg?on_conflict=task_id,chat_id', {
        method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
        body: { task_id: task.id, chat_id: chatId, message_id: mid, agent_id: task.agent_id },
      });
    } catch (e) { warn('simpan ach_tg_logmsg gagal:', redact(e)); }
    return { message_id: mid, created: true };
  }
  /** Posting balasan di grup log oleh bot divisi; bila gagal (bot tak ada di grup, dsb.) coba lewat Chief. */
  async function feedReply(agent: string, chatId: number, text: string, replyTo: number | null) {
    const bot: AgentId = isAgent(agent) ? agent : 'chief';
    let r = await sendText(bot, chatId, text, { replyTo, timeoutMs: FEED_TIMEOUT_MS });
    if (!r.ok && bot !== 'chief') r = await sendText('chief', chatId, text, { replyTo, timeoutMs: FEED_TIMEOUT_MS });
    return r;
  }
  /** Best effort: tidak pernah melempar error. */
  async function feedTask(task: TaskRef, events: FeedEvent[], note: string | null): Promise<Json> {
    try {
      const chatId = await logChatId();
      if (chatId === null) return { ok: false, posted: 0, skipped: 'grup log belum terdaftar' };
      const root = await ensureRoot(chatId, task, events.length === 1 && events[0] === 'new' ? note : null);
      let posted = root.created ? 1 : 0;
      const errors: string[] = root.error ? ['induk: ' + root.error] : [];
      for (const ev of events) {
        if (ev === 'new') continue;
        const r = await feedReply(task.agent_id, chatId, feedLine(ev, task.agent_id, note), root.message_id);
        if (r.ok) posted++; else errors.push(ev + ': ' + (r.results.find((x) => !x.ok)?.error ?? 'gagal'));
      }
      if (errors.length) warn('feed grup log:', errors.join('; '));
      return { ok: !errors.length, posted, task_id: task.id, root_message_id: root.message_id, ...(errors.length ? { errors } : {}) };
    } catch (e) {
      warn('feed grup log gagal:', redact(e));
      return { ok: false, posted: 0, error: redact(e) };
    }
  }
  async function patchInbox(id: number, patch: Json) {
    try { await db(`ach_inbox?id=eq.${id}`, { method: 'PATCH', body: patch, prefer: 'return=minimal' }); } catch (e) { warn('patch inbox gagal:', redact(e)); }
  }

  /* ---------- perintah cepat ---------- */
  async function statusText(): Promise<string> {
    const rows: Json[] = await db('ach_agents?select=id,name,status,location,activity,current_task,updated_at&order=sort_order.asc.nullslast,id.asc');
    const n = now();
    const lines = rows.map((a) => {
      const aid: string = String(a.id);
      const div = isAgent(aid) ? DIVISION[aid] : null;
      const stale = !a.updated_at || n.getTime() - Date.parse(a.updated_at) > STALE_HOURS * 3600e3;
      const room = a.location === 'desk' && div ? div.home : ROOM_LABEL[a.location] ?? (a.location ? a.location : 'jadwal otomatis');
      let s = `${div?.emoji ?? '•'} ${a.name ?? a.id} — ${STATUS_LABEL[a.status] ?? a.status} · ${room}`;
      if (a.activity) s += `\n   ${a.activity}`;
      if (a.current_task) s += `\n   📌 ${a.current_task}`;
      s += `\n   ⏱ ${ago(a.updated_at, n)}${stale ? ' (data basi → website pakai jadwal otomatis)' : ''}`;
      return s;
    });
    return `🏮 Status kantor ACHPHORIA · ${wibTime(n.toISOString())}\n\n` + (lines.join('\n\n') || 'Belum ada data agen.');
  }
  async function tasksText(filter?: string): Promise<string> {
    let path = 'ach_tasks?select=agent_id,title,status,due_at,updated_at&status=in.(%22Sedang%20kerja%22,Terjadwal)&order=agent_id.asc,status.asc,due_at.asc.nullslast&limit=60';
    const who = filter?.toLowerCase().trim();
    if (who && isAgent(who)) path += `&agent_id=eq.${who}`;
    const rows: Json[] = await db(path);
    if (!rows.length) return '✅ Tidak ada tugas terbuka' + (who && isAgent(who) ? ' untuk ' + DIVISION[who].name : '') + '.';
    const by: Record<string, Json[]> = {};
    for (const t of rows) (by[t.agent_id ?? '-'] ??= []).push(t);
    const order = [...AGENTS, '-'];
    const parts = Object.keys(by).sort((a, b) => order.indexOf(a as AgentId) - order.indexOf(b as AgentId)).map((id) => {
      const head = isAgent(id) ? `${DIVISION[id].emoji} ${DIVISION[id].name}` : '• Tanpa agen';
      const items = by[id].map((t) => `  ${t.status === 'Sedang kerja' ? '▶️' : '🗓'} ${t.title}${t.status === 'Terjadwal' && t.due_at ? ' (tenggat ' + wibTime(t.due_at) + ')' : ''}`);
      return head + '\n' + items.join('\n');
    });
    return `📋 Tugas terbuka (${rows.length})\n\n` + parts.join('\n\n');
  }
  function helpText(bot: AgentId): string {
    const d = DIVISION[bot];
    return [
      `${d.emoji} Halo! Aku bot divisi ${d.name} ACHPHORIA CORPORATION.`,
      '',
      'Perintah cepat:',
      '/status — posisi & aktivitas kelima agen di kantor virtual',
      '/tugas — daftar tugas terbuka (bisa /tugas research, /tugas ops, …)',
      '/help — bantuan ini',
      '/setlogs — (di grup, owner) jadikan grup ini grup log update tugas',
      '',
      `Pesan lain akan diteruskan ke asisten ${d.name}; balasannya menyusul di chat ini.`,
      bot === 'chief'
        ? 'Di grup HQ, aku penerima default: pesan tanpa mention bot lain akan kutangani.'
        : `Di grup, mention @${botUsername(bot)} atau balas pesanku supaya aku yang menangani.`,
    ].join('\n');
  }

  /* ---------- wake asisten ---------- */
  async function wake(bot: AgentId, payload: Json): Promise<{ ok: boolean; note: string }> {
    const B = UP(bot);
    const url = env('WAKE_URL_' + B);
    if (!url) return { ok: false, note: `wake belum dikonfigurasi (WAKE_URL_${B} kosong)` };
    const key = env('WAKE_KEY_' + B);
    const style = (env('WAKE_KEY_STYLE_' + B) ?? env('WAKE_KEY_STYLE') ?? 'bearer').toLowerCase();
    const header = env('WAKE_KEY_HEADER_' + B) ?? env('WAKE_KEY_HEADER') ?? 'Authorization';
    const param = env('WAKE_KEY_PARAM_' + B) ?? env('WAKE_KEY_PARAM') ?? 'key';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    let target = url;
    try {
      if (key && style !== 'none') {
        if (style === 'query') {
          const u = new URL(url);
          u.searchParams.set(param, key);
          target = u.toString();
        } else if (style === 'bearer') headers[header] = 'Bearer ' + key;
        else headers[header] = key;
      }
      const res = await f(target, { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) });
      const body = (await res.text().catch(() => '')).slice(0, 200);
      return res.ok ? { ok: true, note: `wake ok (HTTP ${res.status})` } : { ok: false, note: redact(`wake gagal: HTTP ${res.status} ${body}`).trim() };
    } catch (e) {
      const msg = (e as Error)?.name === 'TimeoutError' ? 'timeout 10 dtk' : redact(e);
      return { ok: false, note: 'wake gagal: ' + msg };
    }
  }

  /* ---------- webhook Telegram ---------- */
  function siblingInfo(bot: AgentId) {
    const ids = new Set<number>(), names = new Set<string>();
    for (const a of AGENTS) {
      if (a === bot) continue;
      const id = botUserId(a);
      if (id) ids.add(id);
      names.add(botUsername(a));
    }
    return { ids, names };
  }

  function mentions(inc: Incoming, username: string, userId: number | null): boolean {
    const t = inc.text;
    for (const e of inc.entities) {
      if (e.type === 'mention' && t.slice(e.offset, e.offset + e.length).toLowerCase() === '@' + username) return true;
      if (e.type === 'text_mention' && userId && e.user?.id === userId) return true;
    }
    return new RegExp('(^|[^A-Za-z0-9_])@' + username + '(?![A-Za-z0-9_])', 'i').test(t);
  }

  async function processUpdate(bot: AgentId, update: Json): Promise<void> {
    // bot ditambahkan / dikeluarkan dari grup → cukup catat chat
    if (update?.my_chat_member) {
      await upsertChat(bot, update.my_chat_member.chat);
      return;
    }
    const inc = parseUpdate(update);
    if (!inc || !inc.chat) return;
    const chatRole = await upsertChat(bot, inc.chat);
    if (inc.kind === 'callback_query' && inc.callbackId) await tg(bot, 'answerCallbackQuery', { callback_query_id: inc.callbackId });

    // pesan layanan (anggota masuk/keluar, ganti judul, migrasi grup → supergroup, pin, …): bukan perintah
    if (inc.kind !== 'callback_query' && inc.msg && SERVICE_KEYS.some((k) => inc.msg[k] !== undefined)) {
      const from = inc.msg.migrate_to_chat_id ? inc.chat.id : inc.msg.migrate_from_chat_id;
      const to = inc.msg.migrate_to_chat_id ? inc.msg.migrate_to_chat_id : inc.msg.migrate_from_chat_id ? inc.chat.id : null;
      if (from && to) {
        // grup jadi supergroup → chat_id berubah; bawa role (mis. 'logs') ke chat_id baru
        try {
          const old: Json[] = await db(`ach_tg_chats?select=role&chat_id=eq.${from}&role=eq.logs&limit=1`);
          if (old.length) {
            if (to !== inc.chat.id) await upsertChat(bot, { id: to, type: 'supergroup', title: inc.chat.title });
            await setLogChat(Number(to));
          }
        } catch (e) { warn('migrasi role chat gagal:', redact(e)); }
      }
      return;
    }

    const me = botUsername(bot);
    const myId = botUserId(bot);
    const chatType: string = inc.chat.type ?? 'private';
    const isPrivate = chatType === 'private';
    const from = inc.from;
    if (from?.id && myId && from.id === myId) return; // pesan sendiri

    const cmd = parseCommand(inc.text);
    const sib = siblingInfo(bot);
    const mentioned = mentions(inc, me, myId);
    const fromBot = !!from?.is_bot;
    const fromSibling = fromBot && (sib.ids.has(from.id) || sib.names.has(String(from.username ?? '').toLowerCase()));

    // pesan dari bot lain: abaikan kecuali eksplisit mention bot ini (cegah loop)
    if (fromBot && !mentioned) return;

    // klaim owner: /start <TG_CLAIM_CODE>
    const isStartWithArgs = !!cmd && cmd.name === 'start' && !!cmd.args && (!cmd.target || cmd.target === me);
    const redactedText = isStartWithArgs ? '/start [kode disembunyikan]' : inc.text;
    const storedUpdate = isStartWithArgs ? { update_id: inc.updateId, redacted: true } : update;

    let allowed = false;
    if (fromSibling) allowed = true;
    else if (from?.id && !fromBot) allowed = await isAllowed(from.id);

    // --- grup LOGS: feed saja (v4) ---
    const isGroup = chatType === 'group' || chatType === 'supergroup';
    const title = String(inc.chat.title ?? '');
    const isLogChat = isGroup && (chatRole === 'logs' || LOG_TITLE.test(title));
    const ourTarget = !cmd?.target || cmd.target === me || sib.names.has(cmd.target);
    const regCmd = !!cmd && isGroup && ourTarget && !fromBot && (cmd.name === 'setlogs' || cmd.name === 'unsetlogs' ||
      ((cmd.name === 'start' || cmd.name === 'logs') && !cmd.args && LOG_TITLE.test(title)));
    if (regCmd) {
      if (bot !== 'chief' || !allowed) return; // hanya Chief yang mendaftarkan, hanya untuk owner; bot lain diam
      const row = await db('ach_inbox?on_conflict=bot,update_id&select=id', {
        method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation',
        body: {
          bot, update_id: inc.updateId, chat_id: inc.chat.id, chat_type: chatType, chat_title: title || null,
          from_id: from?.id ?? null, from_name: fullName(from), from_username: from?.username ?? null, text: inc.text,
          message_id: inc.messageId, reply_to_message_id: inc.replyTo, update, status: 'selesai',
          note: cmd!.name === 'unsetlogs' ? 'grup log dinonaktifkan' : 'grup log didaftarkan', handled_at: now().toISOString(),
        },
      });
      if (!Array.isArray(row) || !row.length) return; // duplikat
      if (cmd!.name === 'unsetlogs') {
        await db(`ach_tg_chats?chat_id=eq.${inc.chat.id}&role=eq.logs`, { method: 'PATCH', prefer: 'return=minimal', body: { role: null } });
        await sendText('chief', inc.chat.id, '📕 Grup log ACHPHORIA dinonaktifkan. Update tugas tidak lagi diposting di sini.', { replyTo: inc.messageId });
        return;
      }
      await setLogChat(inc.chat.id);
      await sendText('chief', inc.chat.id, chatRole === 'logs'
        ? '📒 Grup log ACHPHORIA sudah aktif. Semua update tugas bakal muncul di sini.'
        : '📒 Grup log ACHPHORIA aktif. Semua update tugas bakal muncul di sini.');
      return;
    }
    if (isLogChat) {
      // pesan biasa / mention / perintah lain tidak membangunkan asisten; hanya perintah cepat yang dijawab
      const quickOnly = !!cmd && ['status', 'tugas', 'help', 'bantuan'].includes(cmd.name);
      if (!quickOnly) return;
    }

    // apakah pesan ini ditujukan ke bot ini?
    let addressed: boolean;
    const replyToMe = !!inc.msg?.reply_to_message?.from && (
      (myId && inc.msg.reply_to_message.from.id === myId) || String(inc.msg.reply_to_message.from.username ?? '').toLowerCase() === me);
    if (inc.kind === 'callback_query' || isPrivate) addressed = !cmd?.target || cmd.target === me || isPrivate;
    else if (chatType === 'channel') addressed = mentioned;
    else {
      addressed = mentioned || replyToMe || (!!cmd && cmd.target === me);
      if (!addressed && bot === 'chief' && allowed && !fromBot) {
        const replyToSibling = !!inc.msg?.reply_to_message?.from && (
          sib.ids.has(inc.msg.reply_to_message.from.id) || sib.names.has(String(inc.msg.reply_to_message.from.username ?? '').toLowerCase()));
        const mentionsSibling = [...sib.names].some((n) => mentions(inc, n, null));
        const cmdForOther = !!cmd?.target && cmd.target !== me;
        addressed = !replyToSibling && !mentionsSibling && !cmdForOther;
      }
    }
    if (!addressed) return;

    const baseRow = {
      bot, update_id: inc.updateId, chat_id: inc.chat.id, chat_type: chatType, chat_title: inc.chat.title ?? fullName(inc.chat),
      from_id: from?.id ?? null, from_name: fullName(from) ?? fullName(inc.msg?.sender_chat), from_username: from?.username ?? null,
      text: redactedText, message_id: inc.messageId, reply_to_message_id: inc.replyTo, update: storedUpdate,
    };
    const insertRow = async (status: string, note: string | null): Promise<Json | null> => {
      const handled = status === 'baru' ? null : now().toISOString();
      const rows = await db('ach_inbox?on_conflict=bot,update_id&select=id,status', {
        method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation',
        body: { ...baseRow, status, note, handled_at: handled },
      });
      return Array.isArray(rows) && rows.length ? rows[0] : null; // null = duplikat (Telegram kirim ulang)
    };
    const replyTo = inc.kind === 'callback_query' ? null : inc.messageId;

    // --- klaim owner ---
    if (isStartWithArgs) {
      const claim = env('TG_CLAIM_CODE');
      if (!isPrivate) {
        const row = await insertRow('gagal', 'kode klaim dikirim di grup (ditolak)');
        if (row) await sendText(bot, inc.chat.id, '⚠️ Kode klaim hanya boleh dikirim lewat chat pribadi ke bot. Kalau kodenya asli, minta yang baru ke admin ya.', { replyTo });
        return;
      }
      if (claim && from?.id && !fromBot && await safeEqual(cmd!.args.split(/\s+/)[0], claim)) {
        const row = await insertRow('selesai', 'klaim owner berhasil');
        if (!row) return;
        await db('ach_tg_allow?on_conflict=from_id', {
          method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
          body: { from_id: from.id, note: `${fullName(from) ?? ''}${from.username ? ' @' + from.username : ''} · klaim via @${me} · ${now().toISOString()}`.trim() },
        });
        await sendText(bot, inc.chat.id,
          `✅ Siap, ${fullName(from) ?? 'bos'}! ID Telegram kamu (${from.id}) sudah masuk daftar owner ACHPHORIA.\n` +
          `Sekarang kamu bisa memerintah kelima bot. Coba /status atau /help.`, { replyTo });
        return;
      }
      if (allowed) {
        const row = await insertRow('gagal', 'kode klaim salah');
        if (row) await sendText(bot, inc.chat.id, '❌ Kode klaim salah, tapi tenang — kamu sudah terdaftar kok. /help untuk bantuan.', { replyTo });
        return;
      }
      // tidak diizinkan → lanjut ke penolakan di bawah
    }

    // --- tidak diizinkan ---
    if (!allowed) {
      const prior = from?.id
        ? await db(`ach_inbox?select=id&bot=eq.${bot}&from_id=eq.${from.id}&note=eq.${q('tidak diizinkan')}&limit=1`)
        : [{}];
      const row = await insertRow('gagal', 'tidak diizinkan');
      if (!row) return;
      const firstTime = Array.isArray(prior) && prior.length === 0;
      if (firstTime && !fromBot && chatType !== 'channel') {
        await sendText(bot, inc.chat.id,
          '🙏 Maaf, bot ini privat untuk tim internal ACHPHORIA CORPORATION, jadi belum bisa membantu. Terima kasih sudah mampir!', { replyTo });
      }
      return;
    }

    // --- perintah cepat ---
    const quick = cmd && (!cmd.target || cmd.target === me) && ['status', 'tugas', 'help', 'bantuan', 'start'].includes(cmd.name) ? cmd.name : null;
    if (quick) {
      const row = await insertRow('selesai', 'perintah cepat /' + quick);
      if (!row) return;
      let text: string;
      try {
        text = quick === 'status' ? await statusText() : quick === 'tugas' ? await tasksText(cmd!.args) : helpText(bot);
      } catch (e) {
        text = '⚠️ Gagal membaca data kantor: ' + redact(e);
        await patchInbox(row.id, { status: 'gagal', note: 'perintah cepat gagal: ' + redact(e) });
      }
      await sendText(bot, inc.chat.id, text, { replyTo });
      return;
    }

    // --- pesan biasa → inbox + wake asisten ---
    const row = await insertRow('baru', inc.kind.startsWith('edited') ? '(pesan diedit)' : null);
    if (!row) return;
    await tg(bot, 'sendChatAction', { chat_id: inc.chat.id, action: 'typing' });
    const d = DIVISION[bot];
    const w = await wake(bot, {
      source: 'telegram', bot, inbox_id: row.id, chat_id: inc.chat.id, chat_type: chatType, chat_title: baseRow.chat_title,
      from_name: baseRow.from_name, text: inc.text, message_id: inc.messageId,
      edited: inc.kind.startsWith('edited') || undefined,
      prompt: `Pesan Telegram baru untuk bot ${d.name} (@${me}) dari ${baseRow.from_name ?? 'owner'}` +
        `${isPrivate ? ' (chat pribadi)' : ` di grup "${baseRow.chat_title ?? inc.chat.id}"`}: "${inc.text}". ` +
        `inbox_id=${row.id}, chat_id=${inc.chat.id}, message_id=${inc.messageId}. ` +
        `Ikuti docs/AGENT-GUIDE.md: claim → report kerja → ack → kerjakan → report Selesai → send --inbox ${row.id}.`,
    });
    await patchInbox(row.id, { note: [inc.kind.startsWith('edited') ? '(pesan diedit)' : null, w.note].filter(Boolean).join(' · ') });
    if (!w.ok && env('WAKE_FAIL_NOTICE') !== '0') {
      await sendText(bot, inc.chat.id, `📥 Pesanmu sudah kucatat (#${row.id}), tapi asisten ${d.name} belum bisa dibangunkan otomatis. Nanti dicek dari inbox ya.`, { replyTo, silent: true });
    }
  }

  async function handleTelegram(req: Request, bot: string): Promise<Response> {
    if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405);
    const secret = env('TG_WEBHOOK_SECRET');
    if (!secret || !(await safeEqual(req.headers.get('x-telegram-bot-api-secret-token'), secret))) {
      return json({ ok: false, error: 'unauthorized' }, 401);
    }
    if (!isAgent(bot)) return json({ ok: false, error: 'bot tidak dikenal' }, 404);
    let update: Json;
    try { update = await req.json(); } catch { return json({ ok: true, ignored: 'bukan JSON' }); }
    const job = processUpdate(bot, update).catch((e) => warn(`gagal memproses update ${update?.update_id} (${bot}):`, redact(e)));
    if (deps.waitUntil) deps.waitUntil(job);
    else await job;
    return json({ ok: true });
  }

  /* ---------- API untuk asisten ---------- */
  const str = (v: unknown) => (v === undefined || v === null ? null : String(v));
  const intOrNull = (v: unknown, name: string): number | null => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    if (!Number.isSafeInteger(n)) throw new HttpError(400, `${name} harus bilangan bulat`);
    return n;
  };
  const needBot = (b: Json): AgentId => {
    if (!isAgent(b)) throw new HttpError(400, 'bot wajib salah satu dari: ' + AGENTS.join(', '));
    return b;
  };
  const needInboxId = (v: unknown): number => {
    const n = intOrNull(v, 'inbox_id');
    if (!n) throw new HttpError(400, 'inbox_id wajib');
    return n;
  };

  async function ownerChat(bot: AgentId): Promise<number | null> {
    const allow: Json[] = await db('ach_tg_allow?select=from_id&order=created_at.asc');
    if (!allow.length) return null;
    const ids = allow.map((a) => a.from_id);
    const chats: Json[] = await db(`ach_tg_chats?select=chat_id&bot=eq.${bot}&chat_type=eq.private&chat_id=in.(${ids.join(',')})`);
    const known = new Set(chats.map((c) => Number(c.chat_id)));
    const first = ids.find((id) => known.has(Number(id)));
    return first === undefined ? null : Number(first);
  }

  /** chat_id eksplisit (harus dikenal bot) atau default chat pribadi owner. */
  async function resolveChat(bot: AgentId, raw: unknown): Promise<number> {
    let chatId = intOrNull(raw, 'chat_id');
    if (chatId === null) {
      chatId = await ownerChat(bot);
      if (chatId === null) throw new HttpError(409, `belum ada chat pribadi owner dengan @${botUsername(bot)} — owner perlu kirim /start ke bot ini dulu`);
    } else {
      const known: Json[] = await db(`ach_tg_chats?select=chat_id&bot=eq.${bot}&chat_id=eq.${chatId}&limit=1`);
      if (!known.length) throw new HttpError(403, `chat ${chatId} belum dikenal oleh @${botUsername(bot)} (lihat action 'chats')`);
    }
    return chatId;
  }

  /** Chat milik owner: chat pribadi user allowlist, atau grup HQ (role 'hq' / judul "ACHPHORIA HQ"). */
  async function isOwnerChat(bot: AgentId, chatId: number): Promise<boolean> {
    const rows: Json[] = await db(`ach_tg_chats?select=chat_type,title,role&bot=eq.${bot}&chat_id=eq.${chatId}&limit=1`);
    const c = rows[0];
    if (!c) return false;
    if (c.chat_type === 'private') return isAllowed(chatId);
    return (c.chat_type === 'group' || c.chat_type === 'supergroup') && (c.role === 'hq' || HQ_TITLE.test(String(c.title ?? '')));
  }

  /* ---------- ERP (v5) ---------- */
  const needErpAgent = async (b: Json, action: string): Promise<AgentId> => {
    const bot = needBot(b);
    if (!ERP_AGENTS.includes(bot)) {
      await erpAudit({ agent: bot, action, sql: null, ok: false, error: 'agen tidak diizinkan' });
      throw new HttpError(403, `${action} hanya untuk agen ${ERP_AGENTS.join(' / ')} (bukan ${bot})`);
    }
    return bot;
  };
  async function erpAudit(row: { agent: string; action: string; sql: string | null; row_count?: number | null; truncated?: boolean | null; ms?: number | null; ok: boolean; error?: string | null }) {
    try { await db('ach_erp_audit', { method: 'POST', body: row, prefer: 'return=minimal' }); } catch (e) { warn('audit ERP gagal:', redact(e)); }
  }
  const erpError = (e: unknown) => {
    const status = e instanceof HttpError ? e.status : 502;
    return new HttpError(status, 'erp: ' + redact(e).replace(/^database:\s*/, ''));
  };

  const TASK_COLS = 'id,title,status,agent_id';
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  /** Cari tugas berdasarkan id (uuid penuh atau 8 karakter awal, mis. dari "Tugas #1a2b3c4d") atau judul (agen ini, utamakan yang belum Selesai). */
  async function findTask(agent: AgentId | null, ref: { id?: string | null; title?: string | null }, pool?: TaskRef[]): Promise<TaskRef | null> {
    const id = ref.id ? String(ref.id).trim().replace(/^#/, '').toLowerCase() : '';
    if (id) {
      if (UUID_RE.test(id)) {
        const rows: TaskRef[] = await db(`ach_tasks?select=${TASK_COLS}&id=eq.${q(id)}&limit=1`);
        return rows[0] ?? null;
      }
      if (!/^[0-9a-f]{4,8}$/.test(id)) throw new HttpError(400, 'task_id harus uuid atau 4–8 karakter heksadesimal awal (mis. 1a2b3c4d)');
      const rows: TaskRef[] = pool ?? await db(`ach_tasks?select=${TASK_COLS}&order=updated_at.desc&limit=2000`);
      const hits = rows.filter((t) => String(t.id).toLowerCase().startsWith(id));
      if (hits.length > 1) throw new HttpError(409, `task_id #${id} ambigu (${hits.length} tugas); pakai id lebih panjang`);
      return hits[0] ?? null;
    }
    const title = ref.title ? String(ref.title).trim().toLowerCase() : '';
    if (!title) return null;
    const rows: TaskRef[] = (pool ?? await db(`ach_tasks?select=${TASK_COLS}&agent_id=eq.${agent}&order=updated_at.desc&limit=2000`))
      .filter((t: TaskRef) => (!agent || t.agent_id === agent) && String(t.title).trim().toLowerCase() === title);
    return rows.find((t) => t.status !== 'Selesai') ?? rows[0] ?? null;
  }

  /**
   * report (+ feed grup log). body: status, location, activity, task, task_status, log,
   * task_note (catatan untuk grup log), task_event ('gagal' | 'approval'), task_id.
   */
  async function doReport(agent: AgentId, body: Json): Promise<Json> {
    const status = str(body.status), location = str(body.location);
    let taskStatus = str(body.task_status), task = str(body.task);
    const taskNote = str(body.task_note)?.trim() || null, taskIdRef = str(body.task_id);
    let taskEvent = str(body.task_event)?.toLowerCase() ?? null;
    if (taskEvent === 'fail' || taskEvent === 'failed') taskEvent = 'gagal';
    if (taskEvent === 'nunggu_approval' || taskEvent === 'menunggu_approval') taskEvent = 'approval';
    if (status && !(STATUSES as readonly string[]).includes(status)) throw new HttpError(400, 'status: ' + STATUSES.join(', '));
    if (location && !(ROOMS as readonly string[]).includes(location)) throw new HttpError(400, 'location: ' + ROOMS.join(', ') + " ('' = jadwal otomatis)");
    if (taskStatus && !(TASK_STATUSES as readonly string[]).includes(taskStatus)) throw new HttpError(400, 'task_status: ' + TASK_STATUSES.join(' | '));
    if (taskEvent && !(TASK_EVENTS as readonly string[]).includes(taskEvent)) throw new HttpError(400, 'task_event: ' + TASK_EVENTS.join(' | '));
    for (const k of ['log', 'activity', 'task', 'task_note'] as const) {
      const why = sensitiveReason(str(body[k]));
      if (why) throw new HttpError(400, `${k} ditolak: ${why}. Data ini tampil publik (website / grup log) — tulis tanpa angka sensitif.`);
    }
    if ((taskEvent || taskNote) && !task && !taskIdRef) throw new HttpError(400, 'task_event/task_note butuh task (judul) atau task_id');

    // keadaan tugas sebelum laporan → bedakan tugas baru / perubahan status (tanpa spam bila status sama)
    let before: TaskRef[] | null = null;
    let target: TaskRef | null = null;
    if (task || taskIdRef) {
      try {
        before = await db(`ach_tasks?select=${TASK_COLS}&agent_id=eq.${agent}&order=updated_at.desc&limit=2000`);
      } catch (e) {
        if (taskIdRef || taskEvent) throw e;
        warn('baca tugas untuk feed gagal (laporan tetap jalan):', redact(e)); // feed dilewati, laporan tetap
      }
    }
    if (before) {
      if (taskIdRef) {
        target = await findTask(agent, { id: taskIdRef }, before!);
        if (!target) throw new HttpError(404, `tugas #${taskIdRef} milik ${agent} tidak ditemukan`);
        task = target.title;
      }
      if (taskEvent && !taskStatus) {
        // gagal / nunggu approval: status tugas di website tidak diubah
        target ??= await findTask(agent, { title: task }, before!);
        if (!target) throw new HttpError(404, `tugas "${task}" milik ${agent} tidak ditemukan`);
        task = null;
      }
    }
    if (task && !taskStatus) taskStatus = 'Sedang kerja'; // default sama dengan ach_report_activity

    let res: Json = null;
    const hasRpc = status !== null || location !== null || body.activity != null || task !== null || (body.log != null && String(body.log).trim() !== '');
    if (!hasRpc && !target) throw new HttpError(400, 'report kosong: isi minimal status/location/activity/task/log');
    if (hasRpc) {
      res = await db('rpc/ach_report_activity', {
        method: 'POST',
        body: {
          p_agent_id: agent, p_status: status, p_location: location, p_activity: str(body.activity),
          p_task: task, p_task_status: task ? taskStatus : str(body.task_status), p_log: str(body.log),
        },
      });
    }

    // feed grup log (best effort)
    let feed: Json = undefined;
    if (before) {
      const taskId: string | null = res?.task_id ?? target?.id ?? null;
      if (taskId) {
        const prev = before.find((t) => t.id === taskId) ?? null;
        const nowStatus = task ? taskStatus! : (target?.status ?? prev?.status ?? 'Terjadwal');
        const ref: TaskRef = { id: taskId, title: task ?? target?.title ?? prev?.title ?? '', status: nowStatus, agent_id: agent };
        const map: Record<string, FeedEvent> = { 'Sedang kerja': 'start', Selesai: 'done', Terjadwal: 'scheduled' };
        const events: FeedEvent[] = [];
        if (!prev) events.push('new');
        if (taskEvent) events.push(taskEvent as FeedEvent);
        else if (prev ? prev.status !== nowStatus : nowStatus !== 'Terjadwal') events.push(map[nowStatus]);
        const pick = (...v: unknown[]) => (v.find((x) => typeof x === 'string' && x.trim()) as string | undefined)?.trim() ?? null;
        const ev0 = events.find((e) => e !== 'new');
        const note = taskNote ?? (ev0 === 'start' ? pick(body.activity, body.log) : ev0 ? pick(body.log, body.activity) : null);
        if (events.length) feed = await feedTask(ref, events, note);
        else feed = { ok: true, posted: 0, skipped: 'status tugas tidak berubah' };
      }
    }
    return { ok: true, result: res, ...(feed !== undefined ? { log_feed: feed } : {}) };
  }

  async function api(body: Json): Promise<Json> {
    const action = String(body?.action ?? '');
    switch (action) {
      case 'ping': {
        const bot = body.bot && isAgent(body.bot) ? body.bot : null;
        const cfg = (b: AgentId) => ({ token: !!env('TG_TOKEN_' + UP(b)), wake_url: !!env('WAKE_URL_' + UP(b)), wake_key: !!env('WAKE_KEY_' + UP(b)) });
        let logs: boolean | null = null;
        try { logs = (await logChatId()) !== null; } catch { /* db tidak tersedia */ }
        return { ok: true, version: VERSION, logs_group: logs, configured: bot ? { [bot]: cfg(bot) } : Object.fromEntries(AGENTS.map((a) => [a, cfg(a)])) };
      }
      case 'send': {
        const bot = needBot(body.bot);
        const text = str(body.text);
        if (!text || !text.trim()) throw new HttpError(400, 'text wajib');
        const parseMode = body.parse_mode ? String(body.parse_mode) : null;
        if (parseMode && parseMode !== 'HTML') throw new HttpError(400, "parse_mode hanya boleh 'HTML' (default teks biasa)");
        if (parseMode && text.length > TG_LIMIT) throw new HttpError(400, 'pesan HTML > 4000 karakter; kirim sebagai teks biasa atau pecah sendiri');
        const chatId = await resolveChat(bot, body.chat_id);
        const inboxId = intOrNull(body.inbox_id, 'inbox_id');
        const r = await sendText(bot, chatId, text, { replyTo: intOrNull(body.reply_to_message_id, 'reply_to_message_id'), parseMode, silent: !!body.silent });
        if (inboxId && r.ok) {
          await db(`ach_inbox?id=eq.${inboxId}&bot=eq.${bot}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'selesai', handled_at: now().toISOString() } });
        }
        if (!r.ok) throw new HttpError(502, 'telegram: ' + (r.results.find((x) => !x.ok)?.error ?? 'gagal'));
        return { ok: true, chat_id: chatId, parts: r.parts, message_ids: r.results.map((x) => x.message_id), inbox_done: !!inboxId };
      }
      case 'send_photo':
      case 'send_file': {
        const bot = needBot(body.bot);
        const mode = action === 'send_photo' ? 'photo' : 'document';
        const name = safeName(str(body.filename) ?? '');
        const data = str(body.file_base64);
        if (!data) throw new HttpError(400, 'file_base64 wajib');
        if (data.length > Math.ceil(DOC_MAX / 3) * 4 + 128) throw new HttpError(413, `file terlalu besar (maks ${DOC_MAX / 1048576}MB)`);
        let bytes: Uint8Array;
        try { bytes = b64decode(data); } catch { throw new HttpError(400, 'file_base64 tidak valid'); }
        const chk = checkFile(name, bytes, mode);
        if ('error' in chk) throw new HttpError(/terlalu besar/.test(chk.error) ? 413 : 400, chk.error);
        const caption = str(body.caption);
        if (caption !== null && caption.length > 1024) throw new HttpError(400, 'caption maks 1024 karakter');
        const chatId = await resolveChat(bot, body.chat_id);
        if (caption !== null) {
          // v5: bot ops boleh menulis nominal (Rp …) di caption untuk owner (chat pribadi / grup HQ)
          const relaxed = bot === 'ops' && await isOwnerChat(bot, chatId);
          const why = relaxed ? opsAmountReason(caption) : sensitiveReason(caption);
          if (why) throw new HttpError(400, `caption ditolak: ${why}.`);
        }
        const inboxId = intOrNull(body.inbox_id, 'inbox_id');
        const r = await sendFile(bot, chatId, mode, chk.kind, bytes, name, { caption, replyTo: intOrNull(body.reply_to_message_id, 'reply_to_message_id'), silent: !!body.silent });
        if (!r.ok) throw new HttpError(502, 'telegram: ' + (r.error ?? 'gagal'));
        if (inboxId) {
          await db(`ach_inbox?id=eq.${inboxId}&bot=eq.${bot}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'selesai', handled_at: now().toISOString() } });
        }
        return { ok: true, chat_id: chatId, method: r.method, fallback: r.fallback, message_id: r.message_id, bytes: bytes.length, inbox_done: !!inboxId };
      }
      case 'typing': {
        const bot = needBot(body.bot);
        const chatId = intOrNull(body.chat_id, 'chat_id') ?? await ownerChat(bot);
        if (chatId === null) throw new HttpError(409, 'chat_id tidak diketahui');
        const r = await tg(bot, 'sendChatAction', { chat_id: chatId, action: 'typing' });
        if (!r.ok) throw new HttpError(502, 'telegram: ' + r.description);
        return { ok: true };
      }
      case 'inbox': {
        const bot = needBot(body.bot);
        const status = String(body.status ?? 'baru');
        if (status !== 'semua' && status !== 'all' && !(INBOX_STATUSES as readonly string[]).includes(status)) {
          throw new HttpError(400, 'status: ' + INBOX_STATUSES.join(', ') + ', atau semua');
        }
        const limit = Math.min(Math.max(intOrNull(body.limit, 'limit') ?? 20, 1), 100);
        const cols = 'id,created_at,bot,chat_id,chat_type,chat_title,from_id,from_name,from_username,text,message_id,reply_to_message_id,status,handled_at,note' + (body.full ? ',update' : '');
        let path = `ach_inbox?select=${cols}&bot=eq.${bot}&limit=${limit}`;
        if (status === 'semua' || status === 'all') path += '&order=id.desc';
        else path += `&status=eq.${status}&order=id.${status === 'baru' ? 'asc' : 'desc'}`;
        const rows = await db(path);
        return { ok: true, count: rows.length, rows };
      }
      case 'claim': {
        const id = needInboxId(body.inbox_id);
        let path = `ach_inbox?id=eq.${id}&status=eq.baru`;
        if (body.bot) path += `&bot=eq.${needBot(body.bot)}`;
        const rows = await db(path + '&select=id,bot,chat_id,chat_type,chat_title,from_name,text,message_id,status', {
          method: 'PATCH', prefer: 'return=representation', body: { status: 'diproses', note: str(body.note) ?? undefined },
        });
        if (!rows.length) {
          const cur: Json[] = await db(`ach_inbox?id=eq.${id}&select=id,status,bot`);
          if (!cur.length) throw new HttpError(404, `inbox #${id} tidak ada`);
          return { ok: false, claimed: false, error: `inbox #${id} sudah berstatus '${cur[0].status}'`, row: cur[0] };
        }
        return { ok: true, claimed: true, row: rows[0] };
      }
      case 'done':
      case 'fail': {
        const id = needInboxId(body.inbox_id);
        let path = `ach_inbox?id=eq.${id}`;
        if (body.bot) path += `&bot=eq.${needBot(body.bot)}`;
        const patch: Json = { status: action === 'done' ? 'selesai' : 'gagal', handled_at: now().toISOString() };
        if (body.note !== undefined && body.note !== null) patch.note = String(body.note).slice(0, 2000);
        const rows = await db(path + '&select=id,status,note', { method: 'PATCH', prefer: 'return=representation', body: patch });
        if (!rows.length) throw new HttpError(404, `inbox #${id} tidak ada`);
        return { ok: true, row: rows[0] };
      }
      case 'report':
        return await doReport(needBot(body.bot), body);
      case 'task': {
        // event tugas eksplisit: new | start | done | fail | approval (+ opsional inbox_id → status inbox ikut diubah)
        const bot = needBot(body.bot);
        const ev = String(body.event ?? '').toLowerCase();
        const EV: Record<string, Json> = {
          new: { task_status: 'Terjadwal' }, baru: { task_status: 'Terjadwal' },
          start: { task_status: 'Sedang kerja' }, mulai: { task_status: 'Sedang kerja' }, claim: { task_status: 'Sedang kerja' },
          done: { task_status: 'Selesai' }, selesai: { task_status: 'Selesai' },
          fail: { task_event: 'gagal' }, gagal: { task_event: 'gagal' }, approval: { task_event: 'approval' },
        };
        if (!EV[ev]) throw new HttpError(400, 'event: new | start | done | fail | approval');
        const agent = body.agent ? needBot(body.agent) : bot;
        if (agent !== bot && !['new', 'baru'].includes(ev)) throw new HttpError(400, 'agent lain hanya untuk event new (Chief menugaskan divisi)');
        const title = str(body.title ?? body.task);
        if (!title && !body.task_id) throw new HttpError(400, 'title (judul tugas) atau task_id wajib');
        if (['new', 'baru'].includes(ev) && !title) throw new HttpError(400, 'event new butuh title');
        const inboxId = intOrNull(body.inbox_id, 'inbox_id');
        const r = await doReport(agent, {
          ...EV[ev], task: title, task_id: body.task_id, task_note: body.note,
          status: body.status, location: body.location, activity: body.activity, log: body.log,
        });
        if (inboxId) {
          const isStart = EV[ev].task_status === 'Sedang kerja';
          const patch: Json = isStart ? { status: 'diproses' } : { status: ev === 'fail' || ev === 'gagal' ? 'gagal' : ev === 'approval' ? 'diproses' : 'selesai', handled_at: now().toISOString() };
          if (body.note != null && !isStart) patch.note = String(body.note).slice(0, 2000);
          try {
            await db(`ach_inbox?id=eq.${inboxId}&bot=eq.${bot}${isStart ? '&status=eq.baru' : ''}`, { method: 'PATCH', prefer: 'return=minimal', body: patch });
            r.inbox = { id: inboxId, status: patch.status };
          } catch (e) { r.inbox = { id: inboxId, error: redact(e) }; }
        }
        return r;
      }
      case 'log': {
        // posting bebas ke grup log sebagai bot sendiri, berutas di bawah tugas bila diberi task/task_id
        const bot = needBot(body.bot);
        const text = str(body.text)?.trim();
        if (!text) throw new HttpError(400, 'text wajib');
        const why = sensitiveReason(text);
        if (why) throw new HttpError(400, `text ditolak: ${why}. Grup log bukan tempat angka sensitif.`);
        const chatId = await logChatId();
        if (chatId === null) throw new HttpError(409, 'grup log belum terdaftar — owner kirim /setlogs (atau /start di grup "… LOGS")');
        let replyTo: number | null = null, task: TaskRef | null = null;
        if (body.task_id || body.task) {
          task = await findTask(bot, { id: str(body.task_id), title: str(body.task) });
          if (!task) throw new HttpError(404, 'tugas tidak ditemukan');
          const root = await ensureRoot(chatId, task, null);
          replyTo = root.message_id;
        }
        const r = await sendText(bot, chatId, feedLine('note', bot, text), { replyTo });
        if (!r.ok) throw new HttpError(502, 'telegram: ' + (r.results.find((x) => !x.ok)?.error ?? 'gagal'));
        return { ok: true, message_ids: r.results.map((x) => x.message_id), task_id: task?.id ?? null, reply_to: replyTo };
      }
      case 'erp_query': {
        const bot = await needErpAgent(body.bot, 'erp_query');
        const sqlText = str(body.sql)?.trim() ?? '';
        if (!sqlText) throw new HttpError(400, 'sql wajib (satu SELECT / WITH … SELECT)');
        if (sqlText.length > ERP_SQL_MAX) throw new HttpError(400, `sql terlalu panjang (maks ${ERP_SQL_MAX} karakter)`);
        const limit = Math.min(Math.max(intOrNull(body.limit, 'limit') ?? 50, 1), ERP_MAX_ROWS);
        const t0 = Date.now();
        let res: Json = null, err: unknown = null;
        try { res = await db('rpc/ach_erp_query', { method: 'POST', body: { p_sql: sqlText, p_max_rows: limit } }); } catch (e) { err = e; }
        const ms = Date.now() - t0;
        await erpAudit({
          agent: bot, action: 'erp_query', sql: sqlText, row_count: res?.row_count ?? null, truncated: res?.truncated ?? null, ms,
          ok: !err, error: err ? redact(err).slice(0, 500) : null,
        });
        if (err) throw erpError(err);
        return {
          ok: true, agent: bot, columns: res?.columns ?? [], rows: res?.rows ?? [], row_count: res?.row_count ?? 0,
          truncated: !!res?.truncated, max_rows: res?.max_rows ?? limit, ms,
        };
      }
      case 'erp_schema': {
        const bot = await needErpAgent(body.bot, 'erp_schema');
        const table = str(body.table)?.trim() || null;
        if (table && !/^[a-z_][a-z0-9_]{0,62}$/i.test(table)) throw new HttpError(400, 'nama tabel tidak valid');
        const t0 = Date.now();
        let res: Json = null, err: unknown = null;
        try { res = await db('rpc/ach_erp_schema', { method: 'POST', body: { p_table: table } }); } catch (e) { err = e; }
        const ms = Date.now() - t0;
        await erpAudit({ agent: bot, action: 'erp_schema', sql: table, row_count: Array.isArray(res) ? res.length : null, ms, ok: !err, error: err ? redact(err).slice(0, 500) : null });
        if (err) throw erpError(err);
        const tables: Json[] = Array.isArray(res) ? res : [];
        if (table && !tables.length) throw new HttpError(404, `tabel ${table} tidak ada di allowlist ERP (lihat erp_schema tanpa table)`);
        return { ok: true, agent: bot, count: tables.length, tables, ms };
      }
      case 'chats': {
        const bot = needBot(body.bot);
        const rows = await db(`ach_tg_chats?select=chat_id,chat_type,title,username,role,last_seen&bot=eq.${bot}&order=last_seen.desc&limit=100`);
        return { ok: true, count: rows.length, rows };
      }
      default:
        throw new HttpError(400, 'action tidak dikenal. Pilihan: send, send_photo, send_file, typing, inbox, claim, done, fail, report, task, log, chats, erp_query, erp_schema, ping');
    }
  }

  const handleFx = createFx({ db, env, now, safeEqual });

  async function handleApi(req: Request): Promise<Response> {
    if (req.method !== 'POST') return json({ ok: false, error: 'pakai POST' }, 405);
    const key = env('BRIDGE_KEY');
    if (!key || !(await safeEqual(req.headers.get('x-ach-key'), key))) return json({ ok: false, error: 'unauthorized' }, 401);
    let body: Json;
    try { body = await req.json(); } catch { return json({ ok: false, error: 'body harus JSON' }, 400); }
    try {
      return json(await api(body));
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status >= 500) warn('api error:', redact(e));
      return json({ ok: false, error: redact(e) }, status);
    }
  }

  /* ---------- router ---------- */
  return async function handler(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const segs = url.pathname.split('/').filter(Boolean);
    const at = segs.indexOf('ach-bridge');
    const rest = at >= 0 ? segs.slice(at + 1) : segs;
    let route = rest[0] ?? url.searchParams.get('action') ?? '';
    const bot = rest[1] ?? url.searchParams.get('bot') ?? '';
    if (route === 'telegram') route = 'tg';
    if (!route && req.method === 'GET') route = 'health';
    try {
      if (route === 'health') return json({ ok: true, service: 'ach-bridge', version: VERSION });
      if (route === 'tg') return await handleTelegram(req, bot.toLowerCase());
      if (route === 'api') return await handleApi(req);
      if (route === 'fx') return await handleFx(req, rest.slice(1), url);
      return json({ ok: false, error: 'not found' }, 404);
    } catch (e) {
      warn('unhandled:', redact(e));
      // ke Telegram tetap 200 supaya tidak di-retry terus-menerus
      return json({ ok: route === 'tg', error: 'internal' }, route === 'tg' ? 200 : 500);
    }
  };
}
