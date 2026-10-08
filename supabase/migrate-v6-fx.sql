-- =====================================================================
--  ACHPHORIA CORPORATION · MIGRASI v6 — Jembatan FX (mode AI)
-- ---------------------------------------------------------------------
--  Jalankan setelah migrate-v5-erp-read.sql (project ckoejqzownrujikefgwb).
--  Idempotent: aman diulang. HANYA membuat/mengubah objek ach_*.
--  Tidak ada tabel yang di-drop, objek non-ach_* tidak disentuh, dan tidak
--  ada yang ditambahkan ke publikasi supabase_realtime.
--
--  1. ach_fx_state     snapshot terbaru per device (PC bot / mock). Privat.
--  2. ach_fx_commands  antrean perintah AI -> PC (open/close/modify/...). Privat.
--  3. ach_fx_journal   event trade yang dilaporkan PC untuk ditinjau AI. Privat.
--
--  Semua tabel: RLS aktif, TANPA policy, revoke anon & authenticated,
--  grant hanya ke service_role. Akses lewat Edge Function ach-bridge saja.
-- =====================================================================

begin;

-- 1. snapshot state per device
create table if not exists public.ach_fx_state (
  device_id    text primary key,
  heartbeat_at timestamptz,
  mode         text not null default 'manual',
  bot_running  boolean not null default false,
  dry_run      boolean not null default false,
  account      jsonb not null default '{}'::jsonb,
  positions    jsonb not null default '[]'::jsonb,
  risk_status  jsonb not null default '{}'::jsonb,
  symbols      jsonb not null default '{}'::jsonb,
  market       jsonb not null default '{}'::jsonb,
  link         jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now()
);
alter table public.ach_fx_state add column if not exists link jsonb not null default '{}'::jsonb;
alter table public.ach_fx_state drop constraint if exists ach_fx_state_mode_check;
alter table public.ach_fx_state add constraint ach_fx_state_mode_check check (mode in ('manual', 'ai'));
comment on table public.ach_fx_state is 'ACHPHORIA v6: snapshot terbaru bot FX per device (privat, hanya service_role).';

-- 2. antrean perintah
create table if not exists public.ach_fx_commands (
  id                   uuid primary key default gen_random_uuid(),
  created_at           timestamptz not null default now(),
  created_by           text not null default 'ai',
  device_id            text not null,
  action               text not null,
  symbol               text,
  side                 text,
  order_type           text,
  sl_price             numeric,
  tp_price             numeric,
  risk_percent         numeric,
  lots                 numeric,
  reason               text,
  timeframe            text,
  expires_at           timestamptz not null default (now() + interval '10 minutes'),
  max_slippage_points  integer,
  ticket               bigint,
  status               text not null default 'pending',
  result               jsonb,
  updated_at           timestamptz not null default now()
);
alter table public.ach_fx_commands drop constraint if exists ach_fx_commands_action_check;
alter table public.ach_fx_commands add constraint ach_fx_commands_action_check
  check (action in ('open', 'close', 'modify', 'close_all', 'pause', 'resume', 'set_watchlist'));
alter table public.ach_fx_commands drop constraint if exists ach_fx_commands_status_check;
alter table public.ach_fx_commands add constraint ach_fx_commands_status_check
  check (status in ('pending', 'executing', 'done', 'rejected', 'expired', 'failed'));
create index if not exists ach_fx_commands_device_status_idx
  on public.ach_fx_commands (device_id, status, created_at desc);
comment on table public.ach_fx_commands is 'ACHPHORIA v6: perintah AI untuk bot FX (privat, hanya service_role).';

-- 3. jurnal event dari PC
create table if not exists public.ach_fx_journal (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  device_id  text not null,
  event      text not null,
  ticket     bigint,
  symbol     text,
  side       text,
  lots       numeric,
  price      numeric,
  sl         numeric,
  tp         numeric,
  profit     numeric,
  reason     text,
  extra      jsonb not null default '{}'::jsonb
);
create index if not exists ach_fx_journal_device_time_idx on public.ach_fx_journal (device_id, created_at desc);
comment on table public.ach_fx_journal is 'ACHPHORIA v6: event trade bot FX untuk ditinjau AI (privat, hanya service_role).';

-- keamanan: RLS on, tanpa policy, bukan realtime, bukan untuk anon/authenticated
do $$
declare t text;
begin
  foreach t in array array['ach_fx_state', 'ach_fx_commands', 'ach_fx_journal'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end;
$$;

commit;

notify pgrst, 'reload schema';
