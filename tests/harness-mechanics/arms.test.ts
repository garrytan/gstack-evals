// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyVerifyPatch, configProblems, contractOf, envProblems, gitBlob, hookProblems, patchedProblems, stripSnapshot, vendoredVerify } from "../../lanes/harness-mechanics/arms.ts";
import { session } from "../../lanes/harness-mechanics/match.ts";
import { REPO, VERIFY_PATCH } from "../../lanes/harness-mechanics/pins.ts";
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
