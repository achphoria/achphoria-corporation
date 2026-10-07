# 🚀 ACHPHORIA CORPORATION — Moon Base Virtual Office

Kantor virtual **LIVE** bergaya pixel-art untuk ACHPHORIA CORPORATION: markas manusia di Bulan, dipotong melintang seperti game base-building. Sembilan agen AI (plus 36 kru tim dan beberapa kru lapangan) bekerja, makan, olahraga, tidur, dansa, sampai main bola bareng alien. Semuanya digambar prosedural di `<canvas>`, tanpa aset gambar sama sekali, lalu disinkronkan **realtime** dengan Supabase.

- **Permukaan:** menara komando dengan radar berputar, landasan roket (uap idle), panel surya, rover, hatch lift, dan kubah force-field tempat kru main bareng alien (blob bermata satu, makhluk berantena, anjing alien, bola, perosotan). Bumi berputar pelan di langit berbintang.
- **Bawah tanah:** 3 lantai × 3 modul kantor divisi, masing-masing berisi 1 meja leader + 4 meja tim. Semua lantai tersambung lift kaca di tengah.
- **Lantai bawah (B):** Meeting Room (meja hologram), Kantin, Arcade, Gym, Sleep Pods, Showers, Dance Floor (DJ bot + lampu disko). Ada juga hidroponik, ruang server, reaktor, dan tambang helium-3.
- **UI (Bahasa Indonesia, jam WIB):** Papan Tugas (`T`), Log (`L`), daftar Kru (`K`), kartu detail agen, tooltip, serta badge **LIVE/DEMO**.

## Fitur

| Fitur | Cara pakai |
|---|---|
| Ikuti agen | Klik astronot (atau item di daftar Kru / Log / Papan Tugas, atau tombol `1`–`9`). Kamera zoom lalu mengikuti agen, termasuk saat naik lift dan keluar ke permukaan. |
| Kembali ke overview | `Esc`, klik area kosong, tombol ✕, atau `0` |
| Zoom & geser | Scroll mouse untuk zoom. Seret untuk menggeser (saat tidak sedang mengikuti agen). Saat mengikuti, scroll mengatur level zoom. |
| Papan Tugas | `T` / tombol. Tiga kolom: **Sedang kerja · Terjadwal · Selesai** |
| Log aktivitas | `L` / tombol. Entri baru muncul dengan animasi, waktu dalam WIB |
| Kru | `K` / tombol. Daftar 9 agen beserta status dan lokasinya |

## Struktur file

```
index.html            halaman utama
config.js             URL + publishable key Supabase (AMAN untuk publik)
css/style.css         gaya UI
js/util.js            utilitas, font bitmap, format waktu WIB
js/profiles.js        profil agen, label ruangan/status, jadwal fallback WIB
js/sprites.js         generator sprite astronot pixel-art
js/world.js           tata letak + layer statis (langit, batu, ruangan, furnitur)
js/fx.js              elemen animasi (bintang, Bumi, radar, lift, disko, kubah, alien, partikel)
js/sim.js             simulasi aktor, pathfinding lantai + lift, spot ruangan
js/data.js            Supabase LIVE + fallback DEMO
js/app.js             loop render, kamera, input, panel UI
supabase/schema.sql   skema database (idempotent, prefix ach_)
tools/report.mjs      CLI laporan (Node 18+, tanpa dependensi)
tools/report.py       CLI laporan (Python 3, stdlib saja)
.nojekyll             supaya GitHub Pages menyajikan file apa adanya
```

## Setup

### 1. Supabase

1. Buka project Supabase (boleh project yang sudah ada; semua objek pakai prefix **`ach_`**, jadi tidak bentrok dengan aplikasi lain).
2. Buka **SQL Editor**, tempel isi [`supabase/schema.sql`](supabase/schema.sql), lalu klik **Run**. Skrip ini aman dijalankan berulang kali dan membuat:
   - tabel `ach_agents`, `ach_tasks`, `ach_logs` (+ index, trigger `updated_at`)
   - RLS aktif: publik (anon/authenticated) **hanya bisa SELECT**
   - fungsi `ach_report_activity(...)` (SECURITY DEFINER, EXECUTE **hanya** untuk `service_role`)
   - menambahkan ketiga tabel ke publikasi `supabase_realtime`
   - data awal: 9 agen + beberapa contoh tugas dan log (data yang sudah ada tidak ditimpa)
3. Buka **Project Settings → API Keys**, salin **Project URL** dan **Publishable key** (`sb_publishable_…`; key `anon` lama juga bisa).

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

1. Push repo ini ke GitHub.
2. Buka **Settings → Pages**: *Source* = **Deploy from a branch**, *Branch* = **`main`** dan folder **`/ (root)`**, lalu **Save**.
3. Tunggu 1–2 menit, lalu buka `https://<user>.github.io/achphoria-corporation/`.

Bisa juga dijalankan lokal tanpa build: `python3 -m http.server 8000` lalu buka `http://localhost:8000`.

## LIVE vs DEMO

- Saat dibuka, website langsung tampil dalam **DEMO** (data simulasi) supaya tidak ada layar kosong, sambil mencoba konek ke Supabase.
- Kalau `ach_agents` bisa dibaca dan ada isinya, badge berubah jadi **● LIVE**. Website lalu subscribe ke Realtime (`postgres_changes` pada `ach_agents`, `ach_tasks`, `ach_logs`) dan update instan tanpa refresh. Sebagai cadangan, ada refresh penuh tiap 60 detik.
- Kalau `config.js` kosong, library Supabase gagal dimuat, tabel belum dibuat (schema.sql belum dijalankan), atau query gagal, website tetap di **● DEMO**. Di mode ini ada aktivitas simulasi tiap 20–40 detik, dan koneksi dicoba ulang tiap 30 detik. Begitu data tersedia, website **otomatis pindah ke LIVE**.
- Klik badge untuk melihat alasannya. Tambahkan `?demo=1` di URL untuk memaksa mode demo.

## Ruangan (kolom `location`)

| Kunci | Ruangan | Animasi |
|---|---|---|
| `desk` | Meja leader di modul divisi agen | duduk & mengetik, sesekali menghampiri anggota tim |
| `meeting` | Meeting Room (meja hologram) | rapat, gestur bicara |
| `kantin` | Kantin | makan / ngopi / antre di konter |
| `arcade` | Arcade Room | main mesin arcade, bersorak |
| `gym` | Gym | treadmill, angkat beban slow-motion, samsak, peregangan |
| `sleep` | Sleep Pods (9 kapsul) | tidur + "Zzz" |
| `shower` | Showers (3 bilik) | mandi + uap, antre |
| `dance` | Dance Floor | dansa melayang (gravitasi rendah) |
| `outdoor` | Kubah luar (permukaan) | main lempar bola bareng alien |
| `command` | Menara Komando (permukaan) | jaga konsol radar |
| `rocket` | Landasan Roket (permukaan) | inspeksi / perbaiki roket |

Kalau lokasi agen berubah, sprite-nya berjalan ke sana: menyusuri lantai, naik/turun **lift kaca** (2 jalur: naik di kanan, turun di kiri), lalu lewat hatch permukaan untuk tujuan di luar. Setelah sampai, ia menjalankan animasi ruangan tersebut.

**Status:** `kerja` · `terjadwal` · `santai` · `istirahat` · `offline` (agen `offline` tidur di sleep pod dengan sprite redup).

### Jadwal fallback (WIB)

Dipakai bila `location` kosong (NULL) atau data agen **basi** (`updated_at` lebih lama dari `STALE_HOURS`, default 3 jam). Kartu detail lalu menampilkan label *jadwal otomatis*.

| Jam WIB | Lokasi |
|---|---|
| 00.00–06.00 | `sleep` |
| 06.00–06.45 | `gym` (olahraga pagi) |
| 06.45–07.15 | `shower` |
| 07.15–08.00 | `kantin` (sarapan) |
| 08.00–09.00 | `desk` |
| 09.00–09.30 | `meeting` (daily stand-up) |
| 09.30–12.00 | `desk` (Commander kadang di `command`) |
| 12.00–13.00 | `kantin` (makan siang) |
| 13.00–15.30 | `desk` |
| 15.30–16.30 | variasi harian: `gym` / `arcade` / `desk` |
| 16.30–18.00 | `desk` |
| 18.00–19.00 | `kantin` (makan malam) |
| 19.00–21.00 | variasi: `dance` / `outdoor` / `arcade` / `kantin` (Closer kadang di `rocket`) |
| 21.00–22.00 | `shower` |
| 22.00–24.00 | `sleep` |

## Integrasi agen AI

Agen melapor lewat fungsi Postgres **`ach_report_activity`**:

```sql
ach_report_activity(
  p_agent_id    text,               -- id agen, mis. 'commander'
  p_status      text,               -- kerja|terjadwal|santai|istirahat|offline (NULL = tidak diubah)
  p_location    text,               -- kunci ruangan (NULL = tidak diubah, '' = kosongkan → jadwal otomatis)
  p_activity    text,               -- kalimat aktivitas singkat (NULL = tidak diubah)
  p_task        text default null,  -- judul tugas: di-update bila sudah ada (case-insensitive), dibuat bila belum
  p_task_status text default null,  -- 'Sedang kerja' (default) | 'Terjadwal' | 'Selesai'
  p_log         text default null   -- pesan log TANPA nama agen, mis. 'mulai rapat di Meeting Room'
) returns jsonb
```

Fungsi ini sekaligus meng-update baris agen, membuat atau meng-update tugas, dan menambah baris log, lalu semua browser yang terbuka langsung ikut ter-update. Log tampil sebagai: `16.30 WIB · Commander mulai rapat di Meeting Room`.

ID agen bawaan: `commander`, `engineering`, `research`, `marketing`, `content`, `sales`, `finance`, `success`, `hr`. Nama, divisi, dan warna bisa diubah langsung di tabel `ach_agents` (urutan modul = `sort_order`).

### curl

```bash
export SUPABASE_URL="https://xxxx.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="sb_secret_xxxxxxxx"   # RAHASIA — hanya di sisi agen/server!

curl -X POST "$SUPABASE_URL/rest/v1/rpc/ach_report_activity" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "p_agent_id": "commander",
    "p_status": "kerja",
    "p_location": "meeting",
    "p_activity": "Memimpin rapat koordinasi mingguan",
    "p_task": "Sinkronisasi OKR Q4",
    "p_task_status": "Sedang kerja",
    "p_log": "mulai rapat di Meeting Room"
  }'
```

> Pakai secret key baru (`sb_secret_…`)? Cukup header `apikey` seperti di atas. Kalau masih pakai **service_role JWT lama** (`eyJ…`), tambahkan juga `-H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"`.

**Tambah tugas langsung via REST:**

```bash
curl -X POST "$SUPABASE_URL/rest/v1/ach_tasks" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d '{"agent_id":"finance","title":"Rekap invoice Oktober","detail":"Cocokkan dengan mutasi bank","status":"Terjadwal","due_at":"2026-10-08T10:00:00+07:00"}'
```

**Ubah status tugas** (mis. jadi Selesai):

```bash
curl -X PATCH "$SUPABASE_URL/rest/v1/ach_tasks?id=eq.<uuid-tugas>" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Content-Type: application/json" \
  -d '{"status":"Selesai"}'
```

**Tambah log via REST:**

```bash
curl -X POST "$SUPABASE_URL/rest/v1/ach_logs" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Content-Type: application/json" \
  -d '{"agent_id":"sales","message":"closing deal dengan Lunar Logistics 🎉","location":"desk"}'
```

### CLI siap pakai

```bash
# Node 18+ (tanpa npm install)
node tools/report.mjs --agent engineering --status kerja --location desk \
  --activity "Deploy fitur realtime" --task "Migrasi server ke region baru" --log "mulai deploy ke production"

# bentuk singkat: agent status location activity [task] [task_status] [log]
node tools/report.mjs finance istirahat kantin "Ngopi sambil cek cashflow"

# Python 3 (stdlib saja)
python3 tools/report.py --agent content --status santai --location outdoor \
  --activity "Rekam konten bareng alien" --log "keluar ke Kubah Luar, main bareng alien"
python3 tools/report.py --agent hr --task "Update SOP keselamatan base" --task-status Selesai --log "menyelesaikan SOP keselamatan ✔"
```

Kedua CLI membaca `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY` (alias `SUPABASE_SECRET_KEY`) dari environment.

## Keamanan

- Website hanya memakai **publishable/anon key** dan hanya bisa **membaca** (RLS + grant SELECT).
- Penulisan hanya lewat **service_role/secret key**, baik langsung ke tabel maupun lewat `ach_report_activity` yang EXECUTE-nya sudah dicabut dari `public`, `anon`, dan `authenticated`.
- ⚠️ **Jangan pernah** commit secret key ke repo ini atau menaruhnya di `config.js`.
