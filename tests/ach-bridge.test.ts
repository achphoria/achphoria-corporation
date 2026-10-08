// Tes lokal Edge Function ach-bridge dengan Supabase (PostgREST) & Telegram tiruan.
// Jalankan: deno test --allow-none tests/ach-bridge.test.ts   (tanpa jaringan, tanpa secret asli)
import { FakeDb } from './fake-postgrest.ts';
import { createHandler, parseCommand, sensitiveReason, opsAmountReason, splitText, safeEqual, sniffKind, checkFile, PHOTO_MAX } from '../supabase/functions/ach-bridge/handler.ts';

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
function assert(c: unknown, msg = 'assertion failed'): asserts c { if (!c) throw new Error(msg); }
function eq<T>(a: T, b: T, msg = '') { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); }

const TOKENS: Record<string, string> = {
  chief: '1000001:AAchiefSECRETtokenXXXXXXXXXXXXXXXX',
  research: '1000002:AAresearchSECRETtokenXXXXXXXXXXXXX',
  ops: '1000003:AAopsSECRETtokenXXXXXXXXXXXXXXXXXX',
  content: '1000004:AAcontentSECRETtokenXXXXXXXXXXXXXX',
  engineering: '1000005:AAengineeringSECRETtokenXXXXXXXXXX',
};
const OWNER = 777;
const HQ = -100500;
const LOGS = -100900;

interface Env { [k: string]: string }
function setup(extraEnv: Env = {}, opts: { wakeStatus?: number; tgThrow?: boolean; photoError?: string } = {}) {
  const db = new FakeDb();
  const tgCalls: { bot: string; method: string; body: Row }[] = [];
  const wakeCalls: { url: string; headers: Headers; body: Row }[] = [];
  const logs: string[] = [];
  let msgId = 5000;
  const env: Env = {
    SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'eyJfake.service.role.key',
    TG_WEBHOOK_SECRET: 'whsec-123456789', TG_CLAIM_CODE: 'CLAIM-abc123', BRIDGE_KEY: 'bridgekey-0123456789',
    ...Object.fromEntries(Object.entries(TOKENS).map(([k, v]) => ['TG_TOKEN_' + k.toUpperCase(), v])),
    ...extraEnv,
  };
  // deno-lint-ignore require-await
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    let body: Row;
    if (init?.body instanceof FormData) {
      body = {};
      for (const [k, v] of init.body.entries()) body[k] = typeof v === 'string' ? v : { name: (v as File).name, size: (v as File).size, type: (v as File).type };
    } else body = init?.body ? JSON.parse(String(init.body)) : undefined as unknown as Row;
    const headers = new Headers(init?.headers);
    if (url.hostname === 'fake.supabase.co') {
      assert(headers.get('apikey') === env.SUPABASE_SERVICE_ROLE_KEY, 'apikey header');
      return db.handle(url, init?.method ?? 'GET', headers.get('prefer') ?? '', body);
    }
    if (url.hostname === 'api.telegram.org') {
      const m = /^\/bot([^/]+)\/(\w+)$/.exec(url.pathname)!;
      const bot = Object.entries(TOKENS).find(([, v]) => v === m[1])?.[0] ?? '?';
      if (opts.tgThrow) throw new TypeError(`error sending request for url (${url.href}): connection refused`);
      tgCalls.push({ bot, method: m[2], body });
      if (m[2] === 'sendPhoto' && opts.photoError) return Response.json({ ok: false, error_code: 400, description: opts.photoError });
      return Response.json({ ok: true, result: /^send(Message|Photo|Document)$/.test(m[2]) ? { message_id: ++msgId } : true });
    }
    if (url.hostname === 'wake.example') {
      wakeCalls.push({ url: url.href, headers, body });
      return new Response('ok', { status: opts.wakeStatus ?? 200 });
    }
    throw new Error('unexpected fetch ' + url.href);
  };
  const handler = createHandler({ env: (k) => env[k], fetch: fakeFetch as typeof fetch, log: (...a) => logs.push(a.map(String).join(' ')) });
  // seed data kantor
  db.tables.ach_agents.push(
    { id: 'chief', name: 'Chief of Staff', status: 'kerja', location: 'meeting', activity: 'Stand-up', current_task: 'Rencana Q4', updated_at: new Date().toISOString(), sort_order: 1 },
    { id: 'research', name: 'Research', status: 'istirahat', location: 'tea', activity: 'Seduh teh', current_task: null, updated_at: new Date(Date.now() - 5 * 3600e3).toISOString(), sort_order: 2 },
  );
  db.tables.ach_tasks.push(
    { agent_id: 'research', title: 'Riset tren skincare', status: 'Sedang kerja', due_at: null },
    { agent_id: 'ops', title: 'Rekap mingguan', status: 'Terjadwal', due_at: '2026-10-09T03:00:00Z' },
  );
  let upd = 1;
  const tgPost = (bot: string, update: Row, secret = env.TG_WEBHOOK_SECRET) =>
    handler(new Request(`http://localhost/ach-bridge/tg/${bot}`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret },
      body: JSON.stringify({ update_id: update.update_id ?? upd++, ...update }),
    }));
  const api = (body: Row, key = env.BRIDGE_KEY) =>
    handler(new Request('http://localhost/functions/v1/ach-bridge/api', { method: 'POST', headers: { 'x-ach-key': key, 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  const owner = { id: OWNER, is_bot: false, first_name: 'Eight', last_name: 'Bit', username: 'eightbit' };
  const priv = (text: string, from: Row = owner, extra: Row = {}) => ({ message: { message_id: 10 + upd, from, chat: { id: from.id, type: 'private', first_name: from.first_name }, date: 1, text, ...extra } });
  const grp = (text: string, from: Row = owner, extra: Row = {}) => ({ message: { message_id: 10 + upd, from, chat: { id: HQ, type: 'supergroup', title: 'ACHPHORIA HQ' }, date: 1, text, ...extra } });
  const lg = (text: string, from: Row = owner, extra: Row = {}) => ({ message: { message_id: 10 + upd, from, chat: { id: LOGS, type: 'supergroup', title: 'ACHPHORIA LOGS' }, date: 1, text, ...extra } });
  const allowOwner = () => db.tables.ach_tg_allow.push({ from_id: OWNER, note: 'test', created_at: '2026-01-01T00:00:00Z' });
  const sends = () => tgCalls.filter((c) => c.method === 'sendMessage');
  return { db, env, handler, tgCalls, wakeCalls, logs, tgPost, api, priv, grp, lg, owner, allowOwner, sends };
}

Deno.test('util: parseCommand / splitText / sensitiveReason / safeEqual', async () => {
  eq(parseCommand('/status@Ach_Ops_Bot'), { name: 'status', target: 'ach_ops_bot', args: '' });
  eq(parseCommand('/tugas research'), { name: 'tugas', target: null, args: 'research' });
  eq(parseCommand('halo /status'), null);
  const long = ('baris '.repeat(30) + '\n').repeat(60); // ~10.9k
  const parts = splitText(long);
  assert(parts.length === 3 && parts.every((p) => p.length <= 4000), 'split');
  eq(parts.join('').replace(/\s/g, '').length, long.replace(/\s/g, '').length, 'tak ada teks hilang');
  const emoji = '😀'.repeat(2500); // 5000 code units
  assert(splitText(emoji).every((p) => !/[\ud800-\udbff]$/.test(p)), 'surrogate utuh');
  assert(sensitiveReason('bayar Rp50.000') && sensitiveReason('rp 20rb') && sensitiveReason('IDR 5000'));
  assert(sensitiveReason('hubungi 081234567890') && sensitiveReason('+62 812-3456-7890') && sensitiveReason('0812 3456 7890'));
  assert(!sensitiveReason('mulai riset tren skincare 2026') && !sensitiveReason('rapat jam 10.30') && !sensitiveReason('cek rpm mesin') && !sensitiveReason('Sharpie'));
  assert(await safeEqual('abc', 'abc') && !(await safeEqual('abc', 'abd')) && !(await safeEqual('', '')) && !(await safeEqual(null, 'x')));
});

Deno.test('health & routing', async () => {
  const s = setup();
  const r = await s.handler(new Request('http://localhost/ach-bridge/health'));
  eq(await r.json(), { ok: true, service: 'ach-bridge', version: 'v5.0.0' });
  eq((await s.handler(new Request('http://localhost/ach-bridge?action=health'))).status, 200);
  eq((await s.handler(new Request('http://localhost/ach-bridge/nope', { method: 'POST' }))).status, 404);
});

Deno.test('webhook: secret salah/kosong → 401, tanpa efek', async () => {
  const s = setup();
  eq((await s.tgPost('chief', s.priv('halo'), 'salah')).status, 401);
  eq((await s.tgPost('chief', s.priv('halo'), '')).status, 401);
  const noSecret = setup({ TG_WEBHOOK_SECRET: '' });
  eq((await noSecret.tgPost('chief', noSecret.priv('halo'), 'apa saja')).status, 401);
  eq(s.db.tables.ach_inbox.length + s.tgCalls.length, 0);
  eq((await s.tgPost('bukanbot', s.priv('halo'))).status, 404);
});

Deno.test('tidak diizinkan: dicatat gagal, dibalas sopan SEKALI, tidak wake', async () => {
  const s = setup({ WAKE_URL_RESEARCH: 'https://wake.example/research' });
  const stranger = { id: 999, is_bot: false, first_name: 'Orang' };
  eq((await s.tgPost('research', s.priv('halo bot', stranger))).status, 200);
  await s.tgPost('research', s.priv('halo lagi', stranger));
  eq(s.db.tables.ach_inbox.map((r) => [r.status, r.note]), [['gagal', 'tidak diizinkan'], ['gagal', 'tidak diizinkan']]);
  eq(s.sends().length, 1, 'balasan sekali');
  assert(/privat/.test(s.sends()[0].body.text));
  eq(s.wakeCalls.length, 0);
  eq(s.db.tables.ach_tg_chats.length, 1);
});

Deno.test('klaim owner: /start <kode> menambah allowlist, kode tidak tersimpan', async () => {
  const s = setup();
  await s.tgPost('content', s.priv('/start salah-kode'));
  eq(s.db.tables.ach_tg_allow.length, 0);
  await s.tgPost('content', s.priv('/start CLAIM-abc123'));
  eq(s.db.tables.ach_tg_allow.map((r) => r.from_id), [OWNER]);
  const dump = JSON.stringify(s.db.tables);
  assert(!dump.includes('CLAIM-abc123') && !dump.includes('salah-kode'), 'kode tidak boleh tersimpan');
  assert(/sudah masuk daftar owner/.test(s.sends().at(-1)!.body.text));
  // di grup: ditolak + peringatan, tidak menambah
  const g = setup();
  await g.tgPost('chief', g.grp('/start@ach_chief_bot CLAIM-abc123'));
  eq(g.db.tables.ach_tg_allow.length, 0);
  assert(/chat pribadi/.test(g.sends()[0].body.text));
});

Deno.test('pesan owner → inbox baru + typing + wake (bearer default)', async () => {
  const s = setup({ WAKE_URL_RESEARCH: 'https://wake.example/research', WAKE_KEY_RESEARCH: 'wakekey-research-1' });
  s.allowOwner();
  await s.tgPost('research', s.priv('tolong riset tren skincare'));
  const row = s.db.tables.ach_inbox[0];
  eq([row.status, row.text, row.from_name, row.chat_type], ['baru', 'tolong riset tren skincare', 'Eight Bit', 'private']);
  assert(s.tgCalls.some((c) => c.method === 'sendChatAction' && c.body.action === 'typing'));
  eq(s.wakeCalls.length, 1);
  const w = s.wakeCalls[0];
  eq(w.headers.get('authorization'), 'Bearer wakekey-research-1');
  eq([w.body.source, w.body.bot, w.body.inbox_id, w.body.chat_id, w.body.text], ['telegram', 'research', row.id, OWNER, 'tolong riset tren skincare']);
  assert(/wake ok/.test(row.note));
  eq(s.sends().length, 0, 'tidak ada notifikasi gagal');
});

Deno.test('wake: gaya query & header mentah, per-bot override, gagal tidak memutus', async () => {
  const q = setup({ WAKE_URL_OPS: 'https://wake.example/ops?x=1', WAKE_KEY_OPS: 'k-ops-123456', WAKE_KEY_STYLE: 'query', WAKE_KEY_PARAM: 'sender_key' });
  q.allowOwner();
  await q.tgPost('ops', q.priv('cek data'));
  eq(new URL(q.wakeCalls[0].url).searchParams.get('sender_key'), 'k-ops-123456');
  eq(q.wakeCalls[0].headers.get('authorization'), null);
  const h = setup({ WAKE_URL_OPS: 'https://wake.example/ops', WAKE_KEY_OPS: 'k-ops-123456', WAKE_KEY_HEADER: 'X-Sender-Key', WAKE_KEY_STYLE: 'raw' });
  h.allowOwner();
  await h.tgPost('ops', h.priv('cek data'));
  eq(h.wakeCalls[0].headers.get('x-sender-key'), 'k-ops-123456');
  const f = setup({ WAKE_URL_OPS: 'https://wake.example/ops', WAKE_KEY_OPS: 'k-ops-123456' }, { wakeStatus: 403 });
  f.allowOwner();
  eq((await f.tgPost('ops', f.priv('cek data'))).status, 200);
  const row = f.db.tables.ach_inbox[0];
  eq(row.status, 'baru');
  assert(/wake gagal: HTTP 403/.test(row.note) && !row.note.includes('k-ops-123456'));
  assert(/belum bisa dibangunkan/.test(f.sends()[0].body.text));
});

Deno.test('wake belum dikonfigurasi: tetap tersimpan di inbox', async () => {
  const s = setup();
  s.allowOwner();
  eq((await s.tgPost('engineering', s.priv('deploy dong'))).status, 200);
  const row = s.db.tables.ach_inbox[0];
  eq(row.status, 'baru');
  assert(/WAKE_URL_ENGINEERING kosong/.test(row.note));
  eq(s.wakeCalls.length, 0);
});

Deno.test('perintah cepat /status /tugas /help', async () => {
  const s = setup({ WAKE_URL_CHIEF: 'https://wake.example/chief' });
  s.allowOwner();
  await s.tgPost('chief', s.priv('/status'));
  const st = s.sends()[0].body.text as string;
  assert(st.includes('Chief of Staff') && st.includes('Rapat di Kotatsu') && st.includes('Stasiun Teh') && st.includes('data basi'), st);
  await s.tgPost('chief', s.priv('/tugas research'));
  const tg = s.sends()[1].body.text as string;
  assert(tg.includes('Riset tren skincare') && !tg.includes('Rekap mingguan'), tg);
  await s.tgPost('chief', s.priv('/tugas'));
  assert((s.sends()[2].body.text as string).includes('Rekap mingguan'));
  await s.tgPost('chief', s.priv('/help'));
  assert((s.sends()[3].body.text as string).includes('/status'));
  eq(s.wakeCalls.length, 0, 'perintah cepat tidak membangunkan asisten');
  assert(s.db.tables.ach_inbox.every((r) => r.status === 'selesai'));
});

Deno.test('grup HQ: aturan mention/reply/command & chief sebagai penerima default', async () => {
  const s = setup();
  s.allowOwner();
  await s.tgPost('research', s.grp('halo semua'));
  eq(s.db.tables.ach_inbox.length, 0, 'research abaikan pesan tanpa mention');
  await s.tgPost('chief', s.grp('halo semua'));
  eq(s.db.tables.ach_inbox.length, 1, 'chief menangani pesan umum owner');
  const mention = s.grp('@ach_research_bot cek tren', s.owner, { entities: [{ type: 'mention', offset: 0, length: 17 }] });
  await s.tgPost('research', mention);
  await s.tgPost('chief', mention);
  eq(s.db.tables.ach_inbox.map((r) => r.bot), ['chief', 'research'], 'chief tidak ikut bila bot lain di-mention');
  await s.tgPost('research', s.grp('lanjut ya', s.owner, { reply_to_message: { message_id: 1, from: { id: 1000002, is_bot: true, username: 'ach_research_bot' } } }));
  eq(s.db.tables.ach_inbox.at(-1)!.bot, 'research', 'reply ke pesan bot');
  const before = s.db.tables.ach_inbox.length;
  await s.tgPost('chief', s.grp('/status@ach_ops_bot'));
  eq(s.db.tables.ach_inbox.length, before, 'chief abaikan /cmd@bot_lain');
  await s.tgPost('ops', s.grp('/status@ach_ops_bot'));
  eq(s.db.tables.ach_inbox.at(-1)!.note, 'perintah cepat /status');
  // non-owner di grup: chief tidak menganggapnya ditujukan (tidak ada balasan spam)
  const n = s.sends().length;
  await s.tgPost('chief', s.grp('halo', { id: 4242, is_bot: false, first_name: 'Tamu' }));
  eq(s.sends().length, n);
});

Deno.test('pesan dari bot: abaikan kecuali mention; saudara = diizinkan; bot asing = gagal tanpa balasan', async () => {
  const s = setup({ WAKE_URL_OPS: 'https://wake.example/ops' });
  const researchBot = { id: 1000002, is_bot: true, first_name: 'Research', username: 'ach_research_bot' };
  await s.tgPost('ops', s.grp('update data dong', researchBot));
  await s.tgPost('chief', s.grp('update data dong', researchBot));
  eq(s.db.tables.ach_inbox.length, 0, 'tanpa mention diabaikan (cegah loop)');
  await s.tgPost('ops', s.grp('@ach_ops_bot minta data penjualan', researchBot));
  eq(s.db.tables.ach_inbox[0].status, 'baru');
  eq(s.wakeCalls.length, 1);
  const alien = { id: 31337, is_bot: true, first_name: 'Spam', username: 'spam_bot' };
  await s.tgPost('ops', s.grp('@ach_ops_bot halo', alien));
  eq(s.db.tables.ach_inbox[1].status, 'gagal');
  eq(s.sends().length, 0);
  await s.tgPost('ops', s.grp('@ach_ops_bot echo', { id: 1000003, is_bot: true, username: 'ach_ops_bot' }));
  eq(s.db.tables.ach_inbox.length, 2, 'pesan sendiri diabaikan');
});

Deno.test('update ganda (retry Telegram) hanya diproses sekali; my_chat_member mencatat chat', async () => {
  const s = setup({ WAKE_URL_CHIEF: 'https://wake.example/chief' });
  s.allowOwner();
  const u = { update_id: 4242, ...s.priv('halo') };
  await s.tgPost('chief', u);
  await s.tgPost('chief', u);
  eq(s.db.tables.ach_inbox.length, 1);
  eq(s.wakeCalls.length, 1);
  await s.tgPost('content', { my_chat_member: { chat: { id: HQ, type: 'supergroup', title: 'ACHPHORIA HQ' }, from: s.owner, new_chat_member: { status: 'member' } } });
  assert(s.db.tables.ach_tg_chats.some((c) => c.bot === 'content' && c.chat_id === HQ && c.title === 'ACHPHORIA HQ'));
});

Deno.test('callback_query & foto ber-caption', async () => {
  const s = setup();
  s.allowOwner();
  await s.tgPost('content', { callback_query: { id: 'cb1', from: s.owner, data: 'setuju_publish', message: { message_id: 3, chat: { id: OWNER, type: 'private' } } } });
  assert(s.tgCalls.some((c) => c.method === 'answerCallbackQuery'));
  eq(s.db.tables.ach_inbox[0].text, 'setuju_publish');
  await s.tgPost('content', { message: { message_id: 9, from: s.owner, chat: { id: OWNER, type: 'private' }, photo: [{}], caption: 'pakai ini buat IG' } });
  eq(s.db.tables.ach_inbox[1].text, '[foto] pakai ini buat IG');
});

Deno.test('waitUntil: respons 200 dulu, kerja di latar', async () => {
  const s = setup();
  s.allowOwner();
  const jobs: Promise<unknown>[] = [];
  let dbCalls = 0;
  const slowFetch = async (i: string | URL | Request, init?: RequestInit) => {
    await new Promise((r) => setTimeout(r, 20));
    const url = new URL(String(i));
    if (url.hostname !== 'fake.supabase.co') return Response.json({ ok: true, result: { message_id: 1 } });
    dbCalls++;
    return s.db.handle(url, init?.method ?? 'GET', new Headers(init?.headers).get('prefer') ?? '', init?.body ? JSON.parse(String(init.body)) : undefined);
  };
  const h = createHandler({ env: (k) => s.env[k], fetch: slowFetch as typeof fetch, waitUntil: (p) => jobs.push(p), log: () => {} });
  const res = await h(new Request('http://x/ach-bridge/tg/chief', { method: 'POST', headers: { 'x-telegram-bot-api-secret-token': s.env.TG_WEBHOOK_SECRET }, body: JSON.stringify({ update_id: 1, ...s.priv('halo') }) }));
  eq(res.status, 200);
  eq([jobs.length, dbCalls, s.db.tables.ach_inbox.length], [1, 0, 0], 'belum ada kerja saat respons dikirim');
  await Promise.all(jobs);
  eq(s.db.tables.ach_inbox.length, 1);
});

Deno.test('API: auth, send (owner default, split, outbox, inbox selesai), chat tak dikenal', async () => {
  const s = setup();
  eq((await s.api({ action: 'ping' }, 'salah')).status, 401);
  eq((await s.api({ action: 'ping' }, '')).status, 401);
  const ping = await (await s.api({ action: 'ping' })).json();
  eq(ping.configured.research, { token: true, wake_url: false, wake_key: false });
  // belum ada owner → 409
  eq((await s.api({ action: 'send', bot: 'research', text: 'hai' })).status, 409);
  s.allowOwner();
  await s.tgPost('research', s.priv('tolong riset'));
  const inboxId = s.db.tables.ach_inbox[0].id;
  const n0 = s.sends().length; // (notifikasi 'belum bisa dibangunkan' karena WAKE_URL kosong)
  const text = ('x'.repeat(99) + '\n').repeat(50); // 5000 karakter → 2 bagian
  const r = await (await s.api({ action: 'send', bot: 'research', text, reply_to_message_id: 42, inbox_id: inboxId })).json();
  eq([r.ok, r.chat_id, r.parts, r.inbox_done], [true, OWNER, 2, true]);
  const sm = s.sends().slice(n0);
  eq(sm[0].body.reply_parameters.message_id, 42);
  eq(sm[1].body.reply_parameters, undefined);
  eq(s.db.tables.ach_outbox.length, n0 + 2);
  assert(s.db.tables.ach_outbox.every((o) => o.ok));
  eq(s.db.tables.ach_inbox[0].status, 'selesai');
  eq((await s.api({ action: 'send', bot: 'research', chat_id: 123, text: 'hai' })).status, 403);
  eq((await s.api({ action: 'send', bot: 'research', text: 'hai', parse_mode: 'Markdown' })).status, 400);
  eq((await s.api({ action: 'send', bot: 'hacker', text: 'hai' })).status, 400);
  // grup HQ dikenal setelah ada update dari grup
  await s.tgPost('research', s.grp('@ach_research_bot hai', s.owner));
  const g = await (await s.api({ action: 'send', bot: 'research', chat_id: HQ, text: '<b>progres</b> 50%', parse_mode: 'HTML' })).json();
  eq(g.chat_id, HQ);
  eq(s.sends().at(-1)!.body.parse_mode, 'HTML');
  const chats = await (await s.api({ action: 'chats', bot: 'research' })).json();
  eq(chats.rows.map((c: Row) => c.chat_id).sort(), [OWNER, HQ].sort());
});

Deno.test('API: inbox / claim / done / fail', async () => {
  const s = setup();
  s.allowOwner();
  await s.tgPost('ops', s.priv('satu'));
  await s.tgPost('ops', s.priv('dua'));
  const list = await (await s.api({ action: 'inbox', bot: 'ops' })).json();
  eq(list.rows.map((r: Row) => r.text), ['satu', 'dua']);
  assert(!('update' in list.rows[0]) || list.rows[0].update !== undefined);
  const c1 = await (await s.api({ action: 'claim', inbox_id: list.rows[0].id, bot: 'ops' })).json();
  eq([c1.ok, c1.claimed, s.db.tables.ach_inbox[0].status], [true, true, 'diproses']);
  const c2 = await (await s.api({ action: 'claim', inbox_id: list.rows[0].id })).json();
  eq([c2.ok, c2.claimed], [false, false]);
  eq((await s.api({ action: 'claim', inbox_id: 999 })).status, 404);
  await s.api({ action: 'done', inbox_id: list.rows[0].id, note: 'beres' });
  await s.api({ action: 'fail', inbox_id: list.rows[1].id, note: 'butuh akses' });
  eq(s.db.tables.ach_inbox.map((r) => [r.status, r.note]), [['selesai', 'beres'], ['gagal', 'butuh akses']]);
  eq((await s.api({ action: 'inbox', bot: 'ops', status: 'aneh' })).status, 400);
  const all = await (await s.api({ action: 'inbox', bot: 'ops', status: 'semua' })).json();
  eq(all.count, 2);
});

Deno.test('API: report → RPC ach_report_activity + validasi', async () => {
  const s = setup();
  const ok = await (await s.api({ action: 'report', bot: 'research', status: 'kerja', location: 'desk', activity: 'riset tren', task: 'Riset tren skincare', task_status: 'Sedang kerja', log: 'mulai riset' })).json();
  eq(ok.ok, true);
  eq(s.db.rpc[0], { p_agent_id: 'research', p_status: 'kerja', p_location: 'desk', p_activity: 'riset tren', p_task: 'Riset tren skincare', p_task_status: 'Sedang kerja', p_log: 'mulai riset' });
  await s.api({ action: 'report', bot: 'ops', location: '' });
  eq(s.db.rpc[1].p_location, '', "'' = jadwal otomatis diteruskan");
  eq(s.db.rpc[1].p_status, null);
  for (const bad of [
    { bot: 'research', location: 'kantin' }, { bot: 'research', status: 'sibuk' }, { bot: 'research', task: 'x', task_status: 'selesai' },
    { bot: 'research', log: 'bayar Rp 50.000' }, { bot: 'research', log: 'telp 081234567890' }, { bot: 'research', activity: 'transfer 1234567890' },
    { bot: 'marketing', status: 'kerja' },
  ]) {
    const r = await s.api({ action: 'report', ...bad });
    eq(r.status, 400, JSON.stringify(bad));
  }
  eq(s.db.rpc.length, 2);
});

Deno.test('rahasia tidak pernah bocor ke log/respons/DB', async () => {
  const s = setup({ WAKE_URL_CHIEF: 'https://wake.example/chief', WAKE_KEY_CHIEF: 'super-wake-key-zzz' }, { tgThrow: true });
  s.allowOwner();
  await s.tgPost('chief', s.priv('halo'));
  const res = await s.api({ action: 'send', bot: 'chief', text: 'hai' });
  const body = await res.text();
  const all = [body, ...s.logs, JSON.stringify(s.db.tables)].join('\n');
  for (const v of [...Object.values(TOKENS), s.env.BRIDGE_KEY, s.env.TG_WEBHOOK_SECRET, s.env.TG_CLAIM_CODE, 'super-wake-key-zzz', s.env.SUPABASE_SERVICE_ROLE_KEY]) {
    assert(!all.includes(v), 'bocor: ' + v.slice(0, 8));
  }
  assert(body.includes('bot[token]') || body.includes('[rahasia]'), body);
});

/* ------------------------------------------------------------------ */
/* v4 — grup ACHPHORIA LOGS                                             */
/* ------------------------------------------------------------------ */
async function registerLogs(s: ReturnType<typeof setup>) {
  s.allowOwner();
  const u = s.lg('/start');
  for (const b of ['chief', 'research', 'ops', 'content', 'engineering']) await s.tgPost(b, { update_id: 9000, ...u });
}

Deno.test('LOGS: /start owner di grup "… LOGS" → terdaftar, konfirmasi sekali oleh Chief', async () => {
  const s = setup({ WAKE_URL_CHIEF: 'https://wake.example/chief' });
  await registerLogs(s);
  const logsRows = s.db.tables.ach_tg_chats.filter((c) => c.chat_id === LOGS);
  eq(logsRows.length, 5);
  assert(logsRows.find((c) => c.bot === 'chief')!.role === 'logs', 'chat LOGS ber-role logs');
  eq(new Set(s.db.tables.ach_tg_chats.filter((c) => c.role === 'logs').map((c) => c.chat_id)).size, 1);
  eq(s.sends().map((c) => [c.bot, c.body.chat_id]), [['chief', LOGS]]);
  assert(/Grup log ACHPHORIA aktif/.test(s.sends()[0].body.text));
  eq(s.db.tables.ach_inbox.map((r) => [r.bot, r.note]), [['chief', 'grup log didaftarkan']]);
  eq(s.wakeCalls.length, 0);
  // retry Telegram → tidak dobel
  await s.tgPost('chief', { update_id: 9000, ...s.lg('/start') });
  eq(s.sends().length, 1);
  // ping melaporkan grup log
  eq((await (await s.api({ action: 'ping' })).json()).logs_group, true);
});

Deno.test('LOGS: feed saja — pesan biasa/mention/perintah lain diabaikan, perintah cepat tetap jalan', async () => {
  const s = setup({ WAKE_URL_CHIEF: 'https://wake.example/chief', WAKE_URL_RESEARCH: 'https://wake.example/research' });
  await registerLogs(s);
  const n = s.sends().length, inb = s.db.tables.ach_inbox.length;
  await s.tgPost('chief', s.lg('halo semua'));
  await s.tgPost('research', s.lg('@ach_research_bot cek dong', s.owner, { entities: [{ type: 'mention', offset: 0, length: 17 }] }));
  await s.tgPost('chief', s.lg('/kerjakan sesuatu'));
  await s.tgPost('chief', s.lg('', s.owner, { photo: [{}] }));
  eq([s.sends().length, s.db.tables.ach_inbox.length, s.wakeCalls.length], [n, inb, 0], 'tidak ada balasan/inbox/wake');
  await s.tgPost('chief', s.lg('/status'));
  assert(/Status kantor/.test(s.sends().at(-1)!.body.text));
  // judul mengandung LOGS tapi belum terdaftar pun tetap diam
  const t = setup({ WAKE_URL_CHIEF: 'https://wake.example/chief' });
  t.allowOwner();
  await t.tgPost('chief', t.lg('halo'));
  eq([t.sends().length, t.db.tables.ach_inbox.length, t.wakeCalls.length], [0, 0, 0]);
  // non-owner /start di LOGS → tidak mendaftarkan, tanpa balasan
  const u = setup();
  await u.tgPost('chief', u.lg('/start', { id: 4242, is_bot: false, first_name: 'Tamu' }));
  eq([u.sends().length, u.db.tables.ach_tg_chats.filter((c) => c.role === 'logs').length], [0, 0]);
});

Deno.test('LOGS: /setlogs di grup lain memindahkan grup log; /unsetlogs menonaktifkan; HQ tetap normal', async () => {
  const s = setup();
  await registerLogs(s);
  await s.tgPost('chief', s.grp('/setlogs'));
  eq(s.db.tables.ach_tg_chats.filter((c) => c.role === 'logs').map((c) => c.chat_id), [HQ]);
  assert(/aktif/.test(s.sends().at(-1)!.body.text));
  await s.tgPost('chief', s.grp('/unsetlogs'));
  eq(s.db.tables.ach_tg_chats.filter((c) => c.role === 'logs').length, 0);
  assert(/dinonaktifkan/.test(s.sends().at(-1)!.body.text));
  await s.tgPost('chief', s.grp('halo semua'));
  eq(s.db.tables.ach_inbox.at(-1)!.text, 'halo semua', 'HQ kembali menerima pesan owner');
});

Deno.test('LOGS: migrasi grup → supergroup membawa role; pesan layanan tidak masuk inbox', async () => {
  const s = setup({ WAKE_URL_CHIEF: 'https://wake.example/chief' });
  s.allowOwner();
  const OLD = -900;
  await s.tgPost('chief', { message: { message_id: 1, from: s.owner, chat: { id: OLD, type: 'group', title: 'ACHPHORIA LOGS' }, date: 1, text: '/setlogs' } });
  eq(s.db.tables.ach_tg_chats.find((c) => c.chat_id === OLD)!.role, 'logs');
  await s.tgPost('chief', { message: { message_id: 2, from: s.owner, chat: { id: OLD, type: 'group', title: 'ACHPHORIA LOGS' }, date: 1, migrate_to_chat_id: LOGS } });
  eq(s.db.tables.ach_tg_chats.filter((c) => c.role === 'logs').map((c) => c.chat_id), [LOGS]);
  const inb = s.db.tables.ach_inbox.length;
  await s.tgPost('chief', s.grp('', s.owner, { new_chat_members: [{ id: 5, is_bot: false, first_name: 'X' }] }));
  await s.tgPost('chief', s.grp('', s.owner, { pinned_message: { message_id: 1 } }));
  eq([s.db.tables.ach_inbox.length, s.wakeCalls.length], [inb, 0]);
});

Deno.test('LOGS feed: tugas baru → induk Chief; mulai/selesai/gagal/approval → balasan berutas bot divisi', async () => {
  const s = setup();
  await registerLogs(s);
  const n0 = s.sends().length;
  const r1 = await (await s.api({ action: 'task', bot: 'research', event: 'new', title: 'Tes grup log' })).json();
  eq([r1.ok, r1.log_feed.ok, r1.log_feed.posted], [true, true, 1]);
  const task = s.db.tables.ach_tasks.find((t) => t.title === 'Tes grup log')!;
  eq(task.status, 'Terjadwal');
  const root = s.sends()[n0];
  eq([root.bot, root.body.chat_id], ['chief', LOGS]);
  eq(root.body.text, `📋 Tugas #${String(task.id).slice(0, 8)}: Tes grup log\nDivisi: Research\nStatus: Terjadwal`);
  const rootId = r1.log_feed.root_message_id;
  eq(s.db.tables.ach_tg_logmsg.map((r) => [r.task_id, r.chat_id, r.message_id]), [[task.id, LOGS, rootId]]);

  const r2 = await (await s.api({ action: 'task', bot: 'research', event: 'start', title: 'tes grup log', note: 'cek 3 sumber' })).json();
  eq(r2.log_feed.posted, 1);
  let m = s.sends().at(-1)!;
  eq([m.bot, m.body.text, m.body.reply_parameters.message_id], ['research', '🔄 Research: mulai kerja — cek 3 sumber', rootId]);
  eq(task.status, 'Sedang kerja');
  // report dengan status tugas sama → tidak spam
  const n1 = s.sends().length;
  const r3 = await (await s.api({ action: 'report', bot: 'research', activity: 'lanjut', task: 'Tes grup log', task_status: 'Sedang kerja' })).json();
  eq([r3.log_feed.posted, s.sends().length], [0, n1]);
  // nunggu approval & gagal tidak mengubah status tugas di website
  await s.api({ action: 'task', bot: 'research', event: 'approval', task_id: String(task.id).slice(0, 8), note: 'draf siap' });
  m = s.sends().at(-1)!;
  eq([m.body.text, m.body.reply_parameters.message_id], ['⏳ Research: nunggu approval owner — draf siap', rootId]);
  await s.api({ action: 'report', bot: 'research', task: 'Tes grup log', task_event: 'gagal', task_note: 'sumber tidak bisa diakses' });
  eq(s.sends().at(-1)!.body.text, '❌ Research: gagal — sumber tidak bisa diakses');
  eq(task.status, 'Sedang kerja');
  // selesai lewat report biasa (alur lama di AGENT-GUIDE) → ✅ otomatis, catatan dari --log
  await s.api({ action: 'report', bot: 'research', task: 'Tes grup log', task_status: 'Selesai', activity: 'merapikan catatan', log: 'selesai tes grup log ✔' });
  m = s.sends().at(-1)!;
  eq([m.bot, m.body.text, m.body.reply_parameters.message_id], ['research', '✅ Research: selesai — selesai tes grup log ✔', rootId]);
  eq(task.status, 'Selesai');
  eq(s.db.tables.ach_tg_logmsg.length, 1, 'satu induk per tugas');
  assert(s.db.tables.ach_outbox.filter((o) => o.chat_id === LOGS).length >= 6, 'feed tercatat di outbox');
});

Deno.test('LOGS feed: report tugas baru langsung "Sedang kerja" → induk + balasan; tugas lama tanpa induk dibuatkan induk', async () => {
  const s = setup();
  await registerLogs(s);
  const n0 = s.sends().length;
  await s.api({ action: 'report', bot: 'ops', status: 'kerja', task: 'Rekap harian', task_status: 'Sedang kerja', activity: 'tarik data' });
  const sm = s.sends().slice(n0);
  eq(sm.map((c) => c.bot), ['chief', 'ops']);
  assert(/Status: Sedang kerja/.test(sm[0].body.text));
  eq(sm[1].body.text, '🔄 Ops & Data: mulai kerja — tarik data');
  // tugas lama (sudah ada sebelum v4) → induk dibuat saat event pertama
  const n1 = s.sends().length;
  await s.api({ action: 'task', bot: 'research', event: 'done', title: 'Riset tren skincare', note: 'ringkasan terkirim' });
  const sm2 = s.sends().slice(n1);
  eq(sm2.map((c) => c.bot), ['chief', 'research']);
  assert(/Riset tren skincare/.test(sm2[0].body.text));
  eq(sm2[1].body.text, '✅ Research: selesai — ringkasan terkirim');
  // task + inbox: start → diproses, done → selesai
  await s.tgPost('research', s.priv('tolong riset'));
  const ib = s.db.tables.ach_inbox.at(-1)!;
  const r = await (await s.api({ action: 'task', bot: 'research', event: 'start', title: 'Riset baru', inbox_id: ib.id })).json();
  eq([r.inbox.status, ib.status], ['diproses', 'diproses']);
  await s.api({ action: 'task', bot: 'research', event: 'done', title: 'Riset baru', inbox_id: ib.id, note: 'beres' });
  eq([ib.status, ib.note], ['selesai', 'beres']);
  // validasi
  for (const bad of [
    { action: 'task', bot: 'research', event: 'hapus', title: 'x' }, { action: 'task', bot: 'research', event: 'start' },
    { action: 'task', bot: 'research', event: 'start', title: 'x', note: 'bayar Rp 50.000' },
    { action: 'task', bot: 'research', event: 'start', title: 'x', agent: 'ops' },
    { action: 'report', bot: 'research', task_event: 'gagal' }, { action: 'report', bot: 'research', task: 'x', task_event: 'aneh' },
  ]) eq((await s.api(bad)).status, 400, JSON.stringify(bad));
  eq((await s.api({ action: 'task', bot: 'research', event: 'fail', title: 'Tidak ada' })).status, 404);
  // Chief menugaskan divisi lain
  const n2 = s.sends().length;
  await s.api({ action: 'task', bot: 'chief', agent: 'content', event: 'new', title: 'Kalender konten' });
  assert(s.db.tables.ach_tasks.some((t) => t.agent_id === 'content' && t.title === 'Kalender konten' && t.status === 'Terjadwal'));
  assert(/Divisi: Content & Marketing/.test(s.sends()[n2].body.text));
});

Deno.test('LOGS feed: gagal kirim Telegram / grup belum terdaftar tidak memutus respons report', async () => {
  const none = setup();
  const r0 = await none.api({ action: 'report', bot: 'research', task: 'Tugas A', task_status: 'Terjadwal' });
  const j0 = await r0.json();
  eq([r0.status, j0.ok, j0.log_feed.skipped], [200, true, 'grup log belum terdaftar']);
  const s = setup({}, { tgThrow: true });
  s.allowOwner();
  s.db.tables.ach_tg_chats.push({ bot: 'chief', chat_id: LOGS, chat_type: 'supergroup', title: 'ACHPHORIA LOGS', role: 'logs', last_seen: new Date().toISOString() });
  const r = await s.api({ action: 'task', bot: 'research', event: 'start', title: 'Tugas B' });
  const j = await r.json();
  eq([r.status, j.ok, j.log_feed.ok], [200, true, false]);
  assert(s.db.tables.ach_tasks.some((t) => t.title === 'Tugas B' && t.status === 'Sedang kerja'), 'tugas tetap tercatat');
  assert(s.logs.some((l) => /feed grup log/.test(l)));
  assert(!JSON.stringify(j).includes(TOKENS.chief) && !s.logs.join('\n').includes(TOKENS.research));
});

Deno.test('LOGS: action log — posting bebas sebagai bot sendiri, berutas di bawah tugas, filter angka', async () => {
  const s = setup();
  s.allowOwner();
  eq((await s.api({ action: 'log', bot: 'ops', text: 'halo' })).status, 409);
  await registerLogs(s);
  const r = await (await s.api({ action: 'log', bot: 'ops', text: 'dashboard diperbarui' })).json();
  eq([r.ok, r.reply_to], [true, null]);
  eq([s.sends().at(-1)!.bot, s.sends().at(-1)!.body.text], ['ops', '📝 Ops & Data: dashboard diperbarui']);
  const t = await (await s.api({ action: 'log', bot: 'ops', text: 'progres 50%', task: 'rekap mingguan' })).json();
  const sm = s.sends().slice(-2);
  eq(sm.map((c) => c.bot), ['chief', 'ops'], 'induk dibuat dulu untuk tugas lama');
  eq(sm[1].body.reply_parameters.message_id, t.reply_to);
  const again = await (await s.api({ action: 'log', bot: 'ops', text: 'hampir beres', task_id: String(t.task_id).slice(0, 8) })).json();
  eq(again.reply_to, t.reply_to);
  for (const bad of ['transfer Rp 1.000', 'rek 1234567890', 'wa 0812 3456 7890']) eq((await s.api({ action: 'log', bot: 'ops', text: bad })).status, 400, bad);
  eq((await s.api({ action: 'log', bot: 'ops', text: 'x', task: 'tidak ada' })).status, 404);
  eq((await s.api({ action: 'log', bot: 'ops', text: 'x', task_id: 'zz' })).status, 400);
});

/* ---------- send_photo / send_file ---------- */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
const PDF = new TextEncoder().encode('%PDF-1.4\n%%EOF');
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));

Deno.test('file: sniffKind & checkFile (ekstensi + magic bytes + ukuran)', () => {
  eq([sniffKind(PNG), sniffKind(JPG), sniffKind(PDF), sniffKind(new Uint8Array([1, 2, 3]))], ['png', 'jpg', 'pdf', null]);
  eq(checkFile('a.PNG', PNG, 'photo'), { kind: 'png' });
  eq(checkFile('a.jpeg', JPG, 'photo'), { kind: 'jpg' });
  assert('error' in checkFile('a.pdf', PDF, 'photo'), 'pdf bukan foto');
  eq(checkFile('a.pdf', PDF, 'document'), { kind: 'pdf' });
  assert('error' in checkFile('a.png', PDF, 'document'), 'magic tidak cocok');
  assert('error' in checkFile('a.exe', PNG, 'document'), 'ekstensi');
  const big = new Uint8Array(21 * 1024 * 1024); big.set(PDF);
  assert('error' in checkFile('a.pdf', big, 'document'), 'terlalu besar');
});

Deno.test('send_photo: default chat owner, multipart sendPhoto, caption, reply, outbox, inbox selesai', async () => {
  const s = setup();
  s.allowOwner();
  await s.tgPost('research', s.priv('halo'));
  const r = await s.api({ action: 'send_photo', bot: 'research', filename: '/x/../grafik.png', file_base64: b64(PNG), caption: 'grafik minggu ini', reply_to_message_id: 9, inbox_id: 1 });
  const j = await r.json();
  eq([r.status, j.ok, j.method, j.chat_id], [200, true, 'sendPhoto', OWNER]);
  const c = s.tgCalls.filter((x) => x.method === 'sendPhoto').at(-1)!;
  eq([c.bot, c.body.chat_id, c.body.caption, c.body.photo.name, c.body.photo.type, c.body.photo.size], ['research', String(OWNER), 'grafik minggu ini', 'grafik.png', 'image/png', PNG.length]);
  eq(JSON.parse(c.body.reply_parameters).message_id, 9);
  const ob = s.db.tables.ach_outbox.at(-1)!;
  eq([ob.ok, ob.text, ob.telegram_message_id], [true, '[photo] grafik.png — grafik minggu ini', j.message_id]);
  eq(s.db.tables.ach_inbox.find((x) => x.id === 1)?.status, 'selesai');
});

Deno.test('send_photo: fallback ke sendDocument bila Telegram menolak foto', async () => {
  const s = setup({}, { photoError: 'Bad Request: PHOTO_INVALID_DIMENSIONS' });
  s.allowOwner();
  await s.tgPost('ops', s.priv('halo'));
  const j = await (await s.api({ action: 'send_photo', bot: 'ops', filename: 'a.jpg', file_base64: b64(JPG) })).json();
  eq([j.ok, j.method], [true, 'sendDocument']);
  assert(/PHOTO_INVALID/.test(j.fallback));
  eq(s.tgCalls.at(-1)!.body.document.type, 'image/jpeg');
});

Deno.test('send_photo: foto > 10MB langsung sebagai dokumen', async () => {
  const s = setup();
  s.allowOwner();
  await s.tgPost('ops', s.priv('halo'));
  const big = new Uint8Array(PHOTO_MAX + 10); big.set(PNG);
  let bin = ''; for (let i = 0; i < big.length; i += 8192) bin += String.fromCharCode(...big.subarray(i, i + 8192));
  const j = await (await s.api({ action: 'send_photo', bot: 'ops', filename: 'a.png', file_base64: btoa(bin) })).json();
  eq([j.ok, j.method], [true, 'sendDocument']);
  eq(s.tgCalls.filter((x) => x.method === 'sendPhoto').length, 0);
});

Deno.test('send_file: pdf, chat dikenal, validasi & filter caption & auth', async () => {
  const s = setup();
  s.allowOwner();
  await s.tgPost('chief', s.grp('halo'));
  const j = await (await s.api({ action: 'send_file', bot: 'chief', chat_id: HQ, filename: 'laporan.pdf', file_base64: b64(PDF), caption: 'laporan' })).json();
  eq([j.ok, j.method, j.chat_id], [true, 'sendDocument', HQ]);
  eq(s.tgCalls.at(-1)!.body.document.type, 'application/pdf');
  eq((await s.api({ action: 'send_file', bot: 'chief', chat_id: -1009999, filename: 'a.pdf', file_base64: b64(PDF) })).status, 403);
  eq((await s.api({ action: 'send_file', bot: 'chief', chat_id: HQ, filename: 'a.pdf', file_base64: b64(PDF), caption: 'transfer Rp 5.000' })).status, 400);
  eq((await s.api({ action: 'send_file', bot: 'chief', chat_id: HQ, filename: 'a.pdf', file_base64: b64(PDF), caption: 'wa 0812 3456 7890' })).status, 400);
  eq((await s.api({ action: 'send_file', bot: 'chief', chat_id: HQ, filename: 'a.pdf', file_base64: b64(PNG) })).status, 400);
  eq((await s.api({ action: 'send_photo', bot: 'chief', chat_id: HQ, filename: 'a.pdf', file_base64: b64(PDF) })).status, 400);
  eq((await s.api({ action: 'send_file', bot: 'chief', chat_id: HQ, filename: 'a.pdf' })).status, 400);
  eq((await s.api({ action: 'send_file', bot: 'chief', chat_id: HQ, filename: 'a.pdf', file_base64: '%%%' })).status, 400);
  eq((await s.api({ action: 'send_file', bot: 'chief', filename: 'a.pdf', file_base64: b64(PDF) }, 'salah')).status, 401);
  eq((await s.api({ action: 'send_file', bot: 'research', filename: 'a.pdf', file_base64: b64(PDF) })).status, 409);
  eq(s.tgCalls.filter((x) => x.method === 'sendDocument').length, 1, 'yang ditolak tidak terkirim');
});

/* ---------- v5: akses baca ERP ---------- */
Deno.test('erp_query: hanya ops/chief, RPC service_role, audit tanpa hasil, limit dibatasi', async () => {
  const s = setup();
  const r = await s.api({ action: 'erp_query', bot: 'ops', sql: 'select count(*) n from pos_orders', limit: 999 });
  const j = await r.json();
  eq([r.status, j.ok, j.agent, j.columns, j.rows, j.row_count, j.truncated], [200, true, 'ops', ['n'], [{ n: 3 }], 1, false]);
  assert(typeof j.ms === 'number');
  eq(s.db.erpCalls.at(-1), { fn: 'ach_erp_query', body: { p_sql: 'select count(*) n from pos_orders', p_max_rows: 200 } });
  const a = s.db.tables.ach_erp_audit.at(-1)!;
  eq([a.agent, a.action, a.sql, a.row_count, a.ok], ['ops', 'erp_query', 'select count(*) n from pos_orders', 1, true]);
  assert(!('rows' in a) && !JSON.stringify(a).includes('"n":3'), 'audit tidak menyimpan hasil');
  eq((await (await s.api({ action: 'erp_query', bot: 'chief', sql: 'select 1' })).json()).ok, true, 'chief boleh');
  eq(s.db.erpCalls.at(-1)!.body.p_max_rows, 50, 'default 50');
  // agen lain ditolak (dan dicatat), tanpa memanggil RPC
  const n = s.db.erpCalls.length;
  for (const bot of ['research', 'content', 'engineering']) {
    const x = await s.api({ action: 'erp_query', bot, sql: 'select 1' });
    eq(x.status, 403, bot);
    assert(/hanya untuk agen ops/.test((await x.json()).error));
  }
  eq(s.db.erpCalls.length, n, 'RPC tidak dipanggil untuk agen lain');
  eq(s.db.tables.ach_erp_audit.filter((x) => !x.ok && x.error === 'agen tidak diizinkan').length, 3);
  eq((await s.api({ action: 'erp_query', bot: 'ops', sql: '  ' })).status, 400);
  eq((await s.api({ action: 'erp_query', bot: 'ops', sql: 'select ' + 'x'.repeat(8000) })).status, 400);
  eq((await s.api({ action: 'erp_query', bot: 'ops', sql: 'select 1' }, 'salah')).status, 401);
});

Deno.test('erp_query: penolakan database diteruskan sebagai 4xx + dicatat gagal', async () => {
  const s = setup();
  s.db.erp.ach_erp_query = () => ({ status: 400, json: { code: '22023', message: 'erp_query ditolak: hanya SELECT atau WITH … SELECT' } });
  const r = await s.api({ action: 'erp_query', bot: 'ops', sql: 'delete from pos_orders' });
  const j = await r.json();
  eq([r.status, j.ok], [400, false]);
  assert(/^erp: erp_query ditolak: hanya SELECT/.test(j.error), j.error);
  const a = s.db.tables.ach_erp_audit.at(-1)!;
  eq([a.ok, a.sql, a.row_count], [false, 'delete from pos_orders', null]);
  assert(/hanya SELECT/.test(a.error));
  s.db.erp.ach_erp_query = () => ({ status: 403, json: { code: '42501', message: 'permission denied for table crm_customers' } });
  eq((await s.api({ action: 'erp_query', bot: 'ops', sql: 'select * from crm_customers' })).status, 400);
});

Deno.test('erp_schema: daftar tabel, filter table, validasi nama, hanya ops/chief', async () => {
  const s = setup();
  const j = await (await s.api({ action: 'erp_schema', bot: 'ops' })).json();
  eq([j.ok, j.count, j.tables[0].table], [true, 1, 'pos_orders']);
  eq(s.db.erpCalls.at(-1), { fn: 'ach_erp_schema', body: { p_table: null } });
  await s.api({ action: 'erp_schema', bot: 'ops', table: 'pos_orders' });
  eq(s.db.erpCalls.at(-1)!.body.p_table, 'pos_orders');
  eq((await s.api({ action: 'erp_schema', bot: 'ops', table: 'x; drop' })).status, 400);
  s.db.erp.ach_erp_schema = () => ({ status: 200, json: [] });
  eq((await s.api({ action: 'erp_schema', bot: 'ops', table: 'sys_users' })).status, 404);
  eq((await s.api({ action: 'erp_schema', bot: 'research' })).status, 403);
  eq(s.db.tables.ach_erp_audit.filter((x) => x.action === 'erp_schema').length, 4, 'nama tabel tidak valid ditolak sebelum audit');
});

Deno.test('v5 caption: ops → chat owner boleh nominal Rp, tetap tolak ≥12 digit / kartu / HP; chat lain & bot lain tetap ketat', async () => {
  assert(!opsAmountReason('Penjualan hari ini Rp 1.250.000 (Outlet A Rp 750.000)'));
  assert(!opsAmountReason('Total Rp125000000 dari 298 order'));
  assert(opsAmountReason('kartu 4111111111111111'), '≥12 digit');
  assert(opsAmountReason('kartu 4111 1111 1111 1111'), 'pola kartu');
  assert(opsAmountReason('wa 0812-3456-7890'), 'HP');
  const s = setup();
  s.allowOwner();
  await s.tgPost('ops', s.priv('halo'));
  await s.tgPost('ops', s.grp('@ach_ops_bot halo'));
  const send = (bot: string, caption: string, chat_id?: number) =>
    s.api({ action: 'send_photo', bot, filename: 'g.png', file_base64: b64(PNG), caption, ...(chat_id ? { chat_id } : {}) });
  eq((await send('ops', 'Penjualan hari ini Rp 1.250.000')).status, 200, 'chat pribadi owner');
  eq((await send('ops', 'Penjualan hari ini Rp 1.250.000', HQ)).status, 200, 'grup HQ');
  eq((await send('ops', 'kartu 4111111111111111')).status, 400);
  eq((await send('ops', 'hubungi 081234567890', HQ)).status, 400);
  // grup lain yang dikenal bot ops tetap filter ketat
  s.db.tables.ach_tg_chats.push({ bot: 'ops', chat_id: -100777, chat_type: 'supergroup', title: 'Grup Vendor' });
  eq((await send('ops', 'Penjualan Rp 1.250.000', -100777)).status, 400);
  // bot lain ke chat owner tetap ketat
  await s.tgPost('research', s.priv('halo'));
  eq((await send('research', 'Penjualan Rp 1.250.000')).status, 400);
});
