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

test('migrate-v4-logs.sql: role chat, ach_tg_logmsg privat, auto-daftar grup LOGS, idempotent, hanya ach_*', { skip: !PGlite && 'PGlite tidak terpasang' }, async () => {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    create table public.other_app (id int primary key, secret text);
    create publication supabase_realtime;
  `);
  await db.exec(sql('schema.sql'));
  await db.exec(sql('migrate-v3-telegram.sql'));
  const nonAch = async () => (await db.query(`select c.relname, c.relkind, c.relrowsecurity, coalesce(array_to_string(c.relacl, ','), '') acl
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname not like 'ach\\_%' order by 1`)).rows;
  const before = await nonAch();
  const pubBefore = (await db.query(`select tablename from pg_publication_tables where pubname='supabase_realtime' order by 1`)).rows;
  // owner sudah kirim /start di grup LOGS sebelum deploy: grup lama (group) + supergroup hasil migrasi
  await db.exec(`insert into public.ach_tg_chats (bot, chat_id, chat_type, title, last_seen) values
    ('chief', -900, 'group', 'ACHPHORIA LOGS', now() - interval '2 min'),
    ('chief', -100900, 'supergroup', 'ACHPHORIA LOGS', now() - interval '1 min'),
    ('research', -100900, 'supergroup', 'ACHPHORIA LOGS', now()),
    ('chief', -100500, 'supergroup', 'ACHPHORIA HQ', now())`);

  await db.exec(sql('migrate-v4-logs.sql'));
  await db.exec(sql('migrate-v4-logs.sql')); // idempotent
  await db.exec(sql('migrate-v3-telegram.sql')); // v3 diulang tidak merusak
  await db.exec(sql('migrate-v4-logs.sql'));

  assert.deepEqual(await nonAch(), before, 'objek non-ach_* tidak berubah');
  assert.deepEqual((await db.query(`select tablename from pg_publication_tables where pubname='supabase_realtime' order by 1`)).rows, pubBefore);
  const logs = (await db.query(`select bot, chat_id::int from public.ach_tg_chats where role = 'logs' order by bot`)).rows;
  assert.deepEqual(logs, [{ bot: 'chief', chat_id: -100900 }, { bot: 'research', chat_id: -100900 }], 'supergroup LOGS ditandai');
  await assert.rejects(db.exec(`update public.ach_tg_chats set role = 'aneh' where chat_id = -100500`));

  // grup log yang sudah dipilih manual tidak ditimpa saat migrasi diulang
  await db.exec(`update public.ach_tg_chats set role = null where role = 'logs'; update public.ach_tg_chats set role = 'logs' where chat_id = -100500`);
  await db.exec(sql('migrate-v4-logs.sql'));
  assert.deepEqual((await db.query(`select distinct chat_id::int from public.ach_tg_chats where role = 'logs'`)).rows, [{ chat_id: -100500 }]);

  // ach_tg_logmsg privat
  const r = (await db.query(`select relrowsecurity from pg_class where oid = 'public.ach_tg_logmsg'::regclass`)).rows[0];
  assert.equal(r.relrowsecurity, true);
  assert.equal((await db.query(`select count(*)::int n from pg_policies where tablename = 'ach_tg_logmsg'`)).rows[0].n, 0);
  for (const role of ['anon', 'authenticated']) for (const p of ['select', 'insert', 'update', 'delete']) {
    assert.equal((await db.query(`select has_table_privilege($1, 'public.ach_tg_logmsg', $2) ok`, [role, p])).rows[0].ok, false, `${role} ${p}`);
  }
  await db.exec(`set role service_role`);
  const t = (await db.query(`select public.ach_report_activity('research', null, null, null, 'Tes grup log', 'Terjadwal', null) r`)).rows[0].r;
  await db.exec(`insert into public.ach_tg_logmsg (task_id, chat_id, message_id, agent_id) values ('${t.task_id}', -100900, 55, 'research')`);
  await db.exec(`insert into public.ach_tg_logmsg (task_id, chat_id, message_id) values ('${t.task_id}', -100900, 56)
                 on conflict (task_id, chat_id) do update set message_id = excluded.message_id`);
  assert.equal((await db.query(`select message_id::int m from public.ach_tg_logmsg`)).rows[0].m, 56);
  await db.exec(`reset role`);
  await db.exec(`set role anon`);
  await assert.rejects(db.query(`select * from public.ach_tg_logmsg`), /permission denied/);
  await db.exec(`reset role`);
  await db.exec(`delete from public.ach_tasks where id = '${t.task_id}'`);
  assert.equal((await db.query(`select count(*)::int n from public.ach_tg_logmsg`)).rows[0].n, 0, 'cascade saat tugas dihapus');
  await db.close();
});

test('migrate-v5-erp-read.sql: role read-only, allowlist, validator, RLS ERP tidak diubah, idempotent', { skip: !PGlite && 'PGlite tidak terpasang' }, async () => {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
    create publication supabase_realtime;
    -- ERP tiruan (RLS aktif, policy hanya untuk authenticated)
    create table public.sys_outlets (id int primary key, company_id int, name text, address text, phone text);
    create table public.pos_orders (id int primary key, outlet_id int, business_date date, status text, grand_total numeric(15,2), customer_name text);
    create table public.crm_customers (id int primary key, company_id int, name text, phone text, email text, birth_date date);
    create table public.sys_payment_gateway_secrets (gateway_id int, merchant_key text);
    create table public.sys_users (id int, full_name text, phone text);
    create table public.cogs (id int, total_cogs numeric);
    create view public.rpt_daily_sales with (security_invoker = true) as
      select outlet_id, business_date, count(*) order_count, sum(grand_total) grand_total from public.pos_orders group by 1, 2;
    alter table public.sys_outlets enable row level security;
    alter table public.pos_orders enable row level security;
    alter table public.crm_customers enable row level security;
    alter table public.sys_payment_gateway_secrets enable row level security;
    alter table public.sys_users enable row level security;
    create policy erp_read on public.pos_orders for select to authenticated using (false);
    insert into public.sys_outlets values (1, 1, 'Outlet A', 'Jl. Rahasia 1', '0811111111'), (2, 1, 'Outlet B', 'Jl. Rahasia 2', '0822222222');
    insert into public.pos_orders select g, 1 + g % 2, date '2026-10-08', 'paid', 1000 * g, 'Budi' from generate_series(1, 250) g;
    insert into public.crm_customers values (1, 1, 'Member', '0812345678901', 'a@b.c', '1990-01-01');
    insert into public.sys_payment_gateway_secrets values (1, 'mk_live_secret');
    insert into public.sys_users values (1, 'Kasir', '0813');
  `);
  await db.exec(sql('schema.sql'));
  await db.exec(sql('migrate-v3-telegram.sql'));
  await db.exec(sql('migrate-v4-logs.sql'));
  const erpState = async () => (await db.query(`select c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity,
        coalesce(array_to_string(array(select x from unnest(c.relacl) x where x::text !~ '^ach_erp_reader='), ','), '') acl,
        (select count(*)::int from pg_policies p where p.tablename = c.relname) policies
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname not like 'ach\\_%' order by 1`)).rows;
  const before = await erpState();

  await db.exec(sql('migrate-v5-erp-read.sql'));
  await db.exec(sql('migrate-v5-erp-read.sql')); // idempotent
  assert.deepEqual(await erpState(), before, 'RLS/policy/ACL ERP (selain grant ke ach_erp_reader) tidak berubah');

  const role = (await db.query(`select rolcanlogin, rolbypassrls, rolsuper from pg_roles where rolname = 'ach_erp_reader'`)).rows[0];
  assert.deepEqual(role, { rolcanlogin: false, rolbypassrls: true, rolsuper: false });
  const priv = async (t, p) => (await db.query(`select has_table_privilege('ach_erp_reader', $1, $2) ok`, [t, p])).rows[0].ok;
  for (const p of ['insert', 'update', 'delete', 'truncate']) {
    for (const t of ['public.pos_orders', 'public.sys_outlets', 'public.rpt_daily_sales']) assert.equal(await priv(t, p), false, `${p} ${t}`);
  }
  assert.equal(await priv('public.pos_orders', 'select'), false, 'pos_orders per kolom');
  assert.equal((await db.query(`select has_column_privilege('ach_erp_reader', 'public.pos_orders', 'grand_total', 'select') ok`)).rows[0].ok, true);
  assert.equal((await db.query(`select has_column_privilege('ach_erp_reader', 'public.pos_orders', 'customer_name', 'select') ok`)).rows[0].ok, false);
  assert.equal((await db.query(`select has_column_privilege('ach_erp_reader', 'public.crm_customers', 'phone', 'select') ok`)).rows[0].ok, false);
  for (const t of ['sys_payment_gateway_secrets', 'sys_users', 'cogs', 'ach_inbox', 'ach_erp_audit']) {
    assert.equal((await db.query(`select has_any_column_privilege('ach_erp_reader', 'public.${t}', 'select') ok`)).rows[0].ok, false, t);
  }

  // anon/authenticated tidak bisa memanggil fungsi
  for (const r of ['anon', 'authenticated']) {
    for (const f of ['public.ach_erp_query(text, integer)', 'public.ach_erp_schema(text)', 'ach_erp.run(text, integer)']) {
      assert.equal((await db.query(`select has_function_privilege($1, $2, 'execute') ok`, [r, f])).rows[0].ok, false, `${r} ${f}`);
    }
    await db.exec(`set role ${r}`);
    await assert.rejects(db.query(`select public.ach_erp_query('select 1', 5)`), /permission denied/);
    await db.exec(`reset role`);
  }

  // sebagai service_role
  await db.exec(`set role service_role`);
  const run = async (s, n = 50) => (await db.query(`select public.ach_erp_query($1, $2) r`, [s, n])).rows[0].r;
  const rej = (s, re) => assert.rejects(db.query(`select public.ach_erp_query($1, 50)`, [s]), re, s);
  let r = await run(`select o.name outlet, count(*) n, sum(p.grand_total) total from pos_orders p join sys_outlets o on o.id = p.outlet_id
                     where p.business_date = date '2026-10-08' and p.status = 'paid' group by o.name order by o.name;`);
  assert.deepEqual(r.columns, ['outlet', 'n', 'total']);
  assert.equal(r.row_count, 2, 'RLS ERP dilewati lewat BYPASSRLS role pembaca');
  assert.equal(r.rows[0].n + r.rows[1].n, 250);
  r = await run(`select id, grand_total from pos_orders order by id`, 500);
  assert.equal(r.row_count, 200); assert.equal(r.truncated, true); assert.equal(r.max_rows, 200);
  r = await run(`select id from pos_orders order by id`, 3);
  assert.deepEqual(r.rows.map((x) => x.id), [1, 2, 3]); assert.equal(r.truncated, true);
  r = await run(`with s as (select outlet_id, sum(grand_total) t from pos_orders group by 1) select count(*) n from s where t > 0`);
  assert.equal(r.rows[0].n, 2);
  r = await run(`select count(*) n from rpt_daily_sales`);
  assert.equal(r.rows[0].n, 2, 'view security_invoker terbaca');
  r = await run(`select name from crm_customers where name = 'Member' and 'it''s; drop' <> ''`);
  assert.equal(r.row_count, 1, 'string berisi ; dan kata kunci boleh');
  r = await run(`select count(*) n from pos_orders where status = 'paid' and business_date = (now() at time zone 'Asia/Jakarta')::date - 0`);
  assert.equal(typeof r.rows[0].n, 'number');

  await rej(`select * from crm_customers`, /permission denied/);
  await rej(`select phone from sys_outlets`, /permission denied/);
  await rej(`select customer_name from pos_orders`, /permission denied/);
  await rej(`select * from sys_payment_gateway_secrets`, /dikecualikan/);
  await rej(`select * from public.sys_users`, /dikecualikan/);
  await rej(`select * from cogs`, /permission denied/);
  await rej(`select * from ach_inbox`, /tidak boleh diakses/);
  await rej(`update pos_orders set status = 'x'`, /hanya SELECT/);
  await rej(`delete from pos_orders`, /hanya SELECT/);
  await rej(`select 1; drop table pos_orders`, /SATU statement/);
  await rej(`with x as (delete from pos_orders returning *) select * from x`, /delete/);
  await rej(`select * from pos_orders for update`, /update/);
  await rej(`select 1 into tmp_x`, /into/);
  await rej(`select current_setting('request.headers')`, /current_setting/);
  await rej(`select set_config('transaction_read_only', 'off', true)`, /set_config/);
  await rej(`select * from pg_settings`, /pg_settings/);
  await rej(`select pg_sleep(10)`, /pg_sleep/);
  await rej(`select query_to_xml('select * from sys_users', true, true, '')`, /query_to_xml|dikecualikan/);
  await rej(`select * from information_schema.tables`, /information_schema/);
  await rej(`select * from auth.users`, /auth/);
  await rej(`select * from "sys_users"`, /karakter/);
  await rej(`select $$x$$`, /karakter/);
  await rej(`select E'\\'' , 1`, /karakter|E''|kutip/);
  await rej(`select E'a' x`, /string E'/);
  await rej(`select 1 -- x`, /komentar/);
  await rej(`select 1) x, (select 2`, /kurung/);
  await rej(`select public.ach_erp_schema()`, /ber-schema|ach_erp/);
  await rej(`select 'x`, /kutip/);
  await rej(``, /kosong/);
  await rej(`explain select 1`, /hanya SELECT/);

  // transaksi menjadi read-only setelah query
  await db.exec(`begin`);
  await db.query(`select public.ach_erp_query('select 1 x', 1)`);
  assert.equal((await db.query(`select current_setting('transaction_read_only') v`)).rows[0].v, 'on');
  await assert.rejects(db.query(`insert into public.ach_erp_audit (agent) values ('x')`), /read-only/);
  await db.exec(`rollback`);

  // skema
  const sc = (await db.query(`select public.ach_erp_schema() s`)).rows[0].s;
  const names = sc.map((t) => t.table);
  assert.ok(names.includes('pos_orders') && names.includes('sys_outlets') && names.includes('rpt_daily_sales'));
  for (const bad of ['sys_payment_gateway_secrets', 'sys_users', 'cogs', 'ach_inbox', 'ach_erp_audit']) assert.ok(!names.includes(bad), bad);
  const po = sc.find((t) => t.table === 'pos_orders');
  assert.equal(po.restricted, true);
  assert.ok(!po.columns.some((c) => c.name === 'customer_name'));
  const one = (await db.query(`select public.ach_erp_schema('sys_outlets') s`)).rows[0].s;
  assert.deepEqual(one[0].columns.map((c) => c.name), ['id', 'company_id', 'name']);

  // audit privat tapi bisa ditulis service_role
  await db.exec(`insert into public.ach_erp_audit (agent, sql, row_count, ms, ok) values ('ops', 'select 1', 1, 5, true)`);
  await db.exec(`reset role`);
  assert.equal((await db.query(`select relrowsecurity from pg_class where oid = 'public.ach_erp_audit'::regclass`)).rows[0].relrowsecurity, true);
  for (const rl of ['anon', 'authenticated']) {
    assert.equal((await db.query(`select has_table_privilege($1, 'public.ach_erp_audit', 'select') ok`, [rl])).rows[0].ok, false);
  }
  await db.close();
});

test('migrate-v6-fx.sql: tabel FX privat, idempotent, objek lain tidak berubah', { skip: !PGlite && 'PGlite tidak terpasang' }, async () => {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    create table public.other_app (id int primary key, secret text);
    create publication supabase_realtime;
  `);
  await db.exec(sql('schema.sql'));
  await db.exec(sql('migrate-v5-erp-read.sql'));
  const nonAch = async () => (await db.query(`select c.relname, c.relkind, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname not like 'ach\\_%' order by 1`)).rows;
  const before = await nonAch();
  const pubBefore = (await db.query(`select tablename from pg_publication_tables where pubname='supabase_realtime' order by 1`)).rows;
  await db.exec(sql('migrate-v6-fx.sql'));
  await db.exec(sql('migrate-v6-fx.sql')); // idempotent
  assert.deepEqual(await nonAch(), before, 'objek non-ach_* tidak berubah');
  assert.deepEqual((await db.query(`select tablename from pg_publication_tables where pubname='supabase_realtime' order by 1`)).rows, pubBefore, 'realtime tidak bertambah');
  for (const t of ['ach_fx_state', 'ach_fx_commands', 'ach_fx_journal']) {
    assert.equal((await db.query(`select relrowsecurity from pg_class where oid = 'public.${t}'::regclass`)).rows[0].relrowsecurity, true, t + ' RLS');
    assert.equal((await db.query(`select count(*)::int n from pg_policies where tablename = $1`, [t])).rows[0].n, 0, t + ' tanpa policy');
    for (const role of ['anon', 'authenticated']) for (const p of ['select', 'insert', 'update', 'delete']) {
      assert.equal((await db.query(`select has_table_privilege($1, 'public.${t}', $2) ok`, [role, p])).rows[0].ok, false, `${role} ${p} ${t}`);
    }
    assert.equal((await db.query(`select has_table_privilege('service_role', 'public.${t}', 'select') ok`)).rows[0].ok, true);
  }
  await db.exec(`set role service_role`);
  await db.exec(`insert into public.ach_fx_state (device_id, mode) values ('pc1', 'ai')`);
  await db.exec(`insert into public.ach_fx_state (device_id, mode, account) values ('pc1', 'manual', '{"balance":1}') on conflict (device_id) do update set mode = excluded.mode`);
  assert.equal((await db.query(`select mode from public.ach_fx_state where device_id='pc1'`)).rows[0].mode, 'manual');
  await assert.rejects(db.exec(`insert into public.ach_fx_commands (device_id, action) values ('pc1', 'explode')`), /check/i);
  await db.exec(`insert into public.ach_fx_commands (device_id, action) values ('pc1', 'open')`);
  assert.equal((await db.query(`select status, (expires_at > now()) ok from public.ach_fx_commands`)).rows[0].ok, true, 'expires default +10 menit');
  await db.exec(`reset role`);
  await db.exec(`set role anon`);
  await assert.rejects(db.exec(`select * from public.ach_fx_state`), /permission denied/i);
  await db.close();
});
