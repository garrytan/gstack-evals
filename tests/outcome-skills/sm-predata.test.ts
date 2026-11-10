// Copyright (c) 2026 Garry Tan. MIT License.
// The ten items #290 left to fix before any family SM data: the seven named notes in its body (A3's home links and home
// check, one registry for the /qa pin, scoring only scorable first stages, the SM stage's model, a failed proxy finalize
// and an unknown spend), an empty first stage's follow-on tree, and stock diffs that stay valid in every language. Each
// test failed on the merged harness (d85f75a). The GST-1959 blocks add #314's stock-diff follow-ups and the stock build
// check; each of their tests failed on 5390c71. No key, no paid call; the stock diffs compile with the toolchains present.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { recordProgram } from "../../src/runner/ledger/envelope.ts";
import { recordApproval } from "../../src/runner/ledger/ledger.ts";
import { LocalLedger } from "../../src/runner/ledger/local.ts";
import { readItem, type LedgerError } from "../../src/runner/ledger/record.ts";
import { MeteringProxy } from "../../src/runner/proxy/metering-proxy.ts";
import { REGISTRY_PATH } from "../../lanes/outcome-skills/arms/registry.ts";
import { serveStages, type StageSpec } from "../../lanes/outcome-skills/driver/stage.ts";
import { main } from "../../lanes/outcome-skills/statemachines/cli.ts";
import { fixtureRow, scoreUnit } from "../../lanes/outcome-skills/statemachines/fixtures.ts";
import { contain, containInputs } from "../../lanes/outcome-skills/statemachines/contain.ts";
import { computeStart } from "../../lanes/outcome-skills/statemachines/followon.ts";
import { qaHomeCopy } from "../../lanes/outcome-skills/statemachines/image.ts";
import type { Lang } from "../../lanes/outcome-skills/statemachines/langs.ts";
import { checkRename } from "../../lanes/outcome-skills/statemachines/bindcheck.ts";
import { buildStock, stockDiffs, type StockKind } from "../../lanes/outcome-skills/statemachines/packets.ts";
import { treeVolume } from "../../lanes/outcome-skills/statemachines/oracle.ts";
import { runSession } from "../../lanes/outcome-skills/statemachines/run.ts";
import { sessionEnd, type PlannedSession } from "../../lanes/outcome-skills/statemachines/session.ts";
import { toCandidate } from "../../lanes/outcome-skills/statemachines/source.ts";
import { PY_IMAGE } from "../../lanes/outcome-skills/statemachines/testrun.ts";
import { writeUnit } from "../../lanes/outcome-skills/statemachines/unit.ts";

const ROOT = join(import.meta.dir, "../..");
const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));
const scratch = (name: string) => {
  const r = mkdtempSync(join(tmpdir(), "sm-predata-" + name + "-"));
  roots.push(r);
  return r;
};
const sha = (b: string) => createHash("sha256").update(b).digest("hex");
const py = (code: string, ...args: string[]) => {
  const r = spawnSync("python3", ["-c", code, join(import.meta.dir, "../real-outcome"), ...args], { env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }, encoding: "utf8" });
  if (r.status !== 0) console.log(r.stdout + r.stderr);
  return r.stdout;
};
const unitDir = (root: string, patch?: (u: Record<string, any>) => void, id = fixtureRow().instance_id) => {
  const dir = join(root, "u");
  const row = fixtureRow({ instance_id: id });
  writeUnit(dir, { ...toCandidate("rust", row), image_digest: "sha256:" + "c".repeat(64) }, row);
  if (patch) {
    const u = JSON.parse(readFileSync(join(dir, "unit.json"), "utf8"));
    patch(u);
    writeFileSync(join(dir, "unit.json"), JSON.stringify(u));
  }
  return dir;
};

describe("A3's home (#290 notes 1 and 3, #314 note 4)", () => {
  // Value: protects=A3's /qa home in the session image, installed by qa-install.sh with the home mounted at /root, so every link, text file and compiled binary already names the session's home; fails_when=the copy rewrites or drops what the install wrote, a host's .capy reaches the image, or the digest the session record keeps does not follow the home's content; why_new=#314 note 4 and the Captain's B2 (2026-11-10: install at /root); seam=image.ts qaHomeCopy; no_claim=a gstack install at the recorded pin (the PR's real install covers it)
  test("the copy keeps a home installed at /root as written, leaves out .capy and records the home's digest", () => {
    const root = scratch("qahome");
    const src = join(root, "host-home");
    for (const d of [".claude/skills/gstack/qa", ".claude/skills/gstack/browse/dist", ".gstack", ".capy"]) mkdirSync(join(src, d), { recursive: true });
    writeFileSync(join(src, ".claude/skills/gstack/qa/SKILL.md"), "qa\n");
    symlinkSync("/root/.claude/skills/gstack/qa", join(src, ".claude/skills/qa"));
    symlinkSync("gstack/qa/SKILL.md", join(src, ".claude/skills/qa.md"));
    const settings = JSON.stringify({ hook: "/root/.claude/skills/gstack/bin/hook" });
    writeFileSync(join(src, ".claude/settings.json"), settings);
    const browse = Buffer.concat([Buffer.from("ELF\0"), Buffer.from("/root/.claude/skills/gstack/browse/src")]);
    writeFileSync(join(src, ".claude/skills/gstack/browse/dist/browse"), browse);
    writeFileSync(join(src, ".capy/git-shim.log"), "log\n");
    const dst = join(root, "copy");
    const got = qaHomeCopy(src, dst);
    expect(Object.keys(got).sort()).toEqual(["paths", "sha256"]);
    expect(got.paths).toEqual(["/root/.claude/skills", "/root/.gstack"]);
    expect(got.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(readlinkSync(join(dst, ".claude/skills/qa"))).toBe("/root/.claude/skills/gstack/qa");
    expect(readlinkSync(join(dst, ".claude/skills/qa.md"))).toBe("gstack/qa/SKILL.md");
    expect(readFileSync(join(dst, ".claude/settings.json"), "utf8")).toBe(settings);
    expect(readFileSync(join(dst, ".claude/skills/gstack/browse/dist/browse")).equals(browse)).toBe(true);
    expect(existsSync(join(dst, ".capy"))).toBe(false);
    expect(qaHomeCopy(src, join(root, "again")).sha256).toBe(got.sha256);
    writeFileSync(join(src, ".claude/skills/gstack/qa/SKILL.md"), "qa, changed\n");
    expect(qaHomeCopy(src, join(root, "changed")).sha256).not.toBe(got.sha256);
  });

  // Value: protects=A3's session from a home installed outside the container, whose compiled binaries (gstack's browse resolves its root from its build dir) and text name a dir the session doesn't have; fails_when=a binary or text file that names the host dir is copied into the image, or the refusal does not name the file; why_new=#314 review note 4 (adversarial-native, Medium: qa_home.binaries was computed and dropped); seam=image.ts qaHomeCopy; no_claim=a foreign path that is not the host dir the home was copied from
  test("a binary or a text file that names the host dir fails closed and names the file", () => {
    const root = scratch("qahome-host");
    const src = join(root, "host-home");
    mkdirSync(join(src, ".claude/skills/gstack/browse/dist"), { recursive: true });
    const bin = join(src, ".claude/skills/gstack/browse/dist/browse");
    writeFileSync(bin, Buffer.concat([Buffer.from("ELF\0"), Buffer.from(realpathSync(src) + "/.claude/skills/gstack/browse/src")]));
    expect(() => qaHomeCopy(src, join(root, "bin"))).toThrow(/^E_SM_ARM A3's home names its host dir .* in \/\.claude\/skills\/gstack\/browse\/dist\/browse/);
    rmSync(bin);
    writeFileSync(join(src, ".claude/settings.json"), JSON.stringify({ hook: src + "/.claude/skills/gstack/bin/hook" }));
    expect(() => qaHomeCopy(src, join(root, "text"))).toThrow(/^E_SM_ARM A3's home names its host dir .* in \/\.claude\/settings\.json/);
  });

  // Value: protects=A3's session from a home installed under another home, whose compiled browse binary names that home's gstack checkout and resolves its root there; fails_when=a binary that names gstack's checkout under any home but /root is copied, the refusal does not name it, or a binary naming /root's checkout, or text quoting another home's gstack path as an example, is refused; why_new=the Captain's B2 condition 3 (2026-11-10: the refusal fires on any binary naming a dir other than /root, with a foreign-path fixture); seam=image.ts qaHomeCopy; no_claim=which homes a gstack build machine uses
  test("a binary that names gstack's checkout under a home other than /root fails closed, and /root's or quoted text passes", () => {
    const root = scratch("qahome-foreign");
    const src = join(root, "home");
    mkdirSync(join(src, ".claude/skills/gstack/browse/dist"), { recursive: true });
    const bin = join(src, ".claude/skills/gstack/browse/dist/browse");
    const elf = (path: string) => Buffer.concat([Buffer.from("ELF\0"), Buffer.from(path)]);
    writeFileSync(join(src, ".claude/skills/gstack/README.md"), "Installed at " + join("/", "home", "runner", ".claude/skills/gstack") + " or " + join("/", "github", "home", ".claude/skills/gstack") + " on CI.\n");
    writeFileSync(bin, elf("/root/.claude/skills/gstack/browse/src"));
    expect(qaHomeCopy(src, join(root, "ok")).paths).toEqual(["/root/.claude/skills"]);
    for (const [i, foreign] of [join("/", "home", "runner", ".claude/skills/gstack/browse/src"), join("/", "github", "home", ".claude/skills/gstack")].entries()) {
      writeFileSync(bin, elf(foreign));
      expect(() => qaHomeCopy(src, join(root, "foreign-" + i))).toThrow(/^E_SM_ARM A3's home names its host dir .* or another home's gstack checkout in \/\.claude\/skills\/gstack\/browse\/dist\/browse \(binaries 1, text files 0\)/);
    }
  });

  // Value: protects=files the install wrote that name no host dir; fails_when=a relative --qa-home such as "." becomes a root the host-dir check matches, so "./helper.ts" or a sentence's last period fails the copy, or a relative path hides the host dir it names; why_new=Capy's review of #314; seam=image.ts qaHomeCopy; no_claim=which dir an operator passes
  test("a relative home path is resolved first, so text that names no host dir passes as written", () => {
    const root = scratch("qahome-rel");
    const src = join(root, "host-home");
    mkdirSync(join(src, ".claude/skills/gstack"), { recursive: true });
    const script = 'import { help } from "./helper.ts";\n// Ends with a period.\nconst home = "/root/.claude";\n';
    writeFileSync(join(src, ".claude/skills/gstack/run.ts"), script);
    const cwd = process.cwd();
    process.chdir(src);
    try {
      qaHomeCopy(".", join(root, "dot"));
      qaHomeCopy(relative(src, src + "/../host-home"), join(root, "rel"));
      writeFileSync(join(src, ".claude/skills/gstack/host.ts"), 'const home = "' + src + '/.claude";\n');
      expect(() => qaHomeCopy(".", join(root, "named"))).toThrow(/^E_SM_ARM A3's home names its host dir .* in \/\.claude\/skills\/gstack\/host\.ts/);
    } finally {
      process.chdir(cwd);
    }
    for (const d of ["dot", "rel"]) expect(readFileSync(join(root, d, ".claude/skills/gstack/run.ts"), "utf8")).toBe(script);
  });

  // Value: protects=the host's pinned /qa install: a --qa-home given as a symlink is copied as the tree it names, and a file naming the dir it resolves to is still the host dir; fails_when=the copy keeps the link, or only the link's own path counts as the host dir; why_new=the /ship review of #314 (red team on image.ts); seam=image.ts qaHomeCopy; no_claim=how an operator names the dir
  test("a home given as a symlink is copied as its tree, and a file that names the dir it resolves to fails closed", () => {
    const root = scratch("qahome-link");
    const real = join(root, "real");
    mkdirSync(join(real, ".claude/skills/gstack"), { recursive: true });
    writeFileSync(join(real, ".claude/skills/gstack/f.txt"), "path=/root/x\n");
    symlinkSync(real, join(root, "link"));
    const dst = join(root, "copy");
    qaHomeCopy(join(root, "link"), dst);
    expect(lstatSync(dst).isDirectory()).toBe(true);
    expect(readFileSync(join(dst, ".claude/skills/gstack/f.txt"), "utf8")).toBe("path=/root/x\n");
    writeFileSync(join(real, ".claude/skills/gstack/f.txt"), "path=" + realpathSync(real) + "/x\n");
    expect(() => qaHomeCopy(join(root, "link"), join(root, "copy2"))).toThrow(/^E_SM_ARM A3's home names its host dir .* in \/\.claude\/skills\/gstack\/f\.txt/);
  });

  // Value: protects=the session home holding nothing from outside the install; fails_when=a link that leaves the home, absolute, relative or into the host dir (a home installed outside the container), is copied into the image; why_new=#290 named note 1 and #314 note 4; seam=image.ts qaHomeCopy; no_claim=links gstack's setup writes today, which all point inside the home
  test("a link that leaves the home fails closed", () => {
    for (const target of ["/etc", "../../..", "host"]) {
      const root = scratch("qahome-out");
      const src = join(root, "host-home");
      mkdirSync(join(src, ".claude/skills/gstack"), { recursive: true });
      symlinkSync(target === "host" ? join(src, ".claude/skills/gstack") : target, join(src, ".claude/skills/out"));
      expect(() => qaHomeCopy(src, join(root, "copy"))).toThrow(/^E_SM_ARM A3's home links \/\.claude\/skills\/out to .*outside the home/);
    }
  });

  // Value: protects=the Captain's conditions for A3's install (2026-11-10, B2): it runs the way a user installs gstack, in a throwaway container whose /root is the home dir, with no API key, no drive and no host env, and the container goes whatever the outcome; fails_when=the install runs on the host, mounts anything but the home and a local source (read-only), passes a variable outside its fixed list or a host value, keeps the container, or calls docker before the pin, the command and a clean home are checked; why_new=#314 note 4 and the Captain's B2; seam=arms/qa-install.sh with a stub docker; no_claim=the install itself (the PR's real install at the pin)
  test("qa-install.sh installs in a throwaway container with the home at /root, no keys, no drive and no host env", () => {
    const root = scratch("qa-install");
    const stub = join(root, "bin");
    mkdirSync(stub);
    writeFileSync(join(stub, "docker"), ["#!/usr/bin/env bash", "n=$(ls \"$STUB_DIR\" | grep -c '^call' || true)", "printf '%s\\0' \"$@\" > \"$STUB_DIR/call$n\"", "case \"$1\" in build) cat > \"$STUB_DIR/stdin$n\"; echo sha256:" + "7".repeat(64) + ";; run) exit \"$STUB_RUN_EXIT\";; esac", ""].join("\n"), { mode: 0o755 });
    const src = join(root, "src");
    mkdirSync(src);
    let n = 0;
    const install = (home: string, exit: number, from = src, sha = "a".repeat(40)) => {
      const dir = join(root, "calls" + n++);
      mkdirSync(dir);
      const r = spawnSync("bash", [join(ROOT, "lanes/outcome-skills/arms/qa-install.sh"), from, home, sha, "./setup --host claude"], { encoding: "utf8", env: { PATH: stub + ":" + process.env.PATH, HOME: root, STUB_DIR: dir, STUB_RUN_EXIT: String(exit), ANTHROPIC_API_KEY: "sk-ant-test-not-a-key", CAPY_DRIVE: join("/", "home", "user", ".capy/drive") } });
      const calls = readdirSync(dir).filter((f) => f.startsWith("call")).sort().map((f) => readFileSync(join(dir, f), "utf8").split("\0").slice(0, -1));
      const run = calls.find((c) => c[0] === "run") ?? [];
      const opt = (flag: string) => run.flatMap((a, i) => (a === flag ? [run[i + 1]!] : []));
      return { status: r.status, calls, run, opt, stdin: existsSync(join(dir, "stdin0")) ? readFileSync(join(dir, "stdin0"), "utf8") : "" };
    };
    const home = join(root, "home");
    const ok = install(home, 0);
    expect(ok.status).toBe(0);
    expect(ok.calls.map((c) => c[0])).toEqual(["build", "run", "rm"]);
    expect(ok.stdin).toMatch(/^FROM buildpack-deps:trixie@sha256:[0-9a-f]{64}\nCOPY --from=oven\/bun:1\.4\.4@sha256:[0-9a-f]{64} \/usr\/local\/bin\/bun \/usr\/local\/bin\/bun\n$/);
    expect(ok.opt("-v")).toEqual([realpathSync(home) + ":/root", realpathSync(src) + ":/qa-src:ro"]);
    expect(ok.opt("-e")).toEqual(["HOME=/root", "PATH=/usr/local/bin:/usr/bin:/bin", "USER=root", "LANG=C.UTF-8", "TERM=dumb", "GSTACK_SKIP_PLAYWRIGHT=1", "GSTACK_SKIP_FONTS=1"]);
    expect(ok.run.some((a) => a.includes("sk-ant-test-not-a-key") || a.includes(".capy") || a.startsWith("--env") || a === "--privileged")).toBe(false);
    expect(ok.run).toContain("sha256:" + "7".repeat(64));
    expect(ok.run.slice(-4)).toEqual(["/qa-src", "a".repeat(40), "./setup --host claude", process.getuid!() + ":" + process.getgid!()]);
    expect(ok.calls[2]).toEqual(["rm", "-f", "-v", ok.opt("--name")[0]!]);
    const failed = install(join(root, "home-failed"), 1);
    expect(failed.status).toBe(1);
    expect(failed.calls.map((c) => c[0])).toEqual(["build", "run", "rm"]);
    const remote = install(join(root, "home-remote"), 0, "https://git.capy.ai/garrytan/gstack.git");
    expect(remote.opt("-v")).toEqual([realpathSync(join(root, "home-remote")) + ":/root"]);
    expect(remote.run.at(-4)).toBe("https://git.capy.ai/garrytan/gstack.git");
    mkdirSync(join(root, "used/.claude/skills"), { recursive: true });
    for (const [h, sha] of [[join(root, "used"), "a".repeat(40)], [join(root, "home-bad-sha"), "not-a-sha"]] as const) expect(install(h, 0, src, sha)).toMatchObject({ status: 2, calls: [] });
  });

  // Value: protects=section 4's A3 home check against what the /qa install wrote; fails_when=a told session whose home holds exactly the install's checked paths (here with ~/.local/share/gstack, which gstack's setup can write) is refused, a path the build did not list passes, or a drive passes because the task listed it; why_new=#290 named note 3 (QA_HOME may refuse every A3 session); seam=real_agent.py _open_sm with task.json qa_home (run.ts, image.ts qaHomeCopy); no_claim=which paths a given gstack version writes
  test("real_agent's A3 check takes the home paths the image build listed, and never a drive", () => {
    const code = `
import json, sys, types
sys.path.insert(0, sys.argv[1])
import unit_test as u
ra = u.ra
ra.egress.apply = lambda c, allow: {"event": "egress", "allow": allow}
def check(stdout, qa_home):
    fake = types.SimpleNamespace(options=types.SimpleNamespace(probe_node=""), _exec=lambda c, s, stdin=None, timeout=0: types.SimpleNamespace(returncode=0, stdout=stdout.encode(), stderr=b""))
    task = {"repo_dir": "/testbed", "commits": 1, "base_commit": "b" * 40, "qa_sha": "a" * 40, "qa_home": qa_home}
    try:
        ra.RealAgent._open_sm(fake, "c", "t", task, "http://10.0.0.2:9000", True, lambda e: None)
        return "ok"
    except ra.SandboxSetupError as e:
        return str(e).split(" ")[0]
qa = "COMMITS 1\\nHEAD " + "b" * 40 + "\\nGSTACK " + "a" * 40 + "\\n"
built = ["/root/.claude/skills", "/root/.gstack", "/root/.local/share/gstack"]
home = "".join("HOME " + p + "\\n" for p in built)
print(json.dumps([check(qa + home, built), check(qa + home + "HOME /root/.claude/CLAUDE.md\\n", built), check(qa + home + "HOME /root/.capy\\n", built + ["/root/.capy"])]))
`;
    expect(JSON.parse(py(code))).toEqual(["ok", "E_SM_STRIP", "E_SM_STRIP"]);
  });
});

// Value: protects=section 4's A3 home, where Claude Code would load ~/.claude/CLAUDE.md as user memory in every session, so A3's home may hold it in no case, as a no-gstack home may not; fails_when=a task.json qa_home that lists /root/.claude/CLAUDE.md (the image build lists every checked path the install wrote) lets the file pass, or the refusal does not name it; why_new=#314 review note 5 (adversarial-native, Low); seam=real_agent.py _open_sm; no_claim=whether a gstack version writes that file (setup at b6155921 writes none)
test("real_agent's A3 check refuses a home CLAUDE.md even when the image build listed it, and passes the listed install without it", () => {
  const code = `
import json, sys, types
sys.path.insert(0, sys.argv[1])
import unit_test as u
ra = u.ra
ra.egress.apply = lambda c, allow: {"event": "egress", "allow": allow}
def check(stdout, qa_home):
    fake = types.SimpleNamespace(options=types.SimpleNamespace(probe_node=""), _exec=lambda c, s, stdin=None, timeout=0: types.SimpleNamespace(returncode=0, stdout=stdout.encode(), stderr=b""))
    task = {"repo_dir": "/testbed", "commits": 1, "base_commit": "b" * 40, "qa_sha": "a" * 40, "qa_home": qa_home}
    try:
        ra.RealAgent._open_sm(fake, "c", "t", task, "http://10.0.0.2:9000", True, lambda e: None)
        return "ok"
    except ra.SandboxSetupError as e:
        return str(e)
qa = "COMMITS 1\\nHEAD " + "b" * 40 + "\\nGSTACK " + "a" * 40 + "\\n"
built = ["/root/.claude/skills", "/root/.gstack"]
home = "".join("HOME " + p + "\\n" for p in built)
memory = "/root/.claude/CLAUDE.md"
print(json.dumps([check(qa + home + "HOME " + memory + "\\n", built + [memory]), check(qa + home, built + [memory]), check(qa + home, built)]))
`;
  const [listed, absent, plain] = JSON.parse(py(code)) as string[];
  expect(listed).toStartWith("E_SM_STRIP A3's home holds ['/root/.claude/CLAUDE.md'], outside the /qa install's own");
  expect([absent, plain]).toEqual(["ok", "ok"]);
});

// Value: protects=one registry file for A3's /qa pin, read by run.ts and handed to real_agent as arms_path; fails_when=run.ts checks the pin in the default registry while the session reads another; why_new=#290 named note 2; seam=run.ts runSession registry; no_claim=real_agent's own read of arms_path, which sm-session.test.ts's sm_turn test covers
test("runSession checks A3's /qa pin in the registry it hands real_agent, so a pin recorded there passes to the image build", () => {
  const root = scratch("registry");
  const dir = unitDir(root, (u) => (u.image.runtime_id = "sha256:" + "d".repeat(64)));
  const reg = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
  reg.sm.pins.qa = { ...reg.sm.pins.qa, sha: "a".repeat(40) };
  const registry = join(root, "registry.json");
  writeFileSync(registry, JSON.stringify(reg));
  const session: PlannedSession = { unit: "u", part: 1, index: 0, model: "claude-opus-5-5", cell: "A3", stage: "first", arm: "qa:told" };
  expect(() => runSession({ unitDir: dir, session, control: "http://127.0.0.1:1", proxy: "127.0.0.1:1", out: join(root, "out"), qaHome: join(root, "no-home"), qaSha: "a".repeat(40), registry })).toThrow(/^E_SM_ARM A3's home is a first-stage home holding \.claude\/skills\/gstack/);
});

// Value: protects=section 6's rule that an upstream or infra end is never scored: the first attempt is retried in a fresh container and the retry's end is a gap; fails_when=sm score first scores a session record whatever its end and attempt; why_new=#290 named note 4 (cli.ts score first); seam=cli.ts sm score first --session; no_claim=analysis's reading of the gap (analysis.ts sessionGap)
test("sm score first scores no session that ended upstream or infra: a first attempt goes back for its retry, a retry is a gap", async () => {
  const root = scratch("score");
  const dir = unitDir(root);
  writeFileSync(join(root, "p.patch"), "");
  const score = async (end: string, attempt: number) => {
    const f = join(root, end + attempt + ".json");
    writeFileSync(f, JSON.stringify({ schema: "sm-session.v1", unit: fixtureRow().instance_id, stage: "first", cell: "A1", model: "claude-opus-5-5", lease_id: "l1", end, attempt, tree_patch: { path: join(root, "p.patch"), sha256: sha("") } }));
    const errs: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => void errs.push(a.join(" "));
    try {
      return { code: await main(["score", "first", "--unit", dir, "--session", f, "--out", join(root, end + attempt + ".out.json")]), err: errs[0] ?? "" };
    } finally {
      console.error = orig;
    }
  };
  for (const end of ["upstream", "infra"]) {
    const first = await score(end, 1);
    expect(first).toMatchObject({ code: 2 });
    expect(first.err).toStartWith("E_SM_ARM the session ended " + end + " on attempt 1, so it is not scored");
    const retry = await score(end, 2);
    expect(retry).toMatchObject({ code: 2 });
    expect(retry.err).toStartWith((end === "upstream" ? "E_SM_UPSTREAM_GAP" : "E_SM_INFRA_GAP") + " the session ended " + end + " on its retry");
  }
});

// Value: protects=section 6's gap rule where a first stage seeds a tree: an upstream or infra first stage seeds no A1 or S2 follow-on, so attempt 1 goes back for its retry and attempt 2 is a gap; fails_when=a first-stage record that ended upstream or infra, with its empty patch, seeds a follow-on start set or image, so the base tree is scored as A1 or S2; why_new=the /ship review of #314 (red team on followon.ts); seam=cli.ts sm score followon --first and run.ts runSession; no_claim=analysis's reading of the gap
test("a first stage that ended upstream or infra seeds no follow-on tree: attempt 1 goes back for its retry, attempt 2 is a gap", async () => {
  const root = scratch("seed");
  const dir = unitDir(root);
  writeFileSync(join(root, "p.patch"), "");
  for (const end of ["upstream", "infra"]) for (const attempt of [1, 2]) {
    const f = join(root, end + attempt + ".json");
    writeFileSync(f, JSON.stringify({ schema: "sm-session.v1", unit: fixtureRow().instance_id, stage: "first", cell: "A1", model: "claude-opus-5-5", lease_id: "l1", end, attempt, tree_patch: { path: join(root, "p.patch"), sha256: sha("") } }));
    const want = attempt === 1 ? "E_SM_ARM the session ended " + end + " on attempt 1, so it is not scored and seeds no follow-on" : (end === "upstream" ? "E_SM_UPSTREAM_GAP" : "E_SM_INFRA_GAP") + " the session ended " + end + " on its retry";
    const errs: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => void errs.push(a.join(" "));
    let code: number;
    try {
      code = await main(["score", "followon", "--unit", dir, "--tree", "A1", "--first", f, "--patch", join(root, "p.patch"), "--out", join(root, end + attempt + ".out.json")]);
    } finally {
      console.error = orig;
    }
    expect(code).toBe(2);
    expect(errs[0] ?? "").toStartWith(want);
    const session: PlannedSession = { unit: "u", part: 1, index: 0, model: "claude-opus-5-5", cell: "F-A1-1", stage: "followon", arm: "sm:followon", tree: "A1", replicate: 1, after: "A1" };
    let err = "";
    try {
      runSession({ unitDir: dir, session, control: "http://127.0.0.1:1", proxy: "127.0.0.1:1", out: join(root, "run-" + end + attempt), first: f });
    } catch (e) {
      err = (e as Error).message;
    }
    expect(err).toStartWith(want);
  }
});

describe("the SM stage (#290 notes 5 and 6)", () => {
  const D = 1_000_000;
  const quote = { words: "test words", by: "test", source: "sm-predata.test.ts" };
  const ARMS = ["sm:A0", "sm:A1", "sm:A2", "sm:S2", "sm:followon"];
  const ledger = (items: string[]) => {
    const root = scratch("driver");
    const record = join(root, "record");
    recordProgram(record, { program: "w", cap_micros: 1_000 * D, skill_cap_micros: 1_000 * D, skills: ["sm"], credit_rate_micros: D, quotes: [quote] });
    for (const item of items) recordApproval(record, { action: "init", item, cap_micros: 100 * D, quotes: [quote], admission: "required", program: "w", skills: ["sm"] });
    return { root, record, db: LocalLedger.open(join(root, "ledger.sqlite")) };
  };
  const fetchStub = async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { model: string };
    return Response.json({ id: "msg_1", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
  };
  const serve = (l: ReturnType<typeof ledger>, stages: StageSpec[], extra: { lift_halts?: string[]; now?: () => number } = {}) =>
    serveStages({ record: l.record, local: l.db, run_id: "r1", envelope_host: "m1", machine: "m1", stages, host: "127.0.0.1", dir: join(l.root, "run"), fetch: fetchStub, requireAdmission: () => null, env: { ANTHROPIC_API_KEY: "upstream-key", OPENROUTER_API_KEY: "upstream-key" }, log: () => {}, ...extra });
  const OPUS_STAGE: StageSpec[] = [{ item: "sm-opus", arm: "sm-opus", model: "claude-opus-5-5", arms: ARMS }];
  const openA1 = async (control: string, key: string, model = "claude-opus-5-5") => (await fetch(control + "/sessions", { method: "POST", body: JSON.stringify({ trial: "t-" + key, model, cap_usd: model === "claude-opus-5-5" ? 15 : 3, meta: { arm: "sm:A1", task: key + "/A1", trial_n: 1 }, open_key: key + model, ledger: "u4" }) }));
  const closeWith = async (control: string, id: string, finalizeFails: boolean) => {
    const finalize = MeteringProxy.prototype.finalize;
    if (finalizeFails)
      MeteringProxy.prototype.finalize = async () => {
        throw new Error("finalize failed in this test");
      };
    try {
      return (await (await fetch(control + "/sessions/" + id + "/close", { method: "POST", body: JSON.stringify({ reason: "agent_finished" }) })).json()) as Record<string, any>;
    } finally {
      MeteringProxy.prototype.finalize = finalize;
    }
  };
  const runLines = (l: ReturnType<typeof ledger>, event: string) => readFileSync(join(l.root, "run", "sessions.jsonl"), "utf8").split("\n").filter(Boolean).map((x) => JSON.parse(x) as Record<string, any>).filter((e) => e.event === event);

  // Value: protects=section 13's money table, where each model's sessions draw on that model's own line item; fails_when=a stage pays for one model's sessions from another model's item, or from a name that is no family SM item; why_new=#290 named note 5 (stage.ts SM stage check); seam=driver/stage.ts serveStages with statemachines/items.ts ITEMS; no_claim=the item caps themselves (sm-items.test.ts)
  test("a stage pays only for its line item's own model, before any lease opens", async () => {
    const l = ledger(["sm-opus", "sm-made-up"]);
    const tried = (stages: StageSpec[]) => serve(l, stages).then(async (s) => (await s.stop(), "served"), (e: LedgerError) => e.code + " " + e.message);
    expect(await tried([{ item: "sm-opus", arm: "sm-opus", model: "particle-ai/particle-1", arms: ARMS }])).toStartWith("E_USAGE SM stage sm-opus pays for model particle-ai/particle-1, but line item sm-opus pays for claude-opus-5-5");
    expect(await tried([{ item: "sm-made-up", arm: "sm-made-up", model: "claude-opus-5-5", arms: ARMS }])).toStartWith("E_USAGE SM stage sm-made-up pays for model claude-opus-5-5, but sm-made-up is not one of family SM's line items");
    for (const item of ["sm-opus", "sm-made-up"]) expect(readItem(l.record, item).leases).toEqual([]);
    l.db.close?.();
  });

  // Value: protects=section 6's end kind when the proxy's finalize fails; fails_when=the close answer reports 0 allowance stops and 0 refusals it never counted, so an allowance stop reads as an upstream end and gets a retry, or real_agent drops the flag; why_new=#290 named note 6 (stage.ts finalize); seam=driver/stage.ts closeSession, real_agent.py proxy_summary, session.ts sessionEnd; no_claim=the lease's spend, which the ledger meter keeps
  test("a session whose proxy finalize fails closes with finalized false and unknown counts, and ends as infra", async () => {
    const l = ledger(["sm-opus"]);
    const served = await serve(l, [{ item: "sm-opus", arm: "sm-opus", model: "claude-opus-5-5", arms: ARMS }]);
    const opened = (await (await fetch(served.control + "/sessions", { method: "POST", body: JSON.stringify({ trial: "t-1", model: "claude-opus-5-5", cap_usd: 15, meta: { arm: "sm:A1", task: "u1/A1", trial_n: 1 }, open_key: "k1", ledger: "u4" }) })).json()) as Record<string, any>;
    const finalize = MeteringProxy.prototype.finalize;
    MeteringProxy.prototype.finalize = async () => {
      throw new Error("finalize failed in this test");
    };
    let answer: Record<string, any>;
    try {
      answer = (await (await fetch(served.control + "/sessions/" + opened.id + "/close", { method: "POST", body: JSON.stringify({ reason: "agent_finished" }) })).json()) as Record<string, any>;
    } finally {
      MeteringProxy.prototype.finalize = finalize;
    }
    expect(answer).toMatchObject({ finalized: false, requests: null, ok_responses: null, refused: null, refusals: null, allowance_stops: null, unknown: null, undrained: null, unsettled: null });
    const proxy = JSON.parse(py("import json, sys\nsys.path.insert(0, sys.argv[1])\nimport unit_test as u\nprint(json.dumps(u.ra.proxy_summary(json.loads(sys.argv[2]))))", JSON.stringify(answer)));
    expect(proxy.finalized).toBe(false);
    expect(sessionEnd({ termination: "error_result", proxy }, false)).toEqual({ end: "infra", unknown_micros: answer.unknown_micros });
    expect(await served.stop()).toBe(2);
    l.db.close?.();
  });

  // Value: protects=section 6's one retry when a close's proxy finalize failed: its allowance stops are unknown (null), so the item halts before any retry and the Captain rules after reading the journal; fails_when=the halted stage opens another session, a relaunch opens a lease on the item before the halt is lifted, the run record misses the session id or the journal path, or a lift leaves the item halted; why_new=#314 review note 8 and the Captain's halt (2026-11-10); seam=driver/stage.ts closeSession, open and serve; no_claim=the Captain's ruling, which the lane records elsewhere
  test("a close whose proxy finalize failed halts its item: the run record names the session and its journal, and no session or lease opens until the halt is lifted", async () => {
    const l = ledger(["sm-opus", "sm-particle"]);
    const served = await serve(l, [...OPUS_STAGE, { item: "sm-particle", arm: "sm-particle", model: "particle-ai/particle-1", arms: ARMS }]);
    const s1 = (await (await openA1(served.control, "u1")).json()) as Record<string, any>;
    expect((await closeWith(served.control, s1.id, true)).finalized).toBe(false);
    const journal = join(realpathSync(join(l.root, "run")), s1.lease_id + ".journal.ndjson");
    expect(runLines(l, "halt")).toEqual([expect.objectContaining({ item: "sm-opus", id: s1.id, lease_id: s1.lease_id, meter_id: s1.meter_id, journal })]);
    expect(existsSync(journal)).toBe(true);
    const again = await openA1(served.control, "u2");
    expect(again.status).toBe(423);
    expect(((await again.json()) as Record<string, any>).code).toBe("E_SM_FINALIZE_HALT");
    const other = await openA1(served.control, "u2", "particle-ai/particle-1");
    expect(other.status).toBe(200);
    expect((await closeWith(served.control, ((await other.json()) as Record<string, any>).id, false)).finalized).toBe(true);
    expect(await served.stop()).toBe(2);
    const relaunch = await serve(l, OPUS_STAGE).then(async (s) => (await s.stop(), "served"), (e: LedgerError) => e.code + " " + e.message);
    expect(relaunch).toStartWith("E_SM_FINALIZE_HALT line item sm-opus halted in run r1");
    expect(relaunch).toContain(s1.id);
    expect(relaunch).toContain(journal);
    expect(readItem(l.record, "sm-opus").leases.length).toBe(1);
    const lifted = await serve(l, OPUS_STAGE, { lift_halts: [s1.id] });
    expect(readItem(l.record, "sm-opus").leases.length).toBe(2);
    expect(runLines(l, "lift")).toEqual([expect.objectContaining({ item: "sm-opus", id: s1.id })]);
    const s2 = await openA1(lifted.control, "u2");
    expect(s2.status).toBe(200);
    expect((await closeWith(lifted.control, ((await s2.json()) as Record<string, any>).id, false)).finalized).toBe(true);
    expect(await lifted.stop()).toBe(0);
    l.db.close?.();
  });

  // Value: protects=the halt's exit and settled row when the stage is already draining (its lease is too short for another open), where E_SM_FINALIZE_HALT says the driver exits 2; fails_when=the halt line is written but the stage settles lease_expired and the driver exits 0; why_new=#318 /ship review (state-machines specialist, stage.ts drain); seam=driver/stage.ts closeSession and drain; no_claim=the halt on a serving stage (the test above)
  test("a halt on a stage already draining for its lease settles halted, and the driver exits 2", async () => {
    const l = ledger(["sm-opus"]);
    let clock = Date.now();
    const served = await serve(l, OPUS_STAGE, { now: () => clock });
    const s1 = (await (await openA1(served.control, "u1")).json()) as Record<string, any>;
    clock += 365 * 24 * 3600 * 1000;
    expect((await openA1(served.control, "u2")).status).toBe(503);
    expect((await closeWith(served.control, s1.id, true)).finalized).toBe(false);
    expect(runLines(l, "halt")).toEqual([expect.objectContaining({ item: "sm-opus", id: s1.id })]);
    expect(await served.stop()).toBe(2);
    expect(runLines(l, "settled")).toEqual([expect.objectContaining({ item: "sm-opus", ended: "halted" })]);
    l.db.close?.();
  });

  // Value: protects=--lift-halt's refusal of an id that names no standing halt (unknown, or already lifted), before any recovery or lease; fails_when=a stale or made-up lift opens a lease or writes a lift line; why_new=#318 /ship review (testing specialist, stage.ts --lift-halt); seam=driver/stage.ts serve; no_claim=the lift that succeeds (the test above)
  test("a --lift-halt naming no standing halt is refused before any lease opens", async () => {
    const l = ledger(["sm-opus"]);
    const served = await serve(l, OPUS_STAGE);
    const s1 = (await (await openA1(served.control, "u1")).json()) as Record<string, any>;
    expect((await closeWith(served.control, s1.id, true)).finalized).toBe(false);
    expect(await served.stop()).toBe(2);
    const lifted = await serve(l, OPUS_STAGE, { lift_halts: [s1.id] });
    expect(await lifted.stop()).toBe(0);
    const tried = (ids: string[]) => serve(l, OPUS_STAGE, { lift_halts: ids }).then(async (s) => (await s.stop(), "served"), (e: LedgerError) => e.code + " " + e.message);
    for (const id of [s1.id, "made-up"]) expect(await tried([id])).toStartWith("E_USAGE --lift-halt " + id + " names no halt still standing in run r1");
    expect(readItem(l.record, "sm-opus").leases.length).toBe(2);
    expect(runLines(l, "lift").length).toBe(1);
    l.db.close?.();
  });

  // Value: protects=every close whose proxy finalize ran, which the halt must leave alone; fails_when=a finalized close writes a halt, stops the stage or changes the driver's exit; why_new=the Captain's halt (2026-11-10), its other direction; seam=driver/stage.ts closeSession; no_claim=the close answer's figures (sm-driver.test.ts)
  test("a close whose proxy finalize ran writes no halt, and its stage keeps serving", async () => {
    const l = ledger(["sm-opus"]);
    const served = await serve(l, OPUS_STAGE);
    const s1 = (await (await openA1(served.control, "u1")).json()) as Record<string, any>;
    expect((await closeWith(served.control, s1.id, false)).finalized).toBe(true);
    expect(runLines(l, "halt")).toEqual([]);
    const s2 = await openA1(served.control, "u2");
    expect(s2.status).toBe(200);
    expect((await closeWith(served.control, ((await s2.json()) as Record<string, any>).id, false)).finalized).toBe(true);
    expect(await served.stop()).toBe(0);
    expect((await serve(l, OPUS_STAGE).then(async (s) => s.stop()))).toBe(0);
    l.db.close?.();
  });
});

// Value: protects=section 8's follow-on on a first stage that changed nothing: its tree is the base tree under an empty commit two and is scored like any other; fails_when=computeStart refuses an empty first-stage patch on A1 or S2, so that tree's three follow-ons are lost, or S0 takes a patch; why_new=the Captain's pre-data item 8 for #290; seam=followon.ts computeStart; no_claim=the start set itself, which sm-followon-docker.test.ts runs in Docker
test("an A1 or S2 first stage with an empty patch gets a follow-on start set, and S0 still takes no patch", () => {
  const dir = unitDir(scratch("start"), (u) => (u.oracle = { runs: [], stable: ["t1"], stable_sha256: "", f2p_ok: true, max_wall_ms: 0, verdict: "kept", smoke: null, leak: null, history: null }));
  for (const tree of ["A1", "S2"] as const) expect(() => computeStart({ unitDir: dir, tree, treePatch: "" })).toThrow(/^E_SM_UNIT .*has no runtime image/);
  expect(() => computeStart({ unitDir: dir, tree: "S0", treePatch: "diff --git a/x b/x\n" })).toThrow(/^E_SM_ARM S0 takes no first-stage patch/);
});

describe("stock diffs stay valid code (pre-data item 9)", () => {
  const has = (bin: string) => spawnSync("sh", ["-c", "command -v " + bin], { encoding: "utf8" }).status === 0;
  const dotnet = has("dotnet") ? spawnSync("dotnet", ["--version"], { encoding: "utf8" }).stdout.trim().split(".")[0] : null;
  const CSPROJ = '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net' + dotnet + '.0</TargetFramework><OutputType>Library</OutputType><ImplicitUsings>disable</ImplicitUsings><Nullable>disable</Nullable></PropertyGroup></Project>\n';
  const CASES: Array<{ lang: Lang; path: string; text: string[]; tool: string | null; check: (f: string, d: string) => string[] }> = [
    { lang: "go", path: "pkg/core/c.go", tool: "go", check: (f, d) => ["go", "build", "-o", join(d, "out"), f],
      text: ["package core", "", "func Count(items []int) int {", "\ttotal := 0", "\tfor _, v := range items {", "\t\ttotal += v", "\t}", "\treturn total", "}", "", "func Pair() struct {", "\tA int", "} {", "\treturn struct{ A int }{1}", "}"] },
    { lang: "rust", path: "src/lib.rs", tool: "rustc", check: (f, d) => ["rustc", "--edition", "2021", "--crate-type", "lib", "--emit=metadata", "-o", join(d, "out.rmeta"), f],
      text: ["pub const fn double(x: u32) -> u32 {", "    x * 2", "}", "", "pub fn sum(items: &[u32]) -> u32 {", "    let mut total = 0;", "    for v in items {", "        total += v;", "    }", "    total", "}"] },
    { lang: "java", path: "src/Counter.java", tool: "javac", check: (f, d) => ["javac", "-d", join(d, "out"), f],
      text: ["class Base {", "    Base(int n) {", "    }", "}", "", "public class Counter extends Base {", "    Counter() {", "        super(1);", "    }", "", "    int count(java.util.List<Integer> items) {", "        int size = items.size();", "        int total = size * 2;", "        return total;", "    }", "",
        "    int pick(int k) {", "        int result = 0;", "        switch (k) {", "            case 1:", "                result = 10;", "                break;", "            default:", "                result = 20;", "        }", "        return result;", "    }", "",
        "    void go(java.util.concurrent.ExecutorService ex) {", "        ex.submit(new Runnable() {", "            public void run() {", "                int k = 1;", "            }", "        });", "    }", "}"] },
    { lang: "c", path: "src/sum.c", tool: "gcc", check: (f) => ["gcc", "-fsyntax-only", "-std=c11", "-Werror=implicit-function-declaration", f],
      text: ["int sum(const int *items, int n) {", "    int total = 0;", "    for (int i = 0; i < n; i++) {", "        total += items[i];", "    }", "    return total;", "}"] },
    { lang: "cpp", path: "src/sum.cpp", tool: "g++", check: (f) => ["g++", "-fsyntax-only", "-std=c++17", f],
      text: ["#include <vector>", "", "int sum(const std::vector<int>& items) {", "    int total = 0;", "    for (int v : items) {", "        total += v;", "    }", "    return total;", "}"] },
    { lang: "csharp", path: "src/Counter.cs", tool: dotnet ? "dotnet" : null, check: (_f, d) => (writeFileSync(join(d, "x.csproj"), CSPROJ), ["dotnet", "build", "-nologo", "-v", "q", join(d, "x.csproj")]),
      text: ["public record Point(int X, int Y) {", "    public int Sum() {", "        return X + Y;", "    }", "}", "", "public class Counter {", "    public int Count(int[] items) {", "        int total = 0;", "        foreach (var v in items) {", "            total += v;", "        }", "        return total;", "    }", "",
        "    public int Pick(int k) {", "        int result = 0;", "        switch (k) {", "            case 1:", "                result = 10;", "                break;", "            default:", "                result = 20;", "                break;", "        }", "        return result;", "    }", "",
        "    public void Fill(System.Collections.Generic.List<Cell> cells) {", "        cells.Add(new Cell() {", "            V = 1", "        });", "    }", "}", "", "public class Cell { public int V; }"] },
    { lang: "js", path: "src/sum.mjs", tool: "node", check: (f) => ["node", "--check", f],
      text: ["export function sum(items) {", "  let total = 0;", "  for (const v of items) {", "    total += v;", "  }", "  return total;", "}"] },
    { lang: "ts", path: "src/read.ts", tool: "node", check: (f) => [join(ROOT, "node_modules/.bin/tsc"), "--noEmit", "--strict", "--target", "es2022", "--lib", "es2022,dom", "--types", "", f],
      text: ["interface Store {", "  load(): {", "    x: number;", "  };", "}", "", "export function read(s: Store): number {", "  const value = s.load().x;", "  return value;", "}"] },
    { lang: "python", path: "src/total.py", tool: "python3", check: (f) => ["python3", "-c", "import sys; compile(open(sys.argv[1]).read(), sys.argv[1], 'exec')", f],
      text: ["def total(items):", '  """Sum the items."""', "  result = 0", "  for v in items:", "    result += v", "  return result", ""] },
  ];
  const build = (c: (typeof CASES)[number], diff: string | null) => {
    const d = scratch("stock-" + c.lang);
    const f = join(d, c.path);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, c.text.join("\n"));
    if (diff !== null) {
      writeFileSync(join(d, "stock.patch"), diff);
      const a = spawnSync("git", ["apply", "stock.patch"], { cwd: d, encoding: "utf8" });
      if (a.status !== 0) return "does not apply: " + a.stderr.trim();
    }
    const argv = c.check(f, d);
    const r = spawnSync(argv[0]!, argv.slice(1), { cwd: d, encoding: "utf8", timeout: 300_000, env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: "1", DOTNET_NOLOGO: "1" } });
    return r.status === 0 ? "ok" : (r.stdout + r.stderr).trim().split("\n").slice(0, 4).join(" | ");
  };
  // Value: protects=a Python function's docstring staying its first statement under the logging diff, so __doc__ and doctests keep working; fails_when=the log line goes above the docstring; why_new=the /ship review of #314 (testing specialist on packets.ts); seam=packets.ts stockDiffs; no_claim=what a judge scores
  test("python: the logging diff keeps a docstring first, on one line or several", () => {
    const one = stockDiffs({ lang: "python", path: "t.py", text: ["def total(items):", '    """Sum the items."""', "    result = 0", "    return result", ""].join("\n") })[2]!.diff!;
    expect(one).toContain(' def total(items):\n     """Sum the items."""\n+    print("enter")');
    const many = stockDiffs({ lang: "python", path: "t.py", text: ["def total(items):", '    """Sum', "    the items.", '    """', "    return 0", ""].join("\n") })[2]!.diff!;
    expect(many).toContain('     the items.\n     """\n+    print("enter")');
  });

  for (const c of CASES) {
    // Value: protects=section 10's stock diffs as neutral code a judge can read as the same program: every kind applies to the unit's own file and still compiles or parses, and logging brings the header or import its call needs; fails_when=a log call goes in without its import or header, before a constructor's super call, into a const fn, an interface member or an anonymous struct type, at the wrong Python indent, or a rename reaches a member of another type; why_new=the Captain's pre-data item 9 for #290 (packets.ts stock diffs); seam=packets.ts stockDiffs; no_claim=a unit's real file, or what a judge scores
    test.skipIf(!c.tool || !has(c.tool))(c.lang + ": the base file and each of its three stock diffs apply and compile or parse", () => {
      const s = stockDiffs({ lang: c.lang, path: c.path, text: c.text.join("\n") });
      expect(s.map((x) => [x.kind, x.diff === null])).toEqual([["comments_whitespace", false], ["rename_only", false], ["logging", false]]);
      expect([build(c, null), ...s.map((x) => build(c, x.diff))]).toEqual(["ok", "ok", "ok", "ok"]);
    }, 600_000);
  }
});

describe("stock diffs stay valid code: the #314 follow-ups (GST-1959)", () => {
  const has = (bin: string) => spawnSync("sh", ["-c", "command -v " + bin], { encoding: "utf8" }).status === 0;
  const dotnet = has("dotnet") ? spawnSync("dotnet", ["--version"], { encoding: "utf8" }).stdout.trim().split(".")[0] : null;
  const KINDS = ["comments_whitespace", "rename_only", "logging"] as const;
  const stock = (lang: Lang, path: string, text: string[]) => Object.fromEntries(stockDiffs({ lang, path, text: text.join("\n") }).map((s) => [s.kind, s.diff])) as Record<StockKind, string | null>;
  const tree = (files: Record<string, string[]>, diff: string | null) => {
    const d = scratch("gst1959");
    for (const [p, t] of Object.entries(files)) {
      mkdirSync(dirname(join(d, p)), { recursive: true });
      writeFileSync(join(d, p), t.join("\n"));
    }
    if (diff === null) return { d, error: null };
    writeFileSync(join(d, "stock.patch"), diff);
    const a = spawnSync("git", ["apply", "stock.patch"], { cwd: d, encoding: "utf8" });
    return { d, error: a.status === 0 ? null : "does not apply: " + a.stderr.trim() };
  };
  /** "ok" when the files, with the diff applied, pass the check run in their dir, else the reason. */
  const passes = (files: Record<string, string[]>, diff: string | null, argv: (d: string) => string[]) => {
    const t = tree(files, diff);
    if (t.error) return t.error;
    const v = argv(t.d);
    const r = spawnSync(v[0]!, v.slice(1), { cwd: t.d, encoding: "utf8", timeout: 300_000, env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: "1", DOTNET_NOLOGO: "1", PYTHONDONTWRITEBYTECODE: "1" } });
    return r.status === 0 ? "ok" : (r.stdout + r.stderr).trim().split("\n").slice(0, 4).join(" | ");
  };
  /** The base file and each stock kind of path checked: "ok", "none" for a kind the file can't give, or the reason. */
  const every = (lang: Lang, files: Record<string, string[]>, path: string, argv: (d: string) => string[]) => {
    const s = stock(lang, path, files[path]!);
    return [passes(files, null, argv), ...KINDS.map((k) => (s[k] === null ? "none" : passes(files, s[k], argv)))];
  };
  const after = (path: string, text: string[], diff: string) => {
    const t = tree({ [path]: text }, diff);
    if (t.error) throw new Error(t.error);
    return readFileSync(join(t.d, path), "utf8").split("\n");
  };
  const gcc = (file: string) => (d: string) => ["gcc", "-fsyntax-only", "-std=c11", "-Werror=implicit-function-declaration", "-I", d, "-x", "c", join(d, file)];
  const pyc = (file: string) => () => ["python3", "-c", "import sys; compile(open(sys.argv[1]).read(), sys.argv[1], 'exec')", file];

  // Value: protects=section 10's logging stock diff in Java and C#, where an anonymous class or object initializer passed as an argument opens no method body; fails_when=a constructor call with nested parentheses (new Handler(Looper.getMainLooper()) {) reads as a method opener, so a log statement lands at class-member level or inside the initializer and the diff no longer compiles; why_new=the Captain's item 6 for GST-1959, Capy finding 01M730S3RJ7SYPBY0HH8CPGF17 on #314 (packets.ts:259); seam=packets.ts functionBodies; no_claim=an anonymous class whose constructor call spans lines
  test("java and c#: an anonymous class or object initializer whose constructor call nests parentheses gets no log line", () => {
    const java = ["class Looper {", "    static Object getMainLooper() {", "        return null;", "    }", "}", "", "class Handler {", "    Handler(Object o) {", "    }", "", "    void handle() {", "    }", "}", "",
      "public class Poster {", "    void post(java.util.List<Handler> hs) {", "        hs.add(new Handler(Looper.getMainLooper()) {", "            void handle() {", "                int k = 1;", "            }", "        });", "    }", "}", ""];
    const cs = ["public class Cell {", "    public int V;", "    public Cell(int v) {", "        V = v;", "    }", "}", "", "public class Grid {", "    static int Make() {", "        return 1;", "    }", "",
      "    public void Fill(System.Collections.Generic.List<Cell> cells) {", "        cells.Add(new Cell(Make()) {", "            V = 2", "        });", "    }", "}", ""];
    expect(stock("java", "src/Poster.java", java).logging).not.toContain("getMainLooper()) {\n+");
    expect(stock("csharp", "src/Grid.cs", cs).logging).not.toContain("new Cell(Make()) {\n+");
    if (has("javac")) expect(every("java", { "src/Poster.java": java }, "src/Poster.java", (d) => ["javac", "-d", join(d, "out"), "src/Poster.java"])).toEqual(["ok", "ok", "none", "ok"]);
    if (dotnet) {
      const csproj = '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net' + dotnet + '.0</TargetFramework><OutputType>Library</OutputType><ImplicitUsings>disable</ImplicitUsings><Nullable>disable</Nullable></PropertyGroup></Project>';
      expect(every("csharp", { "src/Grid.cs": cs, "x.csproj": [csproj] }, "src/Grid.cs", (d) => ["dotnet", "build", "-nologo", "-v", "q", join(d, "x.csproj")])).toEqual(["ok", "ok", "none", "ok"]);
    }
  }, 600_000);

  // Value: protects=section 10's logging stock diff in C, where a config.h first in the file sets the feature macros the system headers read; fails_when=stdio.h goes in above the project's first include, so the feature macros come too late and a POSIX call (strdup) is undeclared; why_new=the Captain's item 7 for GST-1959, the outside voice's first finding on #314 (packets.ts withHeader); seam=packets.ts stockDiffs and withHeader; no_claim=a project header that defines a macro named like a stdio.h function
  test("c: stdio.h goes after the includes before the first line of code, so a config.h that sets feature macros stays first", () => {
    const files = { "config.h": ["#define _POSIX_C_SOURCE 200809L", "#include <stdio.h>", ""], "src/dup.c": ["/* Copies strings. */", '#include "config.h"', "#include <string.h>", "", "char *dup(const char *s) {", "    char *copy = strdup(s);", "    return copy;", "}", ""] };
    expect(after("src/dup.c", files["src/dup.c"], stock("c", "src/dup.c", files["src/dup.c"]).logging!).slice(0, 4)).toEqual(["/* Copies strings. */", '#include "config.h"', "#include <string.h>", "#include <stdio.h>"]);
    if (has("gcc")) expect(every("c", files, "src/dup.c", gcc("src/dup.c"))).toEqual(["ok", "ok", "ok", "ok"]);
  });

  // Value: protects=section 10's logging stock diff in C and C++ files with an #ifndef block that sets a default before a platform #ifdef; fails_when=an #ifndef X / #define X / #endif read as the include guard puts stdio.h inside a later #ifdef _WIN32, so the diff no longer compiles on Linux; why_new=the Captain's item 11 for GST-1959, adversarial-native#3 on #314 (packets.ts withHeader); seam=packets.ts withHeader; no_claim=a guard opened after other directives
  test("c: an #ifndef block that only sets a default is no include guard, and a real guard still takes stdio.h inside it", () => {
    const fill = ["#ifndef BUFSZ", "#define BUFSZ 64", "#endif", "#ifdef _WIN32", "#include <windows.h>", "#endif", "", "int fill(char *b) {", "    int used = BUFSZ;", "    b[0] = 0;", "    return used;", "}", ""];
    expect(after("src/fill.c", fill, stock("c", "src/fill.c", fill).logging!).slice(0, 2)).toEqual(["#include <stdio.h>", "#ifndef BUFSZ"]);
    const sum = ["#ifndef SUM_H", "#define SUM_H", "", "#include <stddef.h>", "", "static inline int sum(const int *items, size_t n) {", "    int total = 0;", "    for (size_t i = 0; i < n; i++) {", "        total += items[i];", "    }", "    return total;", "}", "", "#endif", ""];
    expect(after("src/sum.h", sum, stock("c", "src/sum.h", sum).logging!).slice(0, 5)).toEqual(["#ifndef SUM_H", "#define SUM_H", "", "#include <stddef.h>", "#include <stdio.h>"]);
    if (has("gcc")) {
      expect(every("c", { "src/fill.c": fill }, "src/fill.c", gcc("src/fill.c"))).toEqual(["ok", "ok", "ok", "ok"]);
      expect(every("c", { "src/sum.h": sum }, "src/sum.h", gcc("src/sum.h"))).toEqual(["ok", "ok", "ok", "ok"]);
    }
  });

  // Value: protects=section 10's logging stock diff in Python, where a docstring can run on over lines through a backslash outside the string or inside it; fails_when=the log line goes in after the docstring's first physical line, inside the string expression, and the file no longer compiles; why_new=the Captain's item 8 for GST-1959, the outside voice's second finding on #314 (packets.ts logLine); seam=packets.ts functionBodies and logLine; no_claim=a docstring in parentheses
  test("python: a docstring continued by a backslash keeps the log line after its last line", () => {
    const outside = ["def total(items):", '    "Sum " \\', '        "the items."', "    result = 0", "    for v in items:", "        result += v", "    return result", ""];
    const inside = ["def total(items):", '    "Sum \\', 'the items."', "    result = 0", "    return result", ""];
    expect(stock("python", "t.py", outside).logging).toContain('         "the items."\n+    print("enter")');
    expect(stock("python", "t.py", inside).logging).toContain(' the items."\n+    print("enter")');
    if (has("python3")) for (const text of [outside, inside]) expect(every("python", { "t.py": text }, "t.py", pyc("t.py"))).toEqual(["ok", "ok", "ok", "ok"]);
  });

  // Value: protects=section 10's rename-only stock diff in Python as a refactor that keeps behavior; fails_when=a keyword argument on its own line in a multi-line call (timeout=30,) reads as the file's first local and is renamed, so the call raises TypeError; why_new=the Captain's item 9 for GST-1959, adversarial-native#1 on #314 (packets.ts:340); seam=packets.ts renameOnly; no_claim=keyword names built at run time (**kwargs)
  test("python: a keyword argument on its own line in a multi-line call is never renamed", () => {
    const text = ["def fetch(client):", "    client.configure(", "        timeout=30,", "    )", '    result = client.get("/items")', "    return result", ""];
    const r = stock("python", "t.py", text).rename_only!;
    expect(r).not.toContain("timeout_value");
    expect(r).toContain('+    result_value = client.get("/items")');
    const call = () => ["python3", "-c", "import runpy; ns = runpy.run_path('t.py'); C = type('C', (), {'configure': lambda self, timeout: setattr(self, 't', timeout), 'get': lambda self, p: (p, self.t)}); assert ns['fetch'](C()) == ('/items', 30)"];
    if (has("python3")) expect([passes({ "t.py": text }, null, call), passes({ "t.py": text }, r, call)]).toEqual(["ok", "ok"]);
  });

  // Value: protects=section 10's stock diffs as changes that keep every string the program prints or returns; fails_when=a use of the local inside a string that runs on over lines (a Python triple-quoted string, a Go raw string, a JavaScript template literal) is renamed, or a def inside a docstring takes a comment or log line; why_new=the Captain's item 10 for GST-1959, adversarial-native#2 on #314 (packets.ts code()); seam=packets.ts renameOnly and its line masking; no_claim=C# verbatim strings and C++ raw strings
  test("python, go and js: a local used inside a multi-line string is not renamed, and the next local is", () => {
    const cases: Array<[Lang, string, string[], string, string]> = [
      ["python", "t.py", ["def greet():", "    text = '''hello", "    text here'''", "    size = len(text)", "    return text, size", ""], "text_value", "size_value"],
      ["go", "c.go", ["package core", "", "func Banner() (string, int) {", "\tlabel := `title", "label here`", "\twidth := len(label)", "\treturn label, width", "}", ""], "labelValue", "widthValue"],
      ["js", "c.mjs", ["export function banner() {", "  const label = `title", "label here`;", "  const width = label.length;", "  return [label, width];", "}", ""], "labelValue", "widthValue"],
    ];
    for (const [lang, path, text, kept, renamed] of cases) {
      const r = stock(lang, path, text).rename_only;
      expect([lang, r?.includes(kept), r?.includes(renamed)]).toEqual([lang, false, true]);
    }
    const doc = ["def outer():", '    """Example:', "", "    def inner(x):", "        '''Doc.'''", "        return x", '    """', "    return 1", ""];
    for (const k of ["comments_whitespace", "logging"] as const) {
      const got = after("t.py", doc, stock("python", "t.py", doc)[k]!), at = got.indexOf(doc[1]!);
      expect(got.slice(at, at + 6)).toEqual(doc.slice(1, 7));
    }
  });
  // Value: protects=section 10's rename-only stock diff in JavaScript and TypeScript templates that nest, where a template inside another's ${} keeps its text and a use inside ${} is code; fails_when=the nested template's opening backtick reads as the outer one's close, its text reads as code, and a local named in that text is renamed with it, so the program returns other text; why_new=Capy finding 01M735TWT564TV5VRT8XCMPGFR on #316 (packets.ts codeLines); seam=packets.ts codeLines and renameOnly; no_claim=a tagged template's raw strings
  test("js: a template nested in another's ${} keeps its text out of the rename, and a use inside ${} is renamed", () => {
    const run = (text: string[], diff: string | null) => {
      const t = tree({ "c.mjs": text }, diff);
      if (t.error) return t.error;
      const r = spawnSync("node", ["-e", "import('./c.mjs').then((m) => console.log(JSON.stringify(m.render())))"], { cwd: t.d, encoding: "utf8" });
      return r.status === 0 ? r.stdout.trim() : "exit " + r.status + ": " + r.stderr.trim();
    };
    const nested = ["export function render() {", "  const template = `head ${`", "let count = 1; count`} template`;", "  let count = 2;", "  const width = count + 1;", "  return [template, count, width];", "}", ""];
    const inner = ["export function render() {", "  const person = 'you';", "  return `hi ${person} and ${`", "nested ${person}`}`;", "}", ""];
    const a = stock("js", "c.mjs", nested).rename_only, b = stock("js", "c.mjs", inner).rename_only;
    expect([a?.includes("countValue"), a?.includes("widthValue"), b?.includes("${personValue} and"), b?.includes("nested ${personValue}")]).toEqual([false, true, true, true]);
    if (has("node")) expect([run(nested, a ?? null), run(inner, b ?? null)]).toEqual([run(nested, null), run(inner, null)]);
  });
  // Value: protects=section 10's stock diffs as neutral controls in JavaScript and TypeScript files where a line inside a template looks like a function opener; fails_when=a line that ends inside a template, or that starts inside an open ${...} and ends in template text, takes a comment or log line, so the template's text and the program's output change while the file still parses; why_new=Capy finding 01M737G151WR5CBSQ5SR906NGN on #316 (packets.ts codeLines open flag); seam=packets.ts codeLines and functionBodies; no_claim=a function written inside ${...}, which these lines leave without a comment or log line
  test("js: a function-like line in a template's text, after a ${...} or where the template opens, takes no comment or log line", () => {
    const text = ["export function render(prefix) {", "  const source = `${prefix", "}(x) => {", "  body", "}`;", "  return source;", "}", "", "export function other() {", "  const words = `(y) => {", "  inside", "}`;", "  return words;", "}", ""];
    const out = (diff: string | null) => {
      const t = tree({ "c.mjs": text }, diff);
      if (t.error) return t.error;
      const r = spawnSync("node", ["-e", "import('./c.mjs').then((m) => console.log(JSON.stringify([m.render('p'), m.other()])))"], { cwd: t.d, encoding: "utf8" });
      return r.status === 0 ? r.stdout.trim().split("\n").at(-1) : "exit " + r.status + ": " + r.stderr.trim();
    };
    const s = stock("js", "c.mjs", text);
    expect(KINDS.map((k) => s[k] === null)).toEqual([false, false, false]);
    if (has("node")) expect(KINDS.map((k) => out(s[k]))).toEqual(KINDS.map(() => out(null)));
  });

  // Value: protects=section 10's stock diffs in Go files with rune literals, where brace depth decides each function body's end; fails_when=a rune literal '{' adds to the depth, the body runs to the end of the file, and the rename reaches a package-level variable another file uses; why_new=the Captain's item 17 for GST-1959, adversarial-native#9 on #314 (packets.ts:215); seam=packets.ts functionBodies and its line masking; no_claim=Rust char literals, which the Rust masking reads
  test("go: a rune literal '{' opens no block, so the rename stays in its own function", () => {
    const text = ["package core", "", "func Open(s string) int {", "\tcount := 0", "\tfor _, r := range s {", "\t\tif r == '{' {", "\t\t\tcount++", "\t\t}", "\t}", "\treturn count", "}", "", "var count = 1", "", "func More() int {", "\twidth := count", "\treturn width", "}", ""];
    const r = stock("go", "c.go", text).rename_only!;
    expect(r.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---"))).toEqual(["-\twidth := count", "-\treturn width"]);
    const other = ["package core", "", "func Other() int {", "\treturn count", "}", ""];
    if (has("go")) expect(every("go", { "c.go": text, "other.go": other }, "c.go", (d) => ["go", "build", "-o", join(d, "out"), join(d, "c.go"), join(d, "other.go")])).toEqual(["ok", "ok", "ok", "ok"]);
  }, 600_000);

  // Value: protects=section 10's rename-only stock diff as a refactor that keeps behavior when a block opens and closes on one line; fails_when=a declaration inside a one-line if or try block reads as a header declaration, its scope runs to the end of the line, and a later use there that names an outer binding is renamed, a ReferenceError a syntax check misses; why_new=the specialist red-team finding on #316 (packets.ts:430); seam=packets.ts renameOnly scope(); no_claim=a block that opens in a header's own parentheses (a lambda)
  test("a use after a one-line block closes is outside the local's scope, and a header declaration still renames its own block", () => {
    const js = ["export function f(ok) {", "  if (ok) { const count = 1; use(count); } return count;", "}", ""];
    const java = ["class C {", "  int f() {", "    try { int count = parse(); use(count); } catch (Exception e) { return count; }", "    return 0;", "  }", "}", ""];
    for (const [lang, path, text] of [["js", "c.mjs", js], ["ts", "c.ts", js], ["java", "C.java", java]] as const) {
      const r = stock(lang, path, [...text]).rename_only;
      expect(r === null || !/return countValue/.test(r)).toBe(true);
    }
    const header = ["export function g(xs) {", "  for (let step = 0; step < xs.length; step++) { use(xs[step], step); }", "  return xs;", "}", ""];
    expect(stock("js", "g.mjs", header).rename_only?.includes("for (let stepValue = 0; stepValue < xs.length; stepValue++) { use(xs[stepValue], stepValue); }")).toBe(true);
  });

  // Value: protects=section 10's rename-only stock diff in Go when the name is also a package-level variable in another file of the package; fails_when=a use of the name before the local's declaration, after its block ends, or in its own initializer refers to the package-level variable but is renamed, so the diff stops compiling; why_new=the Captain's item 18 for GST-1959, adversarial-native#10 on #314 (packets.ts renameOnly); seam=packets.ts renameOnly; no_claim=shadowing through forms LOCAL_NAME does not read (a range clause, a closure's parameter)
  test("go: a use outside the local's scope blocks the rename, and a name declared again in a later block is still renamed", () => {
    const other = ["package core", "", "var count = 10", ""];
    const blocked = [
      ["package core", "", "func Pick(ok bool) int {", "\tif ok {", "\t\tcount := 1", "\t\t_ = count", "\t}", "\treturn count", "}", ""],
      ["package core", "", "func Twice() int {", "\tn := count * 2", "\tcount := n", "\treturn count", "}", ""],
      ["package core", "", "func Bump() int {", "\tcount := count + 1", "\treturn count", "}", ""],
    ];
    for (const text of blocked) expect(stock("go", "c.go", text).rename_only).toBeNull();
    const again = ["package core", "", "func Sum(a, b []int) int {", "\tfor _, v := range a {", "\t\ttotal := v", "\t\t_ = total", "\t}", "\tfor _, v := range b {", "\t\ttotal := v", "\t\t_ = total", "\t}", "\treturn count", "}", ""];
    expect(stock("go", "c.go", again).rename_only!.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"))).toEqual(["+\t\ttotalValue := v", "+\t\t_ = totalValue", "+\t\ttotalValue := v", "+\t\t_ = totalValue"]);
    const build = (d: string) => ["go", "build", "-o", join(d, "out"), join(d, "c.go"), join(d, "other.go")];
    if (has("go")) {
      for (const text of blocked) expect(every("go", { "c.go": text, "other.go": other }, "c.go", build)).toEqual(["ok", "ok", "none", "ok"]);
      expect(every("go", { "c.go": again, "other.go": other }, "c.go", build)).toEqual(["ok", "ok", "ok", "ok"]);
    }
  }, 600_000);
});

describe.skipIf(process.env.GSTACK_EVALS_DOCKER !== "1")("a session record and A3's image through runSession, with Harbor stubbed (docker)", () => {
  const pid = process.pid;
  const d = (args: string[], input?: string) => spawnSync("docker", args, { encoding: "utf8", input, timeout: 900_000 });
  const tag = "sm-predata-git:" + pid;
  const id = "predata__run-" + pid;
  const built: string[] = [];
  let runtime = "";
  const root = scratch("run");
  const harbor = join(root, "harbor");
  writeFileSync(harbor, [
    "#!/usr/bin/env bash", "set -eu", "out=; prev=", "for a in \"$@\"; do [ \"$prev\" = -o ] && out=$a; prev=$a; done", "printf '%s\\n' \"$@\" > \"$SM_STUB_DIR/args\"",
    "ev=$out/job/trial/agent/evaluator", "[ \"$SM_STUB_MODE\" = none ] && exit 1", "mkdir -p \"$ev\"",
    "echo '{\"termination\":\"completed\",\"proxy\":{\"spent_micros\":null,\"requests\":null,\"ok_responses\":null,\"refused\":null,\"refusals\":null,\"allowance_stops\":null,\"unknown_micros\":null,\"unknown_calls\":null,\"finalized\":null}}' > \"$ev/real-summary.json\"",
    "echo '{\"event\":\"u4_slot\",\"lease_id\":\"l1\",\"meter_id\":\"m1\"}' > \"$ev/usersim-events.jsonl\"", "",
  ].join("\n"), { mode: 0o755 });
  beforeAll(() => {
    expect(d(["build", "-q", "-t", tag, "-"], "FROM " + PY_IMAGE + "\nRUN apt-get update -qq && apt-get install -y -qq --no-install-recommends git >/dev/null && rm -rf /var/lib/apt/lists/*\n").status).toBe(0);
    runtime = d(["image", "inspect", "--format", "{{.Id}}", tag]).stdout.trim();
    d(["volume", "create", treeVolume(id)]);
    expect(d(["run", "--rm", "--network", "none", "-v", treeVolume(id) + ":/d", "--entrypoint", "sh", tag, "-c", "cd /d && git init -q && mkdir src && echo 'fn reset() {}' > src/a.txt && git add -A && git -c user.name=t -c user.email=t@e commit -qm c0"]).status).toBe(0);
  }, 900_000);
  afterAll(() => {
    for (const t of [...built, tag]) d(["image", "rm", "-f", t]);
    d(["volume", "rm", "-f", treeVolume(id)]);
    delete process.env.SM_STUB_DIR;
    delete process.env.SM_STUB_MODE;
  });
  const unit = () => unitDir(scratch("run-unit"), (u) => Object.assign(u, { repo_dir: "/w", work_dir: "/w", scope: { dir: "src" }, image: { ...u.image, runtime_id: runtime } }), id);
  const run = (mode: string, cell: string, arm: string, extra: Record<string, string> = {}) => {
    const out = join(scratch("run-out"), "out");
    process.env.SM_STUB_DIR = dirname(out);
    process.env.SM_STUB_MODE = mode;
    const res = runSession({ unitDir: unit(), session: { unit: id, part: 1, index: 0, model: "claude-opus-5-5", cell, stage: "first", arm }, control: "http://127.0.0.1:1", proxy: "127.0.0.1:1", out, harbor, ...extra });
    built.push(res.image.tag);
    return { ...res, out, args: readFileSync(join(dirname(out), "args"), "utf8").split("\n") };
  };

  // Value: protects=a session record's spend when no close answer reached real-summary.json; fails_when=a missing summary, or a proxy block with every field null, is recorded as 0 micros spent; why_new=#290 named note 7 (run.ts spent_micros); seam=run.ts runSession's record; no_claim=the lease's spend, which the ledger keeps
  test("a session with no summary, or with an all-null proxy block, records its spend as unknown, never 0", () => {
    for (const mode of ["none", "nullproxy"]) {
      const r = run(mode, "A0", "sm:A0");
      expect(r.record).toMatchObject({ spent_micros: null, end: "infra", unknown_micros: 0, qa_home_sha256: null });
      expect(JSON.parse(readFileSync(join(r.out, "session.json"), "utf8")).spent_micros).toBeNull();
    }
  }, 900_000);

  // Value: protects=A3's session as built: the registry run.ts checks is the one real_agent reads, the task lists the home paths the build wrote, the session record keeps the home's digest, and the install's links and settings, written at /root, work there; fails_when=arms_path names another registry, task.json carries no qa_home, the record has no digest, a link dangles, a text file changes, or the host's .capy reaches /root; why_new=#290 named notes 1, 2 and 3, and the Captain's B2 (install at /root, digest in the run record); seam=run.ts runSession, image.ts buildSessionImage and qaHomeCopy; no_claim=a gstack install at the pin, or real_agent's check in a live container
  test("A3's image holds the install as written at /root and no .capy, and real_agent gets the same registry, the built home paths and the home's digest", () => {
    const reg = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
    reg.sm.pins.qa = { ...reg.sm.pins.qa, sha: "a".repeat(40) };
    const registry = join(root, "registry.json");
    writeFileSync(registry, JSON.stringify(reg));
    const home = join(root, "host-home");
    for (const p of [".claude/skills/gstack/qa", ".gstack", ".capy"]) mkdirSync(join(home, p), { recursive: true });
    writeFileSync(join(home, ".claude/skills/gstack/qa/SKILL.md"), "qa\n");
    symlinkSync("/root/.claude/skills/gstack/qa", join(home, ".claude/skills/qa"));
    writeFileSync(join(home, ".claude/settings.json"), JSON.stringify({ hook: "/root/.claude/skills/gstack/bin/hook" }) + "\n");
    writeFileSync(join(home, ".capy/git-shim.log"), "log\n");
    const r = run("nullproxy", "A3", "qa:told", { qaHome: home, qaSha: "a".repeat(40), registry });
    expect(r.args).toContain("arms_path=" + registry);
    expect(JSON.parse(readFileSync(join(r.out, "task.json"), "utf8"))).toMatchObject({ qa_sha: "a".repeat(40), qa_home: ["/root/.claude/skills", "/root/.gstack"] });
    expect(r.record.qa_home_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.record.qa_home_sha256).toBe(r.image.qa_home!.sha256);
    expect(JSON.parse(readFileSync(join(r.out, "session.json"), "utf8")).qa_home_sha256).toBe(r.image.qa_home!.sha256);
    const look = d(["run", "--rm", "--network", "none", "--entrypoint", "sh", r.image.image_id, "-c", "readlink /root/.claude/skills/qa; cat /root/.claude/skills/qa/SKILL.md; cat /root/.claude/settings.json; ls -A /root | grep -c '^.capy$' || true"]);
    expect(look.stdout.trim().split("\n")).toEqual(["/root/.claude/skills/gstack/qa", "qa", JSON.stringify({ hook: "/root/.claude/skills/gstack/bin/hook" }), "0"]);
  }, 900_000);

  // Value: protects=A3's session check on the /qa install: a home qa-install.sh hands back to the host user is root's in the image, as a root install's is, so real_agent's SM_CHECK reads the gstack checkout's commit; fails_when=the copy keeps the host uid, git refuses the checkout as another user's, SM_CHECK prints GSTACK none and real_agent refuses every A3 session; why_new=the PR's real install at the pin (C1, #314 note 4); seam=image.ts BUILD's copy of /sm-in/home, real_agent.py SM_CHECK; no_claim=a gstack install at the pin (the PR's real install covers it)
  test("A3's home is root's in the image, so real_agent's check reads the /qa checkout's commit", () => {
    const home = join(root, "owned-home");
    const gs = join(home, ".claude/skills/gstack");
    mkdirSync(gs, { recursive: true });
    writeFileSync(join(gs, "SKILL.md"), "gstack\n");
    const git = (args: string[]) => spawnSync("git", ["-C", gs, "-c", "user.name=t", "-c", "user.email=t@e", ...args], { encoding: "utf8" });
    expect(git(["init", "-q"]).status).toBe(0);
    expect(git(["add", "-A"]).status).toBe(0);
    expect(git(["commit", "-qm", "c0"]).status).toBe(0);
    const sha = git(["rev-parse", "HEAD"]).stdout.trim();
    const reg = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
    reg.sm.pins.qa = { ...reg.sm.pins.qa, sha };
    const registry = join(root, "owned-registry.json");
    writeFileSync(registry, JSON.stringify(reg));
    const r = run("nullproxy", "A3", "qa:told", { qaHome: home, qaSha: sha, registry });
    const smCheck = readFileSync(join(import.meta.dir, "../../lanes/real-outcome/agent/real_agent.py"), "utf8").match(/SM_CHECK = r"""([\s\S]*?)"""/)![1]!.replace("{repo}", "/w");
    const look = d(["run", "--rm", "--network", "none", "--entrypoint", "sh", r.image.image_id, "-c", smCheck]);
    expect(look.stdout.split("\n").filter((l) => l.startsWith("GSTACK "))).toEqual(["GSTACK " + sha]);
    const owners = d(["run", "--rm", "--network", "none", "--entrypoint", "sh", r.image.image_id, "-c", "find /root -maxdepth 4 ! -user 0 | head -3; stat -c %u:%g /root"]);
    expect(owners.stdout.trim()).toBe("0:0");
  }, 900_000);

  // Value: protects=the halt before any session: a session image whose store holds a commit past the base (packed and unreachable, so the build's commit count passes) is refused with E_SM_CONTAIN before Harbor runs, and sm contain writes one record line per check for a clean unit and fails the bad one; fails_when=runSession opens a session on that image, sm contain passes it, a clean unit fails, or the record misses a check; why_new=the Captain's containment scope for C1 (GSTA-2, 2026-11-10); seam=run.ts runSession, cli.ts sm contain, contain.ts containImage in the built image; no_claim=what a real SWE-rebench image holds (the PR's runs on real units)
  test("an image holding a later commit halts before Harbor with E_SM_CONTAIN, and sm contain records each check", async () => {
    const id2 = id + "-contain";
    d(["volume", "create", treeVolume(id2)]);
    try {
      const g = "git -c user.name=t -c user.email=t@e";
      expect(d(["run", "--rm", "--network", "none", "-v", treeVolume(id2) + ":/d", "--entrypoint", "sh", tag, "-c", "cd /d && git init -q && mkdir src && echo 'fn reset() {}' > src/a.txt && git add -A && " + g + " commit -qm c0 && git checkout -qb b2 && echo b > src/a.txt && " + g + " commit -qam c1 && git checkout -q - && git repack -a -d -q && git branch -q -D b2 && rm -rf .git/logs"]).status).toBe(0);
      const bad = unitDir(scratch("contain-bad"), (u) => Object.assign(u, { repo_dir: "/w", work_dir: "/w", scope: { dir: "src" }, image: { ...u.image, runtime_id: runtime } }), id2);
      const out = join(scratch("contain-run"), "out");
      process.env.SM_STUB_DIR = dirname(out);
      process.env.SM_STUB_MODE = "nullproxy";
      expect(() => runSession({ unitDir: bad, session: { unit: id2, part: 1, index: 0, model: "claude-opus-5-5", cell: "A0", stage: "first", arm: "sm:A0" }, control: "http://127.0.0.1:1", proxy: "127.0.0.1:1", out, harbor })).toThrow(/^E_SM_CONTAIN .* objects \(1: [0-9a-f]{40}\)/);
      expect(existsSync(join(dirname(out), "args"))).toBe(false);
      const rec = join(scratch("contain-rec"), "run.jsonl");
      const okOut = join(dirname(rec), "ok.json");
      expect(await main(["contain", "--unit", unit(), "--out", okOut, "--record", rec])).toBe(0);
      expect(JSON.parse(readFileSync(okOut, "utf8"))).toMatchObject({ schema: "sm-contain.v1", unit: id, ok: true });
      const badOut = join(dirname(rec), "bad.json");
      expect(await main(["contain", "--unit", bad, "--out", badOut, "--record", rec])).not.toBe(0);
      expect(JSON.parse(readFileSync(badOut, "utf8"))).toMatchObject({ unit: id2, ok: false });
      const lines = readFileSync(rec, "utf8").trim().split("\n").map((l) => JSON.parse(l));
      expect(lines.map((l) => [l.unit, l.image, l.check, l.ok])).toEqual([
        [id, "first", "refs", true], [id, "first", "objects", true], [id, "first", "stores", true], [id, "first", "scan", true],
        [id2, "first", "refs", true], [id2, "first", "objects", false], [id2, "first", "stores", true], [id2, "first", "scan", true],
      ]);
      expect(lines[3]).toMatchObject({ archives: expect.any(Number), archive_paths: expect.any(Array) });
    } finally {
      d(["volume", "rm", "-f", treeVolume(id2)]);
    }
  }, 900_000);
});


// Value: protects=the session workspace against the upstream fix reaching it as git objects or leftover files (GEVA-503: 12 of 40 SWE-rebench images carried the fix and its tests behind tags past the base, and particle-1 found them with git log --all in 19 of 160 sessions); fails_when=a ref, a commit object, another object store or a file outside the repo that holds a hidden test name or a test-side marker passes, a clean, follow-on or pinned A3 workspace fails, or a finding carries the test text instead of its sha256; why_new=the Captain's containment scope for C1 (GSTA-2, 2026-11-10); seam=contain.ts contain with sh/contain.sh on a fixture root; no_claim=what a real image holds (the PR's runs on real units)
describe("the containment check before any session (E_SM_CONTAIN)", () => {
  const NAME = "test_hidden_contain_probe";
  const MARK = '    assert contain_probe("x") == 42  # the hidden check';
  const git = (dir: string, ...args: string[]) => {
    const r = spawnSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@e", "-c", "init.defaultBranch=main", ...args], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  };
  const tree = (label: string) => {
    const root = scratch("contain-" + label);
    const w = join(root, "w");
    mkdirSync(w, { recursive: true });
    git(w, "init", "-q");
    writeFileSync(join(w, "a.py"), "def f():\n    return 1\n");
    git(w, "add", "-A");
    git(w, "commit", "-qm", "base");
    return { root, w, base: git(w, "rev-parse", "HEAD") };
  };
  const later = (w: string) => {
    writeFileSync(join(w, "a.py"), "def f():\n    return 2\n");
    git(w, "commit", "-qam", "fix");
    return git(w, "rev-parse", "HEAD");
  };
  const check = (t: { root: string; w: string; base: string }, o: { want?: string; qaPin?: string; names?: string[] } = {}) =>
    contain({ kind: "host", root: t.root, repo: t.w }, { want: o.want ?? t.base, names: o.names ?? [NAME], markers: [MARK], ...(o.qaPin ? { qaPin: o.qaPin } : {}) });
  const clean = { refs: { ok: true, findings: [] }, objects: { ok: true, findings: [] }, stores: { ok: true, findings: [] }, scan: { ok: true, findings: [] } };

  test("a clean one-commit tree and a two-commit follow-on tree pass every check, and archives outside the repo are only listed", () => {
    const t = tree("clean");
    mkdirSync(join(t.root, "opt"), { recursive: true });
    writeFileSync(join(t.root, "opt/dep.whl"), "PK");
    writeFileSync(join(t.w, "inside.zip"), "PK");
    expect(check(t)).toEqual({ ok: true, checks: clean, archives: ["/opt/dep.whl"] });
    const two = later(t.w);
    expect(check(t, { want: two })).toEqual({ ok: true, checks: clean, archives: ["/opt/dep.whl"] });
  });

  test("a tag past the base fails the refs check, peeled, and its commit fails the objects check", () => {
    const t = tree("tag");
    const fix = later(t.w);
    git(t.w, "tag", "-a", "v2", "-m", "release", fix);
    git(t.w, "reset", "-q", "--hard", t.base);
    const r = check(t);
    expect(r.ok).toBe(false);
    expect(r.checks.refs.ok).toBe(false);
    expect(r.checks.refs.findings).toContain("refs/tags/v2 " + fix);
    expect(r.checks.objects.findings).toEqual([fix]);
    git(t.w, "pack-refs", "--all");
    expect(check(t).checks.refs.findings).toContain("packed-refs " + fix);
  });

  test("an unreachable later commit inside a pack fails the objects check while every ref is clean", () => {
    const t = tree("pack");
    git(t.w, "checkout", "-qb", "b2");
    const fix = later(t.w);
    git(t.w, "checkout", "-q", "main");
    git(t.w, "repack", "-a", "-d", "-q");
    git(t.w, "branch", "-q", "-D", "b2");
    rmSync(join(t.w, ".git/logs"), { recursive: true, force: true });
    expect(git(t.w, "count-objects", "-v")).toMatch(/^in-pack: [1-9]/m);
    const r = check(t);
    expect(r.checks.refs).toEqual({ ok: true, findings: [] });
    expect(r.checks.objects).toEqual({ ok: false, findings: [fix] });
    expect(r.ok).toBe(false);
  });

  test("an alternates file, the alternates variable and a nested .git each fail the stores check", () => {
    const other = tree("alt-src");
    later(other.w);
    const t = tree("alt");
    writeFileSync(join(t.w, ".git/objects/info/alternates"), join(other.w, ".git/objects") + "\n");
    expect(check(t).checks.stores.findings).toContain("alternates /w/.git/objects/info/alternates");
    rmSync(join(t.w, ".git/objects/info/alternates"));
    process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES = join(t.root, "nowhere");
    try {
      expect(check(t).checks.stores.findings).toContain("env GIT_ALTERNATE_OBJECT_DIRECTORIES");
    } finally {
      delete process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES;
    }
    const lib = join(t.w, "vendor/lib");
    mkdirSync(lib, { recursive: true });
    git(lib, "init", "-q");
    writeFileSync(join(lib, "b.py"), "x = 1\n");
    git(lib, "add", "-A");
    git(lib, "commit", "-qm", "later");
    writeFileSync(join(t.w, ".gitmodules"), "[submodule]\n");
    const r = check(t);
    expect(r.checks.stores.ok).toBe(false);
    expect(r.checks.stores.findings).toEqual(expect.arrayContaining(["nested /w/vendor/lib/.git", "gitmodules /w/.gitmodules", "store /w/vendor/lib/.git"]));
    expect(check(t).ok).toBe(false);
  });

  test("a /tmp patch carrying a marker and a file outside the repo naming a hidden test fail the scan by path and sha256 only", () => {
    const t = tree("scan");
    writeFileSync(join(t.w, "b.py"), "def test_known_in_base():\n    pass\n");
    git(t.w, "add", "-A");
    git(t.w, "commit", "-qm", "base2");
    const base = git(t.w, "rev-parse", "HEAD");
    mkdirSync(join(t.root, "tmp"), { recursive: true });
    mkdirSync(join(t.root, "opt/left"), { recursive: true });
    writeFileSync(join(t.root, "tmp/fix.patch"), "--- a/t.py\n+++ b/t.py\n@@ -1 +1,2 @@\n+" + MARK + "\n");
    writeFileSync(join(t.root, "opt/left/test_x.py"), "def " + NAME + "():\n    pass\ndef test_known_in_base():\n    pass\n");
    const r = check({ ...t, base }, { names: [NAME, "test_known_in_base"] });
    expect(r.checks.scan.ok).toBe(false);
    expect(r.checks.scan.findings.sort()).toEqual(["marker /tmp/fix.patch sha256=" + sha(MARK), "name /opt/left/test_x.py sha256=" + sha(NAME)]);
    expect(JSON.stringify(r)).not.toContain(NAME);
    expect(JSON.stringify(r)).not.toContain("contain_probe");
    expect(r.ok).toBe(false);
  });

  test("A3's gstack checkout passes only at the /qa pin, and any other object store on the filesystem fails", () => {
    const t = tree("qa");
    const gs = join(t.root, "root/.claude/skills/gstack");
    mkdirSync(gs, { recursive: true });
    git(gs, "init", "-q");
    writeFileSync(join(gs, "SKILL.md"), "gstack\n");
    git(gs, "add", "-A");
    git(gs, "commit", "-qm", "pin");
    const pin = git(gs, "rev-parse", "HEAD");
    expect(check(t, { qaPin: pin })).toEqual({ ok: true, checks: clean, archives: [] });
    expect(check(t, { qaPin: "f".repeat(40) }).checks.stores).toEqual({ ok: false, findings: ["store /root/.claude/skills/gstack/.git"] });
    expect(check(t).checks.stores).toEqual({ ok: false, findings: ["store /root/.claude/skills/gstack/.git"] });
  });

  // Value: protects=the record and the E_SM_CONTAIN message when the check cannot read the repo; fails_when=a CHECK line that says fail reads as a passing check; why_new=Capy's review of #318; seam=contain.ts parseContain; no_claim=why a repo dir is missing
  test("a check the script reports as failed reads as failed, as do the checks that never ran", () => {
    const t = tree("norepo");
    const r = contain({ kind: "host", root: t.root, repo: join(t.root, "missing") }, { want: t.base, names: [NAME], markers: [MARK] });
    expect(r.ok).toBe(false);
    expect(Object.values(r.checks).map((c) => c.ok)).toEqual([false, false, false, false]);
  });

  test("the inputs are the FAIL_TO_PASS leaf names and the 30-code-point lines test.patch and fix-tests.patch add", () => {
    const dir = unitDir(scratch("contain-inputs"), (u) => { u.tests.f2p = ["tests/test_a.py::TestK::test_one[p1]", "src/lib.rs::tests::two", "testThree(com.x.FooTest)", "com.x.BarTest#testFour", "TestFive/sub_case"]; });
    const files = { "test.patch": "diff --git a/t b/t\n--- a/t\n+++ b/t\n@@ -0,0 +1,2 @@\n+short\n+" + MARK + "\n", "fix-tests.patch": "diff --git a/s b/s\n--- a/s\n+++ b/s\n@@ -0,0 +1 @@\n+        assert_eq!(parse_contain(\"y\"), Some(7));\n" };
    const u = JSON.parse(readFileSync(join(dir, "unit.json"), "utf8"));
    for (const [n, body] of Object.entries(files)) {
      writeFileSync(join(dir, n), body);
      u.files[n] = sha(body);
    }
    writeFileSync(join(dir, "unit.json"), JSON.stringify(u));
    expect(containInputs(dir)).toEqual({ names: ["test_one", "two", "testThree", "testFour", "sub_case"], markers: [MARK, '        assert_eq!(parse_contain("y"), Some(7));'] });
  });
});

const GO_IMAGE = process.env.SM_SCORE_GO_IMAGE ?? "";
describe.skipIf(!(process.env.GSTACK_EVALS_DOCKER === "1" && GO_IMAGE))("the stock build check in the unit's runtime image (GST-1959, docker, SM_SCORE_GO_IMAGE)", () => {
  const volumes: string[] = [];
  afterAll(() => volumes.forEach((v) => spawnSync("docker", ["volume", "rm", "-f", v])));
  const unit = (id: string, lang: Lang, files: Record<string, string>, rebuild: string[]) => {
    const u = scoreUnit({ id, lang, image: GO_IMAGE, files, tests: {}, commands: { rebuild, test: ["true"], print: [] }, f2p: ["t"], stable: ["t"], known: ["t"] });
    volumes.push(u.volume);
    return u;
  };
  const read = (r: ReturnType<typeof buildStock>) => r.kinds.map((k) => [k.kind, k.diff === null, k.build.replace(/^exits .*/, "exits")]);

  // Value: protects=section 10's stock diffs as code that builds in the unit's own runtime image before any judge sees them; fails_when=a kind that fails the unit's rebuild or the Python parse, or does not apply, still reaches a judge, or a kind stands when the control built nothing; why_new=the Captain's build check for GST-1959; seam=packets.ts buildStock; no_claim=a real unit's rebuild commands, or hardened mode (the scorer's Docker tests run root too)
  test("go and python: a kind that builds stands, one that fails to build or apply is null with its reason, and a control that builds nothing nulls every kind", () => {
    const go = ["package core", "", "func Count(items []int) int {", "\ttotal := 0", "\tfor _, v := range items {", "\t\ttotal += v", "\t}", "\treturn total", "}", ""].join("\n");
    const mod = "module example.com/core\n\ngo 1.16\n";
    const g = unit("stock-go", "go", { "go.mod": mod, "core.go": go }, ["cd /w && go build ./..."]);
    const gs = stockDiffs({ lang: "go", path: "core.go", text: go }).map((s) => (s.kind === "logging" ? { ...s, diff: s.diff!.replace('println("enter")', "println(enter)") } : s));
    const gr = buildStock(g.dir, "core.go", gs, { mode: "root", volume: g.volume });
    expect(gr.control).toEqual([0]);
    expect(read(gr)).toEqual([["comments_whitespace", false, "ok"], ["rename_only", false, "ok"], ["logging", true, "exits"]]);

    const py = ["def total(items):", "    result = 0", "    for v in items:", "        result += v", "    return result", ""].join("\n");
    const p = unit("stock-py", "python", { "src/total.py": py }, []);
    const ps = stockDiffs({ lang: "python", path: "src/total.py", text: py }).map((s) =>
      s.kind === "logging" ? { ...s, diff: s.diff!.replace('+    print("enter")', '+  print("enter")') } : s.kind === "comments_whitespace" ? { ...s, diff: s.diff!.replace(" def total(items):", " def other(items):") } : s);
    const pr = buildStock(p.dir, "src/total.py", ps, { mode: "root", volume: p.volume });
    expect([pr.commands.length, pr.control]).toEqual([1, [0]]);
    expect(read(pr)).toEqual([["comments_whitespace", true, "does not apply"], ["rename_only", false, "ok"], ["logging", true, "exits"]]);

    const n = unit("stock-none", "go", { "go.mod": mod, "core.go": go }, ["cd /w && false"]);
    expect(buildStock(n.dir, "core.go", stockDiffs({ lang: "go", path: "core.go", text: go }), { mode: "root", volume: n.volume }).kinds.map((k) => [k.diff, k.build])).toEqual(Array(3).fill([null, "the control passes no command: exits 1"]));
  }, 900_000);
});

describe("stock diffs keep the program's behavior: the #316 follow-ups (GST-1959)", () => {
  const has = (bin: string) => spawnSync("sh", ["-c", "command -v " + bin], { encoding: "utf8" }).status === 0;
  const rename = (lang: Lang, path: string, text: string[]) => stockDiffs({ lang, path, text: text.join("\n") }).find((s) => s.kind === "rename_only")!.diff;
  /** argv run in a scratch dir holding the files, with the diff applied when one is given: its output, or why it failed. */
  const run = (files: Record<string, string[]>, diff: string | null, argv: string[]) => {
    const d = scratch("gst1959-behavior");
    for (const [p, t] of Object.entries(files)) {
      mkdirSync(dirname(join(d, p)), { recursive: true });
      writeFileSync(join(d, p), t.join("\n"));
    }
    if (diff !== null) {
      writeFileSync(join(d, "stock.patch"), diff);
      const a = spawnSync("git", ["apply", "stock.patch"], { cwd: d, encoding: "utf8" });
      if (a.status !== 0) return "does not apply: " + a.stderr.trim();
    }
    const r = spawnSync(argv[0]!, argv.slice(1), { cwd: d, encoding: "utf8", timeout: 300_000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
    return r.status === 0 ? r.stdout.trim() : "exit " + r.status + ": " + (r.stdout + r.stderr).trim().split("\n").slice(0, 3).join(" | ");
  };
  /** A JavaScript module's call under node, or a TypeScript one's under bun, run where the module is c<ext>. */
  const call = (ext: string, expr: string) => [...(ext === ".ts" ? [process.execPath] : ["node", "--input-type=module"]), "-e", "const m = await import('./c" + ext + "'); console.log(JSON.stringify(" + expr + "))"];

  // Value: protects=section 10's rename-only stock diff as a refactor that keeps behavior when a for, if, while, try, using or catch header declares the local; fails_when=the header's scope runs to the end of its line, or to the close of a one-line block that opened before the header on the same line, so a later use that names an outer binding (a global, an inherited field, a package variable in another file) is renamed; why_new=the deferred adversarial finding at packets.ts:415 on #316 and its fix-check note; seam=packets.ts renameOnly scope(); no_claim=an if header's else branch, which this scope leaves out
  test("a header declaration's scope ends with the block or statement its header opens, wherever the line starts", () => {
    const line = (decl: string) => ["    for (" + decl + " total = 0; total < 3; total++) { g(total); } total = 5;"];
    const cases: Array<[Lang, string, string[]]> = [
      ["js", "c.mjs", ["export function f() {", ...line("let"), "}", "function g(x) {}", ""]],
      ["ts", "c.ts", ["export function f(): void {", ...line("let"), "}", "function g(x: number) {}", ""]],
      ["java", "C.java", ["class C extends Base {", "  void f() {", ...line("int"), "  }", "  void g(int x) {}", "}", ""]],
      ["c", "c.c", ["#include \"glob.h\"", "", "void f(void) {", ...line("int"), "}", ""]],
      ["cpp", "c.cpp", ["#include \"glob.h\"", "", "void f() {", ...line("int"), "}", ""]],
      ["csharp", "C.cs", ["class C : Base {", "  void F() {", ...line("int"), "  }", "  void g(int x) {}", "}", ""]],
      ["js", "o.mjs", ["export function f(ok) {", "  if (ok) { for (let count = 0; count < 3; count++) {", "    g(count);", "  }", "  use(count); }", "}", ""]],
      ["java", "O.java", ["class O extends Base {", "  void f(boolean ok) {", "    if (ok) { for (int count = 0; count < 3; count++) {", "      g(count);", "    }", "    use(count); }", "  }", "}", ""]],
    ];
    expect(cases.map(([lang, path, text]) => [path, rename(lang, path, text)])).toEqual(cases.map(([, path]) => [path, null]));
    const go = ["package core", "", "func F(ok bool) int {", "\tif ok { for count := 0; count < 3; count++ {", "\t\t_ = count", "\t}", "\treturn count }", "\treturn 0", "}", ""];
    expect(rename("go", "c.go", go)).toBeNull();
    if (has("go")) expect(run({ "c.go": go, "other.go": ["package core", "", "var count = 10", ""], "go.mod": ["module example.com/core", "", "go 1.16", ""] }, null, ["go", "build", "./..."])).toBe("");
    const own = ["export function g(xs) {", "  for (let step = 0; step < xs.length; step++) {", "    use(xs[step], step);", "  }", "  return xs;", "}", ""];
    expect(rename("js", "g.mjs", own)).toContain("+  for (let stepValue = 0; stepValue < xs.length; stepValue++) {\n+    use(xs[stepValue], stepValue);");
  }, 600_000);

  // Value: protects=section 10's rename-only stock diff in Go switch and select statements, where each case clause is its own block; fails_when=a local declared in one case clause keeps its scope into the next clause, so a use there that names a package variable in another file is renamed and the diff stops compiling; why_new=the deferred adversarial finding at packets.ts:415 on #316 (a scope that runs past its declaration's block); seam=packets.ts renameOnly scope(); no_claim=a select clause's receive declaration, which this scope never renames
  test("go: a local declared in a case clause stays in its clause", () => {
    const text = ["package core", "", "func Pick(k int) int {", "\tswitch k {", "\tcase 1:", "\t\tcount := 5", "\t\treturn count", "\tcase 2:", "\t\treturn count", "\t}", "\treturn 0", "}", ""];
    expect(rename("go", "c.go", text)).toBeNull();
    if (has("go")) expect(run({ "c.go": text, "other.go": ["package core", "", "var count = 10", ""], "go.mod": ["module example.com/core", "", "go 1.16", ""] }, null, ["go", "build", "./..."])).toBe("");
  }, 600_000);

  // Value: protects=section 10's rename-only stock diff in Rust and C++, where a declaration's scope starts after its whole statement or ends with the braceless statement it is; fails_when=a Rust let's scope starts at its first line break, so a use of an outer binding on the statement's next line is renamed, or a C++ declaration that is an if's braceless body keeps a scope to the end of the enclosing block; why_new=the deferred adversarial finding at packets.ts:415 on #316; seam=packets.ts renameOnly scope(); no_claim=a Rust let-else, whose else block this scope leaves out
  test("rust and c++: a let's scope starts after its statement, and a braceless body's declaration ends with it", () => {
    expect(rename("rust", "src/lib.rs", ["pub fn f(xs: &[u32]) -> u32 {", "    let total = xs.len() as u32", "        + total;", "    total", "}", ""])).toBeNull();
    const cpp = ["#include \"glob.h\"", "", "int pick(bool ok) {", "    if (ok)", "        int total = 1;", "    return total;", "}", ""];
    expect(rename("cpp", "pick.cpp", cpp)).toBeNull();
    if (has("g++")) expect(run({ "pick.cpp": cpp, "glob.h": ["extern int total;", ""] }, null, ["g++", "-fsyntax-only", "-std=c++17", "pick.cpp"])).toBe("");
  });

  // Value: protects=section 10's rename-only stock diff in Python, where a class body is no function scope and a parameter's name is part of how callers call it; fails_when=a class attribute is renamed with the method uses that name a global, or a nested function's or lambda's parameter is renamed, so a call by keyword raises TypeError; why_new=the deferred adversarial finding at packets.ts:415 on #316 (the Captain asked for every language the rename handles); seam=packets.ts renameOnly; no_claim=names reached through locals() or vars()
  test("python: a class attribute and a nested function's or lambda's parameter are never renamed", () => {
    const cls = ["from cfg import *", "", "", "def make():", "    class Counter:", "        total = 0", "", "        def get(self):", "            return total", "", "    return Counter", ""];
    const param = ["def make():", "    total = 0", "    def add(total):", "        return total + 1", "    return add", ""];
    const lam = ["def make():", "    total = 0", "    step = lambda total, by: total + by", "    return step", ""];
    expect([rename("python", "t.py", cls), rename("python", "t.py", param)]).toEqual([null, null]);
    const l = rename("python", "t.py", lam);
    expect([l?.includes("total_value"), l?.includes("step_value")]).toEqual([false, true]);
    if (has("python3")) {
      const call = (c: string) => ["python3", "-c", "import t; print(" + c + ")"];
      expect(run({ "t.py": cls, "cfg.py": ["total = 10", ""] }, null, call("t.make()().get()"))).toBe("10");
      expect(run({ "t.py": param }, null, call("t.make()(total=4)"))).toBe("5");
      expect([run({ "t.py": lam }, null, call("t.make()(total=1, by=2)")), run({ "t.py": lam }, l!, call("t.make()(total=1, by=2)"))]).toEqual(["3", "3"]);
    }
  });

  // Value: protects=section 10's rename-only stock diff in JavaScript and TypeScript as a refactor that keeps what the code does, where the rebuild check gives only node --check; fails_when=a rename the line rules allow still changes behavior: a destructured property's binding, an object method or class field in the local's scope, a regular expression, JSX text, a function's inferred name, a TypeScript parameter property, or a name a direct eval reads; why_new=the Captain's item 2 for GST-1959 (a JS or TS behavioural check for rename controls, after #316's review); seam=packets.ts renameOnly and bindcheck.ts; no_claim=messages of errors the code throws, which can quote source text
  test("js and ts: a rename that would change what the code does is never made, and a plain one still is", () => {
    const cases: Array<[Lang, string, string[], string | null, string]> = [
      ["js", ".mjs", ["export function pick(opts) {", "  let total = 1;", "  {", "    const { total = 5 } = opts;", "    return total;", "  }", "}", ""], "m.pick({ total: 7 })", "7"],
      ["js", ".mjs", ["export function make() {", "  let total = 0;", "  total += 1;", "  return { total() { return 2; } };", "}", ""], "m.make().total()", "2"],
      ["js", ".mjs", ["export function count(s) {", "  const word = 'x';", "  return (s.match(/word/g) || []).length + word.length;", "}", ""], "m.count('word word')", "3"],
      ["js", ".mjs", ["export function named() {", "  const handler = () => 1;", "  return handler.name;", "}", ""], "m.named()", '"handler"'],
      ["js", ".mjs", ["export function calc(code) {", "  let total = 2;", "  return eval(code);", "}", ""], "m.calc('total * 3')", "6"],
      ["js", ".mjs", ["export function calc(code) {", "  let total = 2;", "  return (eval)(code);", "}", ""], "m.calc('total * 3')", "6"],
      ["ts", ".ts", ["export function calc(code: string) {", "  let total = 2;", "  return (eval as any)(code);", "}", ""], "m.calc('total * 3')", "6"],
      ["ts", ".ts", ["export function make() {", "  let total = 1;", "  class Box {", "    constructor(public total) {}", "  }", "  return new Box(total);", "}", ""], "m.make().total", "1"],
      ["js", ".jsx", ["export function Title() {", "  const label = 'Hi';", "  return <h1>label {label.toUpperCase()}</h1>;", "}", ""], null, ""],
    ];
    expect(cases.map(([lang, ext, text]) => [text[1], rename(lang, "c" + ext, text)])).toEqual(cases.map(([, , text]) => [text[1], null]));
    for (const [, ext, text, expr, out] of cases) if (expr && (ext === ".ts" || has("node"))) expect(run({ ["c" + ext]: text }, null, call(ext, expr))).toBe(out);
    const plain = ["export function sum(items: number[]): number {", "  let total = 0;", "  for (const v of items) {", "    total += v;", "  }", "  const label = `sum ${total}`;", "  return label.length + total;", "}", ""];
    const r = rename("ts", "c.ts", plain);
    expect(r).toContain("+  let totalValue = 0;");
    expect(run({ "c.ts": plain }, r, call(".ts", "m.sum([1, 2, 3])"))).toBe(run({ "c.ts": plain }, null, call(".ts", "m.sum([1, 2, 3])")));
  }, 120_000);

  // Value: protects=section 10's rename-only control in JavaScript and TypeScript when the binder check cannot run; fails_when=a child that fails or prints nothing reads as a file with no safe rename, or as a safe one; why_new=the testing finding on bindcheck.ts:22 in this PR's /ship review; seam=bindcheck.ts checkRename; no_claim=why the child failed
  test("a JavaScript or TypeScript rename check that cannot run refuses with E_SM_PACKET", () => {
    expect(() => checkRename({ path: "", before: "let a = 1;", after: "let aValue = 1;", name: "a", renamed: "aValue" })).toThrow(/^E_SM_PACKET /);
  });

  // Value: protects=a run host's Docker volumes when the stock build check's tree copy fails; fails_when=copyVolume creates the copy volume and then its copy fails before the try that drops it, so the volume stays behind; why_new=the deferred adversarial finding at packets.ts:520 on #316; seam=packets.ts buildStock; no_claim=a volume left by a Docker daemon that stops answering
  test("the stock build check drops its copy volume when the copy into it fails", () => {
    const root = scratch("stock-volume");
    const stub = join(root, "bin");
    mkdirSync(stub);
    writeFileSync(join(stub, "docker"), ["#!/bin/sh", "echo \"$*\" >> \"$DOCKER_CONFIG/calls\"", "[ \"$1\" = run ] && exit 1", "exit 0", ""].join("\n"), { mode: 0o755 });
    const dir = unitDir(root, (u) => Object.assign(u, { image: { ...u.image, runtime_id: "sha256:" + "d".repeat(64) }, commands: { ...u.commands, rebuild: ["true"] }, repo_dir: "/w", work_dir: "/w" }));
    const script = "import { buildStock } from " + JSON.stringify(join(ROOT, "lanes/outcome-skills/statemachines/packets.ts")) + "; try { buildStock(" + JSON.stringify(dir) + ", 'src/lib.rs', [{ kind: 'logging', diff: null }], { mode: 'root', volume: 'sm-tree-stub' }); } catch (e) { console.log(e.message.split(' ')[0]); }";
    const r = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", env: { ...process.env, PATH: stub + ":" + process.env.PATH, DOCKER_CONFIG: root } });
    expect(r.stdout.trim()).toBe("E_SM_HISTORY");
    const calls = readFileSync(join(root, "calls"), "utf8").trim().split("\n");
    const made = calls.find((c) => c.startsWith("volume create "))!.slice("volume create ".length);
    expect(calls.at(-1)).toBe("volume rm -f " + made);
  });

  // Value: protects=the stock-build and judge-key records, which name the unit the stock diffs came from; fails_when=sm packets stock builds in one unit's image and records the stock under another --unit, or sm packets labelled keeps the last unit_dir of a unit listed twice or builds a spec entry in another unit's dir; why_new=the deferred adversarial finding at cli.ts:363 on #316; seam=cli.ts sm packets stock and labelled; no_claim=a unit dir whose tree and file list belong to another unit
  test("sm packets stock and labelled refuse a unit that is not the one in its unit dir, and labelled refuses a unit listed twice", async () => {
    const root = scratch("unit-checks");
    const dir = unitDir(root), id = fixtureRow().instance_id;
    const tree = join(root, "tree");
    mkdirSync(join(tree, "src"), { recursive: true });
    writeFileSync(join(tree, "src/lib.rs"), "pub fn f() -> u32 {\n    let total = 1;\n    total\n}\n");
    writeFileSync(join(root, "files.txt"), "src/lib.rs\n");
    const err = async (argv: string[]) => {
      const errs: string[] = [];
      const orig = console.error;
      console.error = (...a: unknown[]) => void errs.push(a.join(" "));
      try {
        return { code: await main(argv), err: errs[0] ?? "" };
      } finally {
        console.error = orig;
      }
    };
    const stock = await err(["packets", "stock", "--lang", "rust", "--tree", tree, "--file", "src/lib.rs", "--files", join(root, "files.txt"), "--unit", "other__unit-1", "--unit-dir", dir, "--model", "claude-opus-5-5", "--out-dir", join(root, "out")]);
    expect(stock).toEqual({ code: 2, err: "E_USAGE --unit other__unit-1 is not the unit in --unit-dir, which holds " + id });
    const entry = (unit: string) => ({ unit, unit_dir: dir, lang: "rust", tree, file: "src/lib.rs", files: join(root, "files.txt") });
    for (const [spec, want] of [[[entry(id), entry(id)], "E_USAGE spec lists " + id + " more than once"], [[entry("other__unit-1")], "E_USAGE spec entry other__unit-1 is not the unit in its unit_dir, which holds " + id]] as const) {
      writeFileSync(join(root, "spec.json"), JSON.stringify(spec));
      expect(await err(["packets", "labelled", "--spec", join(root, "spec.json"), "--out-dir", join(root, "lab")])).toEqual({ code: 2, err: want });
    }
    expect(existsSync(join(root, "out")) || existsSync(join(root, "lab"))).toBe(false);
  });
});
