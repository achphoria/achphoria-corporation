# 🏮 ACHPHORIA CORPORATION — Kantor Virtual (gaya Jepang)

Kantor virtual **LIVE** untuk ACHPHORIA CORPORATION: sebuah kantor mungil bergaya Jepang, seperti rumah boneka dari clay yang dipotong melintang dan dilihat dari atas serong. Lima maskot clay berbentuk kacang (satu per divisi, memakai jaket *happi* indigo) bekerja, rapat di kotatsu, menyeduh teh, makan ramen, jajan di vending machine, dan tidur siang di tatami. Semua gerakan mereka disinkronkan **realtime** dengan Supabase.

![Overview kantor ACHPHORIA](assets/preview.webp)

- **Latar:** satu ilustrasi diorama clay (dinding pasir, kayu ash, tekstil indigo, tanaman sage, bantal terakota, cahaya amber). Isinya: pojok baca dengan jendela shoji, rak buku, taman zen dan bonsai; meja multi-monitor; kotatsu dengan 5 bantal duduk; booth server berkaca; corkboard, kamera tripod, dan rak tanaman; stasiun teh dengan kyusu beruap plus konter ramen 3 bangku; pintu noren; vending machine; papan tulis; lampion; dan monstera.
- **Karakter:** sprite maskot clay di atas latar. Ukurannya mengikuti perspektif (makin depan makin besar), urutan gambarnya diatur menurut kedalaman (y), ada bayangan kontak, dan bagian depan kotatsu ikut menutupi agen yang duduk di belakangnya.
- **Animasi:** jalan melompat dengan *squash & stretch*, napas pelan saat diam, kedip mata, getar mengetik di meja, duduk di bantal atau bangku, tidur berbaring dengan "z", serta gelembung emote 💬 ☕ 🍜 💡 🥤.
- **Suasana:** lampion bergoyang dan berkerlip, uap dari kyusu, kedip monitor dan LED server, vending machine berpendar, debu melayang di cahaya jendela, dan tint siang/sore/malam yang mengikuti jam WIB.
- **UI (Bahasa Indonesia, jam WIB):** panel kertas washi, aksen indigo, tombol clay, wordmark ACHPHORIA dengan stempel hanko merah 達成 ("pencapaian"). Tersedia Papan Tugas (`T`), Log (`L`), daftar Tim (`K`), kartu detail agen, tooltip, dan badge **LIVE/DEMO**.

## Agen (v2)

| id | Nama tampilan | Warna | Properti | Zona "desk" |
|---|---|---|---|---|
| `chief` | Chief of Staff | rose pudar `#d98c8c` | gulungan | kotatsu (kursi depan) |
| `research` | Research | biru langit `#8fb8de` | tumpukan buku | pojok baca (bantal dekat rak buku) |
| `ops` | Ops & Data | sage `#8fae8b` | tablet grafik | meja multi-monitor |
| `content` | Content & Marketing | abu hangat `#a8a29a` | secangkir teh | pojok konten (corkboard + kamera) |
| `engineering` | Engineering | amber `#e0a64a` | obeng | booth server |

Nama, divisi, dan warna bisa diubah di tabel `ach_agents`. Maskot dipilih berdasarkan `id`.

## Fitur

| Fitur | Cara pakai |
|---|---|
| Ikuti agen | Klik maskot (atau item di daftar Tim / Log / Papan Tugas, atau tombol `1`–`5`). Kamera zoom lalu mengikuti agen, dan kartu detail terbuka. |
| Kembali ke overview | `Esc`, klik area kosong, tombol ✕, atau `0` |
| Zoom & geser | Scroll untuk zoom di sekitar kursor, seret untuk menggeser. Saat mengikuti agen, scroll mengatur level zoom. |
| Papan Tugas | `T`. Tiga kolom: **Sedang kerja · Terjadwal · Selesai** |
| Log aktivitas | `L`. Entri baru muncul dengan animasi, waktu dalam WIB |
| Tim | `K`. Lima agen beserta status, lokasi, dan aktivitasnya |
| Tooltip | Arahkan kursor ke maskot atau fasilitas (kotatsu, stasiun teh, vending, …) |
| Parameter URL | `?demo=1` memaksa mode demo · `?jam=21` pratinjau pencahayaan jam tertentu · `?debug=1` menampilkan peta lantai, graf jalan, dan titik-titik bernama |

## Struktur file

```
index.html                    halaman utama
config.js                     URL + publishable key Supabase (AMAN untuk publik)
css/style.css                 gaya UI (washi, indigo, tombol clay)
assets/                       latar 2560×1440 + versi kecil, potongan depan kotatsu,
                              3 lampion, 5 maskot (+ varian mata tertutup), favicon (± 0,7 MB)
js/util.js                    utilitas, format waktu WIB
js/profiles.js                5 agen, kunci ruangan, status, jadwal fallback WIB
js/assets.js                  pemuat gambar + pose duduk yang dibuat di kode
js/world.js                   peta lantai, graf waypoint, titik bernama, area tooltip, skala perspektif
js/sim.js                     simulasi agen: rute, reservasi kursi, pose, squash & stretch, emote
js/fx.js                      suasana: lampion, uap, monitor, LED server, vending, debu, tint siang/malam
js/data.js                    Supabase LIVE + fallback DEMO (+ deteksi database v1)
js/app.js                     loop render, kamera, input, panel UI
supabase/schema.sql           skema LENGKAP v2 untuk instalasi baru (idempotent, prefix ach_)
supabase/migrate-v2-kantor.sql migrasi database v1 (markas bulan, 9 agen) → v2
tools/report.mjs              CLI laporan (Node 18+, tanpa dependensi)
tools/report.py               CLI laporan (Python 3, stdlib saja)
.nojekyll                     supaya GitHub Pages menyajikan file apa adanya
```

### Aset

Tidak ada generator gambar yang dipakai. Semua aset dibuat dari dua gambar referensi:

- **Latar:** ilustrasi kantor diperbesar 2× (EDSR super-resolution) menjadi 2560×1440 WebP. Lampion dipotong menjadi sprite terpisah supaya bisa bergoyang, dan dinding di belakangnya di-*inpaint*. Bagian depan kotatsu (meja + selimut) dipotong dengan alpha untuk efek oklusi.
- **Maskot:** dipotong dari lembar maskot, latar belakangnya dihapus dengan `rembg` (model isnet-general-use). Untuk tiap maskot dibuat juga varian **mata tertutup** (mata di-*inpaint* lalu digambar garis lengkung) yang dipakai saat kedip dan tidur.
- **Pose dibuat di kode:** *idle* (napas), *jalan* (lompat + squash & stretch + miring + balik arah), *duduk* (kaki dipotong dengan alas membulat), *bangku* (duduk dengan tinggi dudukan), *tidur* (diputar berbaring di atas bantal kecil, mata tertutup, "z").

## Setup

### 1. Supabase

**Instalasi baru:** buka **SQL Editor**, tempel isi [`supabase/schema.sql`](supabase/schema.sql), lalu **Run**. Skrip ini aman diulang dan membuat:
- tabel `ach_agents`, `ach_tasks`, `ach_logs` (+ index, trigger `updated_at`)
- RLS aktif: publik (anon/authenticated) **hanya bisa SELECT**
- fungsi `ach_report_activity(...)` (SECURITY DEFINER, EXECUTE **hanya** untuk `service_role`, memvalidasi id/lokasi/status v2)
- tabel ach_* masuk ke publikasi `supabase_realtime`
- 5 agen v2 + contoh tugas dan log (data yang sudah ada tidak ditimpa)

**Sudah pakai v1 (markas bulan, 9 agen)?** Jalankan [`supabase/migrate-v2-kantor.sql`](supabase/migrate-v2-kantor.sql) **sekali** di SQL Editor. Skrip ini idempotent, berjalan dalam satu transaksi, dan hanya menyentuh objek `ach_*`:

1. Kalau data v1 terdeteksi, skrip **menghapus** baris seed 9 agen lama (`commander`, `engineering`, `research`, `marketing`, `content`, `sales`, `finance`, `success`, `hr`) beserta tugas dan log mereka. Agen v1 `engineering`/`research`/`content` dikenali dari nama lamanya (Engineer/Researcher/Creator), jadi agen v2 dengan id yang sama tidak ikut terhapus kalau skrip diulang.
2. Lokasi lama milik agen lain yang tersisa dikosongkan (mereka lalu memakai jadwal otomatis).
3. CHECK constraint lokasi dan status diganti dengan kunci v2.
4. Lima agen v2 dimasukkan. Kalau id sudah ada, hanya nama/divisi/warna/urutan yang dirapikan.
5. Contoh tugas dan log ditambahkan untuk 5 agen, hanya kalau mereka belum punya.
6. Fungsi `ach_report_activity` diganti dengan validasi v2.
7. RLS, policy SELECT publik, grant, dan publikasi realtime ditegaskan ulang.
8. Diakhiri dengan `notify pgrst, 'reload schema'`.

Sebelum migrasi dijalankan, website tetap tampil dalam **DEMO** dengan badge `DEMO | DB v1`. Klik badge untuk melihat alasannya. Begitu 5 agen v2 ada dan tidak ada lagi agen v1, website **otomatis pindah ke LIVE** (dicek tiap 30 detik).

### 2. `config.js`

```js
window.ACH_CONFIG = {
  SUPABASE_URL: 'https://xxxx.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_xxxxxxxx',   // publishable/anon — aman di browser
  ...
};
```

> ⚠️ **PENTING:** `service_role` / secret key (`sb_secret_…`) **JANGAN PERNAH** ditaruh di `config.js`, di HTML, atau di repo ini. Key itu memberi akses penuh dan melewati RLS. Simpan hanya di lingkungan agen/server (env var, secret manager).

### 3. GitHub Pages

*Settings → Pages*: *Deploy from a branch* → **`main`** / **`/ (root)`**. Website: `https://achphoria.github.io/achphoria-corporation/`.
Untuk menjalankan lokal tanpa build: `python3 -m http.server 8000`.

## LIVE vs DEMO

- Saat dibuka, website langsung tampil dalam **DEMO** (data simulasi) sambil mencoba konek ke Supabase.
- Kalau `ach_agents` bisa dibaca **dan** berisi kelima agen v2 (tanpa agen v1), badge berubah jadi **● LIVE**. Website lalu subscribe ke Realtime (`postgres_changes` pada `ach_agents`, `ach_tasks`, `ach_logs`), dengan refresh penuh tiap 60 detik sebagai cadangan.
- Website tetap di DEMO, dengan alasan singkat di badge, kalau: `config.js` kosong, tabel belum ada, tabel kosong, database masih v1, agen v2 belum lengkap, atau query gagal. Koneksi dicoba ulang tiap 30 detik.

## Ruangan (kolom `location`)

| Kunci | Tempat | Yang terjadi |
|---|---|---|
| `desk` | zona kerja agen sendiri (lihat tabel agen) | duduk/berdiri di zonanya; mengetik (getar kecil) atau membaca |
| `meeting` | kotatsu, 5 bantal (Chief selalu di kursi depan) | duduk; bergantian bicara 💬 |
| `tea` | stasiun teh (kyusu beruap) | berdiri di konter, menyesap ☕ |
| `ramen` | konter ramen, 3 bangku (+2 tempat berdiri) | duduk di bangku, menyeruput 🍜 |
| `tatami` | pojok tatami (2 tempat) | berbaring di bantal kecil, mata tertutup, "z" |
| `vending` | vending machine | jajan 🥤 |
| `whiteboard` | papan tulis | corat-coret ide 💡 |
| `offline` | pintu noren | berjalan ke noren, melambai 👋, lalu redup |

Kunci yang tidak dikenal dianggap `desk`. Agen dengan status `offline` selalu berada di noren. Saat lokasi berubah, maskot berjalan melalui graf waypoint di lantai: lewat koridor di belakang kotatsu, di depannya, atau di sisi kiri/kanan.

**Status:** `kerja` · `terjadwal` · `santai` · `istirahat` · `offline`

### Jadwal fallback (WIB)

Jadwal ini dipakai kalau `location` kosong (NULL) atau data agen **basi** (`updated_at` lebih tua dari `STALE_HOURS`, default 3 jam). Kartu detail lalu menampilkan label *jadwal otomatis*. Variasi "giliran" ditentukan per agen per hari secara deterministik, jadi semua pengunjung melihat hal yang sama.

| Jam WIB (Senin–Jumat) | Lokasi |
|---|---|
| 00.00–07.30 | `offline` (belum masuk) |
| 07.30–08.30 | 2 agen bergiliran di `tea` (teh pagi), sisanya di `desk` |
| 08.30–09.00 | `desk` (cek inbox) |
| **09.00–09.30** | **`meeting`: stand-up pagi di kotatsu** |
| 09.30–10.30 | `desk` |
| 10.30–10.50 | rehat teh untuk 2 agen bergiliran (`tea`) |
| 10.50–12.00 | `desk`; Chief & Ops kadang di `whiteboard` (11.00–11.40, rencana sprint) |
| **12.00–13.00** | **`ramen`: makan siang bareng** |
| 13.00–14.30 | `desk` |
| 14.30–15.00 | sebagian agen tidur siang di `tatami` (±40% peluang per hari), sisanya `desk` |
| **15.00–15.20** | **`vending`: jajan jam tiga** (2 agen bergiliran) |
| 15.20–16.00 | `desk` |
| 16.00–16.20 | rehat teh sore (`tea`, 2 agen bergiliran) |
| 16.30–17.00 (Jumat) | `meeting`: retro mingguan |
| 16.20–17.30 | `desk` |
| 17.30–18.00 | `desk` (wrap-up); Chief di `whiteboard` (rekap harian) |
| 18.00–19.00 | Engineering (dan kadang Content) lembur di `desk`, lainnya `offline` |
| 19.00–24.00 | `offline` (sudah pulang) |
| Sabtu–Minggu | `offline`; Engineering cek server 10.00–11.00 |

## Integrasi agen AI

Agen melapor lewat fungsi Postgres **`ach_report_activity`**:

```sql
ach_report_activity(
  p_agent_id    text,               -- chief | research | ops | content | engineering
  p_status      text,               -- kerja|terjadwal|santai|istirahat|offline (NULL = tidak diubah)
  p_location    text,               -- desk|meeting|tea|ramen|tatami|vending|whiteboard|offline
                                    -- (NULL = tidak diubah, '' = kosongkan → jadwal otomatis)
  p_activity    text,               -- kalimat aktivitas singkat (NULL = tidak diubah)
  p_task        text default null,  -- judul tugas: di-update bila sudah ada (case-insensitive), dibuat bila belum
  p_task_status text default null,  -- 'Sedang kerja' (default) | 'Terjadwal' | 'Selesai'
  p_log         text default null   -- pesan log TANPA nama agen, mis. 'gabung rapat di kotatsu'
) returns jsonb
```

Fungsi ini meng-update baris agen, membuat atau meng-update tugas, dan menambah log dalam satu panggilan. Semua browser yang terbuka langsung ikut ter-update. Id, lokasi, atau status yang tidak valid ditolak dengan pesan yang jelas. `p_location = 'offline'` tanpa `p_status` otomatis membuat status menjadi `offline`. Log tampil sebagai: `12.05 WIB · Engineering makan ramen dulu di konter 🍜`.

### curl

```bash
export SUPABASE_URL="https://xxxx.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="sb_secret_xxxxxxxx"   # RAHASIA — hanya di sisi agen/server!

curl -X POST "$SUPABASE_URL/rest/v1/rpc/ach_report_activity" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "p_agent_id": "chief",
    "p_status": "terjadwal",
    "p_location": "meeting",
    "p_activity": "Stand-up pagi di kotatsu",
    "p_task": "Rencana prioritas Q4",
    "p_task_status": "Sedang kerja",
    "p_log": "gabung rapat di kotatsu"
  }'
```

> Pakai secret key baru (`sb_secret_…`)? Cukup header `apikey` seperti di atas. Kalau masih pakai **service_role JWT lama** (`eyJ…`), tambahkan juga `-H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"`.

**Tambah tugas langsung via REST:**

```bash
curl -X POST "$SUPABASE_URL/rest/v1/ach_tasks" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d '{"agent_id":"ops","title":"Rekap data penjualan Oktober","detail":"Kirim ke Chief of Staff","status":"Terjadwal","due_at":"2026-10-08T10:00:00+07:00"}'
```

**Ubah status tugas** (mis. jadi Selesai):

```bash
curl -X PATCH "$SUPABASE_URL/rest/v1/ach_tasks?id=eq.<uuid-tugas>" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Content-Type: application/json" \
  -d '{"status":"Selesai"}'
```

### CLI siap pakai

```bash
# Node 18+ (tanpa npm install)
node tools/report.mjs --agent engineering --status kerja --location desk \
  --activity "Memantau server" --task "Migrasi database ke region Jakarta" --log "mulai migrasi database"

# bentuk singkat: agent status location activity [task] [task_status] [log]
node tools/report.mjs content istirahat tea "Seduh teh hijau"

# Python 3 (stdlib saja)
python3 tools/report.py --agent research --status istirahat --location tatami \
  --activity "Tidur siang 20 menit" --log "tidur siang sebentar di pojok tatami"
python3 tools/report.py --agent ops --task "Dashboard metrik operasional" --task-status Selesai --log "menyelesaikan dashboard ✔"
```

Kedua CLI membaca `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY` (alias `SUPABASE_SECRET_KEY`) dari environment, lalu memvalidasi lokasi/status sebelum mengirim.

## Keamanan

- Website hanya memakai **publishable/anon key** dan hanya bisa **membaca** (RLS + grant SELECT).
- Penulisan hanya lewat **service_role/secret key**, baik langsung ke tabel maupun lewat `ach_report_activity` yang EXECUTE-nya sudah dicabut dari `public`, `anon`, dan `authenticated`.
- ⚠️ **Jangan pernah** commit secret key ke repo ini atau menaruhnya di `config.js`.
