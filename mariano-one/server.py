#!/usr/bin/env python3
import os
import subprocess
import sys
import threading
import time
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SCAN = ROOT / "scripts" / "scan_public.py"
SCAN_INTERVAL = int(os.environ.get("SCAN_INTERVAL_SECONDS", "3600"))
PORT = int(os.environ.get("PORT", "10000"))


def run_scan():
    try:
        proc = subprocess.run(
            [sys.executable, str(SCAN)],
            cwd=str(ROOT.parent),
            capture_output=True,
            text=True,
            timeout=300,
        )
        print(f"[radar] exit={proc.returncode}", flush=True)
        if proc.stdout:
            print(proc.stdout[-4000:], flush=True)
        if proc.stderr:
            print(proc.stderr[-4000:], file=sys.stderr, flush=True)
    except Exception as exc:
        print(f"[radar] error: {exc}", file=sys.stderr, flush=True)


def scanner_loop():
    while True:
        run_scan()
        time.sleep(max(900, SCAN_INTERVAL))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        if self.path.endswith("opportunities.json"):
            self.send_header("Cache-Control", "no-store, max-age=0")
        else:
            self.send_header("Cache-Control", "public, max-age=120")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        super().end_headers()

    def log_message(self, fmt, *args):
        print("[http] " + fmt % args, flush=True)


if __name__ == "__main__":
    threading.Thread(target=scanner_loop, daemon=True).start()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"MARIANO ONE listening on :{PORT}", flush=True)
    server.serve_forever()
