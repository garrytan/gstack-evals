// The review-models pilot end to end, keyless, on this machine with Docker (GEVA-590 prereg sections 3, 5, 8 and 10;
// pre-run changes 1 and 2). It drives two toy units through the real pilot path: rm-supply's buildChecked builds a P unit
// (a 210-line PR) and a B unit (a commit on its own parent) from a toy source whose .claude/settings.json carries hooks
// and permissions and which has a .mcp.json, so the build strips them; a temporary ledger holds one warn item per cell and
// one for the retry reserve; then rm-run pilot runs review-units with the seeded order, one Docker rig per cell (each with
// its own lease), the retry rig, the real metering proxy with --remove-voice-web-search, and the trial image's Claude Code
// and Codex 0.170.0. Every model call goes to a stub on this host behind the proxy (--upstream). The stub's main agent runs
// the pinned review/sections/adversarial.md blocks in each gstack cell, so Codex sends its real requests, web_search
// included, and the proxy has to remove that tool. Every provider key is blanked in the run's environment. It prints one
// PASS or FAIL line per check, or SKIP when Docker or the trial image is not there.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { ledgerCli } from "../../runner/ledger/cli.ts";
import { ledgerStatus } from "../../runner/ledger/ledger.ts";
import { stateRoot } from "../image.ts";
import { RETRY_RUN_ID, REVIEW_CAP_USD } from "./rm-run.ts";
import { main as rmRun } from "./rm-run.ts";
import { blockAfter, messagesAnswer, OUTSIDE_TEXT, responsesAnswer, type Block } from "./rm-check.ts";
import { RM_CELLS, RM_GSTACK } from "./rm-cells.ts";
import { armId } from "./run.ts";
import { buildChecked } from "./supply/b-units.ts";
import { builtDir } from "./unit-repos.ts";

export interface Check {
  check: string;
  ok: boolean;
  detail: string;
}

const GUARD = "[ -x ~/.claude/skills/gstack/bin/gstack-codex-probe ] || { echo RM_E2E_NO_GSTACK; exit 0; }\n";
const PLANT = "rm-e2e planted web_search";
const PLANT_STEP = [
  "B=$(grep '^model_providers.gstack_evals_proxy.base_url = ' ~/.codex/config.toml | cut -d'\"' -f2)",
  "M=$(grep '^model = ' ~/.codex/config.toml | cut -d'\"' -f2)",
  "BODY=$(printf '" + JSON.stringify({ model: "%s", input: PLANT, tools: [{ type: "web_search" }], stream: false }) + "' \"$M\")",
  "curl -sS -o /dev/null -w 'PLANTED_STATUS: %{http_code}\\n' \"$B/responses\" -H \"authorization: Bearer $OPENAI_API_KEY\" -H 'content-type: application/json' -d \"$BODY\"",
].join("\n");
const ANSWER = "```json\n[]\n```";

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? cwd, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "rm-e2e", GIT_AUTHOR_EMAIL: "rm-e2e@example.invalid", GIT_COMMITTER_NAME: "rm-e2e", GIT_COMMITTER_EMAIL: "rm-e2e@example.invalid" } });
  if (r.status !== 0) throw new Error("E_RM_RUN rm-run e2e: git " + args.join(" ") + ": " + (r.stderr || r.stdout).trim());
  return r.stdout.trim();
}

/** The toy source and its two units, built and stripped as rm-supply build does, with units.json beside them. */
function toyUnits(dir: string): { build: string; ids: string[]; stripped: string[] } {
  const src = join(dir, "source");
  mkdirSync(join(src, "src"), { recursive: true });
  mkdirSync(join(src, ".claude"), { recursive: true });
  git(src, "init", "-q", "-b", "main");
  writeFileSync(join(src, "package.json"), JSON.stringify({ name: "toy", private: true }) + "\n");
  writeFileSync(join(src, "src", "app.ts"), "export const add = (a: number, b: number) => a + b;\n");
  writeFileSync(join(src, ".claude", "settings.json"), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "echo hook" }] }] }, permissions: { allow: ["Bash"] }, model: "x" }) + "\n");
  writeFileSync(join(src, ".mcp.json"), "{}\n");
  writeFileSync(join(src, "CLAUDE.md"), "Toy repository.\n");
  git(src, "add", "-A");
  git(src, "commit", "-q", "-m", "initial");
  const base = git(src, "rev-parse", "HEAD");
  writeFileSync(join(src, "src", "app.ts"), "export const add = (a: number, b: number) => a - b;\n");
  git(src, "commit", "-q", "-am", "simplify add");
  const bic = git(src, "rev-parse", "HEAD");
  git(src, "checkout", "-q", "-b", "feature");
  writeFileSync(join(src, "src", "feature.ts"), Array.from({ length: 210 }, (_, i) => "export const f" + i + " = " + i + ";").join("\n") + "\n");
  git(src, "add", "-A");
  git(src, "commit", "-q", "-m", "feature");
  const head = git(src, "rev-parse", "HEAD");
  git(src, "checkout", "-q", "main");
  const build = join(dir, "units");
  mkdirSync(build, { recursive: true });
  const refs = [
    { id: "rm-e2e/toy#7@" + head.slice(0, 12), repo: "rm-e2e/toy", pr: 7, head, base: bic },
    { id: "rm-e2e/toy#0@" + bic.slice(0, 12), repo: "rm-e2e/toy", pr: 0, head: bic, base },
  ];
  const stripped: string[] = [];
  const rows = refs.map((unit) => {
    const b = buildChecked({ unit, source: src, dest: builtDir(build, unit.id), needles: { strings: [], fix: "0".repeat(40) } });
    stripped.push(unit.id + ": " + b.instructions.strip.map((s) => s.path + " " + s.action).join(", "));
    return { id: unit.id, repo: b.repo, instructions: b.instructions, problems: b.problems };
  });
  writeFileSync(join(build, "units.json"), JSON.stringify(rows, null, 2) + "\n");
  return { build, ids: refs.map((r) => r.id), stripped };
}

interface Seen { api: "messages" | "responses" | "other"; model: string; tools: string[]; kind: string; auth: string }

/** The stub upstream behind the proxy. The proxy strips the slot, so the main agent's script is stateless: the first step whose tool call has no result yet. */
async function startStub(steps: Block[][]): Promise<{ port: number; seen: Seen[]; close: () => Promise<void> }> {
  const seen: Seen[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const path = new URL(req.url ?? "/", "http://stub").pathname;
      let body: Record<string, any> = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        body = {};
      }
      const send = (a: { type: string; body: string }) => {
        res.writeHead(200, { "content-type": a.type });
        res.end(a.body);
      };
      const auth = String(req.headers["x-api-key"] ?? req.headers.authorization ?? "");
      const tools = Array.isArray(body.tools) ? body.tools.map((t: any) => String(t?.type ?? t?.name ?? "")) : [];
      if (req.method === "POST" && path.endsWith("/v1/responses")) {
        const text = JSON.stringify(body.input ?? "");
        seen.push({ api: "responses", model: String(body.model ?? ""), tools, kind: text.includes("reply OK") ? "probe" : text.includes(PLANT) ? "planted" : "voice", auth });
        return send(responsesAnswer(body, text.includes("reply OK") ? "OK" : OUTSIDE_TEXT));
      }
      if (req.method !== "POST" || !path.endsWith("/v1/messages")) {
        seen.push({ api: "other", model: "", tools: [], kind: req.method + " " + path, auth });
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ data: [] }));
      }
      const messages: any[] = body.messages ?? [];
      const main = tools.length > 0;
      seen.push({ api: "messages", model: String(body.model ?? ""), tools: [], kind: main ? "main" : "side", auth });
      if (!main) return send(messagesAnswer(body, [{ type: "text", text: "done" }]));
      const done = new Set(messages.flatMap((m) => (m.role === "user" && Array.isArray(m.content) ? m.content.filter((b: any) => b.type === "tool_result").map((b: any) => b.tool_use_id) : [])));
      const step = steps.find((blocks) => blocks.every((b) => b.type !== "tool_use" || !done.has(b.id)));
      return send(messagesAnswer(body, step ?? [{ type: "text", text: ANSWER }]));
    });
  });
  await new Promise<void>((r) => server.listen(0, "0.0.0.0", () => r()));
  return { port: (server.address() as AddressInfo).port, seen, close: () => new Promise<void>((r) => server.close(() => r())) };
}

/** Every file under dir whose name passes keep. */
function walk(dir: string, keep: (name: string) => boolean, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, keep, out);
    else if (keep(n)) out.push(p);
  }
  return out;
}

export async function rmE2e(o: { out: string; log?: (line: string) => void }): Promise<{ skipped: string | null; checks: Check[] }> {
  const log = o.log ?? (() => {});
  if (spawnSync("docker", ["info"], { encoding: "utf8" }).status !== 0) return { skipped: "Docker is not running here", checks: [] };
  const out = resolve(o.out);
  if (existsSync(out) && readdirSync(out).length) throw new Error("E_USAGE rm-run e2e: --out " + out + " is not empty; pass a new directory");
  mkdirSync(out, { recursive: true });
  const checks: Check[] = [];
  const add = (check: string, ok: boolean, detail: string) => {
    checks.push({ check, ok, detail });
    log((ok ? "PASS " : "FAIL ") + check + ": " + detail);
  };
  const sources = join(stateRoot(), "sources");
  const pinRepo = [join(process.env.HOME ?? "", ".local", "share", "gstack"), ...(existsSync(sources) ? readdirSync(sources).map((n) => join(sources, n)) : [])].find((d) => spawnSync("git", ["-C", d, "cat-file", "-e", RM_GSTACK.sha + "^{commit}"]).status === 0);
  if (!pinRepo) return { skipped: "no local repository holds gstack " + RM_GSTACK.sha + "; clone it under " + sources, checks: [] };
  const md = spawnSync("git", ["-C", pinRepo, "show", RM_GSTACK.sha + ":review/sections/adversarial.md"], { encoding: "utf8" }).stdout;
  const prompt = "/tmp/rm-e2e-prompt.txt";
  const promptText = "Review the changes on this branch against the base branch. Find ways this code will fail in production. End with exactly VERDICT: CLEAN or VERDICT: FINDINGS as the last line.";
  const bash = (i: number, command: string): Block[] => [{ type: "tool_use", id: "toolu_rm_e2e_" + i, name: "Bash", input: { command: GUARD + command, description: "e2e step " + i, timeout: 600_000 } }];
  const steps: Block[][] = [
    bash(1, "codex --version; ~/.claude/skills/gstack/bin/gstack-codex-probe select-model exec"),
    bash(2, blockAfter(md, "**Detect diff size:**", { base: "main" })),
    bash(3, blockAfter(md, "**Detect the Codex master switch + tool availability:**", { base: "main" })),
    bash(4, "cat > " + prompt + " <<'RM_PROMPT'\n" + promptText + "\nRM_PROMPT\n" + blockAfter(md, "### Codex adversarial challenge", { base: "main", prompt })),
    bash(5, blockAfter(md, "### Codex structured review", { base: "main", prompt })),
    bash(6, PLANT_STEP),
  ];

  const toy = toyUnits(join(out, "toy"));
  add("units built and stripped", toy.stripped.every((s) => s.includes(".claude/settings.json keys") && s.includes(".mcp.json removed")), toy.stripped.join("; "));

  const ledgerDir = join(out, "ledger");
  mkdirSync(ledgerDir, { recursive: true });
  const approvals = join(ledgerDir, "gstack-approvals");
  writeFileSync(approvals, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const blank = Object.fromEntries(Object.keys(process.env).filter((k) => /(^|_)(API_)?KEY$|_TOKEN$|SECRET|PASSWORD/.test(k)).map((k) => [k, ""]));
  const env: Record<string, string | undefined> = { ...process.env, ...blank, ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", OPENROUTER_API_KEY: "", GSTACK_EVALS_APPROVALS_BIN: approvals, GSTACK_EVALS_LEDGER_RECORD: join(ledgerDir, "record"), GSTACK_EVALS_LEDGER: join(ledgerDir, "ledger.sqlite") };
  const quiet = { out: (l: string) => log("  " + l), err: (l: string) => log("  " + l) };
  const capOf = (c: (typeof RM_CELLS)[number]) => Math.ceil(REVIEW_CAP_USD[c.id] * toy.ids.length) + 5;
  const items = [...RM_CELLS.map((c) => ["e2e-" + c.id.toLowerCase(), capOf(c)] as const), ["e2e-retry", 20] as const];
  for (const [item, cap] of items) {
    const code = await ledgerCli(["init", "--cap", String(cap), "--item", item, "--admission", "warn", "--words", "keyless e2e", "--by", "rm-run e2e", "--source", "src/trial/review/rm-e2e.ts"], quiet, env);
    if (code !== 0) throw new Error("E_RM_RUN rm-run e2e: ledger init " + item + " exited " + code);
  }
  const plan = join(out, "plan");
  mkdirSync(plan, { recursive: true });
  writeFileSync(join(plan, "pilot-units.txt"), toy.ids.toSorted().join("\n") + "\n");
  writeFileSync(join(plan, "commands.json"), JSON.stringify({ "rm-e2e/toy": { install: "true", test: "true" } }) + "\n");
  writeFileSync(join(plan, "cell-items.json"), JSON.stringify({ schema: "rm-cell-items.v1", cells: Object.fromEntries(RM_CELLS.map((c) => [armId(c.arm, c.model), { item: "e2e-" + c.id.toLowerCase(), cap_usd: capOf(c), allowance_usd: REVIEW_CAP_USD[c.id] }])), retry: { item: "e2e-retry", run_id: RETRY_RUN_ID, cap_usd: 20 } }, null, 2) + "\n");

  const stub = await startStub(steps);
  const run = join(out, "run");
  let code: number;
  try {
    code = await rmRun(["pilot", "--plan", plan, "--unit-repos", toy.build, "--commands", join(plan, "commands.json"), "--out", run, "--upstream", "http://host.docker.internal:" + stub.port, "--ledger", join(ledgerDir, "ledger.sqlite"), "--ledger-record", join(ledgerDir, "record")], { out: (l) => log("  " + l), err: (l) => log("  " + l) }, env);
  } finally {
    await stub.close();
  }
  add("rm-run pilot exits 0", code === 0, "exit " + code);

  const entries = existsSync(join(run, "cells.ndjson")) ? readFileSync(join(run, "cells.ndjson"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  const want = toy.ids.length * RM_CELLS.length;
  const done = entries.filter((e) => e.record?.termination?.kind === "completed");
  add("every unit in every cell", entries.length === want && done.length === want, entries.length + " entries, " + done.length + " completed of " + want + ": " + [...new Set(entries.map((e) => e.record?.termination?.kind + (e.record?.termination?.code ? " " + e.record.termination.code : "")))].join(", "));
  const order = existsSync(join(run, "order.tsv")) ? readFileSync(join(run, "order.tsv"), "utf8").trim().split("\n").slice(1) : [];
  const unitsInOrder = order.map((l) => l.split("\t")[3]);
  const grouped = unitsInOrder.every((u, i) => i === 0 || u === unitsInOrder[i - 1] || !unitsInOrder.slice(0, i).includes(u));
  add("seeded order groups each unit's cells", order.length === want && grouped, order.length + " rows; unit sequence " + unitsInOrder.map((u) => u?.split("#")[1]).join(" "));
  const costFiles = walk(run, (n) => n === "cost.tsv");
  const cost = costFiles.flatMap((p) => readFileSync(p, "utf8").trim().split("\n").slice(1));
  const voiceRows = cost.filter((l) => l.split("\t")[1] === "voice");
  add("cost.tsv voice rows", voiceRows.length === toy.ids.length * RM_CELLS.filter((c) => c.voice).length && voiceRows.every((l) => l.split("\t")[9] !== "unavailable"), voiceRows.length + " voice rows in " + costFiles.length + " cost.tsv files, " + cost.length + " rows in all");
  const journals = walk(run, (n) => n.endsWith(".ndjson") && n.includes("journal"));
  const removed = journals.flatMap((j) => readFileSync(j, "utf8").split("\n").filter((l) => l.includes("\"tool_removed\"")));
  const voiceSeen = stub.seen.filter((s) => s.api === "responses" && s.kind !== "probe");
  const planted = stub.seen.filter((s) => s.kind === "planted");
  const gstackCells = RM_CELLS.filter((c) => c.voice).length * toy.ids.length;
  add("the proxy removes web_search from the voice and journals it", removed.length >= gstackCells && planted.length === gstackCells && voiceSeen.every((s) => !s.tools.includes("web_search")), removed.length + " tool_removed lines in " + journals.length + " journals; " + planted.length + " planted requests and " + (voiceSeen.length - planted.length) + " Codex voice requests reached the stub, " + voiceSeen.filter((s) => s.tools.includes("web_search")).length + " still carrying web_search");
  const codexAsked = walk(run, (n) => n.startsWith("rollout-") && n.endsWith(".jsonl")).filter((p) => readFileSync(p, "utf8").includes("\"web_search\"")).length;
  log("NOTE Codex's own requests: " + codexAsked + " rollouts name a web_search tool; other stub calls: " + [...new Set(stub.seen.filter((s) => s.api === "other").map((s) => s.kind))].join(", "));
  const rollouts = walk(run, (n) => n.startsWith("rollout-") && n.endsWith(".jsonl")).filter((p) => p.includes("codex-sessions"));
  add("codex rollouts kept", rollouts.length >= toy.ids.length * RM_CELLS.filter((c) => c.voice).length, rollouts.length + " rollout files under host/codex-sessions");
  const transcripts = walk(run, (n) => n === "transcript.ndjson");
  const state = walk(run, () => true).filter((p) => p.includes("/gstack-state/"));
  add("exposure inputs kept", transcripts.length >= want && state.length > 0, transcripts.length + " transcripts, " + state.length + " gstack-state files");
  const status = new Map(ledgerStatus(join(ledgerDir, "record")).map((s) => [s.item, s]));
  const cellItems = RM_CELLS.map((c) => status.get("e2e-" + c.id.toLowerCase()));
  add("one lease per cell, settled", cellItems.every((s) => s && s.leases === 1 && !s.open_lease && s.committed_micros > 0), RM_CELLS.map((c, i) => c.id + " leases=" + cellItems[i]?.leases + " open=" + (cellItems[i]?.open_lease ? "yes" : "no") + " committed=" + ((cellItems[i]?.committed_micros ?? 0) / 1e6).toFixed(4)).join("; "));
  const retry = status.get("e2e-retry");
  add("retry reserve untouched when nothing reruns", entries.every((e) => !e.rerun) && (retry?.committed_micros ?? 0) === 0, "retry leases=" + retry?.leases + " committed=" + ((retry?.committed_micros ?? 0) / 1e6).toFixed(4));
  const auths = [...new Set(stub.seen.map((s) => s.auth.replace(/^Bearer /, "")))];
  add("only the placeholder key reaches the stub", stub.seen.length > 0 && auths.every((a) => a === "stub-not-a-key"), stub.seen.length + " requests; " + auths.length + " distinct credentials" + (auths.every((a) => a === "stub-not-a-key") ? ", all the placeholder" : ", not all the placeholder"));
  return { skipped: null, checks };
}
