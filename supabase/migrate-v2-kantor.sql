-- =====================================================================
--  ACHPHORIA CORPORATION · MIGRASI v1 (markas bulan) → v2 (kantor Jepang)
-- ---------------------------------------------------------------------
--  Jalankan SEKALI di Supabase SQL Editor project ckoejqzownrujikefgwb
--  (aman diulang: idempotent). Website otomatis pindah dari DEMO ke LIVE
--  begitu 5 agen v2 ada & tidak ada lagi agen v1.
--
--  Yang dilakukan (hanya objek ach_*):
--   1. Bila data v1 terdeteksi: HAPUS baris seed 9 agen lama
--        commander, engineering, research, marketing, content, sales,
--        finance, success, hr
--      beserta tugas (ach_tasks) & log (ach_logs) milik mereka.
--      (engineering/research/content v1 dikenali dari nama lamanya:
--       Engineer / Researcher / Creator, jadi agen v2 dengan id yang sama
--       TIDAK ikut terhapus saat skrip diulang.)
--   2. Lokasi lama di agen lain yang tersisa dikosongkan (→ jadwal otomatis).
--   3. CHECK constraint lokasi & status diganti ke kunci v2:
--        desk, meeting, tea, ramen, tatami, vending, whiteboard, offline
--   4. Insert/rapikan 5 agen v2: chief, research, ops, content, engineering
--      (nama/divisi/warna/urutan diset; status/lokasi live tidak ditimpa).
--   5. Seed tugas & log contoh untuk 5 agen (hanya bila mereka belum punya).
--   6. Ganti fungsi ach_report_activity (validasi id/lokasi/status v2).
--   7. Tegaskan ulang RLS, policy SELECT publik, grant, publikasi realtime.
--   8. notify pgrst, 'reload schema'.
--  Tidak ada tabel yang di-drop; objek non-ach_* tidak disentuh.
-- =====================================================================

begin;

-- 0. Prasyarat: tabel v1/v2 harus sudah ada
do $$
begin
  if to_regclass('public.ach_agents') is null or to_regclass('public.ach_tasks') is null or to_regclass('public.ach_logs') is null then
    raise exception 'Tabel ach_* belum ada. Untuk instalasi baru jalankan supabase/schema.sql saja.';
  end if;
end;
$$;

-- 1. Hapus data seed v1 (hanya bila v1 terdeteksi)
do $$
declare
  v_old text[];
  n_t int; n_l int; n_a int;
begin
  select coalesce(array_agg(a.id), '{}') into v_old
    from public.ach_agents a
   where a.id in ('commander','marketing','sales','finance','success','hr')
      or (a.id = 'engineering' and a.name = 'Engineer')
      or (a.id = 'research'    and a.name = 'Researcher')
      or (a.id = 'content'     and a.name = 'Creator');

  if cardinality(v_old) > 0 then
    delete from public.ach_tasks where agent_id = any (v_old);
    get diagnostics n_t = row_count;
    delete from public.ach_logs  where agent_id = any (v_old);
    get diagnostics n_l = row_count;
    delete from public.ach_agents where id = any (v_old);
    get diagnostics n_a = row_count;
    raise notice 'ACHPHORIA v2: hapus % agen v1 (%), % tugas, % log', n_a, array_to_string(v_old, ', '), n_t, n_l;
  else
    raise notice 'ACHPHORIA v2: tidak ada data v1 — lewati penghapusan';
  end if;
end;
$$;

-- 2 & 3. CHECK constraint v2
alter table public.ach_agents drop constraint if exists ach_agents_location_check;
alter table public.ach_agents drop constraint if exists ach_agents_status_check;
update public.ach_agents set location = null
 where location is not null and location not in ('desk','meeting','tea','ramen','tatami','vending','whiteboard','offline');
update public.ach_agents set status = 'kerja'
 where status not in ('kerja','terjadwal','santai','istirahat','offline');
alter table public.ach_agents add constraint ach_agents_status_check
  check (status in ('kerja','terjadwal','santai','istirahat','offline'));
alter table public.ach_agents add constraint ach_agents_location_check
  check (location is null or location in ('desk','meeting','tea','ramen','tatami','vending','whiteboard','offline'));
comment on table public.ach_agents is 'ACHPHORIA kantor virtual v2: 5 agen AI (chief, research, ops, content, engineering).';
comment on table public.ach_logs is 'ACHPHORIA kantor virtual: log aktivitas (tulis tanpa nama agen di depan, mis. "gabung rapat di kotatsu").';

-- 4. Lima agen v2
insert into public.ach_agents (id, name, division, color, sort_order, status, location, activity, current_task) values
  ('chief',       'Chief of Staff',      'Chief of Staff',      '#d98c8c', 1, 'kerja',     'meeting', 'Memimpin stand-up di kotatsu',              'Rencana prioritas Q4'),
  ('research',    'Research',            'Research',            '#8fb8de', 2, 'kerja',     'desk',    'Membaca laporan riset di pojok baca',       'Riset tren pasar Asia Tenggara'),
  ('ops',         'Ops & Data',          'Ops & Data',          '#8fae8b', 3, 'kerja',     'desk',    'Memantau dashboard di meja multi-monitor',  'Dashboard metrik operasional'),
  ('content',     'Content & Marketing', 'Content & Marketing', '#a8a29a', 4, 'istirahat', 'tea',     'Seduh teh sambil cari ide konten',          'Seri video "Sehari di Kantor"'),
  ('engineering', 'Engineering',         'Engineering',         '#e0a64a', 5, 'kerja',     'desk',    'Memantau server di booth kaca',             'Migrasi database ke region Jakarta')
on conflict (id) do update set
  name       = excluded.name,
  division   = excluded.division,
  color      = excluded.color,
  sort_order = excluded.sort_order;

-- 5. Seed tugas & log v2 (hanya bila 5 agen belum punya)
insert into public.ach_tasks (agent_id, title, detail, status, due_at)
select v.agent_id, v.title, v.detail, v.status, v.due_at
from (values
  ('chief',       'Rencana prioritas Q4',               'Samakan target kelima divisi untuk kuartal ini.',  'Sedang kerja', null::timestamptz),
  ('chief',       'Agenda rapat mingguan',              'Agenda stand-up & retro Jumat di kotatsu.',        'Terjadwal',    now() + interval '1 day'),
  ('research',    'Riset tren pasar Asia Tenggara',     'Ringkasan peluang 3 negara prioritas.',            'Sedang kerja', null),
  ('research',    'Ringkasan 5 paper AI terbaru',       'Catatan singkat untuk tim.',                       'Terjadwal',    now() + interval '2 days'),
  ('ops',         'Dashboard metrik operasional',       'KPI harian di tiga layar meja multi-monitor.',     'Sedang kerja', null),
  ('ops',         'Rekap data penjualan mingguan',      'Kirim ke Chief of Staff setiap Jumat.',            'Terjadwal',    now() + interval '6 hours'),
  ('content',     'Seri video "Sehari di Kantor"',      'Rekam aktivitas tim di pojok kamera.',             'Sedang kerja', null),
  ('content',     'Kalender konten November',           'Rencana posting 4 minggu.',                        'Terjadwal',    now() + interval '3 days'),
  ('engineering', 'Migrasi database ke region Jakarta', 'Latensi lebih rendah untuk pengguna Indonesia.',   'Sedang kerja', null),
  ('engineering', 'Optimasi pipeline CI',               'Build < 3 menit.',                                 'Selesai',      null)
) as v(agent_id, title, detail, status, due_at)
where not exists (select 1 from public.ach_tasks t where t.agent_id in ('chief','research','ops','content','engineering'));

insert into public.ach_logs (agent_id, message, location, created_at)
select v.agent_id, v.message, v.location, now() - v.ago
from (values
  ('chief',       'membuka hari dengan stand-up di kotatsu',       'meeting', interval '95 minutes'),
  ('engineering', 'deploy patch keamanan ke server ✔',             'desk',    interval '80 minutes'),
  ('content',     'menyeduh teh hijau di stasiun teh ☕',          'tea',     interval '41 minutes'),
  ('research',    'balik ke Pojok Baca, lanjut riset pasar',       'desk',    interval '33 minutes'),
  ('ops',         'memperbarui dashboard metrik di meja monitor',  'desk',    interval '12 minutes')
) as v(agent_id, message, location, ago)
where not exists (select 1 from public.ach_logs l where l.agent_id in ('chief','research','ops','content','engineering'));

-- 6. Fungsi laporan v2
-- ---------------------------------------------------------------------
-- Fungsi laporan untuk agen AI (hanya service_role)
-- ---------------------------------------------------------------------
--  p_agent_id    : chief | research | ops | content | engineering
--  p_status      : kerja|terjadwal|santai|istirahat|offline (NULL/'' = tidak diubah)
--  p_location    : desk|meeting|tea|ramen|tatami|vending|whiteboard|offline
--                  (NULL = tidak diubah, '' = kosongkan → jadwal otomatis WIB)
--                  location 'offline' tanpa p_status otomatis membuat status 'offline'
--  p_activity    : kalimat aktivitas singkat (NULL = tidak diubah)
--  p_task        : judul tugas; dicocokkan (case-insensitive) dengan tugas agen ini,
--                  di-update bila ada, dibuat bila belum ada
--  p_task_status : 'Sedang kerja' (default) | 'Terjadwal' | 'Selesai'
--  p_log         : pesan log (tanpa nama agen), mis. 'gabung rapat di kotatsu'
create or replace function public.ach_report_activity(
  p_agent_id    text,
  p_status      text,
  p_location    text,
  p_activity    text,
  p_task        text default null,
  p_task_status text default null,
  p_log         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task_id     uuid;
  v_log_id      bigint;
  v_task        text := nullif(btrim(coalesce(p_task, '')), '');
  v_task_status text := coalesce(nullif(btrim(coalesce(p_task_status, '')), ''), 'Sedang kerja');
  v_status      text := nullif(btrim(coalesce(p_status, '')), '');
  v_loc_in      text := case when p_location is null then null else btrim(p_location) end;
  v_location    text;
begin
  if p_agent_id is null or not exists (select 1 from public.ach_agents a where a.id = p_agent_id) then
    raise exception 'Agen "%" tidak ditemukan di public.ach_agents (id v2: chief, research, ops, content, engineering)', p_agent_id
      using errcode = 'P0002';
  end if;
  if v_status is not null and v_status not in ('kerja','terjadwal','santai','istirahat','offline') then
    raise exception 'Status "%" tidak valid. Pilihan: kerja, terjadwal, santai, istirahat, offline', v_status
      using errcode = '22023';
  end if;
  if v_loc_in is not null and v_loc_in <> '' and v_loc_in not in ('desk','meeting','tea','ramen','tatami','vending','whiteboard','offline') then
    raise exception 'Lokasi "%" tidak valid. Pilihan: desk, meeting, tea, ramen, tatami, vending, whiteboard, offline ('''' = jadwal otomatis)', v_loc_in
      using errcode = '22023';
  end if;
  if v_task is not null and v_task_status not in ('Sedang kerja','Terjadwal','Selesai') then
    raise exception 'Status tugas "%" tidak valid. Pilihan: Sedang kerja, Terjadwal, Selesai', v_task_status
      using errcode = '22023';
  end if;
  if v_status is null and v_loc_in = 'offline' then
    v_status := 'offline';
  end if;

  update public.ach_agents a set
    status       = coalesce(v_status, a.status),
    location     = case when v_loc_in is null then a.location
                        when v_loc_in = '' then null
                        else v_loc_in end,
    activity     = coalesce(p_activity, a.activity),
    current_task = case when v_task is null then a.current_task
                        when v_task_status = 'Selesai' then (case when lower(a.current_task) = lower(v_task) then null else a.current_task end)
                        when v_task_status = 'Sedang kerja' then v_task
                        else a.current_task end,
    updated_at   = now()
  where a.id = p_agent_id
  returning a.location into v_location;

  if v_task is not null then
    select t.id into v_task_id
      from public.ach_tasks t
     where t.agent_id = p_agent_id and lower(t.title) = lower(v_task)
     order by (t.status = 'Selesai') asc, t.updated_at desc
     limit 1;
    if v_task_id is null then
      insert into public.ach_tasks (agent_id, title, status)
      values (p_agent_id, v_task, v_task_status)
      returning id into v_task_id;
    else
      update public.ach_tasks set status = v_task_status where id = v_task_id;
    end if;
  end if;

  if nullif(btrim(coalesce(p_log, '')), '') is not null then
    insert into public.ach_logs (agent_id, message, location)
    values (p_agent_id, btrim(p_log), v_location)
    returning id into v_log_id;
  end if;

  return jsonb_build_object('ok', true, 'agent_id', p_agent_id, 'location', v_location, 'task_id', v_task_id, 'log_id', v_log_id);
end;
$$;

revoke all on function public.ach_report_activity(text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.ach_report_activity(text, text, text, text, text, text, text) to service_role;

-- 7. Keamanan & realtime (ditegaskan ulang, idempotent)
-- ---------------------------------------------------------------------
-- RLS: publik hanya boleh membaca
-- ---------------------------------------------------------------------
alter table public.ach_agents enable row level security;
alter table public.ach_tasks  enable row level security;
alter table public.ach_logs   enable row level security;

drop policy if exists ach_agents_select_public on public.ach_agents;
create policy ach_agents_select_public on public.ach_agents for select to anon, authenticated using (true);
drop policy if exists ach_tasks_select_public on public.ach_tasks;
create policy ach_tasks_select_public on public.ach_tasks for select to anon, authenticated using (true);
drop policy if exists ach_logs_select_public on public.ach_logs;
create policy ach_logs_select_public on public.ach_logs for select to anon, authenticated using (true);

-- hak akses tabel (pertahanan berlapis selain RLS)
revoke all on table public.ach_agents, public.ach_tasks, public.ach_logs from anon, authenticated;
grant select on table public.ach_agents, public.ach_tasks, public.ach_logs to anon, authenticated;
grant all on table public.ach_agents, public.ach_tasks, public.ach_logs to service_role;
revoke all on sequence public.ach_logs_id_seq from anon, authenticated;
grant usage, select on sequence public.ach_logs_id_seq to service_role;

-- ---------------------------------------------------------------------
-- Realtime: pastikan tabel ach_* ada di publikasi supabase_realtime (idempotent)
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['ach_agents', 'ach_tasks', 'ach_logs'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

commit;

-- 8. minta PostgREST memuat ulang cache skema
notify pgrst, 'reload schema';
