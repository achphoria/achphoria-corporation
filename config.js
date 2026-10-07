/*
 * Konfigurasi ACHPHORIA Virtual Office
 * ------------------------------------
 * SUPABASE_URL      : URL project Supabase kamu.
 * SUPABASE_ANON_KEY : publishable / anon key (AMAN untuk browser, hanya bisa BACA karena RLS).
 *
 * ⚠️  JANGAN PERNAH menaruh service_role / secret key di file ini atau di mana pun di website.
 *     Key itu khusus untuk agen AI / server (lihat README & folder tools/).
 *
 * Kosongkan URL/key (atau isi placeholder) untuk menjalankan MODE DEMO.
 * Tambahkan ?demo=1 di URL untuk memaksa mode demo.
 */
window.ACH_CONFIG = {
  SUPABASE_URL: 'https://ccbyqgisgclqlqatxwbk.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_pdEdMAYvBL4HUF9AMp1LaA_z0rbnXsY',

  // Semua objek database memakai prefix ini (project Supabase dipakai bersama aplikasi lain).
  TABLE_PREFIX: 'ach_',

  // Lokasi agen dianggap "basi" bila updated_at lebih lama dari ini → pakai jadwal harian WIB.
  STALE_HOURS: 3,

  // Coba sambung ulang ke Supabase tiap N detik saat masih mode DEMO karena gagal konek.
  RETRY_SECONDS: 30,

  // Refresh penuh berkala saat LIVE (cadangan bila realtime terputus).
  POLL_SECONDS: 60,
};
