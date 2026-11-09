#!/usr/bin/env bun
// Copyright (c) 2026 Garry Tan. MIT License.
// The family SM session path end to end, keyless (P5 reruns it): the session driver (stage.ts) on a temporary ledger with
// a stub Anthropic upstream in this process, Harbor at its pin, real_agent in SM mode and the runtime image's pinned Claude
// Code, on one real dry-run unit's prepared tree. The stub answers each main-loop request with one Bash edit of the unit's
// first fix file, then ends the turn. It runs the A1 first stage and then its follow-on F-A1-1 on that tree, each through
// the same gstack-evals outcome sm session run command a paid run uses, in a child process so this process keeps serving
// the control plane and the stub. It prints one PASS or FAIL line per check.
// Usage: bun e2e.ts --unit <unit dir> --harbor <harbor bin> [--keep]
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { machineId } from "../../../src/runner/ledger/ledger.ts";
import { recordProgram } from "../../../src/runner/ledger/envelope.ts";
import { recordApproval } from "../../../src/runner/ledger/ledger.ts";
import { LocalLedger } from "../../../src/runner/ledger/local.ts";
import { readItem } from "../../../src/runner/ledger/record.ts";
import { sse } from "../../../quick/laneb/runner/fake_upstream.ts";
import { serveStages } from "../driver/stage.ts";
import type { SessionImage } from "./image.ts";
import { planPart, type SessionRecord } from "./session.ts";
import { readUnit } from "./unit.ts";
import { extractChange } from "./score.ts";

const KEYS = /^(ANTHROPIC|OPENAI|OPENROUTER|UBICLOUD|GEMINI|GOOGLE|XAI|DEEPSEEK|TYPESAFE)_[A-Z_]*KEY$|_TOKEN$/;
for (const k of Object.keys(process.env)) if (KEYS.test(k)) delete process.env[k];
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const unitDir = arg("--unit") ?? "";
const harbor = arg("--harbor") ?? "harbor";
const keep = process.argv.includes("--keep");
const D = 1_000_000;
const quote = { words: "dry-run fixture words on a temporary ledger, not an approval", by: "e2e", source: "statemachines/e2e.ts" };
const MARK = "e2e stub edit";
const UNTRACKED = "e2e-untracked.txt";
const BLOB = "e2e-blob.bin";
const results: Array<{ check: string; ok: boolean; detail: string }> = [];
const rule = (check: string, ok: boolean, detail: string) => { results.push({ check, ok, detail }); console.log((ok ? "PASS " : "FAIL ") + check + ": " + detail); };
const sh = (image: string, script: string, mount?: string) => spawnSync("docker", ["run", "--rm", "--network", "none", ...(mount ? ["-v", mount + ":/e2e:ro"] : []), "--entrypoint", "bash", image, "-c", script], { encoding: "utf8", timeout: 300_000 });

const u = readUnit(unitDir);
const file = u.fix.files[0]!;
const W = mkdtempSync(join(homedir(), ".capy/work/geva-436/e2e-"));
const record = join(W, "record");
recordProgram(record, { program: "sm-e2e", cap_micros: 100 * D, skill_cap_micros: 100 * D, skills: ["sm"], credit_rate_micros: D, quotes: [quote] });
recordApproval(record, { action: "init", item: "sm-opus", cap_micros: 40 * D, quotes: [quote], admission: "required", program: "sm-e2e", skills: ["sm"] });
const local = LocalLedger.open(join(W, "ledger.sqlite"));
const stubLog: Array<Record<string, unknown>> = [];
const stub = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (req.method !== "POST") return Response.json({});
    const body = (await req.json()) as Record<string, any>;
    if (path.endsWith("/count_tokens")) return Response.json({ input_tokens: 10 });
    const main = Array.isArray(body.tools) && body.tools.length > 0;
    const edit = main && !JSON.stringify(body.messages ?? []).includes("tool_result");
    stubLog.push({ path, main, edit, tools: main ? body.tools.map((t: any) => t.name ?? t.type) : [] });
    const reply = edit ? [{ type: "tool_use", id: "toolu_e2e_" + stubLog.length, name: "Bash", input: { command: "printf '\\n// " + MARK + "\\n' >> " + file + " && printf '" + MARK + "\\n' > " + UNTRACKED + " && printf '\\000\\001\\002e2e\\000' > " + BLOB, description: "Append one line and write two new files" } }] : [{ type: "text", text: "Done." }];
    if (body.stream) return new Response(sse(body.model, reply as any), { headers: { "content-type": "text/event-stream" } });
    return Response.json({ id: "msg_e2e", type: "message", role: "assistant", model: body.model, content: reply, stop_reason: edit ? "tool_use" : "end_turn", usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
  },
});
const gw = spawnSync("docker", ["network", "inspect", "bridge", "-f", "{{(index .IPAM.Config 0).Gateway}}"], { encoding: "utf8" }).stdout.trim();
const machine = machineId();
const served = await serveStages({ record, local, run_id: "sm-e2e", envelope_host: machine, machine, stages: [{ item: "sm-opus", arm: "sm-opus", model: "claude-opus-5-5", arms: ["sm:A0", "sm:A1", "sm:A2", "sm:S2", "sm:followon"] }], host: gw, dir: join(W, "run"), fetch: (url, init) => fetch(url.replace("https://api.anthropic.com", "http://127.0.0.1:" + stub.port), init), env: { ANTHROPIC_API_KEY: "stub-not-a-key" }, requireAdmission: () => null, planned: 2, log: (l) => console.error(l) });
const lease = served.stages[0]!.lease_id;
rule("lease opens", readItem(record, "sm-opus").open?.lease_id === lease, "lease " + lease + " on sm-opus, proxy " + served.stages[0]!.proxy);
const plan = planPart([u.id], ["claude-opus-5-5"], 1, 1);
const planFile = join(W, "plan.json");
writeFileSync(planFile, JSON.stringify({ schema: "sm-plan.v1", sessions: plan }));
const images: string[] = [];
async function runSession(index: number, out: string, first?: string): Promise<{ record: SessionRecord; image: SessionImage; harbor_exit: string }> {
  const args = ["outcome", "sm", "session", "run", "--unit", unitDir, "--plan", planFile, "--index", String(index), "--control", served.control, "--proxy", served.stages[0]!.proxy, "--out", out, "--harbor", harbor, ...(first ? ["--first", first] : [])];
  let said = "";
  const code = await new Promise<number>((done) => {
    const c = spawn(join(import.meta.dir, "../../../bin/gstack-evals"), args, { env: process.env, stdio: ["ignore", "pipe", "inherit"] });
    c.stdout.on("data", (d) => { said += d; process.stdout.write(d); });
    c.on("close", (n) => done(n ?? 1));
  });
  if (code !== 0) throw new Error("sm session run --index " + index + " exited " + code);
  const image = (JSON.parse(readFileSync(join(out, "images.json"), "utf8")) as { rows: SessionImage[] }).rows[0]!;
  images.push(image.tag);
  return { record: JSON.parse(readFileSync(join(out, "session.json"), "utf8")) as SessionRecord, image, harbor_exit: (said.match(/harbor_exit=(\S+)/) ?? [])[1] ?? "?" };
}
try {
  const a1 = plan.find((s) => s.cell === "A1")!;
  const f1 = plan.find((s) => s.cell === "F-A1-1")!;
  const one = await runSession(a1.index, join(W, "s1"));
  const t1 = sh(one.image.tag, "cd " + u.repo_dir + " && git rev-list --all --count && git rev-parse HEAD && (git cat-file -t " + u.base_commit + " 2>/dev/null || echo absent) && git status --porcelain | wc -l");
  const [c1, h1, orig1, dirty1] = t1.stdout.trim().split("\n");
  rule("A1 image tree is the stripped one-commit tree", c1 === "1" && h1 === one.image.head && orig1 === "absent" && dirty1 === "0", "commits " + c1 + ", head " + h1 + ", the image's original base commit " + orig1 + ", " + dirty1 + " dirty paths; image " + one.image.image_id);
  const r1 = one.record;
  rule("A1 session record", r1.end === "completed" && r1.lease_id === lease && r1.questions.ask_user_question === 0 && existsSync(join(W, "s1/session.json")), "end " + r1.end + ", lease " + r1.lease_id + ", questions " + JSON.stringify(r1.questions) + ", turns " + r1.turns + ", harbor exit " + one.harbor_exit);
  const p1 = r1.tree_patch ? readFileSync(r1.tree_patch.path, "utf8") : "";
  const ch1 = extractChange(p1);
  const binary1 = ch1.binary;
  const text1 = ch1.files;
  writeFileSync(join(W, "s1/text.patch"), text1.map((x) => x.text).join(""));
  const ap1 = r1.tree_patch ? sh(one.image.tag, "cd " + u.repo_dir + " && git apply --check /e2e/text.patch && echo applies", join(W, "s1")) : null;
  const untracked1 = text1.find((x) => x.oldPath === null && x.newPath === UNTRACKED);
  rule("A1 change extracts as a diff against base", text1.some((x) => x.newPath === file && x.text.includes(MARK)) && untracked1?.text.includes("+" + MARK) === true && binary1.length === 1 && binary1[0] === BLOB && ap1?.stdout.includes("applies") === true, text1.length + " text files (" + text1.map((x) => x.newPath).join(", ") + "), binary listed and left out: " + JSON.stringify(binary1) + ", git apply --check of the text diff on the base tree: " + (ap1 ? ap1.stdout.trim() || ap1.stderr.trim().slice(-200) : "not run"));
  const two = await runSession(f1.index, join(W, "s2"), join(W, "s1/session.json"));
  const t2 = sh(two.image.tag, "cd " + u.repo_dir + " && git rev-list --all --count && git rev-parse HEAD^ && git log -1 --format=%s && git diff --name-only HEAD^ HEAD");
  const [c2, parent2] = t2.stdout.trim().split("\n");
  rule("follow-on image tree is two commits on the A1 tree", c2 === "2" && parent2 === one.image.head && t2.stdout.trim().split("\n").slice(3).includes(file), "commits " + c2 + ", parent " + parent2 + ", second commit: " + t2.stdout.trim().split("\n").slice(2).join(" | "));
  const r2 = two.record;
  const p2 = r2.tree_patch ? readFileSync(r2.tree_patch.path, "utf8") : "";
  rule("follow-on session record and diff", r2.end === "completed" && r2.lease_id === lease && r2.tree_ref?.tree === "A1" && p2.includes(MARK), "end " + r2.end + ", tree_ref " + JSON.stringify(r2.tree_ref) + ", " + p2.split("\n").length + " patch lines against the two-commit base");
} catch (e) {
  rule("sessions ran", false, (e as Error).message.slice(0, 600));
} finally {
  const code = await served.stop();
  const item = readItem(record, "sm-opus");
  const sessions = readFileSync(join(W, "run/sessions.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  rule("lease settles", code === 0 && item.open === null && item.leases.length === 1 && item.leases[0]!.close !== null, "driver exit " + code + ", " + sessions.filter((s) => s.event === "open").length + " opens, " + sessions.filter((s) => s.event === "close" || s.event === "closed").length + " closes, spent " + item.leases[0]?.close?.spent_micros + " micros");
  rule("no provider key reached the upstream and the stub saw no web tool", stubLog.every((e) => !(e.tools as string[]).some((t) => /web/i.test(t))) && stubLog.length > 0, stubLog.length + " stub requests, " + stubLog.filter((e) => e.edit).length + " edits");
  stub.stop(true);
  writeFileSync(join(W, "e2e.json"), JSON.stringify({ unit: u.id, results, stub: stubLog }, null, 1) + "\n");
  if (!keep) for (const t of images) spawnSync("docker", ["rmi", "--no-prune", "-f", t]);
  console.log("e2e dir " + W);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}
