// Copyright (c) 2026 Garry Tan. MIT License.
// Plan sections 4, 8, 9 and 12: the /cso lane's keyless end-to-end run. A small fixture tree (one commit, a redacted
// config path among its files) runs through gstack-evals cso rerun's wired runner: the session image on the pinned base,
// the pinned Claude Code on the real Agent SDK inside Harbor, and a temporary ledger whose driver serves cso-smoke at the
// Docker bridge gateway. A stub upstream (no network, no key) plays the model. In none it answers with a finding and DONE;
// in cso and untold (given --home cso=<dir>, an installed gstack home they share) it runs the helper through the
// launcher (start, inspect, read, finish) and then answers. Per arm and model it prints one PASS or FAIL line: the session ends completed with DONE; the
// slot closed finalized; node, bun, python3 and gh resolve in the container; the record names the model id and Claude Code
// version the session reported; exposure reads neither loaded nor a procedure in none, the procedure ran on a daily
// default-scope run with no tooling error in cso and untold, and loaded in cso. Then teardown:
// the driver stops with exit 0. It exits 1 (E_CSO_E2E_FAIL) on any FAIL.
// With --work <cso units work dir> --unit <id>, it runs that built unit's tree and record instead of the fixture.
// Usage: bun lanes/outcome-skills/cso/e2e.ts [--home cso=<dir>] [--work <dir> --unit <id>] [--models opus,particle] [--out <dir>] [--harbor <bin>]
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { sse } from "../../../quick/laneb/runner/fake_upstream.ts";
import { recordProgram } from "../../../src/runner/ledger/envelope.ts";
import { recordApproval } from "../../../src/runner/ledger/ledger.ts";
import { LocalLedger } from "../../../src/runner/ledger/local.ts";
import { serveStages } from "../driver/stage.ts";
import { homeTreeSha256 } from "../h2h/arms/hash.ts";
import { rerun } from "./cli.ts";
import { CSO_STAGES } from "./driver.ts";
import { loadCsoPrereg } from "./prereg.ts";
import { armRuns } from "./sessions.ts";
import { csoRunner } from "./rerunner.ts";
import type { CsoArm, CsoModel, SessionRecord } from "./types.ts";

const KEYS = /^(ANTHROPIC|OPENAI|OPENROUTER|UBICLOUD|GEMINI|GOOGLE|XAI|DEEPSEEK|TYPESAFE|EXA|AGENTRUN)_[A-Z_]*KEY$|_TOKEN$/;
const LAUNCHER = "~/.claude/skills/gstack/bin/gstack-cso-launcher";
const ID = () => "toolu_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
let UNIT = "e2e-fixture";

/** The fixture unit: a two-file tree committed once, and a unit record with only what the runner reads. */
function fixture(work: string): void {
  const tree = join(work, "trees", UNIT);
  mkdirSync(join(tree, "config"), { recursive: true });
  writeFileSync(join(tree, "index.js"), "const fs = require('fs');\nmodule.exports = (p) => fs.readFileSync('/srv/' + p);\n");
  writeFileSync(join(tree, "config/prod.env"), "API_KEY=fixture-not-a-key\n");
  const g = (a: string[]) => spawnSync("git", ["-C", tree, "-c", "user.name=cso-unit", "-c", "user.email=cso-unit@example.invalid", ...a], { encoding: "utf8" });
  g(["init", "-q", "-b", "main"]);
  g(["add", "-A"]);
  g(["commit", "-q", "-m", "audit tree"]);
  mkdirSync(join(work, "units"), { recursive: true });
  writeFileSync(join(work, "units", UNIT + ".json"), JSON.stringify({ schema: "cso-unit.v1", unit: UNIT, tree_sha256: "e2e0".repeat(16) }));
}

export async function main(argv: string[]): Promise<number> {
  const arg = (k: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
  for (const k of Object.keys(process.env)) if (KEYS.test(k)) delete process.env[k];
  const p = loadCsoPrereg();
  const harbor = arg("--harbor") ?? join(homedir(), ".capy/work/uvbin/harbor");
  process.env.PATH = dirname(harbor) + ":" + process.env.PATH;
  const home = arg("--home")?.replace(/^cso=/, "");
  const models = (arg("--models")?.split(",") ?? ["opus", "particle"]) as CsoModel[];
  const arms: CsoArm[] = home ? ["none", "cso", "untold"] : ["none"];
  const W = arg("--out") ?? mkdtempSync(join(homedir(), ".capy/work/cso-e2e-"));
  mkdirSync(join(W, "arms"), { recursive: true });
  const real = arg("--work");
  if (real) {
    UNIT = arg("--unit") ?? (console.error("E_USAGE --work needs --unit <id>"), process.exit(2));
    cpSync(join(real, "trees", UNIT), join(W, "trees", UNIT), { recursive: true, verbatimSymlinks: true });
    mkdirSync(join(W, "units"), { recursive: true });
    cpSync(join(real, "units", UNIT + ".json"), join(W, "units", UNIT + ".json"));
  } else fixture(W);
  writeFileSync(join(W, "arms", "none.json"), JSON.stringify({ arm: "none", home_tree_sha256: "none" }));
  if (home) writeFileSync(join(W, "arms", "cso.json"), JSON.stringify({ arm: "cso", home_tree_sha256: homeTreeSha256(home) }));
  writeFileSync(join(W, "units.json"), JSON.stringify([UNIT]));
  const lines: string[] = [];
  const rule = (name: string, ok: boolean, detail: string) => {
    const l = (ok ? "PASS " : "FAIL ") + name + ": " + detail;
    lines.push(l);
    console.log(l);
  };
  console.log("e2e: arms " + arms.join(", ") + " on " + models.join(", ") + ", work " + W);

  let current: { arm: CsoArm; requests: number } | null = null;
  const upstream = async (url: string, init: RequestInit): Promise<Response> => {
    if (url.endsWith("/count_tokens")) return Response.json({ input_tokens: 10 });
    const body = JSON.parse(typeof init.body === "string" ? init.body : new TextDecoder().decode(init.body as Uint8Array)) as Record<string, any>;
    const reply = (blocks: unknown[]) => new Response(sse(body.model, blocks as any), { headers: { "content-type": "text/event-stream" } });
    const s = current;
    if (!s || !Array.isArray(body.tools) || !body.tools.length) return reply([{ type: "text", text: "ok" }]);
    s.requests++;
    const said = JSON.stringify(body.messages ?? []);
    const done = reply([{ type: "text", text: "Finding 1: index.js:2 reads a caller-chosen path under /srv with no normalization (path traversal).\n\nDONE" }]);
    if (s.arm === "none") return done;
    const run = said.match(/\d{13}-[0-9a-f]{16}/)?.[0];
    const bash = (command: string) => reply([{ type: "tool_use", id: ID(), name: "Bash", input: { command, description: "cso helper" } }]);
    if (!run) return bash(LAUNCHER + " start --repo /work/repo");
    if (!said.includes(" inspect " + run)) return bash(LAUNCHER + " inspect " + run);
    if (!said.includes(" read " + run)) return bash(LAUNCHER + " read " + run + " index.js");
    if (!said.includes(" finish " + run)) return bash(LAUNCHER + " finish " + run);
    return done;
  };

  const gw = spawnSync("docker", ["network", "inspect", "bridge", "-f", "{{(index .IPAM.Config 0).Gateway}}"], { encoding: "utf8" }).stdout.trim();
  const record = join(W, "record");
  const quote = { words: "end-to-end fixture words on a temporary ledger, not an approval", by: "cso-e2e", source: "cso/e2e.ts" };
  const D = 1_000_000;
  recordProgram(record, { program: "cso-e2e", cap_micros: 100 * D, skill_cap_micros: 100 * D, skills: ["cso"], credit_rate_micros: D, quotes: [quote] });
  recordApproval(record, { action: "init", item: "cso-smoke", cap_micros: (p.items as Record<string, { cap: number }>)["cso-smoke"]!.cap * D, quotes: [quote], admission: "required", program: "cso-e2e", skills: ["cso"] });
  const local = LocalLedger.open(join(W, "ledger.sqlite"));
  const served = await serveStages({ record, local, run_id: "cso-e2e", envelope_host: "e2e", machine: "e2e", stages: [{ item: "cso-smoke", arm: "cso-smoke", arms: CSO_STAGES["cso-smoke"]! }], host: gw, dir: join(W, "driver"), fetch: upstream as typeof fetch, requireAdmission: () => null, env: { ANTHROPIC_API_KEY: "stub-upstream-not-a-key", OPENROUTER_API_KEY: "stub-upstream-not-a-key" }, log: () => {} });
  const env = { CSO_CONTROL: served.control, CSO_PROXY: served.stages[0]!.proxy, CSO_WORK: W, CSO_HOME: home, CSO_STAGE: "stage0", CSO_OUT: join(W, "sessions") };
  try {
    for (const arm of arms)
      for (const model of models.filter((m) => (["stage0", "stage1", "stage2"] as const).some((s) => armRuns(arm, m, s, p)))) {
        const name = "arm " + arm + " on " + model;
        current = { arm, requests: 0 };
        const t0 = Date.now();
        const code = await rerun(["--arm", arm, "--model", model, "--units", join(W, "units.json"), "--spend-cap", "20"], csoRunner(env)).catch((e: Error) => (rule(name, false, e.message.slice(0, 800)), -1));
        const s = current;
        current = null;
        if (code === -1) continue;
        const base = join(W, "sessions", "stage0", UNIT);
        const dir = readdirSync(base).filter((d) => d.startsWith(arm + "-" + model + "-")).map((d) => join(base, d)).at(-1);
        const rec = dir && existsSync(join(dir, "session.json")) ? (JSON.parse(readFileSync(join(dir, "session.json"), "utf8")) as SessionRecord) : null;
        const x = dir && existsSync(join(dir, "h2h-summary.json")) ? (JSON.parse(readFileSync(join(dir, "h2h-summary.json"), "utf8")) as Record<string, any>) : {};
        const rt = (x.runtimes ?? {}) as Record<string, { path: string; version: string }>;
        const checks: Array<[string, boolean]> = [
          ["rerun exit 0", code === 0],
          ["completed with DONE", rec?.end === "completed" && rec.done_seen],
          ["slot finalized", x.slot?.close?.finalized === true],
          ["runtimes on PATH", (["node", "bun", "python3", "gh"] as const).every((t) => !!rt[t]?.path)],
          ["session identity", !!rec && rec.harness_version === "2.1.325" && rec.model_id.length > 0],
          ["exposure " + (arm === "none" ? "not loaded, no procedure" : "procedure ran daily/default" + (arm === "cso" ? ", loaded" : "")), !!rec && (arm === "none" ? !rec.exposure.loaded && !rec.exposure.procedure_ran : rec.exposure.procedure_ran && rec.exposure.scope === "daily/default" && rec.exposure.tooling_errors === 0 && (arm !== "cso" || rec.exposure.loaded))],
        ];
        const failed = checks.filter(([, ok]) => !ok).map(([n]) => n);
        rule(name, failed.length === 0, (failed.length ? "failed " + failed.join(", ") + "; " : "") + "end " + rec?.end + ", model " + rec?.model_id + ", Claude Code " + rec?.harness_version + ", " + s.requests + " main requests, exposure " + JSON.stringify(rec?.exposure) + ", runtimes " + Object.keys(rt).join(" ") + ", cost $" + rec?.cost_usd + ", " + ((Date.now() - t0) / 1000).toFixed(0) + " s; " + dir);
      }
  } finally {
    const stopped = await served.stop();
    rule("teardown", stopped === 0, "driver stop exit " + stopped);
  }
  writeFileSync(join(W, "e2e.txt"), lines.join("\n") + "\n");
  const failed = lines.filter((l) => l.startsWith("FAIL"));
  if (failed.length) console.error("E_CSO_E2E_FAIL " + failed.length + " of " + lines.length + " lines failed; " + join(W, "e2e.txt"));
  return failed.length ? 1 : 0;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
