-- =====================================================================
--  ACHPHORIA CORPORATION · Moon Base Virtual Office — skema Supabase
-- ---------------------------------------------------------------------
--  • Idempotent: aman dijalankan berulang kali di Supabase SQL Editor.
--  • SEMUA objek memakai prefix  ach_  karena project Supabase ini dipakai
--    bersama aplikasi lain (mis. Vertex8). Skrip ini TIDAK menyentuh objek
--    lain selain menambahkan tabel ach_* ke publikasi supabase_realtime.
--  • Website (anon / publishable key) hanya bisa SELECT.
--    Penulisan hanya lewat service_role (bypass RLS) atau fungsi
--    public.ach_report_activity(...) yang EXECUTE-nya hanya untuk service_role.
--
--  Kunci ruangan (kolom location):
--    desk     = meja kerja di modul divisi agen
--    meeting  = Meeting Room (meja hologram)      kantin  = Kantin
--    arcade   = Arcade Room                        gym     = Gym
--    sleep    = Sleep Pods                         shower  = Showers
--    dance    = Dance Floor                        outdoor = Kubah luar (main sama alien)
--    command  = Menara Komando (permukaan)         rocket  = Landasan roket (permukaan)
--    NULL     = ikut jadwal harian otomatis (WIB) di website
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
    ('desk','meeting','kantin','arcade','gym','sleep','shower','dance','outdoor','command','rocket'))
);
comment on table public.ach_agents is 'ACHPHORIA virtual office: 9 agen AI (urutan modul = sort_order).';

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
comment on table public.ach_tasks is 'ACHPHORIA virtual office: papan tugas.';

create table if not exists public.ach_logs (
  id         bigserial primary key,
  agent_id   text references public.ach_agents(id) on update cascade on delete set null,
  message    text not null,
  location   text,
  created_at timestamptz not null default now()
);
comment on table public.ach_logs is 'ACHPHORIA virtual office: log aktivitas (tulis tanpa nama agen di depan, mis. "mulai rapat di Meeting Room").';

create index if not exists ach_tasks_agent_idx   on public.ach_tasks (agent_id);
create index if not exists ach_tasks_status_idx  on public.ach_tasks (status, updated_at desc);
create index if not exists ach_logs_created_idx  on public.ach_logs (created_at desc);
create index if not exists ach_logs_agent_idx    on public.ach_logs (agent_id, created_at desc);

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
--  p_status      : kerja|terjadwal|santai|istirahat|offline (NULL = tidak diubah)
--  p_location    : kunci ruangan (NULL = tidak diubah, '' = kosongkan → jadwal otomatis)
--  p_activity    : kalimat aktivitas singkat (NULL = tidak diubah)
--  p_task        : judul tugas; dicocokkan (case-insensitive) dengan tugas agen ini,
--                  di-update bila ada, dibuat bila belum ada
--  p_task_status : 'Sedang kerja' (default) | 'Terjadwal' | 'Selesai'
--  p_log         : pesan log (tanpa nama agen), mis. 'mulai rapat di Meeting Room'
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
  v_location    text;
begin
  if p_agent_id is null or not exists (select 1 from public.ach_agents a where a.id = p_agent_id) then
    raise exception 'Agen "%" tidak ditemukan di public.ach_agents', p_agent_id using errcode = 'P0002';
  end if;

  update public.ach_agents a set
    status       = coalesce(nullif(btrim(coalesce(p_status, '')), ''), a.status),
    location     = case when p_location is null then a.location
                        when btrim(p_location) = '' then null
                        else btrim(p_location) end,
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
-- Realtime: tambahkan tabel ach_* ke publikasi supabase_realtime (idempotent)
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
-- Data awal (tidak menimpa data yang sudah ada)
-- ---------------------------------------------------------------------
insert into public.ach_agents (id, name, division, color, sort_order, status, location, activity, current_task) values
  ('commander',   'Commander',  'Chief of Staff',      '#ffc940', 1, 'kerja',     'meeting', 'Memimpin rapat koordinasi mingguan',      'Sinkronisasi OKR Q4'),
  ('engineering', 'Engineer',   'Engineering',         '#2ee6c5', 2, 'kerja',     'desk',    'Deploy fitur realtime ke production',     'Migrasi server ke region baru'),
  ('research',    'Researcher', 'Research & Data',     '#3dd6ff', 3, 'kerja',     'meeting', 'Presentasi insight data pengguna',        'Analisis retensi bulan ini'),
  ('marketing',   'Marketer',   'Marketing & Growth',  '#ff5fa2', 4, 'kerja',     'desk',    'Nyiapin kampanye peluncuran',             'Kampanye "Moon Week"'),
  ('content',     'Creator',    'Content & Creative',  '#ff9a3d', 5, 'santai',    'outdoor', 'Rekam konten main bola bareng alien',     'Video behind-the-scenes base'),
  ('sales',       'Closer',     'Sales & Partnership', '#4d7dff', 6, 'kerja',     'desk',    'Follow-up calon partner dari Bumi',       'Proposal kemitraan Lunar Logistics'),
  ('finance',     'Treasurer',  'Finance',             '#ffe14d', 7, 'istirahat', 'kantin',  'Ngopi sambil cek cashflow',               'Rekap budget Q4'),
  ('success',     'Helper',     'Customer Success',    '#6dff7a', 8, 'santai',    'gym',     'Angkat beban slow-motion (gravitasi 1/6!)', 'Balas tiket pelanggan prioritas'),
  ('hr',          'Counsel',    'HR & Legal',          '#b46bff', 9, 'terjadwal', 'desk',    'Review kontrak kerja sama',               'Update SOP keselamatan base')
on conflict (id) do nothing;

insert into public.ach_tasks (agent_id, title, detail, status, due_at)
select v.agent_id, v.title, v.detail, v.status, v.due_at
from (values
  ('commander',   'Sinkronisasi OKR Q4',                'Samakan target semua divisi untuk kuartal ini.', 'Sedang kerja', null::timestamptz),
  ('commander',   'Siapkan agenda all-hands',           'Agenda rapat besar Jumat.',                      'Terjadwal',    now() + interval '1 day'),
  ('engineering', 'Migrasi server ke region baru',      'Pindah ke region dengan latensi terendah ke Bumi.', 'Sedang kerja', null),
  ('engineering', 'Upgrade firmware lift kaca',         'Rilis v2.3 untuk kontrol lift.',                 'Selesai',      null),
  ('research',    'Analisis retensi bulan ini',         'Cohort pengguna baru vs lama.',                  'Sedang kerja', null),
  ('marketing',   'Kampanye "Moon Week"',               'Konten 7 hari + iklan.',                         'Sedang kerja', null),
  ('content',     'Video behind-the-scenes base',       'Rekam kegiatan kru & alien di kubah.',           'Sedang kerja', null),
  ('sales',       'Proposal kemitraan Lunar Logistics', 'Draft proposal + harga.',                        'Terjadwal',    now() + interval '6 hours'),
  ('finance',     'Rekap budget Q4',                    'Rekap realisasi vs rencana.',                    'Terjadwal',    now() + interval '2 days'),
  ('success',     'Balas tiket pelanggan prioritas',    'Target SLA < 2 jam.',                            'Sedang kerja', null),
  ('hr',          'Update SOP keselamatan base',        'Termasuk prosedur airlock kubah.',               'Terjadwal',    now() + interval '1 day')
) as v(agent_id, title, detail, status, due_at)
where not exists (select 1 from public.ach_tasks);

insert into public.ach_logs (agent_id, message, location)
select v.agent_id, v.message, v.location
from (values
  ('commander',   'membuka hari dengan briefing singkat', 'meeting'),
  ('engineering', 'deploy hotfix sensor oksigen ✔',       'desk'),
  ('finance',     'istirahat sebentar di Kantin',         'kantin'),
  ('content',     'keluar ke Kubah Luar, main bareng alien', 'outdoor'),
  ('research',    'mulai rapat di Meeting Room',          'meeting')
) as v(agent_id, message, location)
where not exists (select 1 from public.ach_logs);

-- minta PostgREST memuat ulang cache skema
notify pgrst, 'reload schema';
