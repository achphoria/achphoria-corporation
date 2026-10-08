#!/usr/bin/env bash
# =====================================================================
#  ACHPHORIA · deploy jembatan Telegram (ach-bridge) ke Supabase
# ---------------------------------------------------------------------
#  Project: ckoejqzownrujikefgwb (override: PROJECT_REF). Tidak menyentuh project lain.
#
#  Wajib:  SUPABASE_ACCESS_TOKEN   personal access token Supabase (sbp_…), lewat env
#  Opsional (env atau ~/.config/achphoria/bridge.env, env menang):
#    TG_TOKEN_CHIEF / _RESEARCH / _OPS / _CONTENT / _ENGINEERING     token @BotFather
#    WAKE_URL_<ID>, WAKE_KEY_<ID>, WAKE_KEY_HEADER, WAKE_KEY_STYLE (bearer|raw|query|none),
#    WAKE_KEY_PARAM, (+ override per bot: WAKE_KEY_HEADER_<ID>, WAKE_KEY_STYLE_<ID>, WAKE_KEY_PARAM_<ID>),
#    TG_USERNAME_<ID> (bila username bot bukan ach_<id>_bot), WAKE_FAIL_NOTICE=0
#  Dibuat otomatis bila belum ada (openssl rand) & disimpan HANYA di bridge.env (chmod 600):
#    TG_WEBHOOK_SECRET, TG_CLAIM_CODE, BRIDGE_KEY   (+ salinan BRIDGE_KEY di ~/.config/achphoria/bridge_key)
#
#  Langkah:
#    1. cek token bisa melihat project ini (GET /v1/projects/{ref})
#    2. migrasi supabase/migrate-v3-telegram.sql + migrate-v4-logs.sql + migrate-v5-erp-read.sql (Management API POST /v1/projects/{ref}/database/query)
#    3. set secrets fungsi                         (Management API POST /v1/projects/{ref}/secrets)
#    4. deploy fungsi: supabase functions deploy ach-bridge --project-ref … --no-verify-jwt --use-api
#    5. cek GET …/ach-bridge/health
#    6. (--with-telegram) jalankan tools/setup-telegram.sh
#    7. cetak TG_CLAIM_CODE (satu-satunya nilai rahasia yang dicetak — owner harus mengetiknya)
#
#  Env khusus tes: SUPABASE_API_URL (Management API tiruan), ACH_BRIDGE_URL (URL fungsi).
#  Opsi: --dry-run  --skip-migration  --skip-secrets  --skip-deploy  --with-telegram  --no-claim-print
#  Nilai rahasia tidak pernah dicetak dan tidak pernah muncul di argv (dipakai di dalam proses node).
# =====================================================================
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PROJECT_REF="${PROJECT_REF:-ckoejqzownrujikefgwb}"
export ACH_CONF_DIR="${ACH_CONF_DIR:-$HOME/.config/achphoria}"
BIN_DIR="${ACH_BIN_DIR:-/workspace/bin}"
DRY=0; SKIP_MIG=0; SKIP_SEC=0; SKIP_DEP=0; WITH_TG=0; PRINT_CLAIM=1
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;; --skip-migration) SKIP_MIG=1 ;; --skip-secrets) SKIP_SEC=1 ;; --skip-deploy) SKIP_DEP=1 ;;
    --with-telegram) WITH_TG=1 ;; --no-claim-print) PRINT_CLAIM=0 ;;
    -h|--help) awk 'NR>1 && !/^#/{exit} NR>1{print}' "$0"; exit 0 ;;
    *) echo "✖ opsi tidak dikenal: $a" >&2; exit 1 ;;
  esac
done
export ACH_DRY="$DRY"
command -v node >/dev/null || { echo "✖ node (18+) diperlukan" >&2; exit 1; }
if [[ "$DRY" != 1 && -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "✖ Set env SUPABASE_ACCESS_TOKEN (personal access token Supabase) dulu." >&2; exit 1
fi

# helper node: semua rahasia dibaca/ditulis di dalam proses, tidak lewat argv/stdout
run_node() { ACH_STEP="$1" node --input-type=module - <<'JS'
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
const step = process.env.ACH_STEP, REF = process.env.PROJECT_REF, DIR = process.env.ACH_CONF_DIR, DRY = process.env.ACH_DRY === '1';
const FILE = DIR + '/bridge.env', KEYFILE = DIR + '/bridge_key';
const API = (process.env.SUPABASE_API_URL || 'https://api.supabase.com').replace(/\/+$/, '') + '/v1/projects/' + REF;
const AGENTS = ['chief', 'research', 'ops', 'content', 'engineering'];

function loadConf() {
  const conf = {};
  if (existsSync(FILE)) for (const line of readFileSync(FILE, 'utf8').split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) conf[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return conf;
}
const val = (conf, k) => process.env[k] || conf[k] || '';
function rand(kind) {
  const n = kind === 'claim' ? 5 : 32;
  let hex;
  try { hex = execFileSync('openssl', ['rand', '-hex', String(n)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { hex = randomBytes(n).toString('hex'); }
  return kind === 'claim' ? 'ACH-' + hex.toUpperCase() : hex;
}
async function mgmt(path, init = {}) {
  const res = await fetch(API + path, {
    ...init, headers: { Authorization: 'Bearer ' + process.env.SUPABASE_ACCESS_TOKEN, 'Content-Type': 'application/json', ...(init.headers || {}) },
    signal: AbortSignal.timeout(120000),
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}
const short = (d) => (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 600);

if (step === 'secrets-file') {
  if (!DRY) { mkdirSync(DIR, { recursive: true, mode: 0o700 }); chmodSync(DIR, 0o700); }
  const conf = loadConf();
  const made = [];
  for (const [k, kind] of [['TG_WEBHOOK_SECRET', 'hex'], ['TG_CLAIM_CODE', 'claim'], ['BRIDGE_KEY', 'hex']]) {
    const v = process.env[k] || conf[k];
    if (!v) { conf[k] = rand(kind); made.push(k); } else if (process.env[k] && conf[k] !== process.env[k]) { conf[k] = process.env[k]; made.push(k + ' (dari env)'); }
  }
  if (DRY) { console.log('  (dry-run) ' + (made.length ? 'akan membuat/menyimpan: ' + made.join(', ') : 'bridge.env sudah lengkap')); process.exit(0); }
  // tulis ulang file: pertahankan baris lain, perbarui/ tambah 3 kunci di atas
  const lines = existsSync(FILE) ? readFileSync(FILE, 'utf8').split('\n').filter((l) => l !== '') : ['# ACHPHORIA ach-bridge — RAHASIA (chmod 600). Jangan commit / jangan cetak.'];
  for (const k of ['TG_WEBHOOK_SECRET', 'TG_CLAIM_CODE', 'BRIDGE_KEY']) {
    const i = lines.findIndex((l) => new RegExp('^\\s*(?:export\\s+)?' + k + '\\s*=').test(l));
    if (i >= 0) lines[i] = `${k}=${conf[k]}`; else lines.push(`${k}=${conf[k]}`);
  }
  writeFileSync(FILE, lines.join('\n') + '\n', { mode: 0o600 }); chmodSync(FILE, 0o600);
  writeFileSync(KEYFILE, conf.BRIDGE_KEY + '\n', { mode: 0o600 }); chmodSync(KEYFILE, 0o600);
  console.log(`  ✔ ${FILE} (600)${made.length ? ' — baru: ' + made.join(', ') : ' — sudah lengkap'}`);
  console.log(`  ✔ ${KEYFILE} (600) untuk tools/ach.mjs`);
}

if (step === 'check-project') {
  const r = await mgmt('');
  if (!r.ok) { console.error(`  ✖ token tidak bisa mengakses project ${REF}: HTTP ${r.status} ${short(r.data)}`); process.exit(1); }
  console.log(`  ✔ project ${REF}: ${r.data.name ?? '?'} (${r.data.region ?? '?'}, status ${r.data.status ?? '?'})`);
}

if (step === 'migrate') {
  const query = readFileSync(process.env.ACH_SQL, 'utf8');
  if (!/public\.ach_(inbox|tg_chats|tg_logmsg|erp_audit)/.test(query)) { console.error('  ✖ file migrasi tidak dikenali'); process.exit(1); }
  const r = await mgmt('/database/query', { method: 'POST', body: JSON.stringify({ query }) });
  if (!r.ok) { console.error(`  ✖ migrasi gagal: HTTP ${r.status} ${short(r.data)}`); process.exit(1); }
  const v = await mgmt('/database/query', { method: 'POST', body: JSON.stringify({ query:
    `select c.relname as tabel, c.relrowsecurity as rls,
            (select count(*) from pg_policies p where p.schemaname='public' and p.tablename=c.relname) as policies,
            has_table_privilege('anon', c.oid, 'select') as anon_select,
            exists(select 1 from pg_publication_tables t where t.pubname='supabase_realtime' and t.schemaname='public' and t.tablename=c.relname) as realtime
       from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in ('ach_inbox','ach_outbox','ach_tg_allow','ach_tg_chats','ach_tg_logmsg','ach_erp_audit') order by 1` }) });
  console.log('  ✔ migrasi ' + process.env.ACH_SQL.split('/').pop() + ' dijalankan');
  if (v.ok && Array.isArray(v.data)) for (const row of v.data) console.log(`    ${row.tabel}: rls=${row.rls} policies=${row.policies} anon_select=${row.anon_select} realtime=${row.realtime}`);
  if (v.ok && Array.isArray(v.data) && v.data.some((r) => !r.rls || r.anon_select || r.realtime || Number(r.policies) > 0)) { console.error('  ✖ verifikasi keamanan gagal!'); process.exit(1); }
}

if (step === 'set-secrets') {
  const conf = loadConf();
  const names = new Set(['TG_WEBHOOK_SECRET', 'TG_CLAIM_CODE', 'BRIDGE_KEY', 'WAKE_KEY_HEADER', 'WAKE_KEY_STYLE', 'WAKE_KEY_PARAM', 'WAKE_FAIL_NOTICE']);
  for (const a of AGENTS.map((x) => x.toUpperCase())) for (const p of ['TG_TOKEN_', 'TG_USERNAME_', 'WAKE_URL_', 'WAKE_KEY_', 'WAKE_KEY_HEADER_', 'WAKE_KEY_STYLE_', 'WAKE_KEY_PARAM_']) names.add(p + a);
  const secrets = [...names].map((name) => ({ name, value: val(conf, name) })).filter((s) => s.value);
  const missing = AGENTS.filter((a) => !val(conf, 'TG_TOKEN_' + a.toUpperCase()));
  console.log('  secrets: ' + secrets.map((s) => s.name).join(', '));
  if (missing.length) console.log('  ⚠ token belum ada untuk: ' + missing.join(', ') + ' (bisa ditambah nanti, jalankan ulang dengan --skip-migration --skip-deploy)');
  for (const a of AGENTS) if (!val(conf, 'WAKE_URL_' + a.toUpperCase())) { console.log('  ⚠ WAKE_URL_* belum ada untuk sebagian bot — pesan tetap masuk ach_inbox, asisten tidak dibangunkan otomatis'); break; }
  if (DRY) { console.log('  (dry-run) tidak dikirim'); process.exit(0); }
  const r = await mgmt('/secrets', { method: 'POST', body: JSON.stringify(secrets) });
  if (!r.ok) { console.error(`  ✖ set secrets gagal: HTTP ${r.status} ${short(r.data)}`); process.exit(1); }
  console.log(`  ✔ ${secrets.length} secret di-set (nilai tidak ditampilkan)`);
}

if (step === 'health') {
  const url = (process.env.ACH_BRIDGE_URL || `https://${REF}.supabase.co/functions/v1/ach-bridge`).replace(/\/+$/, '') + '/health';
  for (let i = 0; i < 6; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const t = await r.text();
      if (r.ok) { console.log('  ✔ ' + url + ' → ' + t); process.exit(0); }
      console.log(`  … HTTP ${r.status}, coba lagi`);
    } catch (e) { console.log('  … ' + e.message); }
    await new Promise((res) => setTimeout(res, 5000));
  }
  console.error('  ✖ health check gagal'); process.exit(1);
}

if (step === 'print-claim') {
  const c = val(loadConf(), 'TG_CLAIM_CODE');
  console.log('\n============================================================');
  console.log('  🔑 KODE KLAIM OWNER (TG_CLAIM_CODE) — RAHASIA, jangan dibagikan');
  console.log('     Kirim lewat CHAT PRIBADI ke salah satu bot (mis. @ach_chief_bot):');
  console.log('');
  console.log('       /start ' + c);
  console.log('');
  console.log('     Setelah itu kirim /start biasa ke 4 bot lainnya supaya chat');
  console.log('     pribadinya dikenal (dibutuhkan untuk `ach.mjs send` tanpa --chat).');
  console.log('============================================================');
}
JS
}

ensure_supabase_cli() {
  if command -v supabase >/dev/null 2>&1; then SUPA="$(command -v supabase)"; return; fi
  if [[ -x "$BIN_DIR/supabase" ]]; then SUPA="$BIN_DIR/supabase"; return; fi
  echo "  ↓ memasang Supabase CLI ke $BIN_DIR"
  mkdir -p "$BIN_DIR"
  local arch; case "$(uname -m)" in x86_64) arch=amd64 ;; aarch64|arm64) arch=arm64 ;; *) echo "✖ arsitektur tak didukung" >&2; exit 1 ;; esac
  local tmp; tmp="$(mktemp -d)"
  curl -fsSL "https://github.com/supabase/cli/releases/latest/download/supabase_linux_${arch}.tar.gz" -o "$tmp/supabase.tgz"
  tar -xzf "$tmp/supabase.tgz" -C "$tmp" && install -m 755 "$tmp/supabase" "$BIN_DIR/supabase" && rm -rf "$tmp"
  SUPA="$BIN_DIR/supabase"
}

umask 077
echo "▶ ACHPHORIA ach-bridge → project $PROJECT_REF $( [[ $DRY == 1 ]] && echo '(DRY-RUN)')"
echo "1) secret bridge (bridge.env)"; run_node secrets-file
if [[ "$DRY" == 1 ]]; then
  echo "2) (dry-run) cek project, migrasi supabase/migrate-v3-telegram.sql + migrate-v4-logs.sql + migrate-v5-erp-read.sql via Management API"
  echo "3) secrets:"; run_node set-secrets
  echo "4) (dry-run) supabase functions deploy ach-bridge --project-ref $PROJECT_REF --no-verify-jwt --use-api"
  echo "5) (dry-run) health check"; exit 0
fi
echo "2) cek project";            run_node check-project
if [[ "$SKIP_MIG" != 1 ]]; then
  echo "3) migrasi v3 + v4 + v5"
  ACH_SQL="$REPO/supabase/migrate-v3-telegram.sql" run_node migrate
  ACH_SQL="$REPO/supabase/migrate-v4-logs.sql" run_node migrate
  ACH_SQL="$REPO/supabase/migrate-v5-erp-read.sql" run_node migrate
fi
if [[ "$SKIP_SEC" != 1 ]]; then echo "4) secrets fungsi"; run_node set-secrets; fi
if [[ "$SKIP_DEP" != 1 ]]; then
  echo "5) deploy Edge Function ach-bridge"
  ensure_supabase_cli
  (cd "$REPO" && "$SUPA" functions deploy ach-bridge --project-ref "$PROJECT_REF" --no-verify-jwt --use-api)
fi
echo "6) health check";           run_node health
if [[ "$WITH_TG" == 1 ]]; then echo "7) setup Telegram"; "$REPO/tools/setup-telegram.sh" || echo "⚠ setup Telegram belum sempurna (lihat di atas)"; fi
[[ "$PRINT_CLAIM" == 1 ]] && run_node print-claim
exit 0
