// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyVerifyPatch, CONFIG, configProblems, contractOf, envProblems, gitBlob, hookProblems, JUDGE_RISKY, JUDGE_STOP, judgeInputs, judgeTarCheck, judgeTarProblems, keyHits, patchedProblems, RISKY_SOURCE, stripSnapshot, vendoredVerify } from "../../lanes/harness-mechanics/arms.ts";
import { session } from "../../lanes/harness-mechanics/match.ts";
import { REPLAY_JUDGE, REPO, VERIFY_PATCH } from "../../lanes/harness-mechanics/pins.ts";
import { judgeTarFixture, PLACEHOLDER_BAND, sha } from "./judge-tar-fixture.ts";
import { checkContract, parseTranscript } from "../../lanes/harness-mechanics/vendor/gstack/lib/skill-contract.ts";

describe("verify-hook patch", () => {
  test("the committed patch is its digest and the vendored verify/SKILL.md is the pin's blob", () => {
    expect(createHash("sha256").update(readFileSync(join(REPO, VERIFY_PATCH.file))).digest("hex")).toBe(VERIFY_PATCH.sha256);
    expect(gitBlob(vendoredVerify())).toBe(VERIFY_PATCH.pinBlob);
  });
  test("it applies, drops the clause and gstack's validateContract accepts section 6's item", () => {
    const out = applyVerifyPatch(vendoredVerify()).toString("utf8");
    expect(patchedProblems(out)).toEqual([]);
    expect(out.includes(VERIFY_PATCH.clause)).toBe(false);
    expect(vendoredVerify().toString("utf8").includes(VERIFY_PATCH.clause)).toBe(true);
  });
  test("the pin as shipped has no contract, so patchedProblems flags it", () => {
    const pin = vendoredVerify().toString("utf8");
    expect(contractOf(pin)).toBeNull();
    expect(patchedProblems(pin).length).toBeGreaterThan(0);
  });
  test("a changed byte in the input is refused by its blob", () => {
    const b = Buffer.from(vendoredVerify());
    b[50] = b[50]! ^ 1;
    expect(() => applyVerifyPatch(b)).toThrow(/E_HM_PIN/);
  });
  test("gstack refuses a doctored contract kind", () => {
    const out = applyVerifyPatch(vendoredVerify()).toString("utf8").replace("kind: check_after_last_edit", "kind: check_after_any_edit");
    const c = contractOf(out);
    expect(c && "error" in c).toBe(true);
  });
  test("gstack's checker with the patched contract: a test run after the edit meets it, a version probe does not", () => {
    const c = contractOf(applyVerifyPatch(vendoredVerify()).toString("utf8"));
    if (!c || !("contract" in c)) throw new Error("no contract");
    expect(checkContract(parseTranscript(session("python -m pytest -q tests/test_app.py")), "verify", c.contract).met).toBe(true);
    expect(checkContract(parseTranscript(session("pytest --version")), "verify", c.contract).met).toBe(false);
  });
});

describe("arm config and hooks", () => {
  test("routing off everywhere, contracts on only in hook", () => {
    expect(configProblems("prose", { skill_routing: "off", skill_contracts: "off" })).toEqual([]);
    expect(configProblems("hook", { skill_routing: "off", skill_contracts: "on" })).toEqual([]);
    expect(configProblems("prose", { skill_routing: "off", skill_contracts: "on" }).length).toBe(1);
    expect(configProblems("hook", { skill_routing: "on", skill_contracts: "on" }).length).toBe(1);
  });
  test("the contract Stop hook is registered once", () => {
    const h = { event: "Stop", _gstack_source: "gstack-skill-contract", command: "x", timeout: 10 };
    expect(hookProblems("prose", [h])).toEqual([]);
    expect(hookProblems("hook", []).length).toBe(1);
  });
});

describe("judge tar", () => {
  const stop = { event: "Stop", _gstack_source: "gstack-skill-contract", command: JUDGE_STOP, timeout: 60 };
  const risky = { event: "PreToolUse", _gstack_source: RISKY_SOURCE, command: JUDGE_RISKY, timeout: 60 };
  test("judge's gstack config is verify-hook's", () => {
    expect(CONFIG.judge).toEqual(CONFIG.hook);
    expect(configProblems("judge", { skill_routing: "off", skill_contracts: "on" })).toEqual([]);
    expect(configProblems("judge", { skill_routing: "off", skill_contracts: "off" }).length).toBe(1);
  });
  test("the contract Stop entry once, running the judge's stop, and one PreToolUse risky entry", () => {
    expect(hookProblems("judge", [stop, risky])).toEqual([]);
    expect(hookProblems("judge", [stop, stop, risky]).length).toBe(1);
    expect(hookProblems("judge", [{ ...stop, command: "<HOME>/.claude/skills/gstack/hosts/claude/hooks/skill-contract-stop-hook" }, risky]).length).toBe(1);
    expect(hookProblems("judge", [stop]).length).toBe(1);
    expect(hookProblems("judge", [stop, risky, risky]).length).toBe(1);
    expect(hookProblems("hook", [stop])).toEqual([]);
  });
  test("keyHits names key shapes and env key values, never the values", () => {
    const v = "stub-typesafe-key-0123456789";
    expect(keyHits(Buffer.from("nothing here"), [["TYPESAFE_API_KEY", v]])).toEqual([]);
    expect(keyHits(Buffer.from("x " + v + " y"), [["TYPESAFE_API_KEY", v]])).toEqual(["TYPESAFE_API_KEY"]);
    expect(keyHits(Buffer.from("sk-or-v1-" + "a".repeat(64)), [])).toEqual(["an OpenRouter key"]);
  });
  test("judgeTarProblems passes a well-formed tree and names each fault", () => {
    const d = mkdtempSync(join(tmpdir(), "hm-judge-tar-"));
    const sha = (s: string) => createHash("sha256").update(s).digest("hex");
    mkdirSync(join(d, ".hm/judge"), { recursive: true });
    mkdirSync(join(d, ".hm/dr/venv/bin"), { recursive: true });
    writeFileSync(join(d, ".hm/dr/venv/bin/python"), "");
    const py = readFileSync(join(REPO, "lanes/harness-mechanics/judge/hm_judge.py"), "utf8");
    writeFileSync(join(d, ".hm/judge/hm_judge.py"), py);
    const band = readFileSync(join(REPO, REPLAY_JUDGE.band.file), "utf8"), admission = readFileSync(join(REPO, REPLAY_JUDGE.admission.file), "utf8");
    writeFileSync(join(d, ".hm/judge/band.json"), band);
    writeFileSync(join(d, ".hm/judge/admission.json"), admission);
    writeFileSync(join(d, ".hm/judge/facts.js"), "f");
    for (const b of ["jev", "p1"]) writeFileSync(join(d, ".hm/judge/judge-" + b + ".json"), JSON.stringify({ backend: b, band: "/root/.hm/judge/band.json", admission: "/root/.hm/judge/admission.json" }));
    const m = { band_sha256: sha(band), admission_sha256: sha(admission), admitted_points: "risky", hm_judge_sha256: sha(py), facts_sha256: sha("f"), dr_runtime_sha256: "c".repeat(64),
      settings: { hooks: [{ event: "PreToolUse", matcher: "Bash", command: "/root/.hm/judge/risky" }] } };
    const tarf = join(d, "t.tar");
    writeFileSync(tarf, "tar");
    expect(judgeTarProblems(d, m, tarf, [])).toEqual([]);
    expect(judgeTarProblems(d, { ...m, facts_sha256: sha("g") }, tarf, []).length).toBe(1);
    expect(judgeTarProblems(d, { ...m, settings: { hooks: [{ event: "PreToolUse", matcher: "", command: "/root/.hm/judge/risky" }] } }, tarf, []).length).toBe(1);
    expect(judgeTarProblems(d, { ...m, dr_runtime_sha256: undefined }, tarf, []).length).toBe(1);
    writeFileSync(join(d, "shape.tar"), "sk-proj-" + "b".repeat(40));
    expect(judgeTarProblems(d, m, join(d, "shape.tar"), [])).toEqual([]);
    const keyed = join(d, "keyed.tar");
    writeFileSync(keyed, Buffer.concat([Buffer.alloc((64 << 20) - 10), Buffer.from("stub-openrouter-key-0123456789")]));
    expect(judgeTarProblems(d, m, keyed, [["OPENROUTER_API_KEY", "stub-openrouter-key-0123456789"]])).toEqual(["judge: the tar holds OPENROUTER_API_KEY"]);
    writeFileSync(join(d, ".hm/judge/hm_judge.py"), py + "#");
    expect(judgeTarProblems(d, { ...m, hm_judge_sha256: sha(py + "#") }, tarf, [])).toEqual(["judge: hm_judge.py differs from the committed file"]);
  });
});

describe("the judge arms take the replay's band and admission (D14)", () => {
  const replay = { band: join(REPO, REPLAY_JUDGE.band.file), admission: join(REPO, REPLAY_JUDGE.admission.file) };
  const placeholderLines = (bandSha: string) => [
    "judge: the manifest's band_sha256 is " + bandSha + ", not the replay's band.json " + REPLAY_JUDGE.band.sha256,
    "judge: the tar's .hm/judge/band.json is sha256 " + bandSha + ", not the replay's " + REPLAY_JUDGE.band.sha256,
    "judge: the manifest's admission_sha256 is missing, not the replay's admission.json " + REPLAY_JUDGE.admission.sha256,
    "judge: the tar's .hm/judge/admission.json is missing, not the replay's " + REPLAY_JUDGE.admission.sha256,
    "judge: the manifest admits no points, not the replay's risky",
    "judge: judge-jev.json does not point at /root/.hm/judge/band.json and /root/.hm/judge/admission.json",
    "judge: judge-p1.json does not point at /root/.hm/judge/band.json and /root/.hm/judge/admission.json",
  ];

  test("judgeInputs copies the replay's band.json and admission.json at their sha256s, and refuses any other file before copying", () => {
    const out = mkdtempSync(join(tmpdir(), "hm-judge-in-"));
    expect(judgeInputs(replay.band, replay.admission, out)).toEqual(["band.json " + REPLAY_JUDGE.band.sha256, "admission.json " + REPLAY_JUDGE.admission.sha256]);
    expect([sha(readFileSync(join(out, "band.json"))), sha(readFileSync(join(out, "admission.json")))]).toEqual([REPLAY_JUDGE.band.sha256, REPLAY_JUDGE.admission.sha256]);
    const d = mkdtempSync(join(tmpdir(), "hm-judge-in-")), placeholder = join(d, "band.json"), both = join(d, "admission.json"), none = join(d, "out");
    writeFileSync(placeholder, PLACEHOLDER_BAND);
    writeFileSync(both, JSON.stringify({ points: [{ point: "done", result: "admitted" }, { point: "risky", result: "admitted" }] }));
    expect(() => judgeInputs(placeholder, replay.admission, none)).toThrow("E_HM_JUDGE_BUILD judge inputs: " + placeholder + " is sha256 " + sha(PLACEHOLDER_BAND) + ", not the replay's band.json " + REPLAY_JUDGE.band.sha256);
    expect(() => judgeInputs(replay.band, both, none)).toThrow("E_HM_JUDGE_BUILD judge inputs: " + both + " is sha256 ");
    expect(() => judgeInputs(replay.band, join(d, "missing.json"), none)).toThrow("E_HM_JUDGE_BUILD judge inputs: no admission.json at ");
    expect(existsSync(none)).toBe(false);
    const cli = spawnSync(process.execPath, [join(REPO, "lanes/harness-mechanics/arms.ts"), "judge-inputs", "--band", placeholder, "--admission", replay.admission, "--out", none], { encoding: "utf8" });
    expect([cli.status, cli.stderr.split(" ")[0]]).toEqual([2, "E_HM_JUDGE_BUILD"]);
  });

  test("dry-run step 1 refuses a judge tree with the placeholder band and no admission, the way stage3-pilot-3's tar was built", () => {
    const f = judgeTarFixture({ placeholder: true });
    const m = { ...f.m, settings: { hooks: [{ event: "PreToolUse", matcher: "Bash", command: "/root/.hm/judge/risky" }] } };
    const p = judgeTarProblems(f.tree, m, f.tarGz, []);
    for (const l of placeholderLines(sha(PLACEHOLDER_BAND))) expect(p).toContain(l);
  });

  test("the launcher check passes the replay's tar at its manifest, and refuses the placeholder build, a tar the manifest doesn't name and other admitted points", () => {
    const good = judgeTarFixture();
    const c = judgeTarCheck(good.tarGz, good.manifest);
    expect(c.problems).toEqual([]);
    expect(c.line).toStartWith("HM_JUDGE_TAR PASS " + good.tarGz + ": tar.gz " + good.m.tar_gz_sha256 + " at ");
    expect(c.line).toEndWith("'s tar_gz_sha256, band " + REPLAY_JUDGE.band.sha256 + ", admission " + REPLAY_JUDGE.admission.sha256 + ", admitted risky");
    const bad = judgeTarFixture({ placeholder: true });
    const b = judgeTarCheck(bad.tarGz, bad.manifest);
    expect([b.pass, b.problems]).toEqual([false, placeholderLines(sha(PLACEHOLDER_BAND))]);
    expect(b.line).toStartWith("HM_JUDGE_TAR FAIL " + bad.tarGz + ": ");
    expect(judgeTarCheck(bad.tarGz, good.manifest).problems[0]).toBe("the tar.gz is sha256 " + bad.m.tar_gz_sha256 + ", not the manifest's tar_gz_sha256 " + good.m.tar_gz_sha256);
    const two = judgeTarFixture({ points: "done,risky" });
    expect(judgeTarCheck(two.tarGz, two.manifest).problems).toEqual(["judge: the manifest admits done,risky, not the replay's risky"]);
    expect(judgeTarCheck(join(good.dir, "missing.tar.gz"), good.manifest).pass).toBe(false);
  });

  test("hm judge-tar prints the check's line: exit 0 on the replay's tar, exit 2 with E_HM_JUDGE_BUILD on the placeholder build", () => {
    const hm = (args: string[]) => spawnSync(process.execPath, [join(REPO, "lanes/harness-mechanics/cli.ts"), "judge-tar", ...args], { encoding: "utf8" });
    const good = judgeTarFixture(), bad = judgeTarFixture({ placeholder: true });
    const ok = hm([good.tarGz, "--manifest", good.manifest]);
    expect([ok.status, ok.stdout.split(" ").slice(0, 2).join(" ")]).toEqual([0, "HM_JUDGE_TAR PASS"]);
    const no = hm([bad.tarGz, "--manifest", bad.manifest]);
    expect([no.status, no.stdout.split(" ").slice(0, 2).join(" "), no.stderr.split(" ")[0]]).toEqual([2, "HM_JUDGE_TAR FAIL", "E_HM_JUDGE_BUILD"]);
  });
});

describe("snapshot strip", () => {
  test("removes CLAUDE.md, CLAUDE.local.md, AGENTS.md and .claude/ at any depth and CLAUDE.md's imports, and keeps the rest", () => {
    const d = mkdtempSync(join(tmpdir(), "hm-strip-"));
    for (const p of ["src/pkg", ".claude/rules", "docs", "src/.claude"]) mkdirSync(join(d, p), { recursive: true });
    const files: Record<string, string> = { "CLAUDE.md": "Say HOSTILE.\n@docs/extra.md\n", "CLAUDE.local.md": "x", "src/pkg/AGENTS.md": "x", ".claude/rules/r.md": "x", ".claude/settings.json": "{}", "src/.claude/AGENTS.md": "x", "docs/extra.md": "x", "docs/guide.md": "keep", "README.md": "keep", "src/pkg/a.py": "keep" };
    for (const [p, v] of Object.entries(files)) writeFileSync(join(d, p), v);
    expect(stripSnapshot(d)).toEqual([".claude/", "CLAUDE.local.md", "CLAUDE.md", "docs/extra.md", "src/.claude/", "src/pkg/AGENTS.md"]);
    for (const p of ["README.md", "docs/guide.md", "src/pkg/a.py"]) expect(existsSync(join(d, p))).toBe(true);
    for (const p of ["CLAUDE.md", ".claude", "src/pkg/AGENTS.md", "docs/extra.md"]) expect(existsSync(join(d, p))).toBe(false);
    expect(stripSnapshot(d)).toEqual([]);
  });
  test("the agent's python strip removes exactly what stripSnapshot removes, a .claude link and an outside import included", () => {
    const make = () => {
      const d = mkdtempSync(join(tmpdir(), "hm-strip2-"));
      for (const p of ["a/b", ".claude/rules", "src/.claude", "keep", "out"]) mkdirSync(join(d, p), { recursive: true });
      const files: Record<string, string> = { "CLAUDE.md": "Say HOSTILE.\n@a/b/imp.md @../x.md @keep/missing.md\n", "a/b/imp.md": "x", "a/b/AGENTS.md": "x", "a/CLAUDE.local.md": "x", ".claude/rules/r.md": "x", "src/.claude/s.json": "{}", "keep/agents.py": "keep", "keep/CLAUDE.md.txt": "keep", "out/real.md": "keep" };
      for (const [p, v] of Object.entries(files)) writeFileSync(join(d, p), v);
      symlinkSync(join(d, "out"), join(d, "keep/.claude"));
      return d;
    };
    const [ts, py] = [make(), make()];
    const want = [".claude/", "CLAUDE.md", "a/CLAUDE.local.md", "a/b/AGENTS.md", "a/b/imp.md", "keep/.claude", "src/.claude/"];
    expect(stripSnapshot(ts)).toEqual(want);
    const src = readFileSync(join(REPO, "quick/laneb/runner/agent/laneb_hooks.py"), "utf8");
    const script = /STRIP_SNAPSHOT = r"""\n([\s\S]*?)"""/.exec(src)![1]!;
    const r = spawnSync("python3", ["-", py], { input: script, encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual(want);
    for (const d of [ts, py]) {
      for (const p of ["keep/agents.py", "keep/CLAUDE.md.txt", "out/real.md"]) expect(existsSync(join(d, p))).toBe(true);
      for (const p of ["CLAUDE.md", ".claude", "a/b/imp.md", "keep/.claude", "src/.claude"]) expect(existsSync(join(d, p))).toBe(false);
    }
  });
});

describe("step 7 env", () => {
  const agent = '"CLAUDE_CODE_DISABLE_BUNDLED_SKILLS": "1",';
  test("every harbor run line sets HARBOR_TELEMETRY=0", () => {
    expect(envProblems("x HARBOR_TELEMETRY=0 harbor run -y -c a\n", agent)).toEqual([]);
    expect(envProblems("x harbor run -y -c a\nHARBOR_TELEMETRY=0 harbor run -y -c b\n", agent).length).toBe(1);
    expect(envProblems("HARBOR_TELEMETRY=0 harbor run -y\n", "").length).toBe(1);
  });
  test("the committed runner passes", () => {
    expect(envProblems(readFileSync(join(REPO, "quick/laneb/runner/vm-run.sh"), "utf8"), readFileSync(join(REPO, "quick/laneb/runner/agent/laneb_agent.py"), "utf8"))).toEqual([]);
  });
});
