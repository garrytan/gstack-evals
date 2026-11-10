// Copyright (c) 2026 Garry Tan. MIT License.
// The ten items #290 left to fix before any family SM data: the seven named notes in its body (A3's home links and home
// check, one registry for the /qa pin, scoring only scorable first stages, the SM stage's model, a failed proxy finalize
// and an unknown spend), an empty first stage's follow-on tree, and stock diffs that stay valid in every language. Each
// test failed on the merged harness (d85f75a). No key, no paid call; the stock diffs compile with the toolchains present.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { recordProgram } from "../../src/runner/ledger/envelope.ts";
import { recordApproval, settleLease } from "../../src/runner/ledger/ledger.ts";
import { LocalLedger } from "../../src/runner/ledger/local.ts";
import { closeOpenSessions, meterFigures } from "../../src/runner/ledger/sessions.ts";
import { readItem, type LedgerError } from "../../src/runner/ledger/record.ts";
import { MeteringProxy } from "../../src/runner/proxy/metering-proxy.ts";
import { REGISTRY_PATH } from "../../lanes/outcome-skills/arms/registry.ts";
import { serveStages, type StageSpec } from "../../lanes/outcome-skills/driver/stage.ts";
import { main } from "../../lanes/outcome-skills/statemachines/cli.ts";
import { fixtureRow } from "../../lanes/outcome-skills/statemachines/fixtures.ts";
import { CONTAIN_SCRIPT, contain, containInputs, parseContain } from "../../lanes/outcome-skills/statemachines/contain.ts";
import { computeStart } from "../../lanes/outcome-skills/statemachines/followon.ts";
import { qaHomeCopy } from "../../lanes/outcome-skills/statemachines/image.ts";
import type { Lang } from "../../lanes/outcome-skills/statemachines/langs.ts";
import { stockDiffs } from "../../lanes/outcome-skills/statemachines/packets.ts";
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

  const launchTry = (l: ReturnType<typeof ledger>, extra: { lift_halts?: string[] } = {}) => serve(l, OPUS_STAGE, extra).then(async (s) => (await s.stop(), "served"), (e: LedgerError) => e.code + " " + e.message);
  const fileLines = (l: ReturnType<typeof ledger>) => readFileSync(join(l.root, "run", "sessions.jsonl"), "utf8").split("\n").filter(Boolean);
  const indexOf = (all: string[], event: string, id: string) => all.findIndex((x) => { const e = JSON.parse(x); return e.event === event && e.id === id; });

  // Value: protects=the finalize halt across a crash between its two lines: the halt goes to disk (fsynced) before the close, so a crash between them leaves a standing halt, never a close with no halt; fails_when=the close line is written first, so a sessions.jsonl cut after it lets the relaunch serve the item; why_new=#318 deferred finding (outside voice and native adversarial, stage.ts:509), the Captain's pre-run list item 4; seam=driver/stage.ts closeSession and serve, with sessions.jsonl cut where a crash would leave it; no_claim=a power loss inside the halt's own write, which leaves neither line
  test("a crash between the halt line and the close line keeps the halt, because the halt is on disk first", async () => {
    const l = ledger(["sm-opus"]);
    const served = await serve(l, OPUS_STAGE);
    const s1 = (await (await openA1(served.control, "u1")).json()) as Record<string, any>;
    expect((await closeWith(served.control, s1.id, true)).finalized).toBe(false);
    expect(await served.stop()).toBe(2);
    const file = join(l.root, "run", "sessions.jsonl");
    const all = fileLines(l);
    expect(indexOf(all, "halt", s1.id)).toBeLessThan(indexOf(all, "close", s1.id));
    writeFileSync(file, all.slice(0, Math.min(indexOf(all, "halt", s1.id), indexOf(all, "close", s1.id)) + 1).join("\n") + "\n");
    const relaunch = await launchTry(l);
    expect(relaunch).toStartWith("E_SM_FINALIZE_HALT line item sm-opus halted in run r1");
    expect(relaunch).toContain(s1.id);
    expect(readItem(l.record, "sm-opus").leases.length).toBe(1);
    l.db.close?.();
  });

  // Value: protects=the driver's exit when a finalize halt lands on a stage already draining for its cap stop: the stage keeps cap_stop (its lease settles with the stop's scope) and the driver exits 2, as E_SM_FINALIZE_HALT says; fails_when=the driver exits 0 after a halt, or the settled row loses its cap stop; why_new=Capy finding 01M73CFWQ5H4WR50GAYPG0KCSR on #318 (stage.ts:514), the Captain's pre-run list item 4; seam=driver/stage.ts closeSession, capStop and finish; no_claim=a halt on a serving stage (the halt test above)
  test("a halt on a stage draining for its cap stop keeps the cap stop, and the driver exits 2", async () => {
    const l = ledger(["sm-opus"]);
    const served = await serve(l, OPUS_STAGE);
    const live: Array<Record<string, any>> = [];
    for (const k of ["u1", "u2", "u3", "u4", "u5", "u6"]) {
      const r = await openA1(served.control, k);
      expect(r.status).toBe(200);
      live.push((await r.json()) as Record<string, any>);
    }
    expect((await openA1(served.control, "u7")).status).toBe(409);
    expect((await closeWith(served.control, live[0]!.id, true)).finalized).toBe(false);
    for (const s of live.slice(1)) expect((await closeWith(served.control, s.id, false)).finalized).toBe(true);
    expect(await served.done).toBe(2);
    expect(runLines(l, "halt")).toEqual([expect.objectContaining({ item: "sm-opus", id: live[0]!.id })]);
    expect(runLines(l, "settled")).toEqual([expect.objectContaining({ item: "sm-opus", ended: "cap_stop" })]);
    expect(readItem(l.record, "sm-opus").leases[0]!.close?.cap_stop).toBeTruthy();
    l.db.close?.();
  });

  /** Launches the driver in a child process, opens one A1 session on it, then kills the child with kill -9 while the session is live. */
  const crashLive = async (l: ReturnType<typeof ledger>, key: string) => {
    const at = (p: string) => JSON.stringify(join(import.meta.dir, "../..", p));
    const child = join(l.root, "child-" + key + ".ts");
    writeFileSync(child, [
      "import { serveStages } from " + at("lanes/outcome-skills/driver/stage.ts") + ";",
      "import { LocalLedger } from " + at("src/runner/ledger/local.ts") + ";",
      'const fetch = async (_url: string, init: RequestInit) => Response.json({ id: "msg_1", type: "message", role: "assistant", model: JSON.parse(String(init.body)).model, content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });',
      "const served = await serveStages({ record: " + JSON.stringify(l.record) + ", local: LocalLedger.open(" + JSON.stringify(join(l.root, "ledger.sqlite")) + '), run_id: "r1", envelope_host: "m1", machine: "m1", stages: ' + JSON.stringify(OPUS_STAGE) + ', host: "127.0.0.1", dir: ' + JSON.stringify(join(l.root, "run")) + ', fetch, requireAdmission: () => null, env: { ANTHROPIC_API_KEY: "upstream-key" }, log: () => {} });',
      'console.log("CONTROL " + served.control);',
      "await new Promise(() => {});",
    ].join("\n"));
    const proc = Bun.spawn(["bun", child], { stdout: "pipe", stderr: "pipe" });
    const reader = proc.stdout.getReader();
    let out = "";
    while (!out.includes("\n")) {
      const { value, done } = await reader.read();
      if (done) break;
      out += new TextDecoder().decode(value);
    }
    const control = out.match(/CONTROL (\S+)/)?.[1];
    expect(control).toBeDefined();
    const opened = await openA1(control!, key);
    expect(opened.status).toBe(200);
    const s = (await opened.json()) as Record<string, any>;
    proc.kill(9);
    await proc.exited;
    expect(readItem(l.record, "sm-opus").open?.lease_id).toBe(s.lease_id);
    return s;
  };

  // Value: protects=section 6's one retry after a driver crash: a session the driver never closed itself (crash recovery closes it as recovered, or ledger settle closes it as settled) has unknown allowance stops, like a failed finalize, so its item halts at the relaunch before any lease opens and waits for the Captain's ruling on the journal; fails_when=the relaunch serves the item (so the infra end's retry spends with no halt), the halt goes to disk after the recovered close, or a lift leaves the item halted; why_new=#318 deferred finding (Red Team, stage.ts:315), the Captain's pre-run list item 5; seam=driver/stage.ts serve's recovery, with the driver killed by kill -9 in a child process; no_claim=how real_agent ends the session (its proxy block is all null when no close answer comes, so sessionEnd reads infra)
  test("a session the driver never closed itself, after a kill -9, halts its item at the relaunch until --lift-halt, whether recovery or ledger settle closes it", async () => {
    const l = ledger(["sm-opus"]);
    const s1 = await crashLive(l, "u1");
    const relaunch = await launchTry(l);
    expect(relaunch).toStartWith("E_SM_FINALIZE_HALT line item sm-opus halted in run r1");
    expect(relaunch).toContain(s1.id);
    const all = fileLines(l);
    expect(JSON.parse(all[indexOf(all, "halt", s1.id)]!)).toMatchObject({ item: "sm-opus", lease_id: s1.lease_id, meter_id: s1.meter_id, cause: "recovered" });
    expect(indexOf(all, "halt", s1.id)).toBeLessThan(indexOf(all, "close", s1.id));
    expect(JSON.parse(all[indexOf(all, "close", s1.id)]!).reason).toBe("recovered");
    expect(readItem(l.record, "sm-opus").leases.map((x) => x.close?.how ?? "open")).toEqual(["settled"]);
    const lifted = await serve(l, OPUS_STAGE, { lift_halts: [s1.id] });
    expect(await lifted.stop()).toBe(0);
    expect(readItem(l.record, "sm-opus").leases.length).toBe(2);

    const s2 = await crashLive(l, "u2");
    const lease = readItem(l.record, "sm-opus").open!;
    settleLease(l.record, l.db, lease.lease_id, () => {});
    expect(closeOpenSessions(lease, "settled", meterFigures(l.db, lease.lease_id), new Date())).toBe(1);
    const afterSettle = await launchTry(l);
    expect(afterSettle).toStartWith("E_SM_FINALIZE_HALT line item sm-opus halted in run r1");
    expect(afterSettle).toContain(s2.id);
    expect(readItem(l.record, "sm-opus").leases.length).toBe(3);
    expect(await (await serve(l, OPUS_STAGE, { lift_halts: [s2.id] })).stop()).toBe(0);
    l.db.close?.();
  }, 60_000);
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

  const commitBase = (t: { root: string; w: string; base: string }, files: Record<string, string>) => {
    for (const [p, body] of Object.entries(files)) writeFileSync(join(t.w, p), body);
    git(t.w, "add", "-A");
    git(t.w, "commit", "-qm", "base2");
    return { ...t, base: git(t.w, "rev-parse", "HEAD") };
  };

  // Value: protects=the stores check against a git object store that has no HEAD file (a packed or loose cache, the kind an alternates file reads), and against a store that only an alternates file or GIT_ALTERNATE_OBJECT_DIRECTORIES names; fails_when=such a store passes, or a cache that only looks like hex (npm's index-v5, a webpack .pack) fails a clean tree; why_new=#318 deferred finding (outside voice, contain.sh:49), the Captain's pre-run list item 1; seam=contain.ts contain with sh/contain.sh on a fixture root; no_claim=what a real image holds (the Captain's runs on the three dry-run units)
  test("an object store with no HEAD file fails the stores check, packed or loose, and so does every store an alternates file or the alternates variable reaches", () => {
    const src = tree("nohead-src");
    later(src.w);
    git(src.w, "repack", "-a", "-d", "-q");
    const loose = tree("nohead-loose");
    later(loose.w);
    const t = tree("nohead");
    cpSync(join(src.w, ".git/objects/pack"), join(t.root, "opt/cache/objects/pack"), { recursive: true });
    expect(check(t).checks.stores).toEqual({ ok: false, findings: ["objects /opt/cache/objects"] });
    rmSync(join(t.root, "opt"), { recursive: true, force: true });
    cpSync(join(loose.w, ".git/objects"), join(t.root, "srv/objects"), { recursive: true });
    expect(check(t).checks.stores).toEqual({ ok: false, findings: ["objects /srv/objects"] });
    rmSync(join(t.root, "srv"), { recursive: true, force: true });
    mkdirSync(join(t.root, "empty/objects"), { recursive: true });
    writeFileSync(join(t.w, ".git/objects/info/alternates"), join(t.root, "empty/objects") + "\n" + join(src.w, ".git/objects") + "\n");
    expect(check(t).checks.stores).toEqual({ ok: false, findings: ["alternates /w/.git/objects/info/alternates", "reached /empty/objects", "reached " + join(src.w, ".git/objects")] });
    rmSync(join(t.w, ".git/objects/info/alternates"));
    process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES = join(t.root, "empty/objects") + ":" + join(src.w, ".git/objects");
    try {
      expect(check(t).checks.stores).toEqual({ ok: false, findings: ["env GIT_ALTERNATE_OBJECT_DIRECTORIES", "reached /empty/objects", "reached " + join(src.w, ".git/objects")] });
    } finally {
      delete process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES;
    }
    const c = tree("nohead-clean");
    mkdirSync(join(c.root, "root/.npm/_cacache/index-v5/ab/cd"), { recursive: true });
    writeFileSync(join(c.root, "root/.npm/_cacache/index-v5/ab/cd", "e".repeat(60)), "{}\n");
    mkdirSync(join(c.root, "opt/app/node_modules/.cache/webpack/default"), { recursive: true });
    writeFileSync(join(c.root, "opt/app/node_modules/.cache/webpack/default/0.pack"), "x\n");
    expect(check(c)).toEqual({ ok: true, checks: clean, archives: [] });
  });

  // Value: protects=the refs, objects and scan checks against a tool that fails: a git listing that exits non-zero, or a grep that cannot read what it scans, must fail its check instead of reading as an empty, clean listing; fails_when=a failed git for-each-ref, git rev-list or scan grep leaves its check passing; why_new=#318 deferred findings (security specialist, contain.sh:37; Red Team and native adversarial, contain.sh:66), the Captain's pre-run list item 2; seam=contain.ts contain with sh/contain.sh, a git on PATH that fails for-each-ref, a pack index cut short under a later commit (git cat-file then lists nothing from that pack and still exits 0), and a grep on PATH that fails the scan's calls; no_claim=which real failures a real image can raise
  test("a git listing or a scan grep that fails reads as a failed check, never as clean", () => {
    const shims = scratch("tool-shims");
    const shimmed = <T>(tool: string, when: string, f: () => T): T => {
      const real = spawnSync("sh", ["-c", "command -v " + tool], { encoding: "utf8" }).stdout.trim();
      const dir = join(shims, tool);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, tool), "#!/bin/sh\ncase \" $* \" in " + when + ") exit 2;; esac\nexec " + real + " \"$@\"\n", { mode: 0o755 });
      const path = process.env.PATH;
      process.env.PATH = dir + ":" + path;
      try {
        return f();
      } finally {
        process.env.PATH = path;
      }
    };
    const t = tree("toolerr");
    const r = shimmed("git", '*" for-each-ref "*', () => check(t));
    expect(r.checks.refs).toEqual({ ok: false, findings: ["error git for-each-ref"] });
    expect([r.ok, r.checks.objects.ok, r.checks.stores.ok, r.checks.scan.ok]).toEqual([false, true, true, true]);

    const p = tree("badidx");
    git(p.w, "checkout", "-qb", "b2");
    const fix = later(p.w);
    git(p.w, "checkout", "-q", "main");
    expect(spawnSync("git", ["-C", p.w, "pack-objects", "--revs", "-q", join(p.w, ".git/objects/pack/pack")], { input: fix + "\n^" + p.base + "\n" }).status).toBe(0);
    git(p.w, "prune-packed");
    git(p.w, "branch", "-q", "-D", "b2");
    rmSync(join(p.w, ".git/logs"), { recursive: true, force: true });
    const idx = join(p.w, ".git/objects/pack", readdirSync(join(p.w, ".git/objects/pack")).find((n) => n.endsWith(".idx"))!);
    chmodSync(idx, 0o644);
    writeFileSync(idx, readFileSync(idx).subarray(0, 100));
    const o = check(p);
    expect(o.checks.objects.ok).toBe(false);
    expect(o.checks.objects.findings).toContain("error git cat-file");
    expect([o.ok, o.checks.refs.ok]).toEqual([false, true]);

    const g = tree("grepfail");
    mkdirSync(join(g.root, "opt"), { recursive: true });
    writeFileSync(join(g.root, "opt/dep.py"), "x = 1\n");
    const s = shimmed("grep", '*" -H "*', () => check(g));
    expect(s.checks.scan).toEqual({ ok: false, findings: ["error grep markers", "error grep names"] });
    expect([s.ok, s.checks.refs.ok, s.checks.objects.ok, s.checks.stores.ok]).toEqual([false, true, true, true]);
  });

  // Value: protects=clean trees from failing on files the check cannot read: an unreadable file or dir is skipped and listed by path, never failed and never read as an error; fails_when=an unreadable file or dir fails a clean tree, raises an error line, or goes unlisted; why_new=the Captain's pre-run list item 2 (fail closed without failing clean units); seam=contain.ts contain with sh/contain.sh as a user that cannot read the files; no_claim=root in a session image, which reads every file (the docker test drops root's read override to show it there)
  test.skipIf(process.getuid?.() === 0)("a file or dir the check can't read is skipped and listed, and never fails a clean tree", () => {
    const t = commitBase(tree("unreadable"), { ".gitignore": "target/\n" });
    mkdirSync(join(t.root, "opt/locked"), { recursive: true });
    writeFileSync(join(t.root, "opt/locked/t.py"), "x = 1\n");
    writeFileSync(join(t.root, "opt/secret.txt"), "x = 2\n");
    mkdirSync(join(t.w, "target"), { recursive: true });
    writeFileSync(join(t.w, "target/cache.bin"), "x = 3\n");
    const locked = [join(t.root, "opt/secret.txt"), join(t.w, "target/cache.bin"), join(t.root, "opt/locked")];
    for (const p of locked) chmodSync(p, 0);
    try {
      expect(check(t)).toEqual({ ok: true, checks: clean, archives: [], unreadable: ["/opt/locked", "/opt/secret.txt", "/w/target/cache.bin"] });
    } finally {
      for (const p of locked) chmodSync(p, 0o755);
    }
  });

  // Value: protects=the scan of the repo's own leftovers: every file in the repo that git does not track (ignored build output, dependency trees and test caches, and plain untracked files) is scanned, and tracked base files are not; fails_when=an ignored or untracked file in the repo naming a hidden test or holding a marker passes, or a tracked base file is scanned; why_new=#318 deferred finding (Red Team, contain.sh:57), the Captain's pre-run list item 3; seam=contain.ts contain with sh/contain.sh on a fixture root; no_claim=what a real image's repo holds
  test("files in the repo that git does not track are scanned, ignored ones included, and tracked base files are not", () => {
    const t = commitBase(tree("untracked"), { ".gitignore": "target/\nnode_modules/\n.pytest_cache/\n", "b.py": MARK + "  # a longer base line\n" });
    mkdirSync(join(t.w, "target/debug"), { recursive: true });
    writeFileSync(join(t.w, "target/debug/leak.txt"), "fn " + NAME + "() {}\n");
    mkdirSync(join(t.w, "node_modules/x"), { recursive: true });
    writeFileSync(join(t.w, "node_modules/x/t.js"), MARK + "\n");
    mkdirSync(join(t.w, ".pytest_cache/v/cache"), { recursive: true });
    writeFileSync(join(t.w, ".pytest_cache/v/cache/nodeids"), JSON.stringify(["tests/test_a.py::" + NAME]) + "\n");
    writeFileSync(join(t.w, "notes.txt"), NAME + "\n");
    const r = check(t);
    expect(r.checks.scan).toEqual({ ok: false, findings: ["marker /w/node_modules/x/t.js sha256=" + sha(MARK), "name /w/.pytest_cache/v/cache/nodeids sha256=" + sha(NAME), "name /w/notes.txt sha256=" + sha(NAME), "name /w/target/debug/leak.txt sha256=" + sha(NAME)] });
    expect([r.ok, r.checks.refs.ok, r.checks.objects.ok, r.checks.stores.ok]).toEqual([false, true, true, true]);
  });
});


// Value: protects=sh/contain.sh as it runs in a real session image (Debian's git, grep and find, as root): a git store with no HEAD file fails the stores check, an ignored file in the repo naming a hidden test fails the scan, a grep that fails fails the scan, and a clean tree stays clean, also when root cannot read a file (its read override dropped); fails_when=any of those passes, or the unreadable file fails the clean tree; why_new=the Captain's pre-run list (a docker test for contain.sh covering a no-HEAD store, a tool error, an unreadable file and an ignored file holding a hidden name); seam=contain.ts contain (docker kind) and the script run directly with --cap-drop DAC_OVERRIDE and DAC_READ_SEARCH; no_claim=the three dry-run units, which the Captain runs on their own images
describe.skipIf(process.env.GSTACK_EVALS_DOCKER !== "1")("contain.sh in a real container (docker)", () => {
  const NAME = "test_hidden_contain_probe";
  const MARK = '    assert contain_probe("x") == 42  # the hidden check';
  const d = (args: string[], input?: string) => spawnSync("docker", args, { encoding: "utf8", input, timeout: 900_000 });
  const pid = process.pid;
  const base = "sm-contain-docker-base:" + pid;
  const tag = (k: string) => "sm-contain-docker-" + k + ":" + pid;
  const git = "git -c user.name=t -c user.email=t@e";
  const CASES: Record<string, string> = {
    clean: "",
    nohead: "RUN git init -q /s && cd /s && echo later > l.txt && git add l.txt && " + git + " commit -qm later && git repack -a -d -q && mkdir -p /opt/cache/objects && cp -r .git/objects/pack /opt/cache/objects/ && rm -rf /s",
    ignored: "RUN echo 'fn " + NAME + "() {}' > /w/target/leak.rs",
    grepfail: "RUN printf '#!/bin/sh\\ncase \" $* \" in *\" -H \"*) exit 2;; esac\\nexec /usr/bin/grep \"$@\"\\n' > /usr/local/bin/grep && chmod 755 /usr/local/bin/grep",
  };
  const want: Record<string, string> = {};
  beforeAll(() => {
    expect(d(["build", "-q", "-t", base, "-"], "FROM " + PY_IMAGE + "\nRUN apt-get update -qq && apt-get install -y -qq --no-install-recommends git >/dev/null && rm -rf /var/lib/apt/lists/*\nRUN mkdir /w && cd /w && git init -q && printf 'def f():\\n    return 1\\n' > a.py && printf 'target/\\n' > .gitignore && git add -A && " + git + " commit -qm base && mkdir target && echo built > target/build.log\nRUN mkdir -p /opt/locked && echo 'x = 1' > /opt/locked/t.py && chown -R 4321 /opt/locked && chmod 700 /opt/locked && echo 'x = 2' > /opt/secret.txt && chmod 000 /opt/secret.txt\n").status).toBe(0);
    for (const [k, run] of Object.entries(CASES)) {
      expect(d(["build", "-q", "-t", tag(k), "-"], "FROM " + base + "\n" + run + "\n").status).toBe(0);
      want[k] = d(["run", "--rm", "--network", "none", "--entrypoint", "git", tag(k), "-C", "/w", "rev-parse", "HEAD"]).stdout.trim();
    }
  }, 900_000);
  afterAll(() => {
    for (const k of Object.keys(CASES)) d(["image", "rm", "-f", tag(k)]);
    d(["image", "rm", "-f", base]);
  });
  const inside = (k: string) => contain({ kind: "docker", image: tag(k), repoDir: "/w" }, { want: want[k]!, names: [NAME], markers: [MARK] });
  const clean = { refs: { ok: true, findings: [] }, objects: { ok: true, findings: [] }, stores: { ok: true, findings: [] }, scan: { ok: true, findings: [] } };

  test("a clean tree passes as root, and with root's read override dropped its unreadable file and dir are listed, never failed", () => {
    const root = inside("clean");
    expect([root.ok, root.checks, root.unreadable]).toEqual([true, clean, undefined]);
    const inDir = scratch("contain-docker-in");
    chmodSync(inDir, 0o755);
    for (const [n, body] of Object.entries({ want: want.clean + "\n", names: NAME + "\n", markers: MARK + "\n", qa_pin: "" })) writeFileSync(join(inDir, n), body, { mode: 0o644 });
    const r = d(["run", "--rm", "--network", "none", "--user", "0:0", "--cap-drop", "DAC_OVERRIDE", "--cap-drop", "DAC_READ_SEARCH", "-v", inDir + ":/sm-in:ro", "--entrypoint", "bash", tag("clean"), "-c", CONTAIN_SCRIPT, "bash", "/w", "/sm-in", "/"]);
    expect(r.status).toBe(0);
    const p = parseContain(r.stdout);
    expect([p.ok, p.checks]).toEqual([true, clean]);
    expect(p.unreadable).toEqual(expect.arrayContaining(["/opt/locked", "/opt/secret.txt"]));
  }, 900_000);

  test("a git object store with no HEAD file fails the stores check", () => {
    const r = inside("nohead");
    expect(r.checks.stores).toEqual({ ok: false, findings: ["objects /opt/cache/objects"] });
    expect([r.ok, r.checks.refs.ok, r.checks.objects.ok, r.checks.scan.ok]).toEqual([false, true, true, true]);
  }, 900_000);

  test("an ignored file in the repo naming a hidden test fails the scan", () => {
    const r = inside("ignored");
    expect(r.checks.scan).toEqual({ ok: false, findings: ["name /w/target/leak.rs sha256=" + sha(NAME)] });
    expect([r.ok, r.checks.refs.ok, r.checks.objects.ok, r.checks.stores.ok]).toEqual([false, true, true, true]);
  }, 900_000);

  test("a grep that fails during the scan fails the scan instead of reading as clean", () => {
    const r = inside("grepfail");
    expect(r.checks.scan).toEqual({ ok: false, findings: ["error grep markers", "error grep names"] });
    expect([r.ok, r.checks.refs.ok, r.checks.objects.ok, r.checks.stores.ok]).toEqual([false, true, true, true]);
  }, 900_000);
});
