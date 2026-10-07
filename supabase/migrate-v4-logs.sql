-- =====================================================================
--  ACHPHORIA CORPORATION · MIGRASI v4 — Grup Telegram "ACHPHORIA LOGS"
-- ---------------------------------------------------------------------
--  Jalankan setelah migrate-v3-telegram.sql (project ckoejqzownrujikefgwb).
--  Idempotent: aman diulang. HANYA membuat/mengubah objek ach_*.
--  Tidak ada tabel yang di-drop, objek non-ach_* tidak disentuh, dan tidak
--  ada yang ditambahkan ke publikasi supabase_realtime.
--
--  1. ach_tg_chats.role  (NULL | 'hq' | 'logs') — chat ber-role 'logs' = grup feed
--     update tugas. Diisi bridge saat owner kirim /start · /logs di grup yang
--     judulnya mengandung "LOGS", atau /setlogs.
--  2. ach_tg_logmsg      (PRIVAT) id pesan induk Telegram per tugas per chat,
--     supaya event berikutnya (mulai/selesai/gagal/approval) berutas di bawahnya.
--  3. Bila grup "ACHPHORIA LOGS" sudah tercatat di ach_tg_chats (owner sudah
--     kirim /start sebelum deploy) dan belum ada grup log, langsung tandai.
-- =====================================================================

begin;

do $$
begin
  if to_regclass('public.ach_tg_chats') is null or to_regclass('public.ach_tasks') is null then
    raise exception 'Jalankan schema.sql dan migrate-v3-telegram.sql dulu (ach_tasks / ach_tg_chats belum ada).';
  end if;
end;
$$;

-- 1. role chat
alter table public.ach_tg_chats add column if not exists role text;
alter table public.ach_tg_chats drop constraint if exists ach_tg_chats_role_check;
alter table public.ach_tg_chats add constraint ach_tg_chats_role_check
  check (role is null or role in ('hq', 'logs'));
create index if not exists ach_tg_chats_role_idx on public.ach_tg_chats (role, last_seen desc) where role is not null;
comment on column public.ach_tg_chats.role is 'ACHPHORIA v4: NULL | hq | logs. logs = grup feed update tugas (satu chat_id).';

-- 2. pesan induk per tugas
create table if not exists public.ach_tg_logmsg (
  task_id    uuid   not null references public.ach_tasks (id) on delete cascade,
  chat_id    bigint not null,
  message_id bigint not null,
  agent_id   text,
  created_at timestamptz not null default now(),
  primary key (task_id, chat_id)
);
comment on table public.ach_tg_logmsg is 'ACHPHORIA v4: id pesan induk Telegram per tugas di grup log (privat, hanya service_role).';

alter table public.ach_tg_logmsg enable row level security;
revoke all on table public.ach_tg_logmsg from anon, authenticated;
grant all on table public.ach_tg_logmsg to service_role;

-- 3. daftarkan grup LOGS yang sudah ada (supergroup diutamakan; chat_id grup lama mati setelah migrasi)
update public.ach_tg_chats c
   set role = 'logs'
 where c.chat_id = (
         select x.chat_id from public.ach_tg_chats x
          where x.chat_type in ('group', 'supergroup') and x.title ilike '%ACHPHORIA LOGS%'
          order by (x.chat_type = 'supergroup') desc, x.last_seen desc
          limit 1)
   and not exists (select 1 from public.ach_tg_chats y where y.role = 'logs');

commit;

notify pgrst, 'reload schema';
