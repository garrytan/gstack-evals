// Copyright (c) 2026 Garry Tan. MIT License.
// The wrap-up turn's reset in a session container whose image declares a volume inside the repo dir (many SWE-bench-Live
// images declare VOLUME /testbed/mnt_tmp, so Docker mounts an anonymous volume there). Docker only: GSTACK_EVALS_DOCKER=1
// and PF_DOCKER_IMAGE, an image with bash, coreutils, find and git. git clean cannot remove a mount point, so wrapup.sh
// keeps every mount point under the repo dir out of git clean, and a file the wrap-up turn left inside one is still
// discarded and removed.
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const IMAGE = process.env.PF_DOCKER_IMAGE;
const SH = join(import.meta.dir, "../../lanes/outcome-skills/pfchecks/sh");
const SCRIPT = [
  "set -euo pipefail",
  "g() { git -C /r -c safe.directory='*' -c user.name=t -c user.email=t@t \"$@\"; }",
  "printf 'a\\n' > /r/a.txt && g init -q && g add -A && g commit -qm base",
  "bash /sh/capture.sh inventory /r > /w.inv",
  "printf 'b\\n' > /r/a.txt && bash /sh/capture.sh commit /r /w.inv >/dev/null",
  "bash /sh/wrapup.sh save /r /d",
  "printf '[]' > /r/CHECKS.json && printf 'x\\n' > /r/late.txt && printf 'y\\n' > /r/mnt_tmp/late.txt && printf 'c\\n' > /r/a.txt",
  "set +e; bash /sh/wrapup.sh keep /r /d > /keep.out 2>&1; echo \"KEEP_EXIT $?\"; set -e",
  "cat /keep.out",
  "echo \"STATUS [$(g status --porcelain --ignored | tr '\\n' ' ')]\"",
  "echo \"HEAD_IS_S $([ \"$(g rev-parse HEAD)\" = \"$(cat /d/s.head)\" ] && echo yes || echo no)\"",
  "echo \"A $(cat /r/a.txt)\"",
  "echo \"MNT [$(ls -A /r/mnt_tmp | tr '\\n' ' ')]\"",
  "echo \"MOUNTED $(grep -c ' /r/mnt_tmp ' /proc/self/mountinfo)\"",
].join("\n");

test.skipIf(process.env.GSTACK_EVALS_DOCKER !== "1" || !IMAGE)("wrapup.sh keep puts the tree back to S around a volume mounted inside the repo dir", () => {
  const r = spawnSync("docker", ["run", "--rm", "-i", "--network", "none", "-v", SH + ":/sh:ro", "-v", "/r/mnt_tmp", IMAGE!, "bash", "-s"], { input: SCRIPT, encoding: "utf8", timeout: 120_000 });
  const out = r.stdout + r.stderr;
  expect(out).toContain("KEEP_EXIT 0");
  expect(out).toContain("PF_DISCARD late.txt");
  expect(out).toContain("PF_DISCARD mnt_tmp/late.txt");
  expect(out).toContain("PF_WRAPUP checks=1 discarded=3");
  expect(out).toContain("STATUS []");
  expect(out).toContain("HEAD_IS_S yes");
  expect(out).toContain("A b");
  expect(out).toContain("MNT []");
  expect(out).toContain("MOUNTED 1");
});
