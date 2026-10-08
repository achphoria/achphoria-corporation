-- =====================================================================
--  ACHPHORIA CORPORATION · MIGRASI v5 — Akses BACA ERP (SEMAR) untuk bot Ops
-- ---------------------------------------------------------------------
--  Jalankan setelah migrate-v4-logs.sql (project ckoejqzownrujikefgwb).
--  Idempotent: aman diulang. Hanya membuat/mengubah objek ach_* + role
--  khusus ach_erp_reader. Tabel, policy RLS, dan data ERP TIDAK diubah;
--  satu-satunya efek ke objek ERP adalah GRANT SELECT ke role baru ini.
--
--  Desain (lihat README "Akses baca ERP (v5)"):
--   1. role ach_erp_reader: NOLOGIN, BYPASSRLS (supaya baris ERP terlihat tanpa
--      menambah/mengubah policy ERP), dan HANYA SELECT pada allowlist eksplisit
--      (sebagian tabel per kolom: telepon/email/alamat/NPWP/token/payload tidak ikut).
--      Tidak ada yang bisa login sebagai role ini; satu-satunya jalan masuk adalah
--      fungsi ach_erp.run di bawah.
--   2. ach_erp.run(sql, max_rows): SECURITY DEFINER yang DIMILIKI ach_erp_reader
--      (bukan postgres), jadi query berjalan dengan hak role itu: grant tabel
--      menegakkan allowlist. Sebelum jalan: validasi (satu SELECT/WITH, tanpa
--      komentar/dollar-quote/kutip ganda, kurung seimbang, tanpa kata kunci DML/DDL,
--      tanpa katalog pg_*/information_schema/schema lain, hanya fungsi dari allowlist),
--      lalu transaction_read_only = on, request.* (header/JWT PostgREST) dikosongkan,
--      hasil dibungkus LIMIT ≤ 200. Batas waktu: statement_timeout 8s milik role
--      authenticator (PostgREST) berlaku untuk seluruh panggilan RPC; set_config
--      statement_timeout di dalam fungsi hanya berlaku untuk statement berikutnya.
--      Schema ach_erp privat (tidak diekspos PostgREST, USAGE hanya service_role).
--   3. public.ach_erp_query / public.ach_erp_schema: pembungkus SECURITY INVOKER
--      untuk RPC; EXECUTE hanya service_role (Edge Function ach-bridge).
--   4. public.ach_erp_audit: log query (agen, sql, jumlah baris, ms) — PRIVAT.
-- =====================================================================

begin;

-- ---------------------------------------------------------------- 1. role
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'ach_erp_reader') then
    create role ach_erp_reader nologin bypassrls noinherit nocreatedb nocreaterole;
  end if;
end;
$$;
alter role ach_erp_reader nologin bypassrls noinherit nocreatedb nocreaterole;
comment on role ach_erp_reader is 'ACHPHORIA v5: pembaca ERP read-only (NOLOGIN). Hanya dipakai lewat ach_erp.run (SECURITY DEFINER).';
-- pemilik migrasi (postgres) perlu bisa SET ROLE ke role ini untuk menyerahkan kepemilikan fungsi
do $$
begin
  execute format('grant ach_erp_reader to %I with inherit true, set true', current_user);
exception when others then
  execute format('grant ach_erp_reader to %I', current_user);
end;
$$;
-- role ini tidak boleh jadi anggota role lain (anon/authenticated/service_role)
do $$
declare r record;
begin
  for r in select pg_get_userbyid(m.roleid) as parent from pg_auth_members m
            where m.member = 'ach_erp_reader'::regrole loop
    execute format('revoke %I from ach_erp_reader', r.parent);
  end loop;
end;
$$;

-- ---------------------------------------------------------------- 2. allowlist (reset → grant ulang)
do $$
declare
  t text;
  full_tables text[] := array[
    -- CRM (tanpa crm_customers: per kolom di bawah)
    'crm_membership_tiers', 'crm_point_transactions', 'crm_promotions', 'crm_settings',
    -- keuangan
    'fin_accounts', 'fin_journal_lines', 'fin_journals', 'fin_supplier_payment_items',
    -- inventori & produksi
    'inv_adjustment_purposes', 'inv_item_categories', 'inv_item_custom_fields', 'inv_item_stock_levels',
    'inv_item_sub_categories', 'inv_item_units', 'inv_items', 'inv_production_lines', 'inv_productions',
    'inv_recipe_costs', 'inv_recipe_items', 'inv_recipes', 'inv_stock_adjustment_items', 'inv_stock_adjustments',
    'inv_stock_batches', 'inv_stock_movement_batches', 'inv_stock_movements', 'inv_stock_opname_items',
    'inv_stock_opnames', 'inv_stock_transfer_items', 'inv_stock_transfers', 'inv_stocks', 'inv_transfer_packages',
    'inv_units',
    -- master menu & harga
    'mst_menu_categories', 'mst_menu_item_modifier_groups', 'mst_menu_items', 'mst_menu_prices', 'mst_menu_sold_outs',
    'mst_modifier_groups', 'mst_modifiers', 'mst_payment_methods', 'mst_price_schedule_items', 'mst_price_schedules',
    'mst_table_areas',
    -- POS
    'pos_order_item_modifiers', 'pos_order_items', 'pos_refund_payments', 'pos_refunds', 'pos_settlement_items', 'pos_shifts',
    -- pembelian
    'pur_goods_receipt_items', 'pur_goods_receipts', 'pur_pricelist_items', 'pur_pricelists', 'pur_purchase_order_items',
    'pur_purchase_orders',
    -- penjualan B2B
    'sal_credit_notes', 'sal_deliveries', 'sal_delivery_items', 'sal_delivery_packages', 'sal_invoice_items', 'sal_invoices',
    'sal_payment_items', 'sal_pricelist_items', 'sal_pricelists', 'sal_sales_order_items',
    -- master sistem yang aman
    'sys_approval_rules', 'sys_brands', 'sys_company_groups', 'sys_document_sequences',
    -- view laporan ERP (security_invoker: hanya jalan bila kolom dasarnya juga di-grant)
    'rpt_batch_movements', 'rpt_daily_sales', 'rpt_item_costs', 'rpt_menu_food_costs', 'rpt_menu_sales', 'rpt_payables',
    'rpt_payment_summary', 'rpt_pos_settlement_days', 'rpt_production_variances', 'rpt_recipe_costs',
    'rpt_revenue_by_source', 'rpt_sales_invoices', 'rpt_stock_balances', 'rpt_stock_batches', 'rpt_voids'
  ];
  -- tabel campuran: hanya kolom berikut (kolom kontak/pribadi/token/referensi pembayaran tidak ikut)
  col_tables jsonb := jsonb_build_object(
    'crm_customers', 'id,company_id,code,name,tier_id,points_balance,total_spent,visit_count,last_visit_at,is_active,created_at,updated_at',
    'pos_orders', 'id,company_id,outlet_id,shift_id,table_id,order_number,business_date,sales_channel,guest_count,status,subtotal,discount_amount,service_amount,tax_amount,rounding_amount,grand_total,note,created_by,paid_at,voided_at,void_reason,created_at,updated_at,customer_id,promotion_id,promotion_amount,points_redeemed,points_amount,points_earned,order_source,refunded_at',
    'pos_payments', 'id,company_id,order_id,payment_method_id,amount,change_amount,paid_at,created_at',
    'pos_payment_requests', 'id,company_id,outlet_id,order_id,gateway_id,amount,currency,status,requested_by,paid_at,created_at,updated_at',
    'pos_settlements', 'id,company_id,outlet_id,payment_method_id,settlement_number,settlement_date,date_from,date_to,expected_amount,received_amount,fee_amount,difference_amount,to_account_id,note,created_by,created_at,updated_at',
    'fin_supplier_payments', 'id,company_id,supplier_id,account_id,payment_number,payment_date,amount,note,created_by,created_at,updated_at',
    'sal_payments', 'id,company_id,outlet_id,customer_type,buyer_outlet_id,customer_id,payment_number,payment_date,amount,from_account_id,to_account_id,note,created_by,created_at',
    'pur_suppliers', 'id,company_id,code,name,payment_term_days,is_active,created_at,updated_at,supplier_type,linked_outlet_id',
    'sal_customers', 'id,company_id,code,name,payment_term_days,credit_limit,is_active,created_at,updated_at',
    'sal_sales_orders', 'id,company_id,outlet_id,warehouse_id,customer_type,buyer_outlet_id,buyer_warehouse_id,customer_id,purchase_order_id,so_number,so_date,expected_date,status,subtotal,tax_pct,tax_amount,grand_total,note,reject_reason,confirmed_by,confirmed_at,created_by,created_at,updated_at',
    'sys_companies', 'id,code,name,is_active,created_at,updated_at,logo_url,app_name,group_id',
    'sys_outlets', 'id,company_id,brand_id,code,name,timezone,tax_rate,service_charge_rate,rounding_unit,is_active,created_at,updated_at,default_warehouse_id,is_qr_order_enabled,qr_requires_confirmation',
    'inv_warehouses', 'id,company_id,outlet_id,code,name,is_active,created_at,updated_at,warehouse_type,notes',
    'mst_tables', 'id,company_id,outlet_id,table_area_id,code,capacity,status,created_at,updated_at',
    'sys_activity_logs', 'id,company_id,user_id,user_name,action,entity_type,entity_id,entity_label,created_at',
    'sys_approval_requests', 'id,company_id,outlet_id,document_type,document_id,title,amount,status,requested_by,requested_at,decided_by,decided_at,decision_note,created_at,updated_at'
  );
  k text;
  cols text;
begin
  -- reset: cabut semua hak role ini di schema public (tabel, kolom, sequence, fungsi tidak pernah diberikan)
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p', 'f')
              and (has_table_privilege('ach_erp_reader', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                   or has_any_column_privilege('ach_erp_reader', c.oid, 'SELECT,INSERT,UPDATE,REFERENCES')) loop
    execute format('revoke all on table public.%I from ach_erp_reader', t);
  end loop;

  execute 'grant usage on schema public to ach_erp_reader';
  foreach t in array full_tables loop
    if to_regclass('public.' || quote_ident(t)) is not null then
      execute format('grant select on table public.%I to ach_erp_reader', t);
    end if;
  end loop;
  for k in select jsonb_object_keys(col_tables) loop
    if to_regclass('public.' || quote_ident(k)) is null then continue; end if;
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into cols
      from pg_attribute a
     where a.attrelid = ('public.' || quote_ident(k))::regclass and a.attnum > 0 and not a.attisdropped
       and a.attname = any (string_to_array(col_tables ->> k, ','));
    if cols is not null then
      execute format('grant select (%s) on table public.%I to ach_erp_reader', cols, k);
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------- 3. schema privat + fungsi inti
create schema if not exists ach_erp;
comment on schema ach_erp is 'ACHPHORIA v5: fungsi inti akses baca ERP (privat; tidak diekspos PostgREST).';
revoke all on schema ach_erp from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on schema ach_erp from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on schema ach_erp from authenticated'; end if;
end;
$$;
grant usage on schema ach_erp to service_role;
-- sementara: pemilik baru fungsi butuh CREATE di schema (dicabut lagi di bawah)
grant usage, create on schema ach_erp to ach_erp_reader;

create or replace function ach_erp.run(p_sql text, p_max_rows integer default 50)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_catalog, pg_temp
as $fn$
declare
  v_sql  text := btrim(coalesce(p_sql, ''));
  v_mask text;
  v_n    integer := least(greatest(coalesce(p_max_rows, 50), 1), 200);
  v_bad  text;
  v_fn   text;
  v_g    text;
  v_rows json;
  v_cnt  integer;
  v_cols jsonb;
  v_depth integer := 0;
  v_i    integer;
  -- fungsi & kata kunci SQL yang boleh diikuti "(" — selain ini ditolak
  ok_fn  text[] := array[
    -- sintaks
    'select','from','join','in','exists','any','all','some','over','filter','within','group','as','on','using','values',
    'where','and','or','not','when','then','else','case','lateral','by','cast','row','array','having','limit','offset',
    'between','distinct','union','intersect','except','materialized','is','like','ilike','rollup','cube','sets','grouping',
    -- tipe ber-typmod
    'numeric','decimal','varchar','char','character','timestamp','timestamptz','time','float','interval','bit',
    -- agregat & window
    'count','sum','avg','min','max','string_agg','array_agg','json_agg','jsonb_agg','json_object_agg','jsonb_object_agg',
    'bool_and','bool_or','every','stddev','stddev_pop','stddev_samp','variance','var_pop','var_samp','percentile_cont',
    'percentile_disc','mode','corr','row_number','rank','dense_rank','percent_rank','cume_dist','ntile','lag','lead',
    'first_value','last_value','nth_value',
    -- skalar
    'coalesce','nullif','greatest','least','abs','round','ceil','ceiling','floor','trunc','mod','power','sqrt','sign','div',
    'exp','ln','log','width_bucket',
    'lower','upper','initcap','length','char_length','substr','substring','trim','btrim','ltrim','rtrim','concat',
    'concat_ws','replace','split_part','left','right','lpad','rpad','position','strpos','starts_with','translate',
    'reverse','format','regexp_replace','regexp_match','to_char','to_number','to_date','to_timestamp',
    'now','date','date_trunc','date_part','extract','age','make_date','make_time','make_interval','make_timestamp',
    'make_timestamptz','timezone','date_bin','generate_series','justify_days','justify_hours','justify_interval','isfinite',
    'jsonb_build_object','json_build_object','jsonb_build_array','json_build_array','jsonb_array_length','json_array_length',
    'jsonb_array_elements','jsonb_array_elements_text','jsonb_each','jsonb_each_text','jsonb_extract_path_text',
    'jsonb_typeof','jsonb_object_keys','to_jsonb','to_json','array_length','unnest','cardinality','array_to_string',
    'string_to_array','array_position'
  ];
begin
  if v_sql = '' then
    raise exception using errcode = '22023', message = 'erp_query ditolak: sql kosong';
  end if;
  if length(v_sql) > 8000 then
    raise exception using errcode = '22023', message = 'erp_query ditolak: sql terlalu panjang (maks 8000 karakter)';
  end if;
  v_sql := regexp_replace(v_sql, '\s*;\s*$', '');                       -- satu titik koma di akhir boleh
  -- samarkan isi string '...' supaya pemeriksaan kata kunci tidak tertipu teks di dalam string
  v_mask := regexp_replace(v_sql, '''(?:[^'']|'''')*''', '''''', 'g');
  if position('''' in replace(v_mask, '''''', '')) > 0 then
    raise exception using errcode = '22023', message = 'erp_query ditolak: tanda kutip tidak seimbang';
  end if;
  if v_mask ~ ';' then
    raise exception using errcode = '22023', message = 'erp_query ditolak: hanya boleh SATU statement (tanpa ";" di tengah)';
  end if;
  for v_i in 1 .. length(v_mask) loop                                  -- kurung harus seimbang
    v_depth := v_depth + case substr(v_mask, v_i, 1) when '(' then 1 when ')' then -1 else 0 end;
    exit when v_depth < 0;
  end loop;
  if v_depth <> 0 then
    raise exception using errcode = '22023', message = 'erp_query ditolak: tanda kurung tidak seimbang';
  end if;
  if v_mask ~ '(--|/\*)' then
    raise exception using errcode = '22023', message = 'erp_query ditolak: komentar SQL tidak diizinkan';
  end if;
  if v_mask ~ '[$"\\]' then
    raise exception using errcode = '22023', message = 'erp_query ditolak: karakter $ / " / \ tidak diizinkan (pakai nama kolom biasa & string ''...'')';
  end if;
  if v_mask ~* '(^|[^a-z0-9_])[eu]&?''' then
    raise exception using errcode = '22023', message = 'erp_query ditolak: string E''..''/U&''..'' tidak diizinkan';
  end if;
  if v_mask !~* '^\s*(select|with)\M' then
    raise exception using errcode = '22023', message = 'erp_query ditolak: hanya SELECT atau WITH … SELECT';
  end if;
  v_bad := substring(v_mask from '(?i)\m(insert|update|delete|merge|truncate|drop|alter|create|grant|revoke|copy|call|do|execute|prepare|deallocate|listen|notify|unlisten|vacuum|analyze|cluster|reindex|refresh|lock|share|set|reset|discard|into|returning|begin|commit|rollback|savepoint|checkpoint)\M');
  if v_bad is not null then
    raise exception using errcode = '22023', message = format('erp_query ditolak: kata kunci "%s" tidak diizinkan (read-only)', lower(v_bad));
  end if;
  v_bad := substring(v_mask from '(?i)\m(pg_[a-z0-9_]*|information_schema|ach_[a-z0-9_]*)\M');
  if v_bad is null then
    v_bad := substring(v_mask from '(?i)\m(auth|storage|vault|extensions|realtime|net|cron|graphql|graphql_public|pgsodium|supabase_functions|supabase_migrations|pgbouncer|ach_erp)\s*\.');
  end if;
  if v_bad is not null then
    raise exception using errcode = '42501', message = format('erp_query ditolak: "%s" tidak boleh diakses (hanya tabel ERP di schema public)', lower(v_bad));
  end if;
  v_bad := substring(v_mask from '(?i)\m(sys_payment_gateway_secrets|sys_payment_gateways|sys_users|sys_user_invitations|sys_platform_admins|sys_user_context|sys_group_members|sys_user_brands|sys_user_outlets|sys_roles|inv_recipe_access)\M');
  if v_bad is not null then
    raise exception using errcode = '42501', message = format('erp_query ditolak: tabel %s dikecualikan (data sensitif/akses user)', lower(v_bad));
  end if;
  if v_mask ~* '\.\s*[a-z_][a-z0-9_]*\s*\(' then
    raise exception using errcode = '22023', message = 'erp_query ditolak: pemanggilan fungsi ber-schema tidak diizinkan';
  end if;
  for v_fn in select lower(m[1]) from regexp_matches(v_mask, '([a-z_][a-z0-9_]*)\s*\(', 'gi') as m loop
    if not (v_fn = any (ok_fn)) then
      raise exception using errcode = '22023', message = format('erp_query ditolak: fungsi/sintaks "%s(" tidak diizinkan (alias kolom pakai AS di SELECT, bukan t(a,b))', v_fn);
    end if;
  end loop;

  -- pagar transaksi: read-only, batas waktu, buang header/JWT PostgREST dari konteks
  perform set_config('transaction_read_only', 'on', true);
  perform set_config('statement_timeout', '8s', true);
  foreach v_g in array array['request.headers', 'request.cookies', 'request.jwt.claims', 'request.jwt.claim.role',
                             'request.jwt.claim.sub', 'request.jwt.claim.email', 'request.method', 'request.path'] loop
    perform set_config(v_g, '', true);
  end loop;
  for v_g in select name from pg_catalog.pg_settings where name like 'request.%' loop
    perform set_config(v_g, '', true);
  end loop;

  execute format('select json_agg(ach_t) from (select * from (%s) as ach_q limit %s) as ach_t', v_sql, v_n + 1) into v_rows;
  v_cnt := coalesce(json_array_length(v_rows), 0);
  if v_cnt > v_n then
    select json_agg(e order by i) into v_rows from json_array_elements(v_rows) with ordinality as x(e, i) where i <= v_n;
  end if;
  select coalesce(jsonb_agg(k order by o), '[]'::jsonb) into v_cols
    from json_object_keys(case when v_cnt > 0 then v_rows -> 0 else '{}'::json end) with ordinality as y(k, o);
  return jsonb_build_object(
    'columns', v_cols,
    'rows', coalesce(v_rows::jsonb, '[]'::jsonb),
    'row_count', least(v_cnt, v_n),
    'truncated', v_cnt > v_n,
    'max_rows', v_n
  );
end;
$fn$;
comment on function ach_erp.run(text, integer) is 'ACHPHORIA v5: jalankan SATU SELECT read-only sebagai ach_erp_reader (allowlist via grant), maks 200 baris. Hanya service_role.';
alter function ach_erp.run(text, integer) owner to ach_erp_reader;
revoke all on function ach_erp.run(text, integer) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on function ach_erp.run(text, integer) from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on function ach_erp.run(text, integer) from authenticated'; end if;
end;
$$;
grant execute on function ach_erp.run(text, integer) to service_role;
revoke create on schema ach_erp from ach_erp_reader;
revoke usage on schema ach_erp from ach_erp_reader;

-- ---------------------------------------------------------------- 4. pembungkus RPC (public, SECURITY INVOKER)
create or replace function public.ach_erp_query(p_sql text, p_max_rows integer default 50)
returns jsonb
language sql
volatile
security invoker
set search_path = public, pg_temp
as $$ select ach_erp.run(p_sql, p_max_rows) $$;
comment on function public.ach_erp_query(text, integer) is 'ACHPHORIA v5: RPC baca ERP (SELECT tunggal, read-only, ≤200 baris). EXECUTE hanya service_role.';

create or replace function public.ach_erp_schema(p_table text default null)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'table', t.relname,
           'kind', case t.relkind when 'v' then 'view' when 'm' then 'view' else 'table' end,
           'restricted', not has_table_privilege('ach_erp_reader', t.oid, 'SELECT'),
           'comment', obj_description(t.oid, 'pg_class'),
           'columns', (select jsonb_agg(jsonb_build_object('name', a.attname, 'type', format_type(a.atttypid, a.atttypmod)) order by a.attnum)
                         from pg_attribute a
                        where a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
                          and has_column_privilege('ach_erp_reader', t.oid, a.attnum, 'SELECT'))
         ) order by t.relname), '[]'::jsonb)
    from pg_class t
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'public' and t.relkind in ('r', 'v', 'm', 'p')
     and has_any_column_privilege('ach_erp_reader', t.oid, 'SELECT')
     and (p_table is null or t.relname = lower(btrim(p_table)))
$$;
comment on function public.ach_erp_schema(text) is 'ACHPHORIA v5: daftar tabel/view ERP + kolom yang boleh dibaca ach_erp_reader (restricted = hanya sebagian kolom). EXECUTE hanya service_role.';

revoke all on function public.ach_erp_query(text, integer), public.ach_erp_schema(text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.ach_erp_query(text, integer), public.ach_erp_schema(text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.ach_erp_query(text, integer), public.ach_erp_schema(text) from authenticated';
  end if;
end;
$$;
grant execute on function public.ach_erp_query(text, integer), public.ach_erp_schema(text) to service_role;

-- ---------------------------------------------------------------- 5. audit (privat)
create table if not exists public.ach_erp_audit (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  agent      text not null,
  action     text not null default 'erp_query',
  sql        text,
  row_count  integer,
  truncated  boolean,
  ms         integer,
  ok         boolean not null default true,
  error      text
);
comment on table public.ach_erp_audit is 'ACHPHORIA v5: audit akses baca ERP oleh bot (agen, sql, jumlah baris, ms; TANPA isi hasil). Privat, hanya service_role.';
create index if not exists ach_erp_audit_created_idx on public.ach_erp_audit (created_at desc);
alter table public.ach_erp_audit enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.ach_erp_audit from anon';
    execute 'revoke all on sequence public.ach_erp_audit_id_seq from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.ach_erp_audit from authenticated';
    execute 'revoke all on sequence public.ach_erp_audit_id_seq from authenticated';
  end if;
end;
$$;
grant all on table public.ach_erp_audit to service_role;
grant usage, select on sequence public.ach_erp_audit_id_seq to service_role;

commit;
