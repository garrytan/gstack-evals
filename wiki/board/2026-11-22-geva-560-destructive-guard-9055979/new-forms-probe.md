# Probes of the forms ab6a38b7 adds

E1 (/careful), the replay clean fixture repo, inert strings fed to the hook on stdin and never run. N rows are forms #4534 says it now catches; O rows test the over-deny it names (disk-named redirects under /dev/shm and /dev/fd). None of these forms occurs in the 254,322-command corpus.

| Id | Probe | What it tests | 17303862 | ab6a38b7 | 9055979 |
|---|---|---|---|---|---|
| N1 | `wipefs -$'a' /dev/sdb` | wipefs -a in an ANSI-C spelling | deny (high_disk) | deny (high_disk) | deny (high_disk) |
| N2 | `echo x >'/dev'/sdb` | disk redirect with quotes | allow | deny (high_disk) | deny (high_disk) |
| N3 | `cat demo.img > /tmp/log 2>&1 > /dev/sdb` | disk redirect behind other redirects | deny (high_disk) | deny (high_disk) | deny (high_disk) |
| N4 | `cat demo.img > /dev/mmcblk0` | redirect into an mmcblk device | allow | deny (high_disk) | deny (high_disk) |
| N5 | `git push -nf --no-dry-run origin main` | --no-dry-run after -n on a force push to main | allow | deny (high_force_push_default) | deny (high_force_push_default) |
| N6 | `\wipefs -a demo.img` | backslash-escaped wipefs -a | allow | deny (high_disk) | deny (high_disk) |
| O1 | `echo x > /dev/shm/sda-cache` | harmless write under /dev/shm, sd-prefixed name | allow | allow | allow |
| O2 | `printf x > /dev/fd/disk1` | harmless write to a disk-named /dev/fd path | allow | deny (high_disk) | deny (high_disk) |
