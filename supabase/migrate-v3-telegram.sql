-- =====================================================================
--  ACHPHORIA CORPORATION · MIGRASI v3 — Jembatan Telegram (ach-bridge)
-- ---------------------------------------------------------------------
--  Jalankan setelah schema.sql / migrate-v2-kantor.sql (project ckoejqzownrujikefgwb).
--  Idempotent: aman diulang. HANYA membuat/mengubah objek ach_*.
--  Tidak ada tabel yang di-drop, objek non-ach_* tidak disentuh,
--  dan tabel di bawah ini SENGAJA TIDAK dimasukkan ke publikasi supabase_realtime.
--
--  Tabel baru (semuanya PRIVAT: RLS aktif, TANPA policy anon/authenticated,
--  grant dicabut dari anon/authenticated → hanya service_role, yaitu Edge
--  Function ach-bridge, yang bisa membaca/menulis):
--    ach_inbox     pesan Telegram masuk per bot (antrian kerja asisten)
--                  status: baru → diproses → selesai | gagal
--    ach_outbox    pesan yang dikirim bot ke Telegram (audit)
--    ach_tg_allow  allowlist user Telegram (from_id) yang boleh memerintah bot
--    ach_tg_chats  chat yang pernah dilihat tiap bot (cari chat_id grup HQ, dll.)
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- ach_inbox
-- ---------------------------------------------------------------------
create table if not exists public.ach_inbox (
  id                  bigserial primary key,
  created_at          timestamptz not null default now(),
  bot                 text not null,
  update_id           bigint,
  chat_id             bigint,
  chat_type           text,
  chat_title          text,
  from_id             bigint,
  from_name           text,
  from_username       text,
  text                text,
  message_id          bigint,
  reply_to_message_id bigint,
  update              jsonb,
  status              text not null default 'baru',
  handled_at          timestamptz,
  note                text
);
-- kolom yang mungkin belum ada bila tabel dibuat versi lebih awal
alter table public.ach_inbox add column if not exists update_id bigint;
alter table public.ach_inbox add column if not exists handled_at timestamptz;
alter table public.ach_inbox add column if not exists note text;

alter table public.ach_inbox drop constraint if exists ach_inbox_status_check;
alter table public.ach_inbox add constraint ach_inbox_status_check
  check (status in ('baru','diproses','selesai','gagal'));
alter table public.ach_inbox drop constraint if exists ach_inbox_bot_check;
alter table public.ach_inbox add constraint ach_inbox_bot_check
  check (bot in ('chief','research','ops','content','engineering'));
comment on table public.ach_inbox is 'ACHPHORIA v3: pesan Telegram masuk per bot (privat, hanya service_role). status: baru|diproses|selesai|gagal.';

-- satu update Telegram hanya dicatat sekali per bot (Telegram bisa mengirim ulang)
create unique index if not exists ach_inbox_bot_update_uidx on public.ach_inbox (bot, update_id);
create index if not exists ach_inbox_bot_status_idx on public.ach_inbox (bot, status, id);
create index if not exists ach_inbox_from_idx       on public.ach_inbox (bot, from_id);
create index if not exists ach_inbox_created_idx    on public.ach_inbox (created_at desc);

-- ---------------------------------------------------------------------
-- ach_outbox
-- ---------------------------------------------------------------------
create table if not exists public.ach_outbox (
  id                  bigserial primary key,
  created_at          timestamptz not null default now(),
  bot                 text not null,
  chat_id             bigint,
  text                text,
  reply_to_message_id bigint,
  telegram_message_id bigint,
  ok                  boolean not null default false,
  error               text
);
alter table public.ach_outbox drop constraint if exists ach_outbox_bot_check;
alter table public.ach_outbox add constraint ach_outbox_bot_check
  check (bot in ('chief','research','ops','content','engineering'));
comment on table public.ach_outbox is 'ACHPHORIA v3: pesan keluar bot Telegram (audit, privat, hanya service_role).';
create index if not exists ach_outbox_bot_created_idx on public.ach_outbox (bot, created_at desc);

-- ---------------------------------------------------------------------
-- ach_tg_allow — allowlist user Telegram
-- ---------------------------------------------------------------------
create table if not exists public.ach_tg_allow (
  from_id    bigint primary key,
  note       text,
  created_at timestamptz not null default now()
);
alter table public.ach_tg_allow add column if not exists created_at timestamptz not null default now();
comment on table public.ach_tg_allow is 'ACHPHORIA v3: user Telegram (from_id) yang boleh memerintah bot. Diisi lewat /start <TG_CLAIM_CODE> di chat pribadi.';

-- ---------------------------------------------------------------------
-- ach_tg_chats — chat yang dikenal per bot
-- ---------------------------------------------------------------------
create table if not exists public.ach_tg_chats (
  bot       text not null,
  chat_id   bigint not null,
  chat_type text,
  title     text,
  username  text,
  last_seen timestamptz not null default now(),
  primary key (bot, chat_id)
);
alter table public.ach_tg_chats add column if not exists username text;
alter table public.ach_tg_chats drop constraint if exists ach_tg_chats_bot_check;
alter table public.ach_tg_chats add constraint ach_tg_chats_bot_check
  check (bot in ('chief','research','ops','content','engineering'));
comment on table public.ach_tg_chats is 'ACHPHORIA v3: chat Telegram yang pernah dilihat tiap bot (private/group/supergroup/channel).';

-- ---------------------------------------------------------------------
-- Keamanan: RLS aktif TANPA policy → anon/authenticated tidak bisa apa-apa.
-- service_role melewati RLS. Grant dicabut sebagai pertahanan berlapis
-- (default privileges Supabase memberi grant ke anon/authenticated).
-- ---------------------------------------------------------------------
alter table public.ach_inbox    enable row level security;
alter table public.ach_outbox   enable row level security;
alter table public.ach_tg_allow enable row level security;
alter table public.ach_tg_chats enable row level security;

revoke all on table public.ach_inbox, public.ach_outbox, public.ach_tg_allow, public.ach_tg_chats from anon, authenticated;
grant all on table public.ach_inbox, public.ach_outbox, public.ach_tg_allow, public.ach_tg_chats to service_role;
revoke all on sequence public.ach_inbox_id_seq, public.ach_outbox_id_seq from anon, authenticated;
grant usage, select on sequence public.ach_inbox_id_seq, public.ach_outbox_id_seq to service_role;

commit;

-- minta PostgREST memuat ulang cache skema
notify pgrst, 'reload schema';
