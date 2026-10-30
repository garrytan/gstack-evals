import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../../src/cli.ts";
import { recipeHash } from "../../src/rig/recipe.ts";
import { doctorChecks, doctorCommand, type Runner } from "../../src/skill-eval/cli/doctor.ts";
import { approvalRecord, collect, TMP, tree } from "./helpers.ts";

const gstack = tree({ "bin/gstack-approvals": "#!/bin/sh\n", VERSION: "1.91.324.0\n" });
const IMAGE_ID = "sha256:" + "c".repeat(64);
const healthy: Runner = (command, args) => ({ status: 0, stdout: command !== "docker" ? command + " 2.1.0\n" : args[0] === "image" ? IMAGE_ID + " x\n" : "29.9.2\n", stderr: "" });
const env = (extra: Record<string, string> = {}) => ({ GSTACK_EVALS_APPROVALS_BIN: join(gstack, "bin/gstack-approvals"), ANTHROPIC_API_KEY: "fake-anthropic-should-never-print", OPENAI_API_KEY: "fake-openai-should-never-print", XDG_STATE_HOME: join(TMP, "doctor-state"), ...extra });
const recipe = recipeHash();

describe("gstack-evals doctor", () => {
  // Value: protects=doctor's keyless report: Bun, Docker, the host CLI, keys by name, both ledger paths with their rules, and gstack-approvals' version, exit 0 when all pass; fails_when=a check is dropped, a key value is printed, or a path loses its rule; why_new=doctor is new; seam=U4's ledgerPath, recordPath and approvalsBin; no_claim=a real image build, which the Docker tier covers
  test("a healthy machine passes every check, and key values are never printed", async () => {
    const record = approvalRecord("doctor-item", 10);
    const io = collect();
    expect(await doctorCommand(["--host", "claude", "--ledger", join(TMP, "doctor.sqlite"), "--ledger-record", record], io, env(), healthy)).toBe(0);
    const { out, err } = io.text();
    expect(err).toBe("");
    expect(out.split("\n")).toEqual([
      "ok bun: " + process.versions.bun,
      "ok docker: daemon 29.9.2",
      "ok trial image: gstack-evals-trial:" + recipe.slice(0, 16) + " " + IMAGE_ID + " (recipe " + recipe.slice(0, 12) + ", pinned)",
      "ok claude CLI: claude 2.1.0",
      "ok claude key: ANTHROPIC_API_KEY set (checked by name)",
      "ok claude key: OPENAI_API_KEY set (the default judge gpt-6.1-sol)",
      "ok ledger: " + join(TMP, "doctor.sqlite") + " (--ledger)",
      "ok ledger record: " + record + " (--ledger-record), 1 line item",
      "ok gstack-approvals: " + join(gstack, "bin/gstack-approvals") + ", gstack 1.91.324.0",
    ]);
    expect(out).not.toContain("should-never-print");
  });

  // Value: protects=each failing check prints its code lines and doctor exits 2: no Docker, a missing host CLI, a missing subject key, a ledger on a network mount; fails_when=a failure passes, loses its code, or a record read error aborts the report; why_new=new; seam=the injected runner and mount table; no_claim=none beyond protects
  test("no Docker, a missing host CLI, a missing key, a bad ledger path, an unreadable record and a missing approvals bin each fail with their code", () => {
    const broken: Runner = () => ({ status: 1, stdout: "", stderr: "Cannot connect to the Docker daemon\n" });
    const checks = doctorChecks({ env: env({ OPENAI_API_KEY: "" }), hosts: ["codex"], ledger: join(TMP, "nfs", "ledger.sqlite"), record: join(TMP, "no-record"), run: broken, mounts: [{ point: TMP, type: "nfs4" }] });
    const failed = Object.fromEntries(checks.filter((c) => c.status === "fail").map((c) => [c.name, c.code]));
    expect(failed).toEqual({ docker: "E_ISOLATION_UNSAFE", "codex CLI": "E_HOST_CLI", "codex key": "E_KEY_MISSING", ledger: "E_LEDGER_PATH" });
    expect(checks.find((c) => c.name === "codex key" && c.status === "warn")!.detail).toBe("OPENROUTER_API_KEY not set (openrouter models under test)");
    expect(checks.find((c) => c.name === "ledger record")!.detail).toEndWith("no line items yet");
    const odd = tree({ "record/items": "not a directory\n", "ledger-dir/.keep": "" });
    const more = doctorChecks({ env: env({ GSTACK_EVALS_APPROVALS_BIN: join(gstack, "bin/gone") }), hosts: ["claude"], ledger: join(odd, "ledger-dir"), record: join(odd, "record"), run: healthy });
    const byName = Object.fromEntries(more.filter((c) => c.status === "fail").map((c) => [c.name, [c.code, c.detail]]));
    expect(byName.ledger).toEqual(["E_LEDGER_PATH", join(odd, "ledger-dir") + " (--ledger) is a directory, not a SQLite file"]);
    expect(byName["ledger record"]![0]).toBe("E_LEDGER_RECORD");
    expect(byName["gstack-approvals"]).toEqual(["E_APPROVAL_RECORD", join(gstack, "bin/gone") + " does not exist; ledger init and raise mirror approvals through it"]);
  });

  // Value: protects=doctor fails a ledger file that exists but this user cannot read and write, before a run dies opening it; fails_when=a 0444 ledger file in a writable directory passes; why_new=Capy's review of #51; seam=ledgerFileProblem; no_claim=root, who passes every access check
  test.skipIf(process.getuid?.() === 0)("a ledger file this user cannot write fails with E_LEDGER_PATH", () => {
    const dir = tree({ "ledger.sqlite": "" });
    chmodSync(join(dir, "ledger.sqlite"), 0o444);
    const ledger = doctorChecks({ env: env(), hosts: ["claude"], ledger: join(dir, "ledger.sqlite"), record: join(dir, "record"), run: healthy }).find((c) => c.name === "ledger")!;
    expect([ledger.status, ledger.code, ledger.detail]).toEqual(["fail", "E_LEDGER_PATH", join(dir, "ledger.sqlite") + " (--ledger) exists but is not readable and writable by this user"]);
  });

  // Value: protects=bin/gstack-evals runs doctor, without --host it checks both host CLIs, and --json prints one object; fails_when=the doctor row stops resolving or --json mixes in text; why_new=the doctor row printed not built yet; seam=src/cli.ts; no_claim=none beyond protects
  test("bin/gstack-evals doctor --json checks both hosts and prints one object", () => {
    const r = spawnSync(join(REPO_ROOT, "bin", "gstack-evals"), ["doctor", "--json", "--ledger", join(TMP, "bin.sqlite")], { encoding: "utf8", env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: TMP } });
    const report = JSON.parse(r.stdout);
    expect(r.status).toBe(report.ok ? 0 : 2);
    expect(report.checks.map((c: { name: string }) => c.name).filter((n: string) => n.endsWith(" CLI"))).toEqual(["claude CLI", "codex CLI"]);
    expect(report.checks.find((c: { name: string }) => c.name === "claude key")).toMatchObject({ status: "fail", code: "E_KEY_MISSING" });
  });
});
