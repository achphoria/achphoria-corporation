#!/usr/bin/env python3
"""
ACHPHORIA — CLI laporan aktivitas agen (Python 3.8+, hanya stdlib)

Env:
  SUPABASE_URL                 https://xxxx.supabase.co
  SUPABASE_SERVICE_ROLE_KEY    secret key (sb_secret_...) atau service_role JWT lama
                               (alias: SUPABASE_SECRET_KEY)
  ⚠️ Key ini RAHASIA: hanya untuk agen/server, JANGAN taruh di website / config.js.

Contoh:
  python3 tools/report.py --agent chief --status terjadwal --location meeting \\
      --activity "Stand-up pagi di kotatsu" --task "Rencana prioritas Q4" \\
      --task-status "Sedang kerja" --log "gabung rapat di kotatsu"

  python3 tools/report.py content istirahat tea "Seduh teh hijau"     # bentuk singkat (posisional)

Agen (id)    : chief research ops content engineering
Kunci lokasi : desk meeting tea ramen tatami vending whiteboard offline
               (desk = zona kerja agen sendiri; '' = jadwal otomatis)
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

AGENTS = ["chief", "research", "ops", "content", "engineering"]
ROOMS = ["desk", "meeting", "tea", "ramen", "tatami", "vending", "whiteboard", "offline"]
STATUSES = ["kerja", "terjadwal", "santai", "istirahat", "offline"]
TASK_STATUSES = ["Sedang kerja", "Terjadwal", "Selesai"]


def main() -> int:
    p = argparse.ArgumentParser(description="Laporkan aktivitas agen ke kantor virtual ACHPHORIA (ach_report_activity).")
    p.add_argument("pos", nargs="*", help="bentuk singkat: agent status location activity [task] [task_status] [log]")
    p.add_argument("--agent", help="id agen: " + ", ".join(AGENTS))
    p.add_argument("--status", choices=STATUSES)
    p.add_argument("--location", help="kunci ruangan: " + ", ".join(ROOMS) + " ('' = jadwal otomatis)")
    p.add_argument("--activity")
    p.add_argument("--task")
    p.add_argument("--task-status", dest="task_status", choices=TASK_STATUSES)
    p.add_argument("--log")
    a = p.parse_args()

    names = ["agent", "status", "location", "activity", "task", "task_status", "log"]
    for i, v in enumerate(a.pos):
        if i < len(names) and getattr(a, names[i]) is None:
            setattr(a, names[i], v)
    if not a.agent:
        p.print_help()
        return 1
    if a.agent not in AGENTS:
        print(f"⚠ Agen \"{a.agent}\" bukan id v2 ({', '.join(AGENTS)}). Tetap dikirim — server akan menolak bila tidak ada.", file=sys.stderr)
    if a.status and a.status not in STATUSES:
        print("✖ Status tidak valid. Pilih: " + ", ".join(STATUSES), file=sys.stderr)
        return 1
    if a.location and a.location not in ROOMS:
        print("✖ Lokasi tidak valid. Pilih: " + ", ".join(ROOMS), file=sys.stderr)
        return 1
    if a.task_status and a.task_status not in TASK_STATUSES:
        print("✖ Status tugas tidak valid. Pilih: " + " | ".join(TASK_STATUSES), file=sys.stderr)
        return 1

    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_SECRET_KEY") or ""
    if not url or not key:
        print("✖ Set env SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY terlebih dahulu.", file=sys.stderr)
        return 1
    if key.startswith("sb_publishable_"):
        print("✖ Itu publishable key (hanya baca). Pakai secret / service_role key.", file=sys.stderr)
        return 1

    body = {
        "p_agent_id": a.agent,
        "p_status": a.status,
        "p_location": a.location,
        "p_activity": a.activity,
        "p_task": a.task,
        "p_task_status": a.task_status,
        "p_log": a.log,
    }
    headers = {"apikey": key, "Content-Type": "application/json"}
    if not key.startswith("sb_"):  # JWT service_role lama
        headers["Authorization"] = "Bearer " + key
    req = urllib.request.Request(url + "/rest/v1/rpc/ach_report_activity", data=json.dumps(body).encode("utf-8"), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            print("✔ Terkirim:", res.read().decode("utf-8"))
            return 0
    except urllib.error.HTTPError as e:
        print(f"✖ HTTP {e.code}: {e.read().decode('utf-8', 'replace')}", file=sys.stderr)
        return 2
    except urllib.error.URLError as e:
        print(f"✖ Gagal menghubungi Supabase: {e.reason}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
