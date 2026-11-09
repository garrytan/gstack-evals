// Copyright (c) 2026 Garry Tan. MIT License.
// The labels, tune and pin driver (lanes/decision-routing/host/label-tune.sh) with a stub CLI: labels trial and labels
// join run once per Harbor trial with that session's shadow answers, tune reads every labelled file, and pin runs only
// when tune plans no question rewrite (prereg 6.3 re-answers first).

import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "../../lanes/decision-routing/host/label-tune.sh");
const STUB = ["#!/usr/bin/env bash", 'printf "%s\\n" "$*" >> "$STUB_LOG"', 'out=""; prev=""; for a in "$@"; do [ "$prev" = --out ] && out=$a; [ "$prev" = --plan ] && plan=$a; prev=$a; done', '[ -n "$out" ] && echo "{}" > "$out"', '[ -n "\${plan:-}" ] && echo "{\\"types\\": $STUB_TYPES}" > "$plan"', "exit 0"].join("\n") + "\n";

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function rig(types = "[]") {
  const dir = mkdtempSync(join(tmpdir(), "dr-labeltune-"));
  dirs.push(dir);
  const stub = join(dir, "cli");
  writeFileSync(stub, STUB);
  chmodSync(stub, 0o755);
  const out = join(dir, "out");
  for (const [session, task] of [["o__a-1__N__opus", "o__a-1"], ["o__b-2__N__sol", "o__b-2"]]) {
    mkdirSync(join(out, "harbor", session, task + "__x1"), { recursive: true });
    writeFileSync(join(out, "harbor", session, "result.json"), "{}");
    writeFileSync(join(out, "harbor", session, task + "__x1", "result.json"), JSON.stringify({ task_name: task }));
    mkdirSync(join(dir, "answer", "answers"), { recursive: true });
    writeFileSync(join(dir, "answer", "answers", session + ".shadow.jsonl"), "{}\n");
  }
  const r = Bun.spawnSync(["bash", SCRIPT, out, join(dir, "answer"), join(dir, "tasks"), join(dir, "work"), "--proxy-host", "10.0.0.1", "--questions", join(dir, "q.json")], { env: { PATH: process.env.PATH!, DR_CLI: stub, STUB_LOG: join(dir, "log"), STUB_TYPES: types } });
  return { dir, code: r.exitCode, out: r.stdout.toString() + r.stderr.toString(), log: () => readFileSync(join(dir, "log"), "utf8").trim().split("\n") };
}

test("labels each trial, joins its shadow answers, tunes on every labelled file, then pins", () => {
  const { dir, code, log } = rig();
  expect(code).toBe(0);
  const w = join(dir, "work");
  expect(log()).toEqual([
    "labels trial " + join(dir, "out", "harbor", "o__a-1__N__opus", "o__a-1__x1") + " --task " + join(dir, "tasks", "o__a-1") + " --proxy-host 10.0.0.1 --out " + join(w, "labels", "o__a-1__N__opus.jsonl"),
    "labels join --decisions " + join(dir, "answer", "answers", "o__a-1__N__opus.shadow.jsonl") + " --labels " + join(w, "labels", "o__a-1__N__opus.jsonl") + " --out " + join(w, "labelled", "o__a-1__N__opus.jsonl"),
    "labels trial " + join(dir, "out", "harbor", "o__b-2__N__sol", "o__b-2__x1") + " --task " + join(dir, "tasks", "o__b-2") + " --proxy-host 10.0.0.1 --out " + join(w, "labels", "o__b-2__N__sol.jsonl"),
    "labels join --decisions " + join(dir, "answer", "answers", "o__b-2__N__sol.shadow.jsonl") + " --labels " + join(w, "labels", "o__b-2__N__sol.jsonl") + " --out " + join(w, "labelled", "o__b-2__N__sol.jsonl"),
    "tune --labelled " + join(w, "labelled", "o__a-1__N__opus.jsonl") + " --labelled " + join(w, "labelled", "o__b-2__N__sol.jsonl") + " --out " + join(w, "tuned.json") + " --plan " + join(w, "rewrite-plan.json"),
    "pin --tuned " + join(w, "tuned.json") + " --questions " + join(dir, "q.json") + " --out " + join(w, "pin.json"),
  ]);
});

test("stops before pin when tune plans a question rewrite", () => {
  const { dir, code, out, log } = rig('[{"type": "safe"}]');
  expect(code).toBe(3);
  expect(out).toContain("rewrite");
  expect(log().some((l) => l.startsWith("pin "))).toBe(false);
  expect(existsSync(join(dir, "work", "pin.json"))).toBe(false);
});
