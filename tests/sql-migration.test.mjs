// Tes SQL lokal di Postgres-WASM (PGlite) — TIDAK menyentuh Supabase.
// Siapkan sekali: npm i --prefix /tmp/pgl @electric-sql/pglite
// Jalankan:      PGLITE_DIR=/tmp/pgl node --test tests/sql-migration.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const dir = process.env.PGLITE_DIR || '/tmp/pgl';
const require = createRequire(join(dir, 'package.json'));
let PGlite;
try { ({ PGlite } = await import(require.resolve('@electric-sql/pglite'))); } catch { /* lewati */ }
const sql = (f) => readFileSync(new URL('../supabase/' + f, import.meta.url), 'utf8');

test('migrate-v3-telegram.sql: idempotent, privat, hanya objek ach_*', { skip: !PGlite && 'PGlite tidak terpasang' }, async () => {
  const db = new PGlite();
  // tiru lingkungan Supabase: role + default privileges + objek aplikasi lain
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    create table public.other_app (id int primary key, secret text);
    create publication supabase_realtime;
  `);
  await db.exec(sql('schema.sql'));
  const nonAch = async () => (await db.query(`select c.relname, c.relkind, c.relrowsecurity, coalesce(array_to_string(c.relacl, ','), '') acl
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname not like 'ach\\_%' order by 1`)).rows;
  const before = await nonAch();
  const pubBefore = (await db.query(`select tablename from pg_publication_tables where pubname='supabase_realtime' order by 1`)).rows;

  await db.exec(sql('migrate-v3-telegram.sql'));
  await db.exec(sql('migrate-v3-telegram.sql')); // idempotent
  await db.exec(sql('migrate-v2-kantor.sql'));   // v2 tetap jalan sesudahnya
  await db.exec(sql('migrate-v3-telegram.sql'));

  assert.deepEqual(await nonAch(), before, 'objek non-ach_* tidak berubah');
  assert.deepEqual((await db.query(`select tablename from pg_publication_tables where pubname='supabase_realtime' order by 1`)).rows, pubBefore, 'publikasi realtime tidak bertambah');

  const T = ['ach_inbox', 'ach_outbox', 'ach_tg_allow', 'ach_tg_chats'];
  for (const t of T) {
    const r = (await db.query(`select relrowsecurity from pg_class where oid = 'public.${t}'::regclass`)).rows[0];
    assert.equal(r.relrowsecurity, true, t + ' RLS');
    assert.equal((await db.query(`select count(*)::int n from pg_policies where tablename = $1`, [t])).rows[0].n, 0, t + ' tanpa policy');
    for (const role of ['anon', 'authenticated']) {
      for (const p of ['select', 'insert', 'update', 'delete']) {
        assert.equal((await db.query(`select has_table_privilege($1, 'public.${t}', $2) ok`, [role, p])).rows[0].ok, false, `${role} ${p} ${t}`);
      }
    }
    assert.equal((await db.query(`select has_table_privilege('service_role', 'public.${t}', 'insert') ok`)).rows[0].ok, true);
  }

  // perilaku sebagai service_role
  await db.exec(`set role service_role`);
  await db.exec(`insert into public.ach_inbox (bot, update_id, chat_id, text, update) values ('research', 1, 777, 'halo', '{"update_id":1}')`);
  const dup = await db.query(`insert into public.ach_inbox (bot, update_id, text) values ('research', 1, 'dup') on conflict (bot, update_id) do nothing returning id`);
  assert.equal(dup.rows.length, 0, 'unik (bot, update_id)');
  await db.exec(`insert into public.ach_inbox (bot, update_id, text) values ('chief', 1, 'bot lain boleh update_id sama')`);
  assert.equal((await db.query(`select status from public.ach_inbox where bot='research'`)).rows[0].status, 'baru');
  await assert.rejects(db.exec(`insert into public.ach_inbox (bot, text, status) values ('research', 'x', 'aneh')`));
  await assert.rejects(db.exec(`insert into public.ach_inbox (bot, text) values ('marketing', 'x')`));
  await db.exec(`insert into public.ach_outbox (bot, chat_id, text, ok) values ('research', 777, 'balas', true)`);
  await db.exec(`insert into public.ach_tg_allow (from_id, note) values (777, 'owner') on conflict (from_id) do update set note = excluded.note`);
  await db.exec(`insert into public.ach_tg_chats (bot, chat_id, chat_type, title) values ('chief', -100500, 'supergroup', 'ACHPHORIA HQ')
                 on conflict (bot, chat_id) do update set title = excluded.title, last_seen = now()`);
  const rep = await db.query(`select public.ach_report_activity('research','kerja','desk','riset tren','Riset tren skincare','Sedang kerja','mulai riset') r`);
  assert.equal(rep.rows[0].r.ok, true);
  await db.exec(`reset role`);

  // anon benar-benar ditolak
  await db.exec(`set role anon`);
  await assert.rejects(db.query(`select * from public.ach_inbox`), /permission denied/);
  await assert.rejects(db.query(`select * from public.ach_tg_allow`), /permission denied/);
  assert.ok((await db.query(`select count(*) from public.ach_agents`)).rows.length, 'tabel publik v2 tetap terbaca');
  await db.exec(`reset role`);
  await db.close();
});
