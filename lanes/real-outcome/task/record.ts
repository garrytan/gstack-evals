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
  const passed = new Map<string, Set<string>>();
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
    if (!passed.has(e.id)) passed.set(e.id, new Set());
    if (e.outcome === "failed") {
      const text = (e.msg ?? "") + "";
      const name = missingName(text);
      const cls: FailClass = e.when !== "call" ? (name ? "missing_name" : "load") : LOAD_EXC.has(e.exc ?? "") ? (name ? "missing_name" : "load") : name && (e.exc === "AttributeError" || e.exc === "NameError") ? "missing_name" : "assert";
      if (r.status !== "fail") results[e.id] = { status: "fail", cls, ...(cls === "missing_name" ? { name: name! } : {}), exc: e.exc ?? undefined, msg: text.slice(0, 300) };
    } else if (e.outcome === "skipped") {
      if (r.status !== "fail") results[e.id] = { status: "skip", msg: e.xfail ? "xfail" : (e.msg ?? "").slice(0, 300) };
    } else passed.get(e.id)!.add(e.when ?? "");
  }
  for (const [id, phases] of passed) {
    if (id in results) continue;
    results[id] = ["setup", "call", "teardown"].every((w) => phases.has(w)) ? { status: "pass" } : { status: "fail", cls: "load", msg: "incomplete: the run stopped before this test's setup, call and teardown all reported" };
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
  ImportPath?: string;
  FailedBuild?: string;
  Test?: string;
  Output?: string;
}

/**
 * go test -json: one result per top-level and subtest; a package that failed to build fails every id in it. Build
 * errors arrive on stderr up to Go 1.23 and as build-output events (ImportPath, no Package) from Go 1.24.
 */
export function parseGoTest(jsonl: string, stderr: string, module: string): Parsed {
  const results: Results = {};
  const order: string[] = [];
  const notes: string[] = [];
  const dirOf = (pkg: string) => (pkg === module ? "." : pkg.startsWith(module + "/") ? pkg.slice(module.length + 1) : pkg);
  const output = new Map<string, string>();
  const build = new Map<string, string>();
  const pkgOf = (importPath: string) => importPath.split(" ")[0];
  for (const line of jsonl.split("\n")) {
    if (!line.trim().startsWith("{")) continue;
    let e: GoEvent;
    try {
      e = JSON.parse(line);
    } catch {
      notes.push("unparsable go event");
      continue;
    }
    if (e.Action === "build-output" && e.ImportPath) build.set(pkgOf(e.ImportPath), (build.get(pkgOf(e.ImportPath)) ?? "") + (e.Output ?? ""));
    if (!e.Package) continue;
    const key = dirOf(e.Package) + (e.Test ? "::" + e.Test : "");
    if (e.Action === "output") output.set(key, (output.get(key) ?? "") + (e.Output ?? ""));
    if (e.Action === "run" && e.Test) order.push(key);
    if (!e.Test && e.Action === "fail") {
      const out = output.get(key) ?? "";
      if (e.FailedBuild || /\[(build|setup) failed\]/.test(out) || !order.some((id) => id.startsWith(key + "::"))) {
        const text = stderr + "\n" + (build.get(pkgOf(e.FailedBuild ?? e.Package)) ?? "") + out;
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

/** JavaScript failure messages that mean the test could not reach a name: a ReferenceError, or a TypeError calling or
 * reading through something undefined. A module that does not exist, or a missing export, is a load or missing-name
 * failure of the whole file. */
export function jsFailClass(text: string): { cls: FailClass; name?: string; exc?: string } {
  const exc = /\b(ReferenceError|TypeError|SyntaxError|RangeError|AssertionError|Error)\b/.exec(text)?.[1];
  const ref = /ReferenceError:? (?:\[Error\]:? )?([\w$]+) is not defined/.exec(text);
  if (ref) return { cls: "missing_name", name: ref[1], exc: "ReferenceError" };
  const call = /TypeError:? (?:\[Error\]:? )?(?:\(0\s*,\s*)?(?:[\w$.()\[\]]*?\.)?([\w$]+)\)? is not a (?:function|constructor)/.exec(text);
  if (call) return { cls: "missing_name", name: call[1], exc: "TypeError" };
  const read = /TypeError:? (?:\[Error\]:? )?Cannot read propert(?:y|ies) of undefined \(reading '([^']+)'\)/.exec(text);
  if (read) return { cls: "missing_name", name: read[1], exc: "TypeError" };
  const exp = /does not provide an export named '([^']+)'|has no exported member '([^']+)'|Property '([^']+)' does not exist on/.exec(text);
  if (exp) return { cls: "missing_name", name: exp[1] ?? exp[2] ?? exp[3], exc };
  if (/Cannot find module|ERR_MODULE_NOT_FOUND|Failed to resolve import|SyntaxError|error TS\d{4}/.test(text)) return { cls: "load", exc };
  return { cls: "assert", exc };
}

const repoRel = (path: string, repo: string): string => (path.startsWith(repo + "/") ? path.slice(repo.length + 1) : path.replace(/^\/+/, ""));

const jsResult = (status: string | undefined, text: string): TestResult => {
  if (status === "passed") return { status: "pass" };
  if (status === "failed") {
    const c = jsFailClass(text);
    return { status: "fail", cls: c.cls, ...(c.name ? { name: c.name } : {}), ...(c.exc ? { exc: c.exc } : {}), msg: text.slice(0, 300) };
  }
  return { status: "skip", msg: String(status ?? "") };
};

/** jest --json and vitest --reporter=json: one result per assertion, keyed <file relative to the repository>::<full
 * name>. A file whose suite failed to run, with no assertion reported, fails every id in it as a collection failure. */
export function parseJestJson(json: string, repo = "/testbed"): Parsed {
  const results: Results = {};
  const seen: string[] = [];
  const notes: string[] = [];
  let d: { testResults?: { name?: string; status?: string; message?: string; failureMessage?: string; assertionResults?: { fullName?: string; title?: string; ancestorTitles?: string[]; status?: string; failureMessages?: string[] }[] }[] };
  try {
    d = JSON.parse(json);
  } catch {
    if (json.trim()) notes.push("unparsable json record");
    return { results, seen, notes };
  }
  for (const tr of d?.testResults ?? []) {
    const file = repoRel(String(tr.name ?? ""), repo);
    const asserts = tr.assertionResults ?? [];
    for (const a of asserts) {
      const id = file + "::" + (a.fullName || [...(a.ancestorTitles ?? []), a.title ?? ""].join(" "));
      seen.push(id);
      if (results[id]?.status === "fail") continue;
      results[id] = jsResult(a.status, (a.failureMessages ?? []).join("\n"));
    }
    const message = String(tr.message || tr.failureMessage || "");
    if (tr.status === "failed" && asserts.every((a) => a.status !== "failed") && message) {
      const c = jsFailClass(message);
      results["collect:" + file] = { status: "fail", cls: c.cls === "assert" ? "load" : c.cls, ...(c.name ? { name: c.name } : {}), msg: message.slice(0, 300) };
    }
  }
  return { results, seen, notes };
}

/** mocha --reporter json: passes, failures and pending, keyed <file>::<fullTitle>. A failed before or after hook fails
 * every id in its file as a collection failure. */
export function parseMochaJson(json: string, repo = "/testbed"): Parsed {
  const results: Results = {};
  const seen: string[] = [];
  const notes: string[] = [];
  const start = json.indexOf("{");
  let d: Record<string, { fullTitle?: string; title?: string; file?: string; err?: { message?: string; stack?: string; name?: string } }[]>;
  try {
    d = JSON.parse(start < 0 ? "" : json.slice(start));
  } catch {
    if (json.trim()) notes.push("unparsable json record");
    return { results, seen, notes };
  }
  for (const [key, status] of [["passes", "passed"], ["failures", "failed"], ["pending", "pending"]] as const) {
    for (const t of d?.[key] ?? []) {
      const file = repoRel(String(t.file ?? ""), repo);
      const title = String(t.fullTitle ?? t.title ?? "");
      const text = [t.err?.name, t.err?.message, t.err?.stack].filter(Boolean).join(": ");
      if (key === "failures" && /"(before|after)( all| each)?" hook/.test(title)) {
        const c = jsFailClass(text);
        results["collect:" + file] = { status: "fail", cls: c.cls === "assert" ? "load" : c.cls, ...(c.name ? { name: c.name } : {}), msg: text.slice(0, 300) };
        continue;
      }
      const id = file + "::" + title;
      seen.push(id);
      if (results[id]?.status === "fail") continue;
      results[id] = jsResult(status, text);
    }
  }
  return { results, seen, notes };
}

export interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

const XML_ENTITY: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
const unescapeXml = (s: string): string => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => (e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : XML_ENTITY[e] ?? m));

/** A small XML reader for JUnit reports: elements, attributes and text, no DTD or namespaces. Returns null when the
 * document does not parse. */
export function parseXml(xml: string): XmlNode | null {
  const root: XmlNode = { tag: "#root", attrs: {}, children: [], text: "" };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<\/\s*([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2] !== undefined) {
      if (top.tag !== m[2] || stack.length === 1) return null;
      stack.pop();
    } else if (m[3] !== undefined) {
      const attrs: Record<string, string> = {};
      for (const a of m[4].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = unescapeXml(a[2] ?? a[3] ?? "");
      const node: XmlNode = { tag: m[3], attrs, children: [], text: "" };
      top.children.push(node);
      if (m[5] !== "/") stack.push(node);
    } else if (m[6] !== undefined) top.text += unescapeXml(m[6]);
    else if (m[0].startsWith("<") && !/^<(!--|\?|!DOCTYPE)/.test(m[0])) return null;
  }
  return stack.length === 1 ? root : null;
}

/** node --test with the verifier's reporter (verifier/node-reporter.mjs): one JSON line per test, keyed <file>::<suite >
 * ... > name>. A top-level test named after its own file reports a file that failed to load. */
export function parseNodeEvents(jsonl: string, repo = "/testbed"): Parsed {
  const results: Results = {};
  const seen: string[] = [];
  const notes: string[] = [];
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    let e: { event?: string; path?: string[]; file?: string; skip?: boolean; todo?: boolean; exc?: string | null; msg?: string };
    try {
      e = JSON.parse(line);
    } catch {
      notes.push("unparsable record line");
      continue;
    }
    const file = repoRel(String(e.file ?? ""), repo);
    const path = (e.path ?? []).map(String);
    const text = String(e.msg ?? "");
    if (e.event === "test:fail" && path.length === 1 && file && (path[0] === file || file.endsWith("/" + path[0]) || path[0].endsWith(file))) {
      const c = jsFailClass(text);
      results["collect:" + file] = { status: "fail", cls: c.cls === "assert" ? "load" : c.cls, ...(c.name ? { name: c.name } : {}), msg: text.slice(0, 300) };
      continue;
    }
    const id = file + "::" + path.join(" > ");
    seen.push(id);
    if (results[id]?.status === "fail") continue;
    results[id] = e.skip || e.todo ? { status: "skip" } : jsResult(e.event === "test:pass" ? "passed" : "failed", text);
  }
  return { results, seen, notes };
}

/** cargo test's text output: one result per test, keyed <target source>::<test path>, where the target source is what
 * cargo prints after Running (src/lib.rs, tests/it.rs), with the project dir in front. A target that did not compile
 * fails every id in it as a collection failure, and a compile error cargo cannot tie to a target fails the session. */
export function parseCargo(text: string, root = ""): Parsed {
  const results: Results = {};
  const seen: string[] = [];
  const notes: string[] = [];
  const prefix = root ? root + "/" : "";
  let target = "";
  const panics = new Map<string, string>();
  const lines = text.split("\n");
  let cur: string | null = null;
  for (const line of lines) {
    const head = /^---- (\S+) stdout ----$/.exec(line);
    if (head) {
      cur = head[1];
      panics.set(cur, "");
      continue;
    }
    if (cur !== null) {
      if (/^(failures:|test result:|\s*Running )/.test(line)) cur = null;
      else panics.set(cur, panics.get(cur)! + line + "\n");
    }
  }
  for (const line of lines) {
    const run = /^\s*Running (?:unittests )?(\S+)/.exec(line);
    if (run) {
      target = prefix + run[1];
      continue;
    }
    const t = /^test (.+?) \.\.\. (ok|FAILED|ignored)/.exec(line);
    if (!t || !target) continue;
    const id = target + "::" + t[1];
    seen.push(id);
    results[id] = t[2] === "ok" ? { status: "pass" } : t[2] === "ignored" ? { status: "skip" } : { status: "fail", cls: "assert", msg: (panics.get(t[1]) ?? "").trim().slice(0, 300) };
  }
  const compile = [...text.matchAll(/^error: could not compile `[^`]+` \(([^)]*)\)/gm)];
  if (compile.length > 0 || (/^error(\[E\d{4}\])?: /m.test(text) && seen.length === 0)) {
    const msg = (/^error(\[E\d{4}\])?: .*$/m.exec(text)?.[0] ?? "could not compile").slice(0, 300);
    const name = /cannot find (?:function|value|struct|type|macro|module|trait) `([^`]+)`|no (?:function|method|field|associated item) named `([^`]+)`|unresolved import `(?:[\w:]+::)?([^`]+)`/.exec(text);
    const missing = name ? (name[1] ?? name[2] ?? name[3]) : undefined;
    const r: TestResult = { status: "fail", cls: missing ? "missing_name" : "load", ...(missing ? { name: missing } : {}), msg };
    for (const c of compile) {
      const what = c[1];
      const test = /^test "([^"]+)"$/.exec(what);
      if (test) results["collect:" + prefix + "tests/" + test[1] + ".rs"] = r;
      else if (/^lib test$/.test(what)) results["collect:" + prefix + "src/lib.rs"] = r;
      else if (/^bin "([^"]+)" test$/.test(what)) results["collect:" + prefix + "src/main.rs"] = r;
    }
    if (seen.length === 0) results["collect:<session>"] = r;
  }
  return { results, seen, notes };
}
