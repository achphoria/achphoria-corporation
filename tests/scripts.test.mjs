// Tes offline tools/deploy-bridge.sh & tools/setup-telegram.sh terhadap server tiruan
// (Management API Supabase + Telegram Bot API + /health). Env anak dibangun dari nol,
// jadi token asli di mesin ini TIDAK pernah dipakai. Jalankan: node --test tests/scripts.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FAKE_PAT = 'sbp_fake_test_token_000';
const TOKENS = { TG_TOKEN_CHIEF: '111111:AAfakeChiefTokenXXXXXXXXXXXXXXXXXXXXX', TG_TOKEN_OPS: '333333:AAfakeOpsTokenXXXXXXXXXXXXXXXXXXXXXXX' };

function run(cmd, args, env) {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { env, cwd: ROOT });
    let out = '', err = '';
    c.stdout.on('data', (d) => (out += d));
    c.stderr.on('data', (d) => (err += d));
    c.on('close', (code) => resolve({ code, out, err }));
  });
}

test('deploy-bridge.sh (tanpa langkah CLI) + setup-telegram.sh terhadap server tiruan', async () => {
  const calls = [];
  const server = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      const body = b ? JSON.parse(b) : null;
      calls.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
      const send = (s, j) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
      if (req.url.startsWith('/v1/projects/ckoejqzownrujikefgwb')) {
        if (req.headers.authorization !== 'Bearer ' + FAKE_PAT) return send(401, { message: 'bad token' });
        if (req.url.endsWith('/database/query')) {
          if (/pg_class/.test(body.query)) return send(201, ['ach_inbox', 'ach_outbox', 'ach_tg_allow', 'ach_tg_chats'].map((t) => ({ tabel: t, rls: true, policies: 0, anon_select: false, realtime: false })));
          return send(201, []);
        }
        if (req.url.endsWith('/secrets')) return send(201, {});
        return send(200, { name: 'ACHPHORIA', region: 'ap-southeast-1', status: 'ACTIVE_HEALTHY' });
      }
      if (req.url === '/fn/ach-bridge/health') return send(200, { ok: true, service: 'ach-bridge' });
      const m = /^\/bot([^/]+)\/(\w+)$/.exec(req.url);
      if (m) {
        const id = m[1].split(':')[0];
        if (m[2] === 'getMe') return send(200, { ok: true, result: { id: Number(id), username: id === '111111' ? 'ach_chief_bot' : 'ach_ops_bot', can_read_all_group_messages: false } });
        if (m[2] === 'getWebhookInfo') return send(200, { ok: true, result: { url: 'https://ckoejqzownrujikefgwb.supabase.co/functions/v1/ach-bridge/tg/x', pending_update_count: 0 } });
        return send(200, { ok: true, result: true });
      }
      send(404, { message: 'nope' });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const home = mkdtempSync(join(tmpdir(), 'achdeploy-'));
  const conf = join(home, '.config', 'achphoria');
  const env = {
    PATH: process.env.PATH, HOME: home, SUPABASE_ACCESS_TOKEN: FAKE_PAT, SUPABASE_API_URL: base,
    ACH_BRIDGE_URL: base + '/fn/ach-bridge', TG_API_BASE: base, ...TOKENS,
    WAKE_URL_OPS: 'https://wake.example/ops?a=1&b=2', WAKE_KEY_OPS: 'wake-key-ops-secret',
  };

  // tanpa token → gagal cepat
  const noTok = await run('bash', ['tools/deploy-bridge.sh', '--skip-deploy'], { ...env, SUPABASE_ACCESS_TOKEN: '' });
  assert.equal(noTok.code, 1);

  const r1 = await run('bash', ['tools/deploy-bridge.sh', '--skip-deploy', '--with-telegram'], env);
  assert.equal(r1.code, 0, r1.out + r1.err);
  if (process.env.SHOW) console.log(r1.out + r1.err);
  // file rahasia
  assert.equal(statSync(conf).mode & 0o777, 0o700);
  assert.equal(statSync(join(conf, 'bridge.env')).mode & 0o777, 0o600);
  assert.equal(statSync(join(conf, 'bridge_key')).mode & 0o777, 0o600);
  const file = Object.fromEntries(readFileSync(join(conf, 'bridge.env'), 'utf8').split('\n').filter((l) => /^[A-Z]/.test(l)).map((l) => l.split(/=(.*)/s).slice(0, 2)));
  assert.match(file.TG_WEBHOOK_SECRET, /^[0-9a-f]{64}$/);
  assert.match(file.BRIDGE_KEY, /^[0-9a-f]{64}$/);
  assert.match(file.TG_CLAIM_CODE, /^ACH-[0-9A-F]{10}$/);
  assert.equal(readFileSync(join(conf, 'bridge_key'), 'utf8').trim(), file.BRIDGE_KEY);
  assert.equal(Object.keys(file).some((k) => k.startsWith('TG_TOKEN')), false, 'token tidak ditulis ke file');
  // migrasi & secrets
  const q = calls.filter((c) => c.url.endsWith('/database/query'));
  assert.ok(q[0].body.query.includes('create table if not exists public.ach_inbox'));
  const sec = calls.find((c) => c.url.endsWith('/secrets')).body;
  const names = sec.map((s) => s.name).sort();
  assert.deepEqual(names, ['BRIDGE_KEY', 'TG_CLAIM_CODE', 'TG_TOKEN_CHIEF', 'TG_TOKEN_OPS', 'TG_WEBHOOK_SECRET', 'WAKE_KEY_OPS', 'WAKE_URL_OPS']);
  assert.equal(sec.find((s) => s.name === 'BRIDGE_KEY').value, file.BRIDGE_KEY);
  // telegram
  const hooks = calls.filter((c) => c.url.endsWith('/setWebhook'));
  assert.equal(hooks.length, 2);
  for (const h of hooks) {
    assert.equal(h.body.secret_token, file.TG_WEBHOOK_SECRET);
    assert.deepEqual(h.body.allowed_updates, ['message', 'edited_message', 'callback_query', 'my_chat_member']);
    assert.equal(h.body.drop_pending_updates, true);
    assert.match(h.body.url, /^http:\/\/127\.0\.0\.1:\d+\/fn\/ach-bridge\/tg\/(chief|ops)$/);
  }
  assert.ok(calls.some((c) => c.url.endsWith('/setMyCommands') && c.body.commands.map((x) => x.command).join() === 'status,tugas,help'));
  assert.ok(calls.some((c) => c.url.endsWith('/setMyShortDescription')));
  // output: tidak ada rahasia kecuali kode klaim di blok akhir
  const outAll = r1.out + r1.err;
  for (const v of [file.TG_WEBHOOK_SECRET, file.BRIDGE_KEY, FAKE_PAT, 'wake-key-ops-secret', ...Object.values(TOKENS)]) assert.ok(!outAll.includes(v), 'bocor di output');
  assert.equal(outAll.split(file.TG_CLAIM_CODE).length - 1, 1, 'kode klaim dicetak tepat sekali');
  assert.ok(outAll.lastIndexOf('/start ' + file.TG_CLAIM_CODE) > outAll.indexOf('setup Telegram'), 'kode klaim di akhir');

  // jalankan ulang → nilai lama dipakai lagi (idempotent)
  const r2 = await run('bash', ['tools/deploy-bridge.sh', '--skip-deploy', '--skip-migration', '--no-claim-print'], env);
  assert.equal(r2.code, 0, r2.out + r2.err);
  const file2 = readFileSync(join(conf, 'bridge.env'), 'utf8');
  assert.ok(file2.includes('BRIDGE_KEY=' + file.BRIDGE_KEY) && file2.includes('TG_CLAIM_CODE=' + file.TG_CLAIM_CODE));
  assert.ok(!r2.out.includes(file.TG_CLAIM_CODE));

  // setup-telegram --info
  const info = await run('bash', ['tools/setup-telegram.sh', '--info', '--bot', 'ops'], env);
  assert.equal(info.code, 0, info.out + info.err);
  assert.match(info.out, /pending: 0/);
  server.close();
});
