# Drives Codex 0.170.0's interactive TUI under a PTY for a fixed time, then quits it.
import os, pty, sys, time, select, signal
argv = sys.argv[1:]
pid, fd = pty.fork()
if pid == 0:
    os.execvpe(argv[0], argv, os.environ)
end = time.time() + 40
log = open(os.environ['TUI_LOG'], 'wb')
answered = False
while time.time() < end:
    r, _, _ = select.select([fd], [], [], 0.5)
    if fd in r:
        try: data = os.read(fd, 65536)
        except OSError: break
        log.write(data)
        if b'\x1b[6n' in data: os.write(fd, b'\x1b[1;1R')
for _ in range(3):
    try: os.write(fd, b'\x03'); time.sleep(0.5)
    except OSError: break
try: os.kill(pid, signal.SIGTERM)
except Exception: pass
