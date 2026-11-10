import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The Install Bun step in each workflow, run as GitHub runs it (bash -e) with curl and sleep swapped for stubs, so every path
// runs offline: the release zip, its retries, the npm fallback, and each way the step must fail closed. The stub archives hold
// a stand-in binary that prints a version, and the step gets the stub archives' own digests, so these cases never need the
// network. workflow-hygiene.test.ts checks the real pins.
type Step = { run?: string; env?: Record<string, string> };
type Workflow = { jobs: Record<string, { steps: Step[] }> };
const dir = join(import.meta.dir, "..", "..", ".github", "workflows");
const installs = ["ci.yml", "rig.yml", "sealed.yml"].flatMap((f) =>
  Object.values((Bun.YAML.parse(readFileSync(join(dir, f), "utf8")) as Workflow).jobs).flatMap((j) =>
    j.steps.filter((s) => s.env?.BUN_SHA256).map((s) => ({ f, run: s.run!, env: s.env! })),
  ),
);
const ZIP_URL = "https://github.com/oven-sh/bun/releases/download/bun-v1.4.4/bun-linux-x64.zip";
const TGZ_URL = "https://registry.npmjs.org/@oven/bun-linux-x64/-/bun-linux-x64-1.4.4.tgz";
const WRONG = "0".repeat(64);
const RETRIES = ["curl " + ZIP_URL, "sleep 15", "curl " + ZIP_URL, "sleep 30", "curl " + ZIP_URL, "sleep 60", "curl " + ZIP_URL];

// The release stub fails its first STUB_RELEASE_FAILS calls as a 504 burst does, leaving a partial file behind as a cut-off
// transfer would, then serves STUB_ZIP. The npm stub serves STUB_TGZ unless STUB_NPM says fail.
const CURL = [
  "#!/usr/bin/env bash",
  'url="@{@: -1}"',
  'while [ $# -gt 0 ]; do [ "$1" = -o ] && out="$2"; shift; done',
  'echo "curl $url" >> "$STUB_LOG"',
  'case "$url" in',
  "  https://github.com/*)",
  '    if [ "$(grep -c "^curl https://github.com/" "$STUB_LOG")" -le "$STUB_RELEASE_FAILS" ]; then',
  '      printf partial > "$out"',
  '      echo "curl: (22) The requested URL returned error: 504" >&2',
  "      exit 22",
  "    fi",
  '    cp "$STUB_ZIP" "$out" ;;',
  "  https://registry.npmjs.org/*)",
  '    if [ "$STUB_NPM" = fail ]; then echo "curl: (22) The requested URL returned error: 503" >&2; exit 22; fi',
  '    cp "$STUB_TGZ" "$out" ;;',
  '  *) echo "unexpected url $url" >&2; exit 99 ;;',
  "esac",
  "",
].join("\n").replace("@{", "$" + "{");
const SLEEP = '#!/usr/bin/env bash\necho "sleep $1" >> "$STUB_LOG"\n';

const sh = (script: string, cwd: string) => {
  const r = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(script + "\n" + r.stderr);
};
const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

type Case = { releaseFails?: number; npm?: "fail"; version?: string; zipBinary?: false; tgzBinary?: false; zipSha?: string; tgzSha?: string };

function runStep(install: (typeof installs)[number], c: Case = {}) {
  const root = mkdtempSync(join(tmpdir(), "bun-install-"));
  try {
    const stubs = join(root, "stubs");
    const temp = join(root, "runner");
    const z = join(root, "z", "bun-linux-x64");
    const t = join(root, "t", "package", "bin");
    for (const d of [stubs, temp, z, t]) mkdirSync(d, { recursive: true });
    writeFileSync(join(stubs, "curl"), CURL);
    writeFileSync(join(stubs, "sleep"), SLEEP);
    chmodSync(join(stubs, "curl"), 0o755);
    chmodSync(join(stubs, "sleep"), 0o755);
    const bin = "#!/bin/sh\necho " + (c.version ?? install.env.BUN_VERSION) + "\n";
    writeFileSync(join(z, c.zipBinary === false ? "README" : "bun"), bin, { mode: 0o755 });
    writeFileSync(join(t, c.tgzBinary === false ? "README" : "bun"), bin, { mode: 0o755 });
    writeFileSync(join(root, "t", "package", "package.json"), "{}\n");
    sh("zip -q -r bun.zip bun-linux-x64", join(root, "z"));
    sh("tar -czf bun.tgz package", join(root, "t"));
    const log = join(root, "log");
    const githubPath = join(root, "github_path");
    writeFileSync(log, "");
    const r = spawnSync("bash", ["-e", "-c", install.run], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...install.env,
        BUN_SHA256: c.zipSha ?? sha256(join(root, "z", "bun.zip")),
        BUN_NPM_SHA256: c.tgzSha ?? sha256(join(root, "t", "bun.tgz")),
        PATH: stubs + ":" + (process.env.PATH ?? ""),
        RUNNER_TEMP: temp,
        GITHUB_PATH: githubPath,
        STUB_LOG: log,
        STUB_ZIP: join(root, "z", "bun.zip"),
        STUB_TGZ: join(root, "t", "bun.tgz"),
        STUB_RELEASE_FAILS: String(c.releaseFails ?? 0),
        STUB_NPM: c.npm ?? "ok",
      },
    });
    return {
      root,
      ok: r.status === 0,
      out: r.stdout + r.stderr,
      log: readFileSync(log, "utf8").split("\n").filter(Boolean),
      path: existsSync(githubPath) ? readFileSync(githubPath, "utf8") : null,
      onPath: temp + "/bun-linux-x64\n",
      unpacked: existsSync(join(temp, "bun-linux-x64", "bun")),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("a run leaves no temp directory behind", () => {
  const r = runStep(installs[0]);
  expect([r.ok, existsSync(r.root)]).toEqual([true, false]);
});

test("every workflow that installs Bun has the step, with the pins and no other input", () => {
  expect(installs.map((i) => i.f)).toEqual(["ci.yml", "rig.yml", "sealed.yml"]);
  for (const i of installs) expect(Object.keys(i.env).sort()).toEqual(["BUN_NPM_SHA256", "BUN_SHA256", "BUN_VERSION"]);
});

for (const install of installs) {
  describe(install.f + ": Install Bun", () => {
    test("installs from the release zip when the first download works", () => {
      const r = runStep(install);
      expect(r.log).toEqual(["curl " + ZIP_URL]);
      expect([r.ok, r.path]).toEqual([true, r.onPath]);
    });

    test("waits 15, 30 and 60 seconds between tries and keeps the zip once a try works", () => {
      const r = runStep(install, { releaseFails: 3 });
      expect(r.log).toEqual(RETRIES);
      expect([r.ok, r.path]).toEqual([true, r.onPath]);
      expect(r.out.match(/::warning::The Bun release download failed; trying again in \d+s/g)).toHaveLength(3);
    });

    test("installs the npm package after four failed tries", () => {
      const r = runStep(install, { releaseFails: 4 });
      expect(r.log).toEqual([...RETRIES, "curl " + TGZ_URL]);
      expect([r.ok, r.path]).toEqual([true, r.onPath]);
      expect(r.out).toContain("::warning::The Bun release download failed 4 times, so this job installs @oven/bun-linux-x64@1.4.4 from registry.npmjs.org");
    });

    test("refuses a release zip whose digest does not match, and does not fall back", () => {
      const r = runStep(install, { zipSha: WRONG });
      expect(r.log).toEqual(["curl " + ZIP_URL]);
      expect([r.ok, r.path, r.unpacked]).toEqual([false, null, false]);
      expect(r.out).toContain("FAILED");
    });

    test("refuses an npm package whose digest does not match, before unpacking it", () => {
      const r = runStep(install, { releaseFails: 4, tgzSha: WRONG });
      expect(r.log).toEqual([...RETRIES, "curl " + TGZ_URL]);
      expect([r.ok, r.path, r.unpacked]).toEqual([false, null, false]);
      expect(r.out).toContain("FAILED");
    });

    test("fails when the npm download fails too", () => {
      const r = runStep(install, { releaseFails: 4, npm: "fail" });
      expect(r.log).toEqual([...RETRIES, "curl " + TGZ_URL]);
      expect([r.ok, r.path, r.unpacked]).toEqual([false, null, false]);
    });

    test("fails when either archive holds no binary", () => {
      for (const c of [{ zipBinary: false }, { releaseFails: 4, tgzBinary: false }] as Case[]) {
        const r = runStep(install, c);
        expect([r.ok, r.path, r.unpacked]).toEqual([false, null, false]);
      }
    });

    test("fails when the binary reports another version, by either path", () => {
      for (const c of [{ version: "1.4.3" }, { version: "1.4.3", releaseFails: 4 }] as Case[]) {
        const r = runStep(install, c);
        expect([r.ok, r.path]).toEqual([false, null]);
      }
    });
  });
}
