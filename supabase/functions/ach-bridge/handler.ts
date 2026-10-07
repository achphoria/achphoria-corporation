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
 * ⚠️ Jangan pernah me-log nilai token / key. Semua pesan error dilewatkan redact().
 */

export const AGENTS = ['chief', 'research', 'ops', 'content', 'engineering'] as const;
export type AgentId = (typeof AGENTS)[number];
export const ROOMS = ['desk', 'meeting', 'tea', 'ramen', 'tatami', 'vending', 'whiteboard', 'offline'] as const;
export const STATUSES = ['kerja', 'terjadwal', 'santai', 'istirahat', 'offline'] as const;
export const TASK_STATUSES = ['Sedang kerja', 'Terjadwal', 'Selesai'] as const;
export const INBOX_STATUSES = ['baru', 'diproses', 'selesai', 'gagal'] as const;
export const VERSION = 'v3.0.0';

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
  if (m.new_chat_members || m.left_chat_member || m.new_chat_title) return '';
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
    'TG_WEBHOOK_SECRET', 'TG_CLAIM_CODE', 'BRIDGE_KEY', 'ACH_SERVICE_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
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

  async function tg(bot: AgentId, method: string, payload: Json): Promise<Json> {
    const token = env('TG_TOKEN_' + UP(bot));
    if (!token) return { ok: false, description: 'TG_TOKEN_' + UP(bot) + ' belum di-set' };
    const base = (env('TG_API_BASE') ?? 'https://api.telegram.org').replace(/\/+$/, '');
    try {
      const res = await f(`${base}/bot${token}/${method}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });
      const j = await res.json().catch(() => ({ ok: false, description: 'HTTP ' + res.status }));
      if (!j.ok) j.description = redact(j.description ?? 'HTTP ' + res.status);
      return j;
    } catch (e) {
      return { ok: false, description: redact(e) };
    }
  }

  /** Kirim teks (dipecah bila panjang) + catat ke ach_outbox. */
  async function sendText(bot: AgentId, chatId: number, text: string, opts: { replyTo?: number | null; parseMode?: string | null; silent?: boolean } = {}) {
    const parts = splitText(text);
    const results: { ok: boolean; message_id?: number; error?: string }[] = [];
    for (let i = 0; i < parts.length; i++) {
      const payload: Json = { chat_id: chatId, text: parts[i], link_preview_options: { is_disabled: true } };
      if (opts.parseMode) payload.parse_mode = opts.parseMode;
      if (opts.silent) payload.disable_notification = true;
      if (i === 0 && opts.replyTo) payload.reply_parameters = { message_id: opts.replyTo, allow_sending_without_reply: true };
      const r = await tg(bot, 'sendMessage', payload);
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
  async function upsertChat(bot: AgentId, chat: Json) {
    if (!chat?.id) return;
    try {
      await db('ach_tg_chats?on_conflict=bot,chat_id', {
        method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
        body: { bot, chat_id: chat.id, chat_type: chat.type ?? null, title: chat.title ?? fullName(chat), username: chat.username ?? null, last_seen: now().toISOString() },
      });
    } catch (e) { warn('upsert chat gagal:', redact(e)); }
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
    await upsertChat(bot, inc.chat);
    if (inc.kind === 'callback_query' && inc.callbackId) await tg(bot, 'answerCallbackQuery', { callback_query_id: inc.callbackId });

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

  async function api(body: Json): Promise<Json> {
    const action = String(body?.action ?? '');
    switch (action) {
      case 'ping': {
        const bot = body.bot && isAgent(body.bot) ? body.bot : null;
        const cfg = (b: AgentId) => ({ token: !!env('TG_TOKEN_' + UP(b)), wake_url: !!env('WAKE_URL_' + UP(b)), wake_key: !!env('WAKE_KEY_' + UP(b)) });
        return { ok: true, version: VERSION, configured: bot ? { [bot]: cfg(bot) } : Object.fromEntries(AGENTS.map((a) => [a, cfg(a)])) };
      }
      case 'send': {
        const bot = needBot(body.bot);
        const text = str(body.text);
        if (!text || !text.trim()) throw new HttpError(400, 'text wajib');
        const parseMode = body.parse_mode ? String(body.parse_mode) : null;
        if (parseMode && parseMode !== 'HTML') throw new HttpError(400, "parse_mode hanya boleh 'HTML' (default teks biasa)");
        if (parseMode && text.length > TG_LIMIT) throw new HttpError(400, 'pesan HTML > 4000 karakter; kirim sebagai teks biasa atau pecah sendiri');
        let chatId = intOrNull(body.chat_id, 'chat_id');
        if (chatId === null) {
          chatId = await ownerChat(bot);
          if (chatId === null) throw new HttpError(409, `belum ada chat pribadi owner dengan @${botUsername(bot)} — owner perlu kirim /start ke bot ini dulu`);
        } else {
          const known: Json[] = await db(`ach_tg_chats?select=chat_id&bot=eq.${bot}&chat_id=eq.${chatId}&limit=1`);
          if (!known.length) throw new HttpError(403, `chat ${chatId} belum dikenal oleh @${botUsername(bot)} (lihat action 'chats')`);
        }
        const inboxId = intOrNull(body.inbox_id, 'inbox_id');
        const r = await sendText(bot, chatId, text, { replyTo: intOrNull(body.reply_to_message_id, 'reply_to_message_id'), parseMode, silent: !!body.silent });
        if (inboxId && r.ok) {
          await db(`ach_inbox?id=eq.${inboxId}&bot=eq.${bot}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'selesai', handled_at: now().toISOString() } });
        }
        if (!r.ok) throw new HttpError(502, 'telegram: ' + (r.results.find((x) => !x.ok)?.error ?? 'gagal'));
        return { ok: true, chat_id: chatId, parts: r.parts, message_ids: r.results.map((x) => x.message_id), inbox_done: !!inboxId };
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
      case 'report': {
        const bot = needBot(body.bot);
        const status = str(body.status), location = str(body.location), taskStatus = str(body.task_status);
        if (status && !(STATUSES as readonly string[]).includes(status)) throw new HttpError(400, 'status: ' + STATUSES.join(', '));
        if (location && !(ROOMS as readonly string[]).includes(location)) throw new HttpError(400, 'location: ' + ROOMS.join(', ') + " ('' = jadwal otomatis)");
        if (taskStatus && !(TASK_STATUSES as readonly string[]).includes(taskStatus)) throw new HttpError(400, 'task_status: ' + TASK_STATUSES.join(' | '));
        for (const k of ['log', 'activity', 'task'] as const) {
          const why = sensitiveReason(str(body[k]));
          if (why) throw new HttpError(400, `${k} ditolak: ${why}. Data ini tampil publik di website — tulis tanpa angka sensitif.`);
        }
        const res = await db('rpc/ach_report_activity', {
          method: 'POST',
          body: {
            p_agent_id: bot, p_status: status, p_location: location, p_activity: str(body.activity),
            p_task: str(body.task), p_task_status: taskStatus, p_log: str(body.log),
          },
        });
        return { ok: true, result: res };
      }
      case 'chats': {
        const bot = needBot(body.bot);
        const rows = await db(`ach_tg_chats?select=chat_id,chat_type,title,username,last_seen&bot=eq.${bot}&order=last_seen.desc&limit=100`);
        return { ok: true, count: rows.length, rows };
      }
      default:
        throw new HttpError(400, 'action tidak dikenal. Pilihan: send, typing, inbox, claim, done, fail, report, chats, ping');
    }
  }

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
      return json({ ok: false, error: 'not found' }, 404);
    } catch (e) {
      warn('unhandled:', redact(e));
      // ke Telegram tetap 200 supaya tidak di-retry terus-menerus
      return json({ ok: route === 'tg', error: 'internal' }, route === 'tg' ? 200 : 500);
    }
  };
}
