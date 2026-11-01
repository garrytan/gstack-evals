// Copyright (c) 2026 Garry Tan. MIT License.
// The verifier's per-test record. The runner writes raw events (vrun.py's JSON lines for pytest, go test -json for Go)
// to the verifier's output mount; this host-side parser, which never runs task code, turns them into one result per
// test id. A required id the run never reported is missing, and missing never counts as passed.
//
// Failure classes, for V2 to V4 (plan open items: assertion-level failures, not import or collection errors):
//   assert        the test body ran and failed (an assertion or an exception raised in the call phase)
//   missing_name  the test could not reach a name: an attribute, import or symbol that does not exist in the tree
//   load          collection, import, setup or build failed for another reason

export type Status = "pass" | "fail" | "skip" | "missing";
export type FailClass = "assert" | "missing_name" | "load";

export interface TestResult {
  status: Status;
  cls?: FailClass;
  name?: string;
  exc?: string;
  msg?: string;
}

export type Results = Record<string, TestResult>;

const LOAD_EXC = new Set(["ImportError", "ModuleNotFoundError", "SyntaxError", "IndentationError", "TabError"]);

/** The name a failure could not reach, from Python's and Go's own messages. */
export function missingName(text: string): string | null {
  const patterns = [
    /has no attribute '([^']+)'/,
    /cannot import name '([^']+)'/,
    /No module named '([^']+)'/,
    /name '([^']+)' is not defined/,
    /undefined: (?:[\w.]+\.)?(\w+)/,
    /\.(\w+) undefined \(type .* has no (?:field or )?method/,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) return m[1].split(".").pop()!;
  }
  return null;
}

interface PyEvent {
  event: string;
  id?: string;
  when?: string;
  outcome?: string;
  xfail?: boolean;
  exc?: string | null;
  msg?: string | null;
  ids?: string[];
  code?: number;
}

export interface Parsed {
  results: Results;
  /** Every id the run reported, in run order when the runner said it. */
  seen: string[];
  notes: string[];
}

export function parsePytest(jsonl: string): Parsed {
  const results: Results = {};
  const order: string[] = [];
  const notes: string[] = [];
  const collectFails: { id: string; msg: string }[] = [];
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    let e: PyEvent;
    try {
      e = JSON.parse(line);
    } catch {
      notes.push("unparsable record line");
      continue;
    }
    if (e.event === "runner_swapped") notes.push("runner_swapped " + JSON.stringify(e));
    if (e.event === "order" && e.ids) order.push(...e.ids);
    if (e.event === "collect" && e.id !== undefined) collectFails.push({ id: e.id, msg: e.msg ?? "" });
    if (e.event !== "phase" || !e.id) continue;
    const r = results[e.id] ?? { status: "pass" };
    if (e.outcome === "failed") {
      const text = (e.msg ?? "") + "";
      const name = missingName(text);
      const cls: FailClass = e.when !== "call" ? (name ? "missing_name" : "load") : LOAD_EXC.has(e.exc ?? "") ? (name ? "missing_name" : "load") : name && (e.exc === "AttributeError" || e.exc === "NameError") ? "missing_name" : "assert";
      if (r.status !== "fail") results[e.id] = { status: "fail", cls, ...(cls === "missing_name" ? { name: name! } : {}), exc: e.exc ?? undefined, msg: text.slice(0, 300) };
    } else if (e.outcome === "skipped") {
      if (r.status !== "fail") results[e.id] = { status: "skip", msg: e.xfail ? "xfail" : (e.msg ?? "").slice(0, 300) };
    } else if (!(e.id in results)) results[e.id] = r;
  }
  for (const { id, msg } of collectFails) {
    const name = missingName(msg);
    results["collect:" + (id || "<session>")] = { status: "fail", cls: name ? "missing_name" : "load", ...(name ? { name } : {}), msg: msg.slice(-300) };
  }
  return { results, seen: order.length > 0 ? order : Object.keys(results), notes };
}

/** A required id's result: what the run recorded, or a collection failure of its file, or missing. */
export function resultFor(parsed: Parsed, id: string): TestResult {
  const r = parsed.results[id];
  if (r) return r;
  const file = id.split("::")[0];
  const collect = parsed.results["collect:" + file] ?? parsed.results["collect:<session>"];
  if (collect) return collect;
  return { status: "missing" };
}

interface GoEvent {
  Action: string;
  Package?: string;
  Test?: string;
  Output?: string;
}

/** go test -json: one result per top-level and subtest; a package that failed to build fails every id in it. */
export function parseGoTest(jsonl: string, stderr: string, module: string): Parsed {
  const results: Results = {};
  const order: string[] = [];
  const notes: string[] = [];
  const dirOf = (pkg: string) => (pkg === module ? "." : pkg.startsWith(module + "/") ? pkg.slice(module.length + 1) : pkg);
  const output = new Map<string, string>();
  for (const line of jsonl.split("\n")) {
    if (!line.trim().startsWith("{")) continue;
    let e: GoEvent;
    try {
      e = JSON.parse(line);
    } catch {
      notes.push("unparsable go event");
      continue;
    }
    if (!e.Package) continue;
    const key = dirOf(e.Package) + (e.Test ? "::" + e.Test : "");
    if (e.Action === "output") output.set(key, (output.get(key) ?? "") + (e.Output ?? ""));
    if (e.Action === "run" && e.Test) order.push(key);
    if (!e.Test && e.Action === "fail") {
      const out = output.get(key) ?? "";
      if (/\[(build|setup) failed\]/.test(out) || !order.some((id) => id.startsWith(key + "::"))) {
        const text = stderr + "\n" + out;
        const name = missingName(text);
        results["collect:" + key] = { status: "fail", cls: name ? "missing_name" : "load", ...(name ? { name } : {}), msg: text.trim().slice(0, 300) };
      }
      continue;
    }
    if (!e.Test) continue;
    if (e.Action === "pass") results[key] = { status: "pass" };
    if (e.Action === "skip") results[key] = { status: "skip", msg: (output.get(key) ?? "").slice(-300) };
    if (e.Action === "fail") results[key] = { status: "fail", cls: "assert", msg: (output.get(key) ?? "").slice(-300) };
  }
  return { results, seen: order, notes };
}
