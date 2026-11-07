// Copyright (c) 2026 Garry Tan. MIT License.
// The keyless render gate (GEVA-392 addendum): every history's report request for every model and arm, built as the
// drive builds it and checked as the drive checks it before a send (the validator, and the closer check on a gstack
// arm). It needs no key and prints counts and structure only: a refused request by its history's position, never a task
// id, a tool id or any history text.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { readTurns, spliceBy } from "./drive.ts";
import { fail, TbvError } from "./errors.ts";
import { rebuildTurns } from "./history/events.ts";
import { buildRequest, validateRequest } from "./request.ts";
import { fillShape, flags, need } from "./shape.ts";
import { closerHolds } from "./splice.ts";
import { ARM_MODELS, type Arm, type Family, type History, type Io, type Model, type Shape, type SpliceSet } from "./types.ts";

const ARMS: Arm[] = ["none", "lens", "current", "principle"];

function readJson(path: string, what: string): any {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fail("E_TBV_INPUT", what + " is not readable JSON");
  }
}

/** Every .json file under dir, at any depth, in byte order of the path. A broken link or an entry it cannot read fails
 * with a reason code and no path, since a held-out path names its task. */
function jsonFiles(dir: string, what: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    let names: string[];
    try {
      names = readdirSync(d);
    } catch {
      return fail("E_TBV_INPUT", "an entry under " + what + " is a broken link or cannot be read");
    }
    for (const name of names) {
      const p = join(d, name);
      let dir: boolean;
      try {
        dir = statSync(p).isDirectory();
      } catch {
        return fail("E_TBV_INPUT", "an entry under " + what + " is a broken link or cannot be read");
      }
      if (dir) walk(p);
      else if (name.endsWith(".json")) out.push(p);
    }
  };
  walk(dir);
  return out.sort((a, b) => Buffer.compare(Buffer.from(relative(dir, a)), Buffer.from(relative(dir, b))));
}

/** gstack-evals tbv render-gate --tasks <dir> --shapes <dir> --splices <dir> --turns <turns.txt> --cwd <path> --date <yyyy-mm-dd> */
export async function run(argv: string[], io: Io): Promise<number> {
  const f = flags(argv, ["--tasks", "--shapes", "--splices", "--turns", "--cwd", "--date"]);
  const tasksDir = need(f, "--tasks");
  const files = jsonFiles(tasksDir, "--tasks");
  if (!files.length) fail("E_TBV_INPUT", "no tbv-history.v1 file under --tasks");
  const histories: History[] = files.map((p, i) => {
    const h = readJson(p, "file " + (i + 1) + " of " + files.length + " under --tasks");
    if (h?.schema !== "tbv-history.v1" || !Array.isArray(h.events)) fail("E_TBV_INPUT", "file " + (i + 1) + " of " + files.length + " under --tasks is not a tbv-history.v1 history");
    return h as History;
  });
  const shapes = new Map<Arm, Shape>();
  for (const p of jsonFiles(need(f, "--shapes"), "--shapes")) {
    const s = readJson(p, "a shape file") as Shape;
    if (s?.schema !== "tbv-shape.v1" || !ARMS.includes(s.arm)) fail("E_TBV_INPUT", "a file in --shapes is not a tbv-shape.v1 shape");
    if (shapes.has(s.arm)) fail("E_TBV_INPUT", "two shapes in --shapes have the " + s.arm + " arm");
    shapes.set(s.arm, s);
  }
  if (!shapes.size) fail("E_TBV_INPUT", "no tbv-shape.v1 file in --shapes");
  const arms = ARMS.filter((a) => shapes.has(a));
  const models = Object.keys(ARM_MODELS) as Model[];
  const splice = spliceBy(jsonFiles(need(f, "--splices"), "--splices").map((p) => readJson(p, "a splice file") as SpliceSet), (arm) => shapes.get(arm)!.pin, "--splices");
  const turns = readTurns(need(f, "--turns"));
  const fields = { cwd: need(f, "--cwd"), date: need(f, "--date") };

  const families = [...new Set(histories.map((h) => h.family))].sort();
  const fam = new Map<Family, { histories: number; rebuiltIn: number; rebuilt: number; renderRefused: number }>(families.map((x) => [x, { histories: 0, rebuiltIn: 0, rebuilt: 0, renderRefused: 0 }]));
  const cell = new Map<string, { requests: number; valid: number; size: number; refused: number; largest: number }>();
  const refusedLines: string[] = [];
  const digest = createHash("sha256");
  let valid = 0, size = 0, refused = 0;
  histories.forEach((h, i) => {
    const ids = [h.task, h.cluster, ...h.events.flatMap((e) => (e.kind === "tool-use" ? [e.id] : e.kind === "tool-result" ? [e.tool_use_id] : []))].filter((x) => typeof x === "string" && x.length > 0).sort((a, b) => b.length - a.length);
    const redact = (t: string) => ids.reduce((s, id) => s.split(id).join(id === h.task || id === h.cluster ? "<task>" : "<id>"), t);
    const fs = fam.get(h.family)!;
    fs.histories++;
    try {
      const r = rebuildTurns(h);
      if (r.rebuilt) fs.rebuiltIn++;
      fs.rebuilt += r.rebuilt;
    } catch (e) {
      if (!(e instanceof TbvError)) throw e;
      fs.renderRefused++;
    }
    for (const model of models)
      for (const arm of arms) {
        const key = h.family + " " + model;
        const c = cell.get(key) ?? { requests: 0, valid: 0, size: 0, refused: 0, largest: 0 };
        cell.set(key, c);
        c.requests++;
        let why: string | null = null;
        try {
          const set = splice(h.family, arm);
          const built = buildRequest({ history: h, shape: fillShape(shapes.get(arm)!, model, fields), splice: set, turns, arm, model, turn: "report", prior: [] });
          c.largest = Math.max(c.largest, built.estTokens);
          const v = validateRequest(built.body, model);
          if (!v.ok && v.size) {
            c.size++;
            size++;
            continue;
          }
          if (!v.ok) why = "E_TBV_REQUEST the validator refused it: " + v.problem;
          else if (set && !closerHolds(built.body, set)) why = "E_TBV_REQUEST the closer byte check failed";
          else {
            c.valid++;
            valid++;
            digest.update(i + 1 + " " + model + " " + arm + " " + built.sha256 + "\n");
            continue;
          }
        } catch (e) {
          if (!(e instanceof TbvError)) throw e;
          why = e.code + " " + e.message;
        }
        c.refused++;
        refused++;
        refusedLines.push("refused: history " + (i + 1) + " of " + histories.length + " (" + h.family + ", source " + h.source + "), " + model + " " + arm + ": " + redact(why!));
      }
  });

  const total = histories.length * models.length * arms.length;
  const plural = (n: number, one: string, many: string) => n + " " + (n === 1 ? one : many);
  io.out("tbv render-gate: " + plural(histories.length, "history", "histories") + " (" + families.map((x) => x + " " + fam.get(x)!.histories).join(", ") + "); models " + models.join(", ") + "; arms " + arms.join(", ") + "; " + total + " report requests");
  for (const x of families) {
    const s = fam.get(x)!;
    io.out("family " + x + ": " + plural(s.histories, "history", "histories") + ", " + s.rebuiltIn + " with rebuilt turns (" + plural(s.rebuilt, "response", "responses") + ")" + (s.renderRefused ? ", " + s.renderRefused + " refused at render" : ""));
  }
  for (const x of families)
    for (const m of models) {
      const c = cell.get(x + " " + m)!;
      io.out(x + " " + m + ": " + c.requests + " requests: " + c.valid + " valid, " + c.size + " size drops, " + c.refused + " refused; largest estimate " + c.largest + " tokens");
    }
  for (const l of refusedLines) io.out(l);
  io.out("requests sha256 " + digest.digest("hex"));
  io.out(refused ? "Verdict: FAIL (" + refused + " of " + total + " refused, " + valid + " valid, " + size + " size drops)" : "Verdict: PASS (" + valid + " of " + total + " valid, " + size + " size drops)");
  return refused ? 1 : 0;
}
