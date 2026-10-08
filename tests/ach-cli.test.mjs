// Tes CLI tools/ach.mjs — jalankan: node --test tests/ach-cli.test.mjs  (tanpa jaringan luar)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, buildRequest, loadKey, main, sensitiveReason, opsAmountReason, formatRows, formatErp, UsageError, DEFAULT_URL } from '../tools/ach.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'ach.mjs');
const build = (argv, env = {}, readText) => buildRequest(parseArgs(argv), { env, readText });

test('parseArgs: --k v, --k=v, flag boolean, posisional, kebab→snake, nilai negatif', () => {
  const p = parseArgs(['send', '--bot', 'ops', '--text=halo dunia', '--chat', '-1001234', '--html', '--task-status', 'Sedang kerja', 'sisa']);
  assert.equal(p.cmd, 'send');
  assert.deepEqual(p.pos, ['sisa']);
  assert.deepEqual(p.opts, { bot: 'ops', text: 'halo dunia', chat: '-1001234', html: true, task_status: 'Sedang kerja' });
  assert.throws(() => parseArgs(['send', '--text']), UsageError);
  assert.deepEqual(parseArgs(['report', '--location', '']).opts, { location: '' });
});

test('report: contoh dari brief → body yang benar', () => {
  const b = build(['report', '--bot', 'research', '--status', 'kerja', '--location', 'desk', '--activity', 'riset tren',
    '--task', 'Riset tren skincare', '--task-status', 'Sedang kerja', '--log', 'mulai riset']);
  assert.deepEqual(b, { action: 'report', bot: 'research', status: 'kerja', location: 'desk', activity: 'riset tren', task: 'Riset tren skincare', task_status: 'Sedang kerja', log: 'mulai riset' });
  assert.deepEqual(build(['report', '--bot', 'ops', '--location', '']), { action: 'report', bot: 'ops', location: '' });
  assert.deepEqual(build(['report', '--log', 'cek'], { ACH_BOT: 'chief' }), { action: 'report', bot: 'chief', log: 'cek' });
});

test('report: validasi status/lokasi/status tugas/bot/data sensitif', () => {
  const bad = [
    ['report', '--bot', 'research', '--location', 'kantin'],
    ['report', '--bot', 'research', '--status', 'sibuk'],
    ['report', '--bot', 'research', '--task', 'x', '--task-status', 'selesai'],
    ['report', '--bot', 'research', '--task-status', 'Selesai'],
    ['report', '--bot', 'marketing', '--status', 'kerja'],
    ['report', '--status', 'kerja'],
    ['report', '--bot', 'research'],
    ['report', '--bot', 'research', '--log', 'transfer Rp 500.000'],
    ['report', '--bot', 'research', '--log', 'wa 081234567890'],
    ['report', '--bot', 'research', '--activity', 'hubungi +62 812-3456-7890'],
  ];
  for (const argv of bad) assert.throws(() => build(argv), UsageError, argv.join(' '));
  assert.equal(sensitiveReason('rapat jam 10.30 bahas Q4 2026'), null);
});

test('send: teks, stdin/file, chat/reply/inbox numerik, html/silent', () => {
  assert.deepEqual(build(['send', '--bot', 'research', '--text', 'Siap!', '--chat', '-100500', '--reply', '42', '--inbox', '7', '--html', '--silent']),
    { action: 'send', bot: 'research', text: 'Siap!', chat_id: -100500, reply_to_message_id: 42, inbox_id: 7, parse_mode: 'HTML', silent: true });
  assert.equal(build(['send', '--bot', 'ops', '--text', '-'], {}, (p) => (p === '-' ? 'dari stdin' : '')).text, 'dari stdin');
  assert.equal(build(['send', '--bot', 'ops', '--text-file', 'x.txt'], {}, (p) => 'isi ' + p).text, 'isi x.txt');
  assert.equal(build(['send', '--bot', 'ops', 'halo', 'semua']).text, 'halo semua');
  assert.throws(() => build(['send', '--bot', 'ops']), UsageError);
  assert.throws(() => build(['send', '--bot', 'ops', '--text', 'x', '--chat', 'abc']), UsageError);
});

test('inbox/claim/done/fail/chats/ping/typing', () => {
  assert.deepEqual(build(['inbox', '--bot', 'ops']), { action: 'inbox', bot: 'ops', status: 'baru' });
  assert.deepEqual(build(['inbox', '--bot', 'ops', '--status', 'semua', '--limit', '5', '--full']), { action: 'inbox', bot: 'ops', status: 'semua', limit: 5, full: true });
  assert.throws(() => build(['inbox', '--bot', 'ops', '--status', 'aneh']), UsageError);
  assert.deepEqual(build(['claim', '12']), { action: 'claim', inbox_id: 12 });
  assert.deepEqual(build(['claim', '--inbox', '12', '--bot', 'ops']), { action: 'claim', inbox_id: 12, bot: 'ops' });
  assert.deepEqual(build(['done', '12', '--note', 'beres']), { action: 'done', inbox_id: 12, note: 'beres' });
  assert.deepEqual(build(['fail', '12', '--note', 'butuh akses']), { action: 'fail', inbox_id: 12, note: 'butuh akses' });
  assert.throws(() => build(['done']), UsageError);
  assert.deepEqual(build(['chats', '--bot', 'chief']), { action: 'chats', bot: 'chief' });
  assert.deepEqual(build(['ping']), { action: 'ping' });
  assert.deepEqual(build(['typing', '--bot', 'chief', '--chat', '-1']), { action: 'typing', bot: 'chief', chat_id: -1 });
  assert.throws(() => build(['hapus', '--bot', 'chief']), UsageError);
});

test('v4: task / claim|done|fail --task / log / report --task-event --task-note', () => {
  assert.deepEqual(build(['task', 'new', '--bot', 'research', '--title', 'Tes grup log']), { action: 'task', bot: 'research', event: 'new', title: 'Tes grup log' });
  assert.deepEqual(build(['task', 'new', '--bot', 'chief', '--agent', 'content', '--title', 'Kalender', '--note', 'minggu depan']),
    { action: 'task', bot: 'chief', event: 'new', title: 'Kalender', agent: 'content', note: 'minggu depan' });
  assert.deepEqual(build(['task', 'approval', '--bot', 'content', '--task-id', '1a2b3c4d', '--note', 'draf siap']),
    { action: 'task', bot: 'content', event: 'approval', task_id: '1a2b3c4d', note: 'draf siap' });
  assert.deepEqual(build(['claim', '12', '--bot', 'research', '--task', 'Tes grup log', '--note', 'mulai']),
    { action: 'task', bot: 'research', event: 'start', title: 'Tes grup log', note: 'mulai', inbox_id: 12 });
  assert.deepEqual(build(['done', '--bot', 'research', '--task', 'Tes grup log', '--note', 'beres']),
    { action: 'task', bot: 'research', event: 'done', title: 'Tes grup log', note: 'beres' });
  assert.deepEqual(build(['fail', '--task-id', 'abcd1234', '--note', 'butuh akses'], { ACH_BOT: 'ops' }),
    { action: 'task', bot: 'ops', event: 'fail', task_id: 'abcd1234', note: 'butuh akses' });
  assert.deepEqual(build(['log', '--bot', 'ops', '--text', 'dashboard diperbarui', '--task', 'Rekap']), { action: 'log', bot: 'ops', text: 'dashboard diperbarui', task: 'Rekap' });
  assert.deepEqual(build(['log', '--bot', 'ops', 'halo', 'semua']), { action: 'log', bot: 'ops', text: 'halo semua' });
  assert.deepEqual(build(['report', '--bot', 'research', '--task', 'A', '--task-event', 'gagal', '--task-note', 'sumber down']),
    { action: 'report', bot: 'research', task_event: 'gagal', task: 'A', task_note: 'sumber down' });
  assert.deepEqual(build(['report', '--bot', 'research', '--task-id', '1a2b3c4d', '--task-status', 'Selesai']),
    { action: 'report', bot: 'research', task_status: 'Selesai', task_id: '1a2b3c4d' });
  const bad = [
    ['task', 'hapus', '--bot', 'ops', '--title', 'x'], ['task', 'new', '--bot', 'ops'], ['task', 'new', '--bot', 'ops', '--task-id', 'abcd'],
    ['task', 'start', '--bot', 'ops', '--title', 'x', '--agent', 'research'], ['task', 'new', '--bot', 'chief', '--title', 'x', '--agent', 'hr'],
    ['claim', '--bot', 'ops', '--task', 'x', '--note', 'transfer Rp 5.000'], ['done', '--task', 'x'],
    ['log', '--bot', 'ops'], ['log', '--bot', 'ops', '--text', 'rek 1234567890'], ['log', '--bot', 'ops', '--text', 'IDR 300'],
    ['report', '--bot', 'ops', '--task-event', 'gagal'], ['report', '--bot', 'ops', '--task', 'x', '--task-event', 'aneh'],
    ['report', '--bot', 'ops', '--task-note', 'x'], ['report', '--bot', 'ops', '--task', 'x', '--task-note', 'wa 081234567890'],
  ];
  for (const argv of bad) assert.throws(() => build(argv), UsageError, argv.join(' '));
});

test('loadKey: env diutamakan, lalu ~/.config/achphoria/bridge_key (peringatan bila mode longgar)', () => {
  const home = mkdtempSync(join(tmpdir(), 'achhome-'));
  assert.equal(loadKey({ env: {}, home }), '');
  mkdirSync(join(home, '.config', 'achphoria'), { recursive: true });
  const f = join(home, '.config', 'achphoria', 'bridge_key');
  writeFileSync(f, 'kunci-dari-file\n');
  chmodSync(f, 0o644);
  const warns = [];
  assert.equal(loadKey({ env: {}, home, warn: (m) => warns.push(m) }), 'kunci-dari-file');
  assert.equal(warns.length, 1);
  chmodSync(f, 0o600);
  warns.length = 0;
  assert.equal(loadKey({ env: {}, home, warn: (m) => warns.push(m) }), 'kunci-dari-file');
  assert.equal(warns.length, 0);
  assert.equal(loadKey({ env: { ACH_BRIDGE_KEY: 'dari-env' }, home }), 'dari-env');
});

test('main: kirim ke server tiruan dengan header x-ach-key; key tidak tercetak; kode keluar', async () => {
  const seen = [];
  const server = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      seen.push({ url: req.url, key: req.headers['x-ach-key'], body: JSON.parse(b) });
      const fail = JSON.parse(b).action === 'claim';
      res.writeHead(fail ? 404 : 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(fail ? { ok: false, error: 'inbox #9 tidak ada' } : { ok: true, echo: JSON.parse(b).action }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/functions/v1/ach-bridge`;
  const out = [], err = [];
  const env = { ACH_BRIDGE_URL: url, ACH_BRIDGE_KEY: 'rahasia-sekali-123' };
  assert.equal(await main(['chats', '--bot', 'chief'], { env, out: (m) => out.push(m), err: (m) => err.push(m) }), 0);
  assert.equal(seen[0].url, '/functions/v1/ach-bridge/api');
  assert.equal(seen[0].key, 'rahasia-sekali-123');
  assert.deepEqual(seen[0].body, { action: 'chats', bot: 'chief' });
  assert.equal(await main(['claim', '9'], { env, out: (m) => out.push(m), err: (m) => err.push(m) }), 2);
  assert.ok(!(out.join('\n') + err.join('\n')).includes('rahasia-sekali-123'));
  // tanpa key → 1, tidak mengirim
  const n = seen.length;
  assert.equal(await main(['ping'], { env: { ACH_BRIDGE_URL: url }, home: mkdtempSync(join(tmpdir(), 'nokey-')), out: () => {}, err: () => {} }), 1);
  assert.equal(seen.length, n);
  // proses CLI sungguhan + stdin
  const child = spawn(process.execPath, [CLI, 'send', '--bot', 'ops', '--text', '-', '--inbox', '3'], { env: { ...process.env, ...env, HOME: '/nonexistent' } });
  child.stdin.end('teks dari stdin\nbaris dua');
  const code = await new Promise((r) => child.on('close', r));
  assert.equal(code, 0);
  assert.deepEqual(seen.at(-1).body, { action: 'send', bot: 'ops', text: 'teks dari stdin\nbaris dua', inbox_id: 3 });
  server.close();
});

test('CLI: --dry-run & bantuan', () => {
  const r = spawnSync(process.execPath, [CLI, 'report', '--bot', 'research', '--status', 'kerja', '--dry-run'], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout), { url: DEFAULT_URL + '/api', body: { action: 'report', bot: 'research', status: 'kerja' } });
  assert.equal(spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' }).status, 0);
  assert.equal(spawnSync(process.execPath, [CLI], { encoding: 'utf8' }).status, 1);
  const bad = spawnSync(process.execPath, [CLI, 'report', '--bot', 'research', '--location', 'kantin'], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /lokasi tidak valid/);
});

/* ---------- send-photo / send-file ---------- */
import { checkLocalFile, sniffKind } from '../tools/ach.mjs';
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
const PDF = new TextEncoder().encode('%PDF-1.7\n');
const buildF = (argv, files) => buildRequest(parseArgs(argv), { env: {}, readFile: (p) => { if (!(p in files)) throw new UsageError('tidak ada'); return files[p]; } });

test('send-photo / send-file: body base64, opsi, validasi', () => {
  const b = buildF(['send-photo', '--bot', 'ops', '--file', '/tmp/g.png', '--caption', 'grafik', '--chat', '-100123', '--reply', '31', '--inbox', '4', '--silent'], { '/tmp/g.png': PNG });
  assert.deepEqual({ ...b, file_base64: undefined }, { action: 'send_photo', bot: 'ops', filename: 'g.png', caption: 'grafik', chat_id: -100123, reply_to_message_id: 31, inbox_id: 4, silent: true, file_base64: undefined });
  assert.deepEqual(Buffer.from(b.file_base64, 'base64'), Buffer.from(PNG));
  const d = buildF(['send-file', '--bot', 'ops', '--file', 'r.pdf'], { 'r.pdf': PDF });
  assert.equal(d.action, 'send_file'); assert.equal(d.chat_id, undefined);
  assert.equal(sniffKind(PDF), 'pdf');
  assert.throws(() => buildF(['send-photo', '--bot', 'ops', '--file', 'r.pdf'], { 'r.pdf': PDF }), UsageError);
  assert.throws(() => buildF(['send-file', '--bot', 'ops', '--file', 'x.png'], { 'x.png': PDF }), /tidak cocok/);
  assert.throws(() => buildF(['send-file', '--bot', 'ops'], {}), /--file/);
  assert.throws(() => buildF(['send-file', '--file', 'r.pdf'], { 'r.pdf': PDF }), /--bot/);
  assert.throws(() => buildF(['send-file', '--bot', 'chief', '--file', 'r.pdf', '--caption', 'Rp 10.000'], { 'r.pdf': PDF }), /caption ditolak/);
  assert.throws(() => checkLocalFile('a.png', new Uint8Array(0), 'photo'), /kosong/);
  assert.throws(() => checkLocalFile('a.gif', PNG, 'document'), /tidak didukung/);
});

test('send-file via main(): file asli di disk, dry-run tidak mencetak base64, POST ke bridge', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'achf-'));
  const f = join(dir, 'lap.pdf'); writeFileSync(f, PDF);
  const outs = [];
  assert.equal(await main(['send-file', '--bot', 'ops', '--file', f, '--dry-run'], { env: {}, out: (m) => outs.push(m), err: () => {} }), 0);
  assert.match(outs[0], /<\d+ karakter base64>/);
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return new Response(JSON.stringify({ ok: true, method: 'sendDocument' }), { status: 200 }); };
  assert.equal(await main(['send-file', '--bot', 'ops', '--file', f], { env: { ACH_BRIDGE_KEY: 'k-test' }, fetchImpl, out: () => {}, err: () => {} }), 0);
  assert.equal(seen.init.headers['x-ach-key'], 'k-test');
  assert.equal(JSON.parse(seen.init.body).action, 'send_file');
  assert.equal(await main(['send-file', '--bot', 'ops', '--file', join(dir, 'nope.pdf')], { env: { ACH_BRIDGE_KEY: 'k' }, fetchImpl, out: () => {}, err: () => {} }), 1);
});

test('v5 erp / erp-schema: body, sumber SQL, validasi limit', () => {
  assert.deepEqual(build(['erp', '--bot', 'ops', '--sql', 'select 1 x', '--limit', '20']), { action: 'erp_query', bot: 'ops', sql: 'select 1 x', limit: 20 });
  assert.deepEqual(build(['erp', '--sql', 'select 1'], { ACH_BOT: 'ops' }), { action: 'erp_query', bot: 'ops', sql: 'select 1' });
  assert.equal(build(['erp', '--bot', 'ops', '--sql', '-'], {}, (p) => (p === '-' ? ' select 2 \n' : '')).sql, 'select 2');
  assert.equal(build(['erp', '--bot', 'ops', '--sql-file', 'q.sql'], {}, (p) => 'select 3 -- ' + p).sql, 'select 3 -- q.sql');
  assert.equal(build(['erp', '--bot', 'ops', 'select', 'count(*)', 'from', 'pos_orders']).sql, 'select count(*) from pos_orders');
  for (const argv of [['erp', '--bot', 'ops'], ['erp', '--bot', 'ops', '--sql', 'select 1', '--limit', '0'], ['erp', '--bot', 'ops', '--sql', 'select 1', '--limit', '201'], ['erp', '--sql', 'select 1']]) {
    assert.throws(() => build(argv), UsageError, argv.join(' '));
  }
  // agen lain tidak diblok di CLI — server yang menolak (satu sumber kebenaran)
  assert.equal(build(['erp', '--bot', 'research', '--sql', 'select 1']).bot, 'research');
  assert.deepEqual(build(['erp-schema', '--bot', 'ops']), { action: 'erp_schema', bot: 'ops' });
  assert.deepEqual(build(['erp-schema', '--bot', 'ops', '--table', 'pos_orders']), { action: 'erp_schema', bot: 'ops', table: 'pos_orders' });
});

test('v5 caption ops: nominal Rp boleh, ≥12 digit/kartu/HP ditolak; bot lain tetap ketat', () => {
  assert.equal(opsAmountReason('Penjualan Rp 1.250.000'), null);
  assert.ok(opsAmountReason('4111111111111111') && opsAmountReason('4111 1111 1111 1111') && opsAmountReason('0812-3456-7890'));
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
  const bf = (argv) => buildRequest(parseArgs(argv), { env: {}, readFile: () => png });
  assert.equal(bf(['send-photo', '--bot', 'ops', '--file', 'g.png', '--caption', 'Penjualan Rp 1.250.000']).caption, 'Penjualan Rp 1.250.000');
  assert.throws(() => bf(['send-photo', '--bot', 'ops', '--file', 'g.png', '--caption', 'kartu 4111111111111111']), UsageError);
  assert.throws(() => bf(['send-photo', '--bot', 'research', '--file', 'g.png', '--caption', 'Penjualan Rp 1.250.000']), UsageError);
});

test('v5 format: tabel ringkas, footer terpotong, skema', async () => {
  const t = formatRows(['outlet', 'n', 'total'], [{ outlet: 'A', n: 12, total: 1250000 }, { outlet: 'B', n: 3, total: null }]);
  assert.match(t, /^outlet │  n │   total\n/);
  assert.match(t, /A      │ 12 │ 1250000/);
  assert.match(formatErp('erp_query', { columns: ['n'], rows: [{ n: 1 }], row_count: 1, truncated: true, max_rows: 1, ms: 9 }), /terpotong di 1/);
  assert.equal(formatErp('erp_query', { columns: [], rows: [], row_count: 0, ms: 5 }), '(0 baris · 5 ms)');
  const sc = { tables: [{ table: 'pos_orders', kind: 'table', restricted: true, columns: [{ name: 'id', type: 'uuid' }, { name: 'grand_total', type: 'numeric(15,2)' }] }, { table: 'rpt_daily_sales', kind: 'view', restricted: false, columns: [{ name: 'business_date', type: 'date' }] }] };
  assert.match(formatErp('erp_schema', sc), /^pos_orders \*: id, grand_total\nrpt_daily_sales \[view\]: business_date/);
  assert.match(formatErp('erp_schema', { tables: [sc.tables[0]] }, { table: 'pos_orders' }), /pos_orders \(table, sebagian kolom.*\n  id {9}  uuid\n  grand_total  numeric\(15,2\)/);
  // main(): tabel default, --json mentah
  const reply = { ok: true, columns: ['n'], rows: [{ n: 7 }], row_count: 1, truncated: false, max_rows: 50, ms: 3 };
  const fetchImpl = async () => new Response(JSON.stringify(reply), { status: 200 });
  const outs = [];
  assert.equal(await main(['erp', '--bot', 'ops', '--sql', 'select 7 n'], { env: { ACH_BRIDGE_KEY: 'k' }, fetchImpl, out: (m) => outs.push(m), err: () => {} }), 0);
  assert.match(outs.at(-1), /^n\n─\n7\n\(1 baris · 3 ms\)$/);
  assert.equal(await main(['erp', '--bot', 'ops', '--sql', 'select 7 n', '--json'], { env: { ACH_BRIDGE_KEY: 'k' }, fetchImpl, out: (m) => outs.push(m), err: () => {} }), 0);
  assert.deepEqual(JSON.parse(outs.at(-1)), reply);
  const deny = async () => new Response(JSON.stringify({ ok: false, error: 'erp_query hanya untuk agen ops / chief (bukan research)' }), { status: 403 });
  const errs = [];
  assert.equal(await main(['erp', '--bot', 'research', '--sql', 'select 1'], { env: { ACH_BRIDGE_KEY: 'k' }, fetchImpl: deny, out: () => {}, err: (m) => errs.push(m) }), 2);
  assert.match(errs.join(' '), /HTTP 403/);
});
