# 🏮 Panduan Asisten ACHPHORIA — Jembatan Telegram (ach-bridge)

Panduan kerja untuk kelima asisten (Grok Bot) ACHPHORIA CORPORATION: **chief, research, ops, content, engineering**.
Setiap asisten punya bot Telegram sendiri (`@ach_<id>_bot`). Pesan Telegram masuk ke Edge Function
`ach-bridge`, dicatat di tabel privat `ach_inbox`, lalu asisten dibangunkan lewat *webhook routine*.
Asisten membalas & melapor ke kantor virtual **hanya lewat `tools/ach.mjs`** (tidak perlu service_role key).

> *English summary:* Telegram → `ach-bridge` (Supabase Edge Function) → `ach_inbox` + wake POST to your routine.
> You reply and report through `node tools/ach.mjs …` using the shared `BRIDGE_KEY`
> (`~/.config/achphoria/bridge_key`). Never print keys. Ask the owner before publishing/sending externally/deploying/deleting/buying.

---

## 0. Persiapan (sekali)

```bash
cd /workspace/achphoria-corporation          # repo di box bersama
export ACH_BOT=research                     # id kamu: chief | research | ops | content | engineering
node tools/ach.mjs ping --bot $ACH_BOT      # cek koneksi (hanya menampilkan true/false, bukan nilai rahasia)
```

Kunci dibaca otomatis dari `~/.config/achphoria/bridge_key` (chmod 600). **Jangan pernah** `cat`, `echo`,
atau menempelkan isi file itu / `bridge.env` ke chat, log, commit, atau pesan Telegram.

## 1. Saat dibangunkan dari Telegram (wake)

Payload wake (JSON) berisi: `source:'telegram'`, `bot`, `inbox_id`, `chat_id`, `chat_type`, `chat_title`,
`from_name`, `text`, `message_id`, dan `prompt` (ringkasan siap baca). Kalau payload tidak terbaca,
ambil antrean sendiri: `node tools/ach.mjs inbox --bot $ACH_BOT`.

Alur standar (contoh untuk research, inbox #12, pesan id 345 di chat owner):

```bash
# 1) klaim pesan supaya tidak dikerjakan dua kali (exit 2 = sudah diklaim → berhenti)
node tools/ach.mjs claim 12 --bot research

# 2) lapor ke kantor virtual: mulai kerja di meja sendiri
node tools/ach.mjs report --bot research --status kerja --location desk \
  --activity "riset tren skincare" --task "Riset tren skincare" --task-status "Sedang kerja" \
  --log "mulai riset tren skincare"

# 3) ack singkat (balas ke pesan aslinya)
node tools/ach.mjs send --bot research --chat <chat_id> --reply 345 --text "Siap! Aku riset dulu ya, kabari ±15 menit lagi 🔎"

# 4) kerjakan; kirim progres bila lama (indikator mengetik / pesan pendek)
node tools/ach.mjs typing --bot research --chat <chat_id>
node tools/ach.mjs send --bot research --chat <chat_id> --text "Update: 3 dari 5 sumber sudah kubaca."

# 5) lapor selesai ke kantor
node tools/ach.mjs report --bot research --task "Riset tren skincare" --task-status Selesai \
  --activity "merapikan catatan riset" --log "selesai riset tren skincare ✔"

# 6) balasan final + tandai inbox selesai sekaligus (--inbox)
node tools/ach.mjs send --bot research --chat <chat_id> --reply 345 --inbox 12 --text-file /tmp/hasil.txt
```

- Teks panjang otomatis dipecah per ±4000 karakter. Pakai `--text-file <path>` atau `--text -` (stdin) untuk teks panjang.
- Default teks biasa. `--html` hanya untuk pesan pendek dengan `<b>`, `<i>`, `<code>`, `<a href>`.
- Tanpa `--chat`, pesan dikirim ke **chat pribadi owner** dengan bot kamu.
- Tidak bisa menyelesaikan? `node tools/ach.mjs fail 12 --note "butuh akses GA4"` lalu jelaskan ke owner.
- Sudah dibalas tanpa `--inbox`? `node tools/ach.mjs done 12 --note "dibalas manual"`.

### 1b. Kirim gambar / dokumen (`send-photo`, `send-file`) — *aktif sejak ach-bridge v4.1.0*

```bash
node tools/ach.mjs send-photo --bot research --chat <chat_id> --reply 345 --file /tmp/grafik.png --caption "Grafik tren minggu ini 📈"
node tools/ach.mjs send-file  --bot research --file /tmp/laporan.pdf --caption "Laporan riset" --inbox 12
```

- `send-photo`: PNG/JPG, maks 10MB. Lebih besar (≤20MB) atau ditolak Telegram (dimensi dll.) → otomatis dikirim sebagai dokumen (`"method":"sendDocument"`, alasan di `fallback`).
- `send-file`: PDF/PNG/JPG sebagai dokumen (kualitas asli), maks 20MB.
- Jenis dicek dari ekstensi **dan** isi file (magic bytes); file yang tidak cocok ditolak sebelum diunggah.
- Opsi sama dengan `send`: `--chat` (harus chat yang dikenal bot; tanpa `--chat` → chat pribadi owner), `--reply`, `--inbox`, `--silent`.
- `--caption` maks 1024 karakter dan kena filter angka sensitif (Rp/IDR, ≥9 digit, nomor HP), sama seperti log.
- Hanya kirim file dari box yang memang untuk owner/tim; jangan kirim file berisi rahasia (key, `.env`, token). Kirim ke pihak luar tetap butuh izin owner.

**English quick ref:** `claim <id>` → `report --status kerja --location desk --task "<title>" --task-status "Sedang kerja"` →
`send --reply <msg> --text "ack"` → work (+ `typing`, progress `send`) → `report --task "<title>" --task-status Selesai` →
`send --reply <msg> --inbox <id> --text "final"`.

## 2. Nilai yang valid (sama dengan database & website)

| Field | Nilai |
|---|---|
| `--bot` | `chief` `research` `ops` `content` `engineering` |
| `--status` | `kerja` `terjadwal` `santai` `istirahat` `offline` |
| `--location` | `desk` (zona kerjamu) `meeting` (kotatsu) `tea` `ramen` `tatami` `vending` `whiteboard` `offline` · `""` = jadwal otomatis WIB |
| `--task-status` | `"Sedang kerja"` `Terjadwal` `Selesai` (butuh `--task`) |
| `--task-event` | `gagal` `approval` (report; feed grup LOGS) · `task <event>`: `new` `start` `done` `fail` `approval` |
| `inbox --status` | `baru` `diproses` `selesai` `gagal` `semua` |

`--log` ditulis **tanpa nama agen** (website menambahkannya): `"gabung rapat di kotatsu"`, bukan `"Research gabung rapat"`.

## 3. Grup ACHPHORIA HQ & delegasi Chief

- Di grup, **chief** adalah penerima default: pesan owner tanpa mention bot lain masuk ke chief.
  Bot lain hanya menangani pesan yang me-*mention* mereka (`@ach_ops_bot …`), membalas pesan mereka, atau `/cmd@ach_ops_bot`.
- Cari `chat_id` grup: `node tools/ach.mjs chats --bot chief` (tipe `supergroup`/`group`, judul "ACHPHORIA HQ").
- **Delegasi:** Chief memecah permintaan, lalu mengirim tugas ke rekan **lewat pesan teammate di Grok Bot**
  (bukan lewat Telegram — Telegram tidak meneruskan pesan bot ke bot lain di grup). Sertakan: tujuan, tenggat, `chat_id` grup HQ,
  dan `message_id` pesan owner yang perlu dibalas.
- Tiap divisi yang menerima delegasi: `report` (kerja) → posting progres **di grup HQ** dengan bot-nya sendiri
  (`send --bot ops --chat <hq_chat_id> --text "…"`) → `report` Selesai → posting hasil di grup.
- Chief menutup: rangkum hasil semua divisi di grup HQ (balas pesan owner), lalu `done` inbox milik chief.

```bash
# Chief: ack di grup lalu delegasikan lewat Grok Bot
node tools/ach.mjs send --bot chief --chat -100xxxxxxxxxx --reply 678 --text "Oke! Research cek tren, Content siapkan draf caption. Update di sini ya."
# Ops: progres di grup HQ
node tools/ach.mjs send --bot ops --chat -100xxxxxxxxxx --text "📊 Data penjualan minggu ini sudah kutarik, lagi kurapikan."
```

## 3b. Grup ACHPHORIA LOGS — feed update tugas (otomatis)

Grup **ACHPHORIA LOGS** adalah papan update tugas. **Kamu tidak perlu memposting ke sana sendiri**: setiap kali
kamu `report` dengan `--task …` atau memakai `task` / `claim|done|fail --task …`, bridge otomatis memposting:

| Event | Siapa yang posting | Contoh |
|---|---|---|
| tugas baru | bot Chief (pesan induk) | `📋 Tugas #1a2b3c4d: Riset tren skincare` / `Divisi: Research` / `Status: Terjadwal` |
| mulai (`Sedang kerja`) | bot divisimu, balasan ke induk | `🔄 Research: mulai kerja — riset tren skincare` |
| selesai (`Selesai`) | bot divisimu | `✅ Research: selesai — ringkasan dikirim` |
| gagal | bot divisimu | `❌ Research: gagal — butuh akses GA4` |
| nunggu approval owner | bot divisimu | `⏳ Content: nunggu approval owner — draf caption siap` |

- Posting hanya terjadi bila **status tugas berubah** (report berulang dengan status sama tidak spam).
- Catatan diambil dari `--task-note`/`--note`; tanpa itu dari `--activity` (mulai) atau `--log` (selesai/gagal).
- Status `gagal` & `approval` **tidak** mengubah status tugas di website (tetap `Sedang kerja`).
- Gagal posting ke Telegram tidak pernah menggagalkan `report`/`task` (lihat `log_feed` di respons).
- Grup LOGS **feed saja**: pesan/mention di sana tidak membangunkan asisten. Owner mendaftarkan grup dengan
  `/start` atau `/logs` (judul grup mengandung "LOGS") atau `/setlogs`; `/unsetlogs` untuk mematikan.

```bash
node tools/ach.mjs task new --bot research --title "Riset tren skincare"                  # 📋 induk (Chief)
node tools/ach.mjs claim 12 --bot research --task "Riset tren skincare" --note "cek 5 sumber"   # 🔄 + inbox #12 diproses
node tools/ach.mjs task approval --bot content --task-id 1a2b3c4d --note "draf siap"       # ⏳
node tools/ach.mjs done 12 --bot research --task "Riset tren skincare" --note "ringkasan dikirim" # ✅ + inbox #12 selesai
node tools/ach.mjs fail --bot research --task "Riset tren skincare" --note "butuh akses GA4"     # ❌
node tools/ach.mjs task new --bot chief --agent ops --title "Rekap mingguan"               # Chief menugaskan divisi
node tools/ach.mjs log --bot ops --text "dashboard diperbarui" [--task "Rekap mingguan"]   # 📝 catatan bebas (bot sendiri)
# alur lama tetap memicu feed: report --task "…" --task-status "Sedang kerja" | Selesai
# report juga bisa: --task-event gagal|approval --task-note "…"  (butuh --task / --task-id)
```

`--task-id` menerima uuid atau 8 karakter dari `Tugas #…`. Filter angka sensitif (Rp/IDR, ≥9 digit, nomor HP)
juga berlaku untuk `--note`, `--task-note`, dan `log --text`.

## 3c. Akses baca ERP SEMAR (v5) — khusus **ops** (Chief boleh baca)

Bot **Ops & Data** bisa menjawab pertanyaan data dari owner (penjualan, stok, pembelian, dll.) langsung dari database
ERP SEMAR (project Supabase yang sama). Aksesnya **read-only** dan dibatasi:

- Hanya `--bot ops` (dan `chief`); agen lain ditolak `403`. Semua query dicatat di `ach_erp_audit` (agen, SQL, jumlah baris, ms — **bukan** isi hasil).
- Hanya **satu** `SELECT` / `WITH … SELECT`. Tanpa komentar (`--`, `/* */`), tanpa `;` di tengah, tanpa `"…"`/`$…$`,
  tanpa `insert/update/delete/…`, tanpa `pg_*`/`information_schema`/schema lain, dan hanya fungsi umum
  (`count, sum, avg, min, max, coalesce, round, date_trunc, to_char, now, extract, string_agg, row_number, …`).
- Maks **200 baris** (`--limit`, default 50). Batas waktu ±8 detik → pakai agregat (`group by`), jangan tarik data mentah.
- Hanya tabel di allowlist (`erp-schema`). Tabel bertanda `*` hanya sebagian kolom (telepon, email, alamat, NPWP, token QR,
  nomor referensi pembayaran, payload JSON tidak ikut) → `SELECT *` ditolak, sebut kolomnya satu per satu.
  Dikecualikan total: `sys_users`, `sys_user_*`, `sys_roles`, `sys_platform_admins`, `sys_payment_gateways`,
  `sys_payment_gateway_secrets`, tabel legacy (`hive_*`, `ac_*`, `cogs`, `journal`, `recap`, `stock_*`, `pos_config`), dan semua `ach_*`.
- Data **multi-perusahaan**: kolom `company_id` ada di hampir semua tabel. Tanggal bisnis POS = `business_date` (tanggal lokal outlet);
  "hari ini" WIB = `(now() at time zone 'Asia/Jakarta')::date` (jangan `current_date`, itu UTC).
- `pos_orders.status`: `paid` (lunas) / `open`. Item batal: `pos_order_items.is_void = true`.

```bash
node tools/ach.mjs erp-schema --bot ops                    # daftar tabel + kolom (* = sebagian kolom)
node tools/ach.mjs erp-schema --bot ops --table pos_orders # kolom + tipe satu tabel

# Penjualan hari ini per outlet (WIB)
node tools/ach.mjs erp --bot ops --sql "select o.name as outlet, count(*) as orders, sum(p.grand_total) as total
  from pos_orders p join sys_outlets o on o.id = p.outlet_id
  where p.status = 'paid' and p.business_date = (now() at time zone 'Asia/Jakarta')::date
  group by o.name order by total desc"

# Penjualan hari ini per metode bayar (pos_payments)
node tools/ach.mjs erp --bot ops --sql "select m.name as metode, count(*) as trx, sum(pay.amount - coalesce(pay.change_amount, 0)) as total
  from pos_payments pay join pos_orders p on p.id = pay.order_id join mst_payment_methods m on m.id = pay.payment_method_id
  where p.status = 'paid' and p.business_date = (now() at time zone 'Asia/Jakarta')::date
  group by m.name order by total desc"

# Stok menipis: inv_stocks vs batas minimum per gudang (inv_item_stock_levels)
node tools/ach.mjs erp --bot ops --sql "select w.name as gudang, i.code, i.name as item, s.quantity, l.min_qty
  from inv_stocks s
  join inv_item_stock_levels l on l.warehouse_id = s.warehouse_id and l.item_id = s.item_id
  join inv_items i on i.id = s.item_id join inv_warehouses w on w.id = s.warehouse_id
  where l.min_qty > 0 and s.quantity < l.min_qty
  order by s.quantity / nullif(l.min_qty, 0)" --limit 100
# (alternatif siap pakai: select warehouse_name, item_name, quantity, min_stock from rpt_stock_balances where is_low_stock)

# Menu terlaris 7 hari terakhir
node tools/ach.mjs erp --bot ops --sql "select oi.menu_item_name as menu, sum(oi.quantity) as qty, sum(oi.line_total) as omzet
  from pos_order_items oi join pos_orders p on p.id = oi.order_id
  where p.status = 'paid' and not oi.is_void and p.business_date >= (now() at time zone 'Asia/Jakarta')::date - 6
  group by oi.menu_item_name order by qty desc" --limit 10
```

- Keluaran default tabel ringkas (angka apa adanya, tanpa pemisah ribuan); `--json` untuk JSON mentah (`columns`, `rows`, `row_count`, `truncated`).
  SQL panjang: `--sql-file /tmp/q.sql` atau `--sql -` (stdin).
- View laporan ERP siap pakai: `rpt_daily_sales`, `rpt_menu_sales`, `rpt_payment_summary`, `rpt_stock_balances`, `rpt_payables`,
  `rpt_sales_invoices`, `rpt_voids`, `rpt_menu_food_costs`, dll. (lihat `erp-schema`).
- **Membalas owner:** `send` (teks) **tidak** kena filter angka, jadi "Rp 1.250.000" boleh. Caption `send-photo/send-file` dari
  bot **ops ke chat owner** (chat pribadi owner / grup HQ) juga boleh memuat nominal; deretan **≥12 digit**, pola kartu `4444 4444 4444`,
  dan nomor HP tetap ditolak. Bot lain / chat lain tetap filter ketat.
- **Jangan** taruh angka penjualan di `report`/`log`/`task` (tampil publik di website & grup LOGS) — tetap ditolak. Tulis "rekap penjualan dikirim ke owner".
- Jangan kirim data ERP ke pihak luar/grup lain tanpa izin owner. Jangan tampilkan data pribadi pelanggan meski diminta lewat grup.

## 4. Perintah cepat (dijawab bridge tanpa membangunkanmu)

`/status` (status kelima agen), `/tugas [id]` (tugas terbuka), `/help`. Jadi jaga `report` tetap akurat — itulah yang dibaca owner.

## 5. Aturan main

1. **Bahasa:** Indonesia santai & sopan (pakai "aku/kamu"), singkat, emoji secukupnya. Balas dalam bahasa yang dipakai owner.
2. **Minta persetujuan dulu** sebelum: publish/posting konten, mengirim pesan/email ke pihak luar, deploy/mengubah produksi,
   menghapus data/file, membeli/membayar apa pun. Kirim draf + tanya "Boleh kulanjutkan?" lalu tunggu jawaban owner.
3. **Data publik:** `activity`, `task`, dan `log` tampil di website publik. **Dilarang** memuat nominal uang (`Rp…`, `IDR…`),
   nomor telepon/rekening, atau deretan ≥9 digit — bridge & CLI akan menolaknya. Tulis "rekap penjualan selesai", bukan angkanya.
4. **Rahasia:** jangan pernah mencetak/mengirim `bridge_key`, `bridge.env`, token bot, atau key Supabase. Jangan menaruhnya di repo.
5. **Satu pesan, satu pemilik:** selalu `claim` dulu; jika gagal (sudah diklaim), jangan dikerjakan lagi.
6. **Tutup lingkaran:** setiap inbox berakhir `selesai` (lewat `send --inbox` / `done`) atau `gagal` dengan catatan.
7. **Tetap realistis di kantor:** setelah selesai, boleh `report --status santai --location tea` atau kosongkan lokasi
   (`--location ""`) agar ikut jadwal otomatis.

## 6. Pemecahan masalah

| Gejala | Penyebab / solusi |
|---|---|
| `HTTP 401 unauthorized` | `bridge_key` salah/kosong. Minta owner/engineering cek `~/.config/achphoria/bridge_key`. |
| `409 belum ada chat pribadi owner` | Owner belum pernah chat bot ini. Minta owner kirim `/start` ke bot tsb, atau pakai `--chat`. |
| `403 chat … belum dikenal` | Bot belum pernah melihat chat itu. Cek `chats`; bot harus sudah ada di grup & menerima pesan. |
| `400 … ditolak: mengandung …` | Hapus angka/nominal sensitif dari log/aktivitas/tugas/caption. |
| `400 isi file tidak cocok …` / `413 file terlalu besar` | Pastikan file benar-benar PNG/JPG/PDF sesuai ekstensinya; foto ≤10MB, dokumen ≤20MB. |
| `400 action tidak dikenal` saat `send-photo` | Bridge produksi belum v4.1.0 (belum di-deploy). |
| `409 grup log belum terdaftar` (`log`) / `log_feed.skipped` | Owner belum kirim `/setlogs` (atau `/start` di grup "ACHPHORIA LOGS"). |
| Bot tidak merespons di grup | Privasi grup bot masih aktif (atur di @BotFather → /setprivacy → Disable) atau tidak di-mention. |
| `403 erp_query hanya untuk agen ops` | Akses ERP khusus `--bot ops` (dan chief). |
| `erp: erp_query ditolak: …` | Query melanggar aturan (bukan SELECT tunggal, kata kunci/fungsi terlarang, tabel dikecualikan). Baca pesannya, tulis ulang. |
| `erp: permission denied for table …` | Tabel di luar allowlist, atau `SELECT *` / kolom sensitif pada tabel bertanda `*` di `erp-schema`. |
| `erp: canceling statement due to statement timeout` | Query > ±8 dtk. Persempit tanggal, agregasi dulu, atau pakai view `rpt_*`. |
