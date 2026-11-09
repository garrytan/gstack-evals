// Copyright (c) 2026 Garry Tan. MIT License.
// The dry run's session part (prereg 2026-11-09-geva-417, section 15 rule 4): the stage 1 session path end to end with
// no key. The batches run in a child process (session-dry.ts), because the real driver loads the real pinned Agent SDK;
// the plan sizes and the paid run's pin guard run here. A child that fails or prints no lines is one FAIL line.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dxMain } from "../../../src/trial/review/dx-cli.ts";
import { SMOKE } from "../leases.ts";
import { MODEL_STRINGS, type DryCheck } from "../types.ts";
import { dxPlan } from "./session.ts";

const T = (rule: string, parts: Array<[boolean, string]>): DryCheck => ({ rule, pass: parts.every(([ok]) => ok), detail: parts.map(([ok, what]) => (ok ? "ok: " : "FAILED: ") + what).join("; ") });

function plans(): DryCheck {
  const ids = Array.from({ length: 16 }, (_, i) => "c" + (i + 1));
  const none = dxPlan("s1-none", ids);
  const smoke = dxPlan("s1-smoke", ids);
  const resmoke = dxPlan("s1-resmoke", ids, ["autoplan"]);
  const n = (p: ReturnType<typeof dxPlan>) => ("sessions" in p ? p.sessions.length : -1);
  return T("session path: each stage 1 frozen run's plan: s1-none 144 sessions, s1-smoke the 22 of the smoke table, s1-resmoke the repaired arm's 10", [
    [n(none) === 144 && "sessions" in none && none.sessions.every((s) => s.arm === "none" && !s.smoke), "s1-none is 16 units x 3 passes x 3 models on arm none"],
    [n(smoke) === 22 && n(smoke) === SMOKE.reduce((s, [, , k]) => s + k, 0) && "sessions" in smoke && smoke.sessions.every((s) => s.smoke && s.arm !== "none"), "s1-smoke is the smoke table, its own pass, with no none session"],
    [n(resmoke) === 10 && "sessions" in resmoke && resmoke.sessions.every((s) => s.arm === "autoplan" && s.pass === 2), "s1-resmoke reruns autoplan alone as pass 2"],
    ["problem" in dxPlan("s1-none", ids.slice(1)) && "problem" in dxPlan("s1-smoke", ids.slice(0, 9)), "a frozen run with the wrong units is refused"],
  ]);
}

async function pinGuard(): Promise<DryCheck> {
  const dir = mkdtempSync(join(tmpdir(), "dx-session-pin-"));
  try {
    const units = join(dir, "units");
    for (let i = 1; i <= 16; i++) {
      mkdirSync(join(units, "c" + i, "repo"), { recursive: true });
      writeFileSync(join(units, "c" + i, "unit.json"), JSON.stringify({ id: "c" + i }));
      writeFileSync(join(units, "c" + i, "plan.md"), "Add an init command.\n");
      writeFileSync(join(units, "c" + i, "repo", "a.ts"), "export {};\n");
    }
    const err: string[] = [];
    const code = await dxMain(["--plan", "devex", "--units-dir", units, "--units", "all", "--models", ...Object.values(MODEL_STRINGS), "--arms", "none", "--passes", "3", "--run", "s1-none", "--out", join(dir, "out")], { out: () => {}, err: (t) => void err.push(t) }, {});
    const text = err.join("\n");
    return T("session path: a paid stage 1 run refuses without GSTACK_EVALS_DX_PIN before any lease or rig", [[code === 2 && /^E_USAGE review-units: .*GSTACK_EVALS_DX_PIN is not set/.test(text) && text.includes("\n  fix: "), "--run s1-none with no pin: E_USAGE with a fix line"]]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function batches(): DryCheck[] {
  const r = spawnSync(process.execPath, [join(import.meta.dir, "session-dry.ts")], { encoding: "utf8", timeout: 600_000, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? tmpdir(), TMPDIR: tmpdir(), LANG: "C.UTF-8" } });
  try {
    const lines = JSON.parse(r.stdout.trim().split("\n").at(-1) ?? "").lines as DryCheck[];
    if (Array.isArray(lines) && lines.length) return lines;
  } catch {}
  return [T("session path: the end-to-end batches ran in their own process", [[false, "exit " + r.status + ": " + (r.stderr || r.stdout).trim().split("\n").slice(-3).join(" | ").slice(0, 400)]])];
}

export async function checks(): Promise<DryCheck[]> {
  return [plans(), await pinGuard(), ...batches()];
}
