#!/usr/bin/env python3
"""Dev server: serves the repo at http://localhost:8765 with no-cache headers.

Open http://localhost:8765/dev/ after starting the simulator + daemon:

    python3 dev/simulator.py &
    GAUGES_STATE_DIR=dev/state GAUGES_OUT=dev/out/cardata.json \\
      PATH="$PWD/dev/mock-dbus:$PATH" sh cmu/scripts/gauges-daemon.sh &
    python3 dev/serve.py
"""
import functools, http.server, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(os.environ.get("PORT", "8765"))

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()
    def log_message(self, *a):
        pass

if __name__ == "__main__":
    handler = functools.partial(Handler, directory=ROOT)
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler) as srv:
        print("serving %s" % ROOT)
        print("open http://localhost:%d/dev/" % PORT)
        srv.serve_forever()
