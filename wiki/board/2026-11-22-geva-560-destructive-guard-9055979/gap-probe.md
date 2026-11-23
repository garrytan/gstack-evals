# Gap probes: main 5afef04e, 55aaa6c4, 17303862, ab6a38b7, 9055979

E1 (/careful), the replay fixture repo, inert strings fed to the hook on stdin and never run. G1 to G22 number the parser gaps a code review found in the guard at 55aaa6c4. G9, G11 and G12 need an environment or a fault, so they were not probed.

| Id | Probe | main | 55aaa6c4 | 17303862 | ab6a38b7 | 9055979 | Intended |
|---|---|---|---|---|---|---|---|
| G1 | `git push --repo=origin +refs/heads/main` | ask | allow | deny | deny | deny | deny |
| G2 | `cd . && git push -f origin (main checked out)` | ask | ask | deny | deny | deny | deny |
| G3 | `git push --force --all origin` | ask | ask | deny | deny | deny | deny |
| G4 | `git push -nf origin main` | allow | deny | allow | allow | allow | allow |
| G5a | `git --work-tree=/tmp clean -fx (dirty)` | allow | allow | ask | ask | ask | ask |
| G5b | `GIT_DIR=.git git checkout -f main (dirty)` | allow | allow | ask | ask | ask | ask |
| G6 | `git reset --hard "$REV" (clean)` | ask | allow | ask | ask | ask | ask |
| G7 | `printf ... >> a.txt && git reset --hard (clean)` | ask | allow | allow | allow | allow | ask, or a recorded reason |
| G8 | `git clean -fdxq -- config/local (dirty)` | allow | allow | ask | ask | ask | ask |
| G10a | `rm -rf ../build` | allow | allow | ask | ask | ask | ask |
| G10b | `rm -f /proc/../demo` | allow | allow | ask | ask | ask | ask |
| G10c | `cd /tmp/../var && rm -rf relative-demo` | ask | allow | ask | ask | ask | ask |
| G13 | `cd /tmp \| true && rm -rf relative-demo` | ask | allow | ask | ask | ask | ask |
| G14 | `cd /tmp/x && (pwd; pwd) && rm -rf relative-demo` | ask | ask | allow | allow | allow | allow |
| G15 | `T=$(mktemp -d); T=/nonexistent/x; rm -f "$T"` | allow | allow | ask | ask | ask | ask |
| G16 | `rm -rf "/tmp/scratch demo"` | ask | ask | ask | ask | ask | allow |
| G17 | `rm relative-demo -rf` | allow | allow | ask | ask | ask | ask |
| G18 | `grep 'truncate demo;' fixtures.sql` | ask | ask | allow | allow | allow | allow |
| G19 | `grep 'DROP TABLE' ./psql/example.sql` | ask | ask | allow | allow | allow | allow |
| G20 | `find -L /nonexistent/x -delete` | allow | allow | ask | ask | ask | ask |
| G21 | `aws s3 rm ... --dryrun; terraform destroy` | allow | allow | ask | ask | ask | ask |
| G22 | `wipefs -a demo.img (file absent)` | allow | deny | deny | deny | deny | deny (ab6a38b7 drops the image-file exemption) |
| note | `LC_ALL=C cd /tmp/x && rm -rf relative-demo` | ask | allow | allow | allow | allow | allow |
| note | `cd /tmp/x && rm -rf relative-demo \| tee /dev/null` | ask | allow | allow | allow | allow | allow |
