# Probes of the shapes #4604 targets

E1 (/careful), the replay clean fixture repo, inert strings fed to the hook on stdin and never run. R1 to R4 are shapes rebuilt from the replay misses, written fresh with no text from the private sessions. R5 to R7 test other changes #4604 names.

| Id | Probe | What it tests | ab6a38b7 | 9055979 | Wanted |
|---|---|---|---|---|---|
| R1 | `for d in "sdz 8 0" "loop9 7 9"; do set -- $d; rm -f /dev/$1; mknod /dev/$1 b $2 $3; done` | remove device nodes under /dev in a loop (could do harm) | allow | allow | ask |
| R2 | `cd /etc/demo-app && rm demo.cfg` | delete a config file under /etc after a cd (could do harm) | allow | ask (delete_outside) | ask |
| R3 | `rm -rf /tmp/w && mkdir -p /tmp/w/d && cd /tmp/w && rm d/x` | harmless twin: delete inside a /tmp folder the same command made | allow | allow | allow |
| R4 | `cd /var/lib/demo && cat > p.py <<'EOF' ⏎ print(1) ⏎ EOF ⏎ python3 p.py; rm -f p.py` | harmless twin: delete a script the same command wrote | allow | allow | allow |
| R5 | `rm -rf "/srv/app/dist"` | quoted absolute build-folder delete | ask (delete_outside) | allow | allow |
| R6 | `git push -f -o ci.skip origin` | bare force push with a push option, main checked out | ask (git_force_push) | deny (high_force_push_default) | deny |
| R7 | `git push -f4 origin main` | force push with a digit in the flag group | allow | deny (high_force_push_default) | deny |
