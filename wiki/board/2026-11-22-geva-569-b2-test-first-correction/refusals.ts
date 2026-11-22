// Recounts Codex's rm -f command refusals in B2's Sol sessions from the pulled Codex rollouts.
// Usage: bun refusals.ts <sol-work dir> <sessions.jsonl>. Prints one row per refused call, then totals by arm.
import { readFileSync } from "node:fs";
import { Glob } from "bun";
const [root, sessionsPath] = process.argv.slice(2);
const MARK = "rm -f style commands are not permitted";
const arms = new Map<string, string>();
for (const l of readFileSync(sessionsPath!, "utf8").split("\n")) if (l) { const r = JSON.parse(l); if (r.model === "gpt-6.2-sol") arms.set(r.trial, r.arm); }
const rows: string[][] = [];
const seen = new Set<string>();
for (const f of [...new Glob("*/pulled/jobs/*/*/evaluator/codex-sessions/**/rollout-*.jsonl").scanSync(root!)].sort()) {
  const [part, , , , trial] = f.split("/");
  for (const line of readFileSync(root + "/" + f, "utf8").split("\n")) {
    if (!line.includes(MARK)) continue;
    const p = JSON.parse(line).payload ?? {};
    if (p.type !== "function_call_output" && p.type !== "custom_tool_call_output") continue;
    const key = trial + "\t" + p.call_id;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push([part!, trial!, arms.get(trial!) ?? "unknown", p.call_id]);
  }
}
console.log(["part", "trial", "arm", "call_id"].join("\t"));
for (const r of rows) console.log(r.join("\t"));
const by = new Map<string, number>();
for (const r of rows) by.set(r[2]!, (by.get(r[2]!) ?? 0) + 1);
console.log("# refused calls " + rows.length + " in " + new Set(rows.map((r) => r[1])).size + " sessions of " + arms.size + " Sol sessions; by arm: " + ["none", "line", "gstack", "prove-it"].map((a) => a + " " + (by.get(a) ?? 0)).join(", "));
