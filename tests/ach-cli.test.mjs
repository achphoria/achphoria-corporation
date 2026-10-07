// Tes CLI tools/ach.mjs — jalankan: node --test tests/ach-cli.test.mjs  (tanpa jaringan luar)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, buildRequest, loadKey, main, sensitiveReason, UsageError, DEFAULT_URL } from '../tools/ach.mjs';

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
