# Copyright (c) 2026 Garry Tan. MIT License.
"""One egress probe for egress-smoke.sh, judged by bytes. It connects to host:port (over TLS with --tls, certificates
unchecked), sends one HTTP request and prints how many bytes came back within the timeout. Harbor's egress sidecar
accepts every TCP connect and then resets what it does not allow, so a connect proves nothing: only bytes from the far
side mean the path is open. It prints "bytes=<n> <note>" and exits 0 whatever happened on the wire."""

import socket
import ssl
import sys


def probe(host, port, tls=False, timeout=8.0):
    try:
        s = socket.create_connection((host, port), timeout=timeout)
    except OSError as e:
        return 0, "connect:" + type(e).__name__
    try:
        s.settimeout(timeout)
        if tls:
            ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            s = ctx.wrap_socket(s, server_hostname=host)
        s.sendall(("GET / HTTP/1.0\r\nHost: %s\r\n\r\n" % host).encode())
        data = s.recv(64)
        return len(data), "data" if data else "eof"
    except OSError as e:
        return 0, "io:" + type(e).__name__
    finally:
        s.close()


if __name__ == "__main__":
    n, note = probe(sys.argv[1], int(sys.argv[2]), tls="--tls" in sys.argv[3:])
    print("bytes=%d %s" % (n, note))
