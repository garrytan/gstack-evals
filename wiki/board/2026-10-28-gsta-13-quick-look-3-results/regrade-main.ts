import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
// Keyless regrade of recorded sessions on the main agent only: drops every message with a non-null parent_tool_use_id and
// regrades pass, final-answer pass, opened and files loaded with the runner's own grader, then lists any session that changes.
// Usage: bun regrade-main.ts <runner dir> <work dir holding tasks/> <runs dir>...
const [R, W, ...roots] = process.argv.slice(2);
const { parseTranscript, gradePatterns, transcriptText, skillUse } = await import(join(R, "src/grade.ts"));
const tasks: Record<string, any> = {};
for (const s of ["office-hours", "learn"]) {
  const list = [...JSON.parse(readFileSync(join(W, "tasks", s, "full", "tasks.json"), "utf8"))];
  const extra = join(R, "tasks", s + ".extra.json");
  if (existsSync(extra)) list.push(...JSON.parse(readFileSync(extra, "utf8")));
  for (const t of list) tasks[s + "/" + t.id] = t;
}
function* walk(d: string): Generator<string> {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (n === "work") continue;
    if (n === "result.json") yield d;
    else if (statSync(p).isDirectory()) yield* walk(p);
  }
}
const out: any = {};
for (const root of roots) {
  const flips: any[] = [];
  let n = 0, withSub = 0, openFlip = 0;
  for (const d of walk(root)) {
    if (/t\d+\.failed/.test(d)) continue;
    const r = JSON.parse(readFileSync(join(d, "result.json"), "utf8"));
    if (r.status === "infra_error" || !existsSync(join(d, "transcript.jsonl"))) continue;
    const msgs = readFileSync(join(d, "transcript.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const main = msgs.filter((m: any) => !m.parent_tool_use_id);
    if (main.length !== msgs.length) withSub++;
    n++;
    const task = tasks[r.suite + "/" + r.task];
    if (!task) { flips.push({ id: r.id, err: "no task" }); continue; }
    const t = parseTranscript(main);
    const hasMust = (task.must ?? []).length > 0;
    const mT = gradePatterns(task, transcriptText(t));
    const mF = gradePatterns(task, t.finalAnswer);
    const checkOk = r.check ? r.check.ok : true;
    const pass = checkOk && (!hasMust || mT.ok);
    const passF = checkOk && (!hasMust || mF.ok);
    const su = skillUse(t, r.suite); const op = su.opened; if (JSON.stringify(Object.entries(su.files).sort()) !== JSON.stringify(Object.entries(r.files_loaded ?? {}).sort())) out.filesDiff = [...(out.filesDiff ?? []), r.id];
    if (op !== r.opened) openFlip++;
    if (pass !== r.pass || passF !== r.pass_final || op !== r.opened) flips.push({ id: r.id, pass: [r.pass, pass], pass_final: [r.pass_final, passF], opened: [r.opened, op], subMsgs: msgs.length - main.length });
  }
  out[root.split("/").pop()!] = { sessions: n, withSubagentMsgs: withSub, openFlips: openFlip, flips };
}
console.log(JSON.stringify(out, null, 1));
