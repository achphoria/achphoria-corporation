// E2E lokal: jalankan index.ts SUNGGUHAN (deno run) + upstream tiruan (PostgREST/Telegram/wake)
// lalu kirim update Telegram via HTTP dan pakai tools/ach.mjs (node) terhadap fungsi lokal.
// Jalankan: deno run -A tests/e2e-local.ts    (tidak menyentuh jaringan luar / project Supabase asli)
import { FakeDb } from './fake-postgrest.ts';

const UP = 54321, FN = 54322;
const db = new FakeDb();
db.tables.ach_agents.push({ id: 'research', name: 'Research', status: 'kerja', location: 'desk', activity: 'baca', current_task: null, updated_at: new Date().toISOString(), sort_order: 2 });
const tg: { method: string; body: Record<string, unknown> }[] = [];
const wakes: { auth: string | null; body: Record<string, unknown> }[] = [];
let mid = 100;
const upstream = Deno.serve({ port: UP, hostname: '127.0.0.1', onListen: () => {} }, async (req) => {
  const url = new URL(req.url);
  const body = req.method === 'GET' ? undefined : await req.json().catch(() => undefined);
  if (url.pathname.startsWith('/rest/v1/')) return db.handle(url, req.method, req.headers.get('prefer') ?? '', body);
  if (url.pathname.startsWith('/tg/')) {
    const method = url.pathname.split('/').pop()!;
    tg.push({ method, body });
    return Response.json({ ok: true, result: method === 'sendMessage' ? { message_id: ++mid } : true });
  }
  if (url.pathname === '/wake/research') { wakes.push({ auth: req.headers.get('authorization'), body }); return new Response('ok'); }
  return new Response('nope', { status: 404 });
});

const secrets = { TG_WEBHOOK_SECRET: 'e2e-webhook-secret', TG_CLAIM_CODE: 'E2E-CLAIM', BRIDGE_KEY: 'e2e-bridge-key-123' };
const fnEnv = {
  ...secrets, SUPABASE_URL: `http://127.0.0.1:${UP}`, SUPABASE_SERVICE_ROLE_KEY: 'eyJ.e2e.service',
  TG_API_BASE: `http://127.0.0.1:${UP}/tg`, TG_TOKEN_RESEARCH: '2000002:AAe2eTokenForResearchBotXXXXXXXXXX',
  WAKE_URL_RESEARCH: `http://127.0.0.1:${UP}/wake/research`, WAKE_KEY_RESEARCH: 'e2e-wake-key',
  DENO_SERVE_ADDRESS: `tcp:127.0.0.1:${FN}`,
};
const fnPath = new URL('../supabase/functions/ach-bridge/index.ts', import.meta.url).pathname;
const child = new Deno.Command(Deno.execPath(), {
  args: ['run', '--allow-net', '--allow-env', fnPath], env: fnEnv, clearEnv: true, stdout: 'piped', stderr: 'piped',
}).spawn();
const logs: string[] = [];
(async () => { for await (const c of child.stderr.pipeThrough(new TextDecoderStream())) logs.push(c); })();
(async () => { for await (const c of child.stdout.pipeThrough(new TextDecoderStream())) logs.push(c); })();

const base = `http://127.0.0.1:${FN}/ach-bridge`;
for (let i = 0; i < 50; i++) {
  try { if ((await fetch(base + '/health')).ok) break; } catch { /* belum siap */ }
  await new Promise((r) => setTimeout(r, 100));
}
let failed = 0;
const check = (name: string, c: unknown) => { console.log((c ? '✔ ' : '✖ ') + name); if (!c) failed++; };
const tgPost = (update: Record<string, unknown>, secret = secrets.TG_WEBHOOK_SECRET) => fetch(base + '/tg/research', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret }, body: JSON.stringify(update),
});
const owner = { id: 4242, is_bot: false, first_name: 'Eight', last_name: 'Bit' };
const pm = (id: number, text: string) => ({ update_id: id, message: { message_id: id, from: owner, chat: { id: owner.id, type: 'private' }, date: 1, text } });
const cli = async (...args: string[]) => {
  const out = await new Deno.Command('node', { args: ['tools/ach.mjs', ...args], env: { ACH_BRIDGE_URL: base, ACH_BRIDGE_KEY: secrets.BRIDGE_KEY, HOME: '/nonexistent' } }).output();
  const txt = new TextDecoder().decode(out.stdout);
  return { code: out.code, json: txt.trim().startsWith('{') ? JSON.parse(txt) : null, err: new TextDecoder().decode(out.stderr) };
};

try {
  check('GET /health', (await (await fetch(base + '/health')).json()).ok === true);
  const r0 = await tgPost(pm(1, 'x'), 'salah');
  await r0.body?.cancel();
  check('webhook secret salah → 401', r0.status === 401 && db.tables.ach_inbox.length === 0);
  const r1 = await tgPost(pm(2, 'halo'));
  check('webhook owner belum terdaftar → 200 + balasan privat', r1.status === 200 && /privat/.test(String(tg.at(-1)?.body.text)));
  await tgPost(pm(3, '/start E2E-CLAIM'));
  check('klaim owner → allowlist', db.tables.ach_tg_allow.length === 1 && /owner/.test(String(tg.at(-1)?.body.text)));
  await tgPost(pm(4, '/status'));
  check('/status dijawab langsung', /Status kantor/.test(String(tg.at(-1)?.body.text)));
  await tgPost(pm(5, 'tolong riset tren skincare'));
  const row = db.tables.ach_inbox.at(-1)!;
  check('pesan biasa → inbox baru', row.status === 'baru' && row.text === 'tolong riset tren skincare');
  check('wake terkirim dgn Bearer + payload', wakes.length === 1 && wakes[0].auth === 'Bearer e2e-wake-key' && wakes[0].body.inbox_id === row.id);
  check('typing dikirim', tg.some((c) => c.method === 'sendChatAction'));
  const inbox = await cli('inbox', '--bot', 'research');
  check('CLI inbox', inbox.code === 0 && inbox.json.rows.length === 1 && inbox.json.rows[0].id === row.id);
  const claim = await cli('claim', String(row.id), '--bot', 'research');
  check('CLI claim → diproses', claim.code === 0 && db.tables.ach_inbox.at(-1)!.status === 'diproses');
  check('CLI claim ulang → gagal (exit 2)', (await cli('claim', String(row.id))).code === 2);
  const rep = await cli('report', '--bot', 'research', '--status', 'kerja', '--location', 'desk', '--activity', 'riset tren', '--task', 'Riset tren skincare', '--task-status', 'Sedang kerja', '--log', 'mulai riset');
  check('CLI report → RPC', rep.code === 0 && db.rpc.at(-1)?.p_task === 'Riset tren skincare');
  const send = await cli('send', '--bot', 'research', '--text', 'Selesai! Ringkasan terlampir.', '--reply', String(row.message_id), '--inbox', String(row.id));
  check('CLI send → chat owner + inbox selesai', send.code === 0 && send.json.chat_id === owner.id && db.tables.ach_inbox.at(-1)!.status === 'selesai');
  check('outbox tercatat', db.tables.ach_outbox.length >= 3);
  const chats = await cli('chats', '--bot', 'research');
  check('CLI chats', chats.code === 0 && chats.json.rows[0].chat_id === owner.id);
  const all = logs.join('') + JSON.stringify(db.tables);
  check('tidak ada rahasia di log/DB', !Object.values(secrets).some((v) => all.includes(v)) && !all.includes('e2e-wake-key') && !all.includes('AAe2eToken'));
} finally {
  child.kill();
  await child.status;
  await upstream.shutdown();
}
if (logs.join('').trim()) console.log('--- log fungsi ---\n' + logs.join('').trim());
console.log(failed ? `GAGAL: ${failed}` : 'E2E OK');
Deno.exit(failed ? 1 : 0);
