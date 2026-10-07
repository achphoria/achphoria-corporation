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
  SUPABASE_URL: 'https://ckoejqzownrujikefgwb.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNrb2VqcXpvd25ydWppa2VmZ3diIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMjIwNjcsImV4cCI6MjA4NTc5ODA2N30.8XLaBH3g5sysO3Lvizs1NHYke4RQJvVQEZVExC4143I',

  // Semua objek database memakai prefix ini (project Supabase dipakai bersama aplikasi lain).
  TABLE_PREFIX: 'ach_',

  // Lokasi agen dianggap "basi" bila updated_at lebih lama dari ini → pakai jadwal harian WIB.
  STALE_HOURS: 3,

  // Coba sambung ulang ke Supabase tiap N detik saat masih mode DEMO karena gagal konek.
  RETRY_SECONDS: 30,

  // Refresh penuh berkala saat LIVE (cadangan bila realtime terputus).
  POLL_SECONDS: 60,
};
