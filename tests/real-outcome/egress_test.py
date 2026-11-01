"""The egress allowlist on real Docker (open item 6): a container that dropped NET_ADMIN and NET_RAW, the rules written
from outside by the pinned helper image, then adversarial probes from inside. Run by egress.test.ts when
GSTACK_EVALS_DOCKER=1; it pulls the pinned Ubuntu builder image and runs this machine's Bun inside it as the probe.
"""

import json
import os
import socket
import subprocess
import sys
import threading
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path[:0] = [str(ROOT / "lanes/real-outcome/agent")]
import egress  # noqa: E402

IMAGE = "ubuntu:24.04@sha256:24737cef17f4e22b1977df7d9a05e77c4e28b7da5b8911f8d8ccda136bf3573c"
BUN = os.environ["REAL_BUN"]


def docker(*args, check=True, **kw):
    r = subprocess.run(["docker", *args], capture_output=True, text=True, **kw)
    if check and r.returncode != 0:
        raise RuntimeError(f"docker {' '.join(args[:3])}: {r.stderr[-400:]}")
    return r


def exec_fn(container, script, stdin=None, timeout=300):
    return subprocess.run(["docker", "exec", "-i", container, "sh", "-c", script], input=stdin, capture_output=True, timeout=timeout)


def listen():
    s = socket.socket()
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(("0.0.0.0", 0))
    s.listen(16)

    def serve():
        while True:
            try:
                conn, _ = s.accept()
                conn.close()
            except OSError:
                return

    threading.Thread(target=serve, daemon=True).start()
    return s, s.getsockname()[1]


def js(container, code):
    return exec_fn(container, f"/opt/bun -e {json.dumps(code)}", timeout=60).stdout.decode().strip()


def main():
    failed = 0
    sock, port = listen()
    net = f"real-egress-test-{os.getpid()}"
    docker("network", "create", net)
    cid = docker("run", "-d", "--rm", "--network", net, "--cap-drop", "NET_ADMIN", "--cap-drop", "NET_RAW", "-v", f"{BUN}:/opt/bun:ro", IMAGE, "sleep", "600").stdout.strip()
    try:
        gateway = docker("inspect", "-f", "{{range .NetworkSettings.Networks}}{{.Gateway}}{{end}}", cid).stdout.strip()
        allow = [(gateway, port)]

        def case(name, fn):
            nonlocal failed
            try:
                fn()
                print("PASS", name)
            except Exception:
                failed += 1
                print("FAIL", name)
                traceback.print_exc()

        def before():
            resolv = exec_fn(cid, "cat /etc/resolv.conf").stdout.decode()
            assert "nameserver 127.0.0.11" in resolv, resolv
            dns = js(cid, "require('dns').promises.resolve4('example.com').then(()=>console.log('RESOLVED'),e=>console.log('DNSFAIL '+e.code))")
            assert dns == "RESOLVED", dns
            open_ = js(cid, f"require('net').connect({{host:'{gateway}',port:{port}}}).on('connect',()=>{{console.log('OPEN');process.exit(0)}}).on('error',e=>{{console.log(e.code);process.exit(0)}})")
            assert open_ == "OPEN", open_

        case("before the rules Docker's embedded DNS resolves and the host listener is reachable (the probes can tell)", before)

        def applied():
            out = egress.apply(cid, allow)
            assert f"ip daddr {gateway} tcp dport {port} accept" in out["listing"] and "policy drop" in out["listing"], out["listing"]
            probe = egress.probe(exec_fn, cid, allow, "/opt/bun")
            assert probe["result"][f"{gateway}:{port}"] == "open", probe
            assert all(v != "open" for k, v in probe["result"].items() if k != f"{gateway}:{port}"), probe

        case("after the rules only the allowed address and port open; other ports, public addresses and metadata do not", applied)

        def no_dns():
            out = js(cid, "require('dns').promises.resolve4('example.com').then(()=>console.log('RESOLVED'),e=>console.log('DNSFAIL '+e.code))")
            assert out.startswith("DNSFAIL"), out
            udp = js(cid, "const s=require('dgram').createSocket('udp4');s.on('error',e=>{console.log('UDPFAIL '+e.code);process.exit(0)});s.send(Buffer.from('x'),53,'8.8.8.8',e=>{console.log(e?'UDPFAIL '+e.code:'SENT');process.exit(0)})")
            assert udp.startswith("UDPFAIL"), udp

        case("no DNS through Docker's embedded resolver, and no UDP out", no_dns)

        def tamper():
            r = docker("run", "--rm", "--network", f"container:{cid}", "--cap-drop", "ALL", "--entrypoint", "nft", egress.HELPER_IMAGE, "delete", "table", "inet", egress.TABLE, check=False)
            assert r.returncode != 0, "a process without NET_ADMIN deleted the table"
            again = egress.probe(exec_fn, cid, allow, "/opt/bun")
            assert again["result"][f"{gateway}:{port}"] == "open", again

        case("a process in the container's namespace without NET_ADMIN cannot remove the table", tamper)

        def refuses():
            try:
                egress.endpoint("http://gateway:8787")
            except egress.EgressError as e:
                assert str(e).startswith("E_REAL_SANDBOX_EGRESS"), e
            else:
                raise AssertionError("a hostname was accepted")
            try:
                egress.probe(exec_fn, cid, [(gateway, port + 1 if port < 65535 else port - 1)], "/opt/bun")
            except egress.EgressError as e:
                assert "did not open" in str(e), e
            else:
                raise AssertionError("a probe of a closed allowed endpoint passed")

        case("a hostname is refused, and a probe whose allowed endpoint is closed fails", refuses)
    finally:
        docker("rm", "-f", cid, check=False)
        docker("network", "rm", net, check=False)
        sock.close()
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
