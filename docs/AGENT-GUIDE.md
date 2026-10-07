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
| `400 … ditolak: mengandung …` | Hapus angka/nominal sensitif dari log/aktivitas/tugas. |
| `409 grup log belum terdaftar` (`log`) / `log_feed.skipped` | Owner belum kirim `/setlogs` (atau `/start` di grup "ACHPHORIA LOGS"). |
| Bot tidak merespons di grup | Privasi grup bot masih aktif (atur di @BotFather → /setprivacy → Disable) atau tidak di-mention. |
