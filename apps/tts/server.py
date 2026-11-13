"""The game's voice service. Private: only the API calls it (TTS_TOKEN), the browser
never does, and it speaks only for the five characters, at most MAX_CHARS at a time.

  POST /synthesize  {"speaker": "vanguard", "text": "..."}  -> audio/mpeg
  GET  /health
"""
import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from engine import Engine
from voices import VOICE_VERSION

TOKEN = os.environ.get("TTS_TOKEN", "")
ENGINE = Engine()


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            return self._send(200, json.dumps({"ok": True, "voice_version": VOICE_VERSION}).encode())
        self._send(404, b'{"error":"not found"}')

    def do_POST(self):
        if self.path != "/synthesize":
            return self._send(404, b'{"error":"not found"}')
        if not TOKEN or self.headers.get("Authorization") != f"Bearer {TOKEN}":
            return self._send(401, b'{"error":"unauthorized"}')
        try:
            n = int(self.headers.get("Content-Length", "0"))
            req = json.loads(self.rfile.read(min(n, 4096)))
            t = time.time()
            audio = ENGINE.mp3(str(req.get("speaker", "")), str(req.get("text", "")))
            self.log_message("synthesized %s (%d chars) in %.1fs", req.get("speaker"), len(req.get("text", "")), time.time() - t)
            self._send(200, audio, "audio/mpeg")
        except ValueError as e:
            self._send(400, json.dumps({"error": str(e)}).encode())
        except Exception as e:  # noqa: BLE001 - the API falls back to subtitles on any failure
            self.log_message("synthesis failed: %s", e)
            self._send(500, b'{"error":"synthesis failed"}')


if __name__ == "__main__":
    if not TOKEN:
        raise SystemExit("TTS_TOKEN must be set (the API sends it; nothing else may call this)")
    port = int(os.environ.get("PORT", "8090"))
    print(f"voice service on :{port} (voice version {VOICE_VERSION})", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
