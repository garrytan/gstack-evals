// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals verifier, node:test reporter (lanes/real-outcome/task/SPEC.md). Verifier-owned: node loads it from the
// verifier's mount, and it writes one JSON line per test with its file and the names of the suites around it, so ids
// read <file>::<suite > ... > name> on every Node version. A file that failed to load reports as a test named after it,
// after every other line, with the end of that file's stderr as its message, since node reports only "test failed".
import { resolve } from "node:path";

export default async function* reporter(source) {
  const stacks = new Map();
  const stderr = new Map();
  const loads = [];
  for await (const e of source) {
    const d = e.data ?? {};
    const file = d.file ?? "";
    if (e.type === "test:stderr") {
      const key = resolve(file);
      stderr.set(key, ((stderr.get(key) ?? "") + String(d.message ?? "")).slice(-2000));
      continue;
    }
    if (e.type === "test:start") {
      const s = stacks.get(file) ?? [];
      s.length = d.nesting;
      s.push(d.name);
      stacks.set(file, s);
      continue;
    }
    if (e.type !== "test:pass" && e.type !== "test:fail") continue;
    if (d.details?.type === "suite") continue;
    const s = stacks.get(file) ?? [];
    const path = [...s.slice(0, d.nesting), d.name];
    const err = d.details?.error;
    const cause = err?.cause;
    const msg = cause && typeof cause === "object" ? (cause.name ?? "Error") + ": " + (cause.message ?? "") : String(cause ?? err?.message ?? "");
    const line = { event: e.type, path, file, skip: d.skip !== undefined && d.skip !== false, todo: d.todo !== undefined && d.todo !== false, exc: cause?.name ?? err?.name ?? null, msg: msg.slice(0, 600) };
    if (e.type === "test:fail" && d.nesting === 0 && file && resolve(String(d.name)) === resolve(file)) loads.push(line);
    else yield JSON.stringify(line) + "\n";
  }
  for (const line of loads) yield JSON.stringify({ ...line, msg: line.msg + " " + (stderr.get(resolve(line.file)) ?? "") }) + "\n";
}
