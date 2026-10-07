-- =====================================================================
--  ACHPHORIA CORPORATION · Kantor Virtual (v2, gaya Jepang) — skema Supabase
-- ---------------------------------------------------------------------
--  • Untuk instalasi BARU. Database yang masih v1 (markas bulan, 9 agen)
--    → jalankan supabase/migrate-v2-kantor.sql (bukan file ini).
--  • Idempotent: aman dijalankan berulang kali di Supabase SQL Editor.
--  • SEMUA objek memakai prefix  ach_  karena project Supabase ini dipakai
--    bersama aplikasi lain. Skrip ini TIDAK menyentuh objek lain selain
--    menambahkan tabel ach_* ke publikasi supabase_realtime.
--  • Website (anon / publishable key) hanya bisa SELECT.
--    Penulisan hanya lewat service_role (bypass RLS) atau fungsi
--    public.ach_report_activity(...) yang EXECUTE-nya hanya untuk service_role.
--
--  Kunci ruangan (kolom location) — kantor bergaya Jepang (v2):
--    desk       = zona kerja milik agen:
--                 chief → kotatsu · research → pojok baca · ops → meja multi-monitor
--                 content → pojok konten (corkboard + kamera) · engineering → booth server
--    meeting    = rapat di kotatsu          tea        = stasiun teh (kyusu)
--    ramen      = konter ramen (3 bangku)   tatami     = tidur siang di pojok tatami
--    vending    = mesin minuman             whiteboard = papan tulis
--    offline    = pulang / keluar lewat pintu noren
--    NULL       = ikut jadwal harian otomatis (WIB) di website
--  Agen (id): chief, research, ops, content, engineering
--  Status: kerja | terjadwal | santai | istirahat | offline
--  Status tugas: 'Sedang kerja' | 'Terjadwal' | 'Selesai'
-- =====================================================================


-- ---------------------------------------------------------------------
-- Tabel
-- ---------------------------------------------------------------------
create table if not exists public.ach_agents (
  id           text primary key,
  name         text not null,
  division     text not null default '',
  color        text not null default '#8a93a8',
  sort_order   smallint,
  status       text not null default 'kerja',
  location     text,
  activity     text,
  current_task text,
  updated_at   timestamptz not null default now(),
  constraint ach_agents_color_check    check (color ~ '^#[0-9A-Fa-f]{6}$'),
  constraint ach_agents_status_check   check (status in ('kerja','terjadwal','santai','istirahat','offline')),
  constraint ach_agents_location_check check (location is null or location in
    ('desk','meeting','tea','ramen','tatami','vending','whiteboard','offline'))
);
comment on table public.ach_agents is 'ACHPHORIA kantor virtual v2: 5 agen AI (chief, research, ops, content, engineering).';

create table if not exists public.ach_tasks (
  id         uuid primary key default gen_random_uuid(),
  agent_id   text references public.ach_agents(id) on update cascade on delete set null,
  title      text not null,
  detail     text,
  status     text not null default 'Terjadwal',
  due_at     timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ach_tasks_status_check check (status in ('Sedang kerja','Terjadwal','Selesai'))
);
comment on table public.ach_tasks is 'ACHPHORIA kantor virtual: papan tugas.';

create table if not exists public.ach_logs (
  id         bigserial primary key,
  agent_id   text references public.ach_agents(id) on update cascade on delete set null,
  message    text not null,
  location   text,
  created_at timestamptz not null default now()
);
comment on table public.ach_logs is 'ACHPHORIA kantor virtual: log aktivitas (tulis tanpa nama agen di depan, mis. "gabung rapat di kotatsu").';

create index if not exists ach_tasks_agent_idx   on public.ach_tasks (agent_id);
create index if not exists ach_tasks_status_idx  on public.ach_tasks (status, updated_at desc);
create index if not exists ach_logs_created_idx  on public.ach_logs (created_at desc);
create index if not exists ach_logs_agent_idx    on public.ach_logs (agent_id, created_at desc);

-- Pastikan CHECK lokasi memakai kunci v2 walau tabel sudah ada sebelumnya.
-- NOT VALID: tidak memeriksa baris lama (data v1 dibereskan oleh migrate-v2-kantor.sql),
-- tetapi semua INSERT/UPDATE baru wajib memakai kunci v2.
alter table public.ach_agents drop constraint if exists ach_agents_location_check;
alter table public.ach_agents add constraint ach_agents_location_check
  check (location is null or location in ('desk','meeting','tea','ramen','tatami','vending','whiteboard','offline')) not valid;
do $$
begin
  alter table public.ach_agents validate constraint ach_agents_location_check;
exception when check_violation then
  raise notice 'ACHPHORIA: masih ada lokasi v1 di ach_agents — jalankan supabase/migrate-v2-kantor.sql';
end;
$$;

-- ---------------------------------------------------------------------
-- Trigger updated_at
-- ---------------------------------------------------------------------
create or replace function public.ach_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.ach_set_updated_at() from public, anon, authenticated;

drop trigger if exists ach_agents_set_updated_at on public.ach_agents;
create trigger ach_agents_set_updated_at
  before update on public.ach_agents
  for each row execute function public.ach_set_updated_at();

drop trigger if exists ach_tasks_set_updated_at on public.ach_tasks;
create trigger ach_tasks_set_updated_at
  before update on public.ach_tasks
  for each row execute function public.ach_set_updated_at();

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

-- ---------------------------------------------------------------------
-- Data awal: 5 agen v2 (tidak menimpa data yang sudah ada)
-- ---------------------------------------------------------------------
insert into public.ach_agents (id, name, division, color, sort_order, status, location, activity, current_task) values
  ('chief',       'Chief of Staff',      'Chief of Staff',      '#d98c8c', 1, 'kerja',     'meeting', 'Memimpin stand-up di kotatsu',              'Rencana prioritas Q4'),
  ('research',    'Research',            'Research',            '#8fb8de', 2, 'kerja',     'desk',    'Membaca laporan riset di pojok baca',       'Riset tren pasar Asia Tenggara'),
  ('ops',         'Ops & Data',          'Ops & Data',          '#8fae8b', 3, 'kerja',     'desk',    'Memantau dashboard di meja multi-monitor',  'Dashboard metrik operasional'),
  ('content',     'Content & Marketing', 'Content & Marketing', '#a8a29a', 4, 'istirahat', 'tea',     'Seduh teh sambil cari ide konten',          'Seri video "Sehari di Kantor"'),
  ('engineering', 'Engineering',         'Engineering',         '#e0a64a', 5, 'kerja',     'desk',    'Memantau server di booth kaca',             'Migrasi database ke region Jakarta')
on conflict (id) do nothing;

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

-- minta PostgREST memuat ulang cache skema
notify pgrst, 'reload schema';
