import http.server, sys
import os
LOG=os.path.join(os.environ["ACTIONS_TEST_DIR"],"mpc.log")
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def do_GET(self):
        open(LOG,"a").write(self.path+"\n")
        if self.path.startswith("/variables.html"):
            b=b'<html><body><p id="volumelevel">60</p><p id="muted">0</p></body></html>'
            self.send_response(200); self.send_header("Content-Length",str(len(b))); self.end_headers(); self.wfile.write(b)
        else:
            self.send_response(302); self.send_header("Location","/index.html"); self.send_header("Content-Length","0"); self.end_headers()
http.server.HTTPServer(("127.0.0.1",13579),H).serve_forever()
