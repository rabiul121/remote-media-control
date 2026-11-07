import http.server, sys
import os
from urllib.parse import parse_qs, urlparse
LOG=os.path.join(os.environ["ACTIONS_TEST_DIR"],"mpc.log")
volume=60
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def do_GET(self):
        global volume
        open(LOG,"a").write(self.path+"\n")
        if self.path.startswith("/variables.html"):
            if os.path.exists(os.path.join(os.environ["ACTIONS_TEST_DIR"],"mpc-web-disabled")):
                self.send_response(503); self.send_header("Content-Length","0"); self.end_headers(); return
            b=f'<html><body><p id="volumelevel">{volume}</p><p id="muted">0</p></body></html>'.encode()
            self.send_response(200); self.send_header("Content-Length",str(len(b))); self.end_headers(); self.wfile.write(b)
        elif self.path.startswith("/command.html"):
            if os.path.exists(os.path.join(os.environ["ACTIONS_TEST_DIR"],"mpc-web-disabled")):
                self.send_response(503); self.send_header("Content-Length","0"); self.end_headers(); return
            requested=parse_qs(urlparse(self.path).query).get("volume",[])
            if requested: volume=int(requested[0])
            self.send_response(200); self.send_header("Content-Length","0"); self.end_headers()
        else:
            self.send_response(404); self.send_header("Content-Length","0"); self.end_headers()
http.server.HTTPServer(("127.0.0.1",13579),H).serve_forever()
