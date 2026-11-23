// Recounts Codex's rm -f command refusals in B2's Sol sessions from the pulled Codex rollouts.
// Usage: bun refusals.ts <sol-work dir> <sessions.jsonl>. Prints one row per refused call, then totals by arm.
// It reads only the counted Sol sessions in sessions.jsonl, and exits 1 if any of them has no rollout.
import { readFileSync } from "node:fs";
import { Glob } from "bun";
const [root, sessionsPath] = process.argv.slice(2);
const MARK = /exec_command failed: CreateProcess \{ message: .*Rejected\(.*rejected: rm -f style commands are not permitted/s;
const counted = new Map<string, string>();
for (const l of readFileSync(sessionsPath!, "utf8").split("\n")) if (l) { const r = JSON.parse(l); if (r.model === "gpt-6.2-sol") counted.set(r.part + "/" + r.trial, r.arm); }
const rows: string[][] = [];
const seen = new Set<string>();
const withRollout = new Set<string>();
let skipped = 0;
for (const f of [...new Glob("*/pulled/jobs/*/*/evaluator/codex-sessions/**/rollout-*.jsonl").scanSync(root!)].sort()) {
  const [part, , , , trial] = f.split("/");
  const arm = counted.get(part + "/" + trial);
  if (!arm) { skipped++; continue; }
  withRollout.add(part + "/" + trial);
  for (const line of readFileSync(root + "/" + f, "utf8").split("\n")) {
    if (!line.includes("rm -f style commands are not permitted")) continue;
    const p = JSON.parse(line).payload ?? {};
    if (p.type !== "function_call_output" && p.type !== "custom_tool_call_output") continue;
    const out = typeof p.output === "string" ? p.output : JSON.stringify(p.output);
    if (!MARK.test(out)) continue;
    const key = trial + "\t" + p.call_id;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push([part!, trial!, arm, p.call_id]);
  }
}
const missing = [...counted.keys()].filter((k) => !withRollout.has(k));
if (missing.length) { console.error("no rollout for " + missing.length + " counted Sol sessions, first " + missing[0]); process.exit(1); }
console.log(["part", "trial", "arm", "call_id"].join("\t"));
for (const r of rows) console.log(r.join("\t"));
const by = new Map<string, number>();
for (const r of rows) by.set(r[2]!, (by.get(r[2]!) ?? 0) + 1);
console.log("# refused calls " + rows.length + " in " + new Set(rows.map((r) => r[1])).size + " sessions of " + counted.size + " counted Sol sessions, each with its rollout; rollouts outside the table skipped: " + skipped + "; by arm: " + [...by.keys()].sort().map((a) => a + " " + by.get(a)).join(", "));
