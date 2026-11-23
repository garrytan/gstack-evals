// Copyright (c) 2026 Garry Tan. MIT License.
// The head-to-head's keyless end-to-end run: one real O unit, part A's installed homes, and the pinned Claude Code on the
// real Agent SDK inside Harbor containers, driven through rerun's wired session runner (rerunner.ts) on a temporary ledger
// whose driver serves h2h-smoke at the Docker bridge gateway. A stub upstream (no network, no key) plays the model: in
// every arm but none it applies the unit's fix.patch with one Bash call (read at run time, never written to the repo),
// for tstack it first launches full-send with the Skill tool, and it ends with DONE. Per arm it prints one PASS or FAIL
// line: the session ends completed with DONE; the first main request lists the arm's pack skill (none's lists no pack's);
// exposure reads loaded (none: not loaded), and agent-skills shows command:/agent-skills:test with its chrome-devtools MCP
// server connected; node, bun, python3 and gh resolve in the container; the read audit finds no read of another arm's
// install; the slot closed finalized; part C's score ran on the captured tree and reads verified for every arm that
// applied the fix and not for none. Then teardown: the driver stops with exit 0. It exits 1 (E_H2H_E2E_FAIL) on any FAIL.
// Usage: bun lanes/outcome-skills/h2h/sessions/e2e.ts --units <dir of sm-unit dirs> --unit <id> --homes <dir>
//   [--pins <arms-pins.json>] [--arms <arm,...>] [--out <dir>] [--harbor <bin>]
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { sse } from "../../../../quick/laneb/runner/fake_upstream.ts";
import { recordProgram } from "../../../../src/runner/ledger/envelope.ts";
import { recordApproval } from "../../../../src/runner/ledger/ledger.ts";
import { LocalLedger } from "../../../../src/runner/ledger/local.ts";
import { serveStages } from "../../driver/stage.ts";
import { ARMS_PINS_PATH } from "../arms/pins.ts";
import { PREREG_PATH, readPrereg } from "../prereg.ts";
import { readUnits } from "../rerun.ts";
import { PIECE_G_ARMS, PRIMARY_ARMS, type H2hArm } from "../types.ts";
import { H2H_STAGES } from "./driver.ts";
import { NEEDLE } from "./dryrun.ts";
import { sessionRunner } from "./rerunner.ts";
import { dropKeyEnv } from "../../../../src/trial/env.ts";

const MARK = "h2h-e2e-apply";
const ID = () => "toolu_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);

export async function main(argv: string[]): Promise<number> {
  const arg = (k: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
  const need = (k: string) => arg(k) ?? (console.error("E_USAGE missing " + k + "; usage: e2e --units <dir> --unit <id> --homes <dir> [--pins <file>] [--arms <a,b>] [--out <dir>] [--harbor <bin>]"), process.exit(2));
  dropKeyEnv();
  const P = readPrereg();
  const units = need("--units");
  const id = need("--unit");
  const unit = readUnits(join(dirname(PREREG_PATH), "o-frame.json")).find((u) => u.id === id) ?? (console.error("E_USAGE " + id + " is not in o-frame.json"), process.exit(2));
  const arms = (arg("--arms")?.split(",") ?? [...PRIMARY_ARMS, ...PIECE_G_ARMS]) as H2hArm[];
  const harbor = arg("--harbor") ?? join(homedir(), ".capy/work/real/venv/bin/harbor");
  process.env.PATH = dirname(harbor) + ":" + process.env.PATH;
  const W = arg("--out") ?? mkdtempSync(join(homedir(), ".capy/work/h2h-e2e-"));
  mkdirSync(W, { recursive: true });
  const patch = readFileSync(join(units, id, "fix.patch"), "utf8");
  const apply = "git apply --whitespace=nowarn <<'H2H_E2E_PATCH'\n" + patch + (patch.endsWith("\n") ? "" : "\n") + "H2H_E2E_PATCH";
  const lines: string[] = [];
  const rule = (name: string, ok: boolean, detail: string) => {
    const l = (ok ? "PASS " : "FAIL ") + name + ": " + detail;
    lines.push(l);
    console.log(l);
  };
  console.log("e2e: unit " + id + ", arms " + arms.join(", ") + ", work " + W);

  let current: { arm: H2hArm; first: string | null; requests: number } | null = null;
  const upstream = async (url: string, init: RequestInit): Promise<Response> => {
    if (url.endsWith("/count_tokens")) return Response.json({ input_tokens: 10 });
    const raw = typeof init.body === "string" ? init.body : new TextDecoder().decode(init.body as Uint8Array);
    const body = JSON.parse(raw) as Record<string, any>;
    const reply = (blocks: unknown[]) => new Response(sse(body.model, blocks as any), { headers: { "content-type": "text/event-stream" } });
    const s = current;
    if (!s || !Array.isArray(body.tools) || !body.tools.length) return reply([{ type: "text", text: "ok" }]);
    s.first ??= raw;
    s.requests++;
    const said = JSON.stringify(body.messages ?? []);
    if (s.arm === "none") return reply([{ type: "text", text: "No change.\n\nDONE" }]);
    if (s.arm === "tstack" && !said.includes('"name":"Skill"')) return reply([{ type: "tool_use", id: ID(), name: "Skill", input: { skill: "full-send" } }]);
    if (!said.includes(MARK)) return reply([{ type: "tool_use", id: ID(), name: "Bash", input: { command: apply, description: MARK } }]);
    return reply([{ type: "text", text: "Applied the fix.\n\nDONE" }]);
  };

  const gw = spawnSync("docker", ["network", "inspect", "bridge", "-f", "{{(index .IPAM.Config 0).Gateway}}"], { encoding: "utf8" }).stdout.trim();
  const record = join(W, "record");
  const quote = { words: "end-to-end fixture words on a temporary ledger, not an approval", by: "h2h-e2e", source: "h2h/sessions/e2e.ts" };
  const D = 1_000_000;
  recordProgram(record, { program: "h2h-e2e", cap_micros: 2_000 * D, skill_cap_micros: 2_000 * D, skills: ["h2h"], credit_rate_micros: D, quotes: [quote] });
  recordApproval(record, { action: "init", item: "h2h-smoke", cap_micros: 1_000 * D, quotes: [quote], admission: "required", program: "h2h-e2e", skills: ["h2h"] });
  const local = LocalLedger.open(join(W, "ledger.sqlite"));
  const served = await serveStages({ record, local, run_id: "h2h-e2e", envelope_host: "e2e", machine: "e2e", stages: [{ item: "h2h-smoke", arm: H2H_STAGES["h2h-smoke"]![0]!, arms: H2H_STAGES["h2h-smoke"]! }], host: gw, dir: join(W, "driver"), fetch: upstream as typeof fetch, requireAdmission: () => null, env: { ANTHROPIC_API_KEY: "stub-upstream-not-a-key" }, log: () => {}, planned: arms.length, reruns: arms.length });
  const runner = sessionRunner({ H2H_CONTROL: served.control, H2H_PROXY: served.stages[0]!.proxy, H2H_HOMES: need("--homes"), H2H_UNITS: units, H2H_PINS: arg("--pins") ?? ARMS_PINS_PATH, H2H_RERUN_ITEM: "h2h-smoke" });
  let closes = 0;
  try {
    for (const arm of arms) {
      const why = await runner.preflight(arm, [unit]);
      if (why) {
        rule("arm " + arm, false, "preflight: " + why);
        continue;
      }
      const out = join(W, "s-" + arm);
      current = { arm, first: null, requests: 0 };
      const t0 = Date.now();
      const r = await runner.run({ arm, unit, allowance_usd: P.limits.allowance_usd, cap_left_usd: 2 * P.limits.allowance_usd, out }).catch((e: Error) => ({ kind: "error" as const, detail: e.message }));
      const s = current;
      current = null;
      if (r.kind !== "session") {
        rule("arm " + arm, false, r.kind + ": " + r.detail.slice(0, 600));
        continue;
      }
      const file = join(out, "h2h-summary.json");
      const x = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, any>) : {};
      const e = r.session.exposure;
      const rt = (x.runtimes ?? {}) as Record<string, { path: string; version: string }>;
      const runtimes = (["node", "bun", "python3", "gh"] as const).map((t) => t + " " + (rt[t] ? rt[t].path + " (" + rt[t].version + ")" : "missing"));
      const first = s.first ?? "";
      const lists = arm === "none" ? Object.values(NEEDLE).filter((n) => first.includes(n)) : first.includes(NEEDLE[arm]!) ? [NEEDLE[arm]!] : [];
      const sdk = join(out, "sdk-messages.jsonl");
      const mcp = Object.fromEntries([...(existsSync(sdk) ? readFileSync(sdk, "utf8") : "").matchAll(/"name": ?"([^"]+)", ?"status": ?"([a-z_-]+)"/g)].map((m) => [m[1]!, m[2]!]));
      const close = x.slot?.close ?? {};
      if ("finalized" in close) closes++;
      const checks: Array<[string, boolean]> = [
        ["completed with DONE", r.session.end === "completed" && x.done === true],
        ["first request " + (arm === "none" ? "lists no pack skill" : "lists " + NEEDLE[arm]), arm === "none" ? lists.length === 0 : lists.length === 1],
        ["exposure " + (arm === "none" ? "not loaded" : "loaded"), e?.loaded === (arm !== "none")],
        ...(arm === "agent-skills" ? [["command:/agent-skills:test", !!e?.markers.includes("command:/agent-skills:test")], ["chrome-devtools connected", mcp["chrome-devtools"] === "connected"]] as Array<[string, boolean]> : []),
        ["runtimes on PATH", (["node", "bun", "python3", "gh"] as const).every((t) => !!rt[t]?.path)],
        ["no foreign reads", !!e && e.foreign_reads.length === 0],
        ["slot finalized", close.finalized === true],
        ["scored " + (arm === "none" ? "unverified" : "verified"), !!r.score && r.score.verified === (arm !== "none")],
      ];
      const failed = checks.filter(([, ok]) => !ok).map(([n]) => n);
      rule("arm " + arm, failed.length === 0, (failed.length ? "failed " + failed.join(", ") + "; " : "") + "end " + r.session.end + ", done " + x.done + ", attempt " + r.session.attempts + ", " + s.requests + " main requests, exposure " + JSON.stringify({ loaded: e?.loaded, procedure: e?.procedure, markers: e?.markers.slice(0, 4), foreign_reads: e?.foreign_reads }) + ", mcp " + JSON.stringify(mcp) + ", runtimes " + runtimes.join(", ") + ", close finalized " + close.finalized + ", score verified " + r.score?.verified + " (" + r.score?.outcome + "), " + ((Date.now() - t0) / 1000).toFixed(0) + " s; " + out);
    }
  } finally {
    const stopped = await served.stop();
    rule("teardown", stopped === 0, closes + " slots closed in the summaries; driver stop exit " + stopped);
  }
  writeFileSync(join(W, "e2e.txt"), lines.join("\n") + "\n");
  const failed = lines.filter((l) => l.startsWith("FAIL"));
  if (failed.length) console.error("E_H2H_E2E_FAIL " + failed.length + " of " + lines.length + " lines failed; " + join(W, "e2e.txt"));
  return failed.length ? 1 : 0;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
