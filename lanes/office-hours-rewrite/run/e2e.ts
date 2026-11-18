// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours rewrite eval's paid path end to end, keyless, on this machine with Docker (prereg sections 2, 4, 8,
// 12 and 13; pre-run change 1, items 1, 4a and 4c; pre-run change 2). It drives two invented briefs through the real
// path: a temporary ledger with an item for the arms and one for the simulator, the real Docker rig with the real arm
// images (none, and gstack at both pins), the real proxy container, a stub model server on this host behind that proxy
// through the proxy's test-only upstream override, runLaunch with the real closing loop, the real simulator turn
// (sim/founder.ts simTurn) spending through the product-value meter on the simulator item, the real block parser and
// the rows.
//   fx-t8 (a founder T8 brief with prior.json)  none, current, new: the founder sets done on its second reply, the
//       closing message replaces it, and the adviser's block ends the session. On the skill arms the stub's first step
//       runs Bash in the container: gstack-session-kind, gstack-slug, the profile's --kill-check and --read.
//   fx-build (a builder brief)                  none: no block after the first closing message, a block after the
//       second; current and new: as fx-t8.
// Every key variable is removed from this process first; the only key-shaped values are placeholders the proxy and the
// meter hand the stub. It prints one PASS or FAIL line per check, or one SKIP line when Docker is not there. The rig
// finds both pin commits in a local repository (a gstack checkout, or one under <state>/sources/); it never fetches.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, posix } from "node:path";
import { sse, type Block } from "../../../quick/laneb/runner/fake_upstream.ts";
import { recordApproval } from "../../../src/runner/ledger/ledger.ts";
import { ledgerPath, recordPath } from "../../../src/runner/ledger/paths.ts";
import { readItem } from "../../../src/runner/ledger/record.ts";
import { DEFAULT_POLICY, loadPolicy, type LoadedPolicy } from "../../../src/skill-eval/cli/policy.ts";
import { dockerRig, type HostRig } from "../../../src/skill-eval/cli/run-host.ts";
import { readJournalLines } from "../../../src/trial/review/cost.ts";
import { openMeter } from "../../product-value/meter.ts";
import { ARMS, CLOSING, DENIED_TOOLS, firstMessage, LENS_LINE, MODEL_KEYS, PINS } from "../frozen.ts";
import { parseBlock } from "../score/block.ts";
import { simTurn } from "../sim/founder.ts";
import type { BriefMeta, ManifestEntry, PriorSession } from "../types.ts";
import { readManifest } from "./manifest.ts";
import { armSpecs, containerRoot } from "./pins.ts";
import { readRows, rowProblems, rowsReport } from "./rows.ts";
import { ALLOWANCES, meterSim, runLaunch, type RunResult } from "./run.ts";

export interface Check {
  check: string;
  ok: boolean;
  detail: string;
}

export interface E2eOptions {
  keep?: boolean;
  log?: (line: string) => void;
}

const D = 1_000_000;
const KEY_VAR = /(^|_)(API_)?KEY$|_TOKEN$|SECRET|PASSWORD/;
const PROBE_ID = "toolu_ohr_e2e_probe";
const SHEET = "The sheet:\n";
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const BRIEFS: Record<"fx-t8" | "fx-build", { meta: Omit<BriefMeta, "digest">; opening: string; facts: { id: string; text: string; reveal_when: string; kind: string }[]; prior?: PriorSession }> = {
  "fx-t8": {
    meta: { id: "fx-t8", kind: "founder", type: "T8", skin: 0, cluster: "fx-t8", set: "calibration", draw: 1, author: "sol", twin_of: null, traction: false, anti_pattern: null, industry: "fixture", pilot: false },
    opening: "Last time we spoke I said I would get the three gardens using Plotline, my watering-shift page, to prepay a month. I'm back to talk about what happened.",
    facts: [
      { id: "f1", text: "One of the three gardens prepaid ten dollars for July.", reveal_when: "Asked how the prepay test went.", kind: "payment" },
      { id: "f2", text: "The other two leads said they would wait until spring.", reveal_when: "Asked what the others said.", kind: "demand" },
    ],
    prior: { date: day(-20), assignment: "Ask the three gardens to prepay a month of Plotline.", test: "Two of the three gardens prepay.", test_date: day(-10), condition: "if fewer than two prepay, change direction" },
  },
  "fx-build": {
    meta: { id: "fx-build", kind: "builder", type: "hackathon", skin: 0, cluster: "fx-build", set: "calibration", draw: 2, author: "sol", twin_of: null, traction: false, anti_pattern: null, industry: "fixture", pilot: false },
    opening: "I have a weekend hackathon coming up and want to build Tallyroom, a phone map of free seats in campus study halls. What should I build first?",
    facts: [
      { id: "g1", text: "I have one seat sensor working on my desk.", reveal_when: "Asked what is built.", kind: "attempt" },
      { id: "g2", text: "The hackathon judges score live demos above slides.", reveal_when: "Asked how it is judged.", kind: "other" },
    ],
  },
};
const BLOCK = "Here is where I land.\n\nDECISION: Demo one live seat sensor on the map before anything else.\nNEXT ACTION: You wire the desk sensor to the map by Saturday noon.\nWHY: One sensor works; judges score live demos.";

/** True when Docker answers on this machine. */
const dockerUp = (bin: string) => spawnSync(bin, ["info"], { stdio: "ignore" }).status === 0;

export async function runE2e(o: E2eOptions = {}): Promise<{ checks: Check[]; dir: string | null; skipped: boolean }> {
  const log = o.log ?? ((l: string) => console.error(l));
  const docker = process.env.GSTACK_EVALS_DOCKER_BIN || "docker";
  if (!dockerUp(docker)) {
    console.log("SKIP ohr e2e: Docker does not answer on this machine (" + docker + " info failed)");
    return { checks: [], dir: null, skipped: true };
  }
  for (const k of Object.keys(process.env)) if (KEY_VAR.test(k)) delete process.env[k];
  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail: string) => {
    checks.push({ check: name, ok, detail });
    console.log((ok ? "PASS " : "FAIL ") + name + ": " + detail);
  };
  mkdirSync(join(homedir(), ".capy", "work"), { recursive: true });
  const W = mkdtempSync(join(homedir(), ".capy", "work", "ohr-e2e-"));
  const briefsDir = join(W, "briefs");
  for (const [id, b] of Object.entries(BRIEFS)) {
    mkdirSync(join(briefsDir, id), { recursive: true });
    writeFileSync(join(briefsDir, id, "opening.md"), b.opening + "\n");
    writeFileSync(join(briefsDir, id, "sheet.json"), JSON.stringify({ persona: "A fixture person for the keyless end to end.", facts: b.facts }, null, 2) + "\n");
    writeFileSync(join(briefsDir, id, "key.json"), JSON.stringify({ call: "fixture", actions: [], decisive: [b.facts[0]!.id], twin: null, traction: false, wrong_call: null }) + "\n");
    writeFileSync(join(briefsDir, id, "brief.json"), JSON.stringify({ ...b.meta, digest: "fixture" }, null, 2) + "\n");
    if (b.prior) writeFileSync(join(briefsDir, id, "prior.json"), JSON.stringify(b.prior, null, 2) + "\n");
  }
  const entries: ManifestEntry[] = (["fx-t8", "fx-build"] as const).flatMap((brief) => ARMS.map((arm) => ({ stage: 1 as const, brief, model: "opus" as const, arm })));

  let roots: string[] = [];
  const main: { tools: string[]; text: string }[] = [];
  let viaProxy = 0;
  const sim: { n: number; done: boolean; revealed: string[] }[] = [];
  const escaped = (s: string) => JSON.stringify(s).slice(1, -1);
  const probe = () => "for R in " + roots.join(" ") + "; do test -x \"$R/bin/gstack-slug\" && break; done; echo \"SESSION_KIND: $(\"$R/bin/gstack-session-kind\" 2>&1)\"; echo \"SLUG: $(\"$R/bin/gstack-slug\" --get SLUG 2>&1)\"; \"$R/bin/gstack-developer-profile\" --kill-check idea 2>&1; \"$R/bin/gstack-developer-profile\" --read 2>&1 | head -40; true";
  const script = (text: string): Block[] => {
    const skill = text.includes("/office-hours");
    if (skill && !text.includes(PROBE_ID)) return [{ type: "tool_use", id: PROBE_ID, name: "Bash", input: { command: probe(), description: "Read the session's gstack state" } }];
    const closings = text.split(escaped(CLOSING)).length - 1;
    if (closings === 0) return [{ type: "text", text: "What has happened since, and who has asked for it?" }];
    if (closings === 1 && !skill && text.includes("Tallyroom")) return [{ type: "text", text: "Let me think about which way to go before I answer." }];
    return [{ type: "text", text: BLOCK }];
  };
  const stub = Bun.serve({
    hostname: "0.0.0.0",
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      if (req.method !== "POST") return Response.json({});
      const body = (await req.json()) as any;
      if (path.endsWith("/count_tokens")) return Response.json({ input_tokens: 10 });
      if (path.endsWith("/chat/completions")) {
        const system = String(body.messages[0]?.content ?? "");
        const sheet = JSON.parse(system.slice(system.indexOf(SHEET) + SHEET.length)) as { facts: { id: string; text: string }[] };
        const n = body.messages.filter((m: any) => m.role === "user").length;
        const fact = sheet.facts[(n - 1) % sheet.facts.length]!;
        const turn = { reply: "Reply " + n + ": " + fact.text, revealed: [fact.id], rules: [3], done: n >= 2 };
        sim.push({ n, done: turn.done, revealed: turn.revealed });
        return Response.json({ id: "gen-ohr-e2e", provider: "google-vertex", model: body.model, choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(turn) }, finish_reason: "stop" }], usage: { prompt_tokens: 40, completion_tokens: 30, total_tokens: 70 } });
      }
      viaProxy++;
      const tools = Array.isArray(body.tools) ? body.tools.map((t: any) => t.name ?? t.type) : [];
      const text = JSON.stringify(body.messages ?? []);
      const blocks: Block[] = tools.includes("Bash") ? script(text) : [{ type: "text", text: "ok" }];
      if (tools.includes("Bash")) {
        main.push({ tools, text });
        appendFileSync(join(W, "stub-requests.ndjson"), JSON.stringify({ tools, text }) + "\n");
      }
      if (body.stream) return new Response(sse(body.model, blocks), { headers: { "content-type": "text/event-stream" } });
      return Response.json({ id: "msg_ohr_e2e", type: "message", role: "assistant", model: body.model, content: blocks, stop_reason: blocks.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn", usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
    },
  });

  const record = join(W, "record");
  const ledger = join(W, "ledger.sqlite");
  const quote = { words: "keyless end-to-end run on a temporary ledger, not an approval", by: "ohr e2e", source: "lanes/office-hours-rewrite/run/e2e.ts" };
  const items = { arms: "ohr-e2e-arms", sim: "ohr-e2e-sim" };
  for (const item of Object.values(items)) recordApproval(record, { action: "init", item, cap_micros: 150 * D, quotes: [quote], admission: "warn" });
  const env: Record<string, string | undefined> = { ...process.env, ANTHROPIC_API_KEY: "stub-not-a-key" };
  const policy = loadPolicy(DEFAULT_POLICY) as LoadedPolicy;
  const runId = "ohr-e2e-" + randomBytes(4).toString("hex");
  const out = join(W, "out");
  mkdirSync(join(W, "fixtures"), { recursive: true });
  writeFileSync(join(W, "fixtures", "tasks.json"), "[]\n");
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: import.meta.dir, encoding: "utf8" }).stdout.trim();
  const meter = await openMeter({ item: items.sim, runId, out: join(W, "sim-meter"), cacheDir: join(W, "sim-cache"), maxOutputTokens: 1200, amountMicros: 20 * D, record, ledger, env: { OPENROUTER_API_KEY: "stub-not-a-key" }, fetch: ((url: string | URL | Request, init?: RequestInit) => fetch(String(url).replace(/^https:\/\/openrouter\.ai\/api/, "http://127.0.0.1:" + stub.port), init)) as typeof fetch });
  const rigSeen: { egress: { open: boolean; detail: string } | null; journal: string } = { egress: null, journal: "" };
  let run: RunResult | null = null;
  let failure = "";
  try {
    run = await runLaunch({ launch: "stage1", briefsDir, out, runId, models: ["opus"], arms: [...ARMS], pins: PINS, buildCommit: head, dropped: [], allowances: ALLOWANCES, cap: 100 * D, simCap: 20 * D, parallel: 1, policy, docker, day: day(0), log, entries }, {
      openRig: (): HostRig => {
        const rig = dockerRig({ host: "claude", arms: { arms: armSpecs(ARMS), base: null, skill: null, notes: [] }, tasks: join(W, "fixtures", "tasks.json"), out: { path: out, rule: "--out" }, ledger: ledgerPath(ledger, {}), record: recordPath(record, {}), item: items.arms, runId, models: [MODEL_KEYS.opus], policy }, { env, skill: null, skills: { current: "office-hours", new: "office-hours" }, nonce: randomBytes(6).toString("hex"), cap: 100 * D, voice: false, upstream: "http://host.docker.internal:" + stub.port });
        roots = [...new Set((["current", "new"] as const).map((a) => containerRoot(rig.sandbox(a, false, MODEL_KEYS.opus).homePath(""), rig.arms[a]?.gstack ?? "")).map((r) => posix.normalize(r)))];
        rigSeen.egress = rig.egress();
        rigSeen.journal = rig.recovery?.journal ?? "";
        return rig;
      },
      simSlot: meterSim(meter),
      simTurn,
      parse: parseBlock,
    });
  } catch (e) {
    failure = (e as Error).message;
  } finally {
    await meter.close();
    stub.stop(true);
  }
  check("the launch ran", run !== null, failure || "runLaunch returned");
  if (!run) {
    if (!o.keep) rmSync(W, { recursive: true, force: true });
    return { checks, dir: W, skipped: false };
  }
  const rows = readRows(out);
  const row = (arm: string, brief: string) => rows.get("s1/opus/" + arm + "/" + brief)?.row;
  const lines = [...rows.values()];
  const transcript = (arm: string, brief: string) => {
    const p = row(arm, brief)?.transcript;
    return p && existsSync(p) ? readFileSync(p, "utf8") : "";
  };
  check("the launch ended with no stop and every session has a row", run.stops.length === 0 && run.unrun.length === 0 && lines.length === 6, run.stops.map((s) => s.code + " " + s.message).join("; ") || lines.length + " rows");
  const attempts = lines.flatMap((l) => l.attempts);
  check("no key in any container's env, no mount but the work dir and HOME, no departure in the arm env", attempts.length === 6 && attempts.every((a) => a.contained !== null && a.contained.length === 0), attempts.map((a) => (a.contained === null ? "probe did not run" : a.contained.length ? a.contained.join(", ") : "clean")).join("; "));
  check("the egress probe is closed", rigSeen.egress !== null && !rigSeen.egress.open, rigSeen.egress ? rigSeen.egress.detail : "no probe");
  const denied = main.filter((m) => DENIED_TOOLS.some((t) => m.tools.includes(t)));
  check("WebSearch, WebFetch and AskUserQuestion are absent from every request the stub saw", main.length > 0 && denied.length === 0, main.length + " main-agent requests, " + denied.length + " with a denied tool");
  for (const brief of Object.keys(BRIEFS)) {
    const opening = BRIEFS[brief as keyof typeof BRIEFS].opening;
    const asked = main.filter((m) => m.text.includes(escaped(LENS_LINE + "\n\n" + opening)));
    const none = asked.filter((m) => m.text.includes(escaped(firstMessage("none", opening))) && !m.text.includes("/office-hours"));
    const skill = asked.filter((m) => m.text.includes("/office-hours"));
    check(brief + ": the none arm got the lens line before the opening, and the skill arms /office-hours with the same text", none.length > 0 && skill.length > 0, none.length + " none requests, " + skill.length + " skill requests");
  }
  for (const [name, item] of Object.entries(items)) {
    const it = readItem(record, item);
    check("one lease opened and settled on the " + name + " item", it.open === null && it.leases.length === 1 && it.leases[0]!.close !== null, it.leases.length + " opened, " + it.leases.filter((l) => l.close !== null).length + " settled");
  }
  const jl = rigSeen.journal && existsSync(rigSeen.journal) ? readJournalLines(rigSeen.journal) : [];
  const outcomes = jl.filter((l: any) => l.kind === "outcome");
  check("the proxy journal shows every call that reached the stub", outcomes.length === viaProxy && viaProxy > 0, outcomes.length + " outcomes journaled, " + viaProxy + " calls reached the stub through the proxy");
  for (const id of lines.map((l) => l.id)) {
    const l = rows.get(id)!;
    const r = l.row;
    const twice = r.brief === "fx-build" && r.arm === "none";
    const t = r.founder_turns;
    check(id + ": " + (twice ? "no block after the first closing message, a block after the second" : "the founder's done reply was replaced by the closing message, and the block ended the session"), r.end === "block" && r.closings === (twice ? 2 : 1) && r.founder_done && t.length === 2 && t[0]!.delivered && !t[1]!.delivered && t[1]!.done, r.end + ", " + r.closings + " closings, turns " + t.map((x) => x.delivered).join("/"));
  }
  const turns = lines.flatMap((l) => l.row.founder_turns);
  const factAt = (brief: string, n: number) => BRIEFS[brief as keyof typeof BRIEFS].facts[(n - 1) % 2]!.id;
  const read = lines.every((l) => l.row.founder_turns.every((t, i) => t.revealed.join() === factAt(l.row.brief, i + 1) && t.done === i >= 1 && t.rejected_draws.length === 0));
  check("the founder turns are the real simulator's reading of the stub's draws, and the meter serves a repeated request from its cache", turns.length === 12 && read && sim.length === 4, turns.length + " turns, " + sim.length + " distinct simulator calls reached the stub");
  for (const arm of ["current", "new"] as const) {
    for (const brief of Object.keys(BRIEFS)) {
      const r = row(arm, brief);
      check(arm + " on " + brief + ": the container printed SESSION_KIND: interactive and the row reads it", r?.session_kind === "interactive", String(r?.session_kind));
      check(arm + " on " + brief + ": gstack-slug prints idea in the work repo", /SLUG: idea\b/.test(transcript(arm, brief)), (/SLUG: [\w-]+/.exec(transcript(arm, brief)) ?? ["no SLUG line"])[0]);
      check(arm + " on " + brief + ": the pin check in the container passed and the state root was copied out", lines.find((l) => l.id === "s1/opus/" + arm + "/" + brief)?.attempts.every((a) => a.contained !== null) === true && !!r?.state_root && existsSync(r.state_root), r?.state_root ?? "no row");
    }
  }
  check("none rows have no session kind", ["fx-t8", "fx-build"].every((b) => row("none", b)?.session_kind === null), ["fx-t8", "fx-build"].map((b) => String(row("none", b)?.session_kind)).join(", "));
  check("new on fx-t8: the seeded commitment is due (KILL_DUE: yes)", transcript("new", "fx-t8").includes("KILL_DUE: yes"), (/KILL_DUE: \w+/.exec(transcript("new", "fx-t8")) ?? ["no KILL_DUE line"])[0]);
  check("new on fx-build: no seed, so nothing is due", !transcript("new", "fx-build").includes("KILL_DUE: yes"), (/KILL_DUE: \w+/.exec(transcript("new", "fx-build")) ?? ["no KILL_DUE line"])[0]);
  check("current on fx-t8: --read returns the seeded assignment", transcript("current", "fx-t8").includes("Ask the three gardens to prepay a month of Plotline."), transcript("current", "fx-t8").includes("LAST_ASSIGNMENT") ? "LAST_ASSIGNMENT printed" : "no LAST_ASSIGNMENT");
  const problems = lines.flatMap((l) => rowProblems(l));
  const report = rowsReport(readManifest(join(out, "manifest.json")), rows);
  check("the rows parse and match the frozen manifest", problems.length === 0 && report.problems.length === 0 && report.unrun.length === 0, lines.length + " rows" + (problems.length + report.problems.length ? ": " + [...problems, ...report.problems].join("; ") : ""));
  if (!o.keep) rmSync(W, { recursive: true, force: true });
  return { checks, dir: W, skipped: false };
}

if (import.meta.main) {
  const { checks } = await runE2e({ keep: process.argv.includes("--keep") });
  const failed = checks.filter((c) => !c.ok);
  if (failed.length) console.error("E_OHR_E2E_FAIL " + failed.map((c) => c.check).join("; "));
  process.exit(failed.length ? 2 : 0);
}
