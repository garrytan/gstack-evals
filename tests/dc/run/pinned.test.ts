// Copyright (c) 2026 Garry Tan. MIT License.
// The gate hook and the scope read against the pinned gstack checkout, keyless and without the SDK: runs the pinned
// gstack-autoplan drives to gate_pending, answered by the hook through a local RunBox, and the vendored scope rule
// checked against the pinned snapshot binary and its source digests. Skips without DC_GSTACK_PIN_DIR.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { GATE_MESSAGE } from "../../../lanes/design-constructed/frozen.ts";
import { localRunBox } from "../../../lanes/design-constructed/run/box.ts";
import { gateHook, recHashOf } from "../../../lanes/design-constructed/run/hooks.ts";
import { SCOPE_PIN, SCOPE_SOURCES, scaffoldedPlan, scopeOf } from "../../../lanes/design-constructed/run/scope.ts";
import type { RunBox } from "../../../lanes/design-constructed/run/types.ts";
import { pinnedGstack } from "./helpers.ts";

const PIN = pinnedGstack();
const PLAN = "# Settings screen\n\nWe will add a settings page with a form and a save button in src/components/Settings.tsx.\n";

/** The stub reviewer's submit step: write a bound native result for the open attempt and submit it. */
const SUBMIT = [
  "set -e",
  "OUT=$1",
  "A=$(grep -o '\"attempt\":\"[^\"]*\",\"phase\":\"eng\",\"voice\":\"native\"' \"$OUT/attempts.jsonl\" | tail -1 | sed 's/\"attempt\":\"\\([^\"]*\\)\".*/\\1/')",
  "R=$(grep -o '\"result\":\"[^\"]*\"' \"$OUT/attempts.jsonl\" | tail -1 | sed 's/\"result\":\"\\([^\"]*\\)\"/\\1/')",
  "H=$(grep -o 'INPUT: eng [0-9a-f]*' \"$OUT/eng-native-prompt.md\" | tail -1)",
  "printf '%s\\nDRAFT: none\\n\\nThe settings form has no empty state.\\n\\n```gstack-findings\\n{\"id\":\"F1\",\"severity\":\"High\",\"title\":\"No empty state\",\"fix\":\"Add an empty state\"}\\n```\\n' \"$H\" > \"$OUT/$R\"",
  "gstack-autoplan submit --out \"$OUT\" --phase eng --voice native --result \"$OUT/$R\" --model claude-opus-5-5 --attempt \"$A\"",
  "",
].join("\n");

function rig() {
  const pin = PIN as { dir: string; bin: string };
  const work = mkdtempSync(join(tmpdir(), "dc-pin-work-"));
  const home = mkdtempSync(join(tmpdir(), "dc-pin-home-"));
  writeFileSync(join(work, "plan.md"), PLAN);
  const submit = join(home, "submit.sh");
  writeFileSync(submit, SUBMIT);
  const env = { PATH: pin.bin + ":" + (process.env.PATH ?? ""), HOME: home, GSTACK_SESSION_KIND: "unattended" };
  const sh = (cmd: string[]) => {
    const r = spawnSync(cmd[0]!, cmd.slice(1), { cwd: work, env, encoding: "utf8", timeout: 120_000 });
    if (r.status !== 0) throw new Error(cmd.join(" ") + " exited " + r.status + ": " + r.stderr);
    return r.stdout;
  };
  const gated = (name: string) => {
    const out = join(work, name);
    sh(["gstack-autoplan", "next", "--out", out, "--plan", "plan.md", "--kind", "feature", "--scaffold"]);
    sh(["sh", submit, out]);
    return out;
  };
  const box = localRunBox({ roots: [work, home], gstackBin: pin.bin, env, cwd: work });
  const state = (out: string) => JSON.parse(readFileSync(join(out, "run.json"), "utf8"));
  return { work, home, sh, gated, box, state };
}

describe.skipIf("skip" in PIN)("the gate hook on the pinned gstack-autoplan (keyless)" + ("skip" in PIN ? " (skipped: " + PIN.skip + ")" : ""), () => {
  // Value: protects=R2-6, R2-11 and R2-14 against the real pinned binaries: a run at gate_pending is answered rec by agent:harness and leaves gate_pending, rec_rev above 0 takes the render's hash, a failed render falls back to the journal's recommended row, no run answers nothing, and two runs are both answered; fails_when=the answer is refused, the hash is wrong, or a run is missed or double-answered; why_new=no source answers an autoplan gate; seam=gateHook, recHashOf, localRunBox; no_claim=a model's choices, the container box
  test("a run at gate_pending with rec_rev 0 is answered rec by the harness", () => {
    const r = rig();
    const out = r.gated("run-1");
    expect(r.state(out).status).toBe("gate_pending");
    const h = gateHook({ box: r.box, sinceMs: 0 });
    expect(h.onStop()).toBe(GATE_MESSAGE);
    const s = r.state(out);
    expect([s.status === "gate_pending", s.gate.reply, s.gate.answered_by, s.gate.words_by]).toEqual([false, "rec", "agent:harness", "agent:harness"]);
    expect(h.onStop()).toBeNull();
  }, 300_000);

  test("after recommend (rec_rev 1) the hash comes from the pinned render and the answer binds", () => {
    const r = rig();
    const out = r.gated("run-1");
    const printed = r.sh(["gstack-autoplan", "recommend", "--out", out, "--gate-rev", "1", "--item", "d1", "--option", "b", "--basis", "the plan needs it", "--by", "parent"]);
    const want = /--rec-hash ([0-9a-f]+)/.exec(printed)![1];
    expect(recHashOf(r.box, out, 1)).toEqual({ hash: want!, from: "render" });
    expect(gateHook({ box: r.box, sinceMs: 0 }).onStop()).toBe(GATE_MESSAGE);
    expect(r.state(out).gate.reply).toBe("rec");
  }, 300_000);

  test("when the render fails, the journal's recommended row gives the hash and the pin accepts it", () => {
    const r = rig();
    const out = r.gated("run-1");
    r.sh(["gstack-autoplan", "recommend", "--out", out, "--gate-rev", "1", "--item", "d1", "--option", "b", "--basis", "the plan needs it", "--by", "parent"]);
    const broken: RunBox = { ...r.box, gstack: (bin, args) => (bin === "gstack-gate" ? { code: 1, stdout: "", stderr: "render failed" } : r.box.gstack(bin, args)) };
    expect(recHashOf(broken, out, 1)?.from).toBe("journal");
    expect(recHashOf(broken, out, 1)?.hash).toBe(recHashOf(r.box, out, 1)!.hash);
    expect(gateHook({ box: broken, sinceMs: 0 }).onStop()).toBe(GATE_MESSAGE);
    expect(r.state(out).gate.reply).toBe("rec");
  }, 300_000);

  test("no run directory answers nothing; two runs at gate_pending are both answered with one message", () => {
    const r = rig();
    const logs: string[] = [];
    expect(gateHook({ box: r.box, sinceMs: 0, log: (l) => logs.push(l) }).onStop()).toBeNull();
    expect(logs.length).toBe(1);
    const a = r.gated("run-1");
    const b = r.gated("run-2");
    const h = gateHook({ box: r.box, sinceMs: 0, log: (l) => logs.push(l) });
    expect(h.onStop()).toBe(GATE_MESSAGE);
    expect(h.answered().map((x) => x.dir).sort()).toEqual([a, b].sort());
    expect(h.messages()).toBe(1);
    expect([r.state(a).gate.reply, r.state(b).gate.reply]).toEqual(["rec", "rec"]);
  }, 300_000);
});

describe.skipIf("skip" in PIN)("the vendored scope rule against the pin" + ("skip" in PIN ? " (skipped: " + PIN.skip + ")" : ""), () => {
  // Value: protects=the scope read's claim that it is the pin's own rule: the vendored files match their pinned digests and the read equals the pinned snapshot binary's scope command on each plan; fails_when=a source moved or the vendored copy disagrees; why_new=the lane reads UI scope outside a run; seam=scopeOf, scaffoldedPlan, SCOPE_SOURCES; no_claim=plans outside these fixtures
  test("the pin is the one the vendored sources name, and each source matches its sha256", () => {
    const pin = PIN as { dir: string };
    expect(spawnSync("git", ["-C", pin.dir, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim()).toBe(SCOPE_PIN);
    for (const [path, sha] of Object.entries(SCOPE_SOURCES)) expect([path, createHash("sha256").update(readFileSync(join(pin.dir, path))).digest("hex")]).toEqual([path, sha]);
  });

  test("the read equals the pinned binary's scope on each plan, with a template file under the working folder", () => {
    const pin = PIN as { dir: string };
    const root = mkdtempSync(join(tmpdir(), "dc-pin-scope-"));
    const files: Record<string, string> = { "repo/src/card.ts": "const t = html`<div></div>`;\n", "repo/src/util.ts": "export const x = 1;\n" };
    for (const [p, t] of Object.entries(files)) {
      mkdirSync(dirname(join(root, p)), { recursive: true });
      writeFileSync(join(root, p), t);
    }
    const plans = [
      "# Orders\n\nWe will change src/pages/orders.tsx.\n",
      "# Orders\n\nThe form on the page gets a save button.\n",
      "# Orders\n\nThe list and the button stay.\n",
      "## Implementation plan\n\nThe modal layout on the view changes.\n",
      "# Card\n\nWe will change repo/src/card.ts and repo/src/util.ts.\n",
      "# API\n\nThe endpoint returns a list of rows for the menu service.\n",
    ];
    for (const [i, plan] of plans.entries()) {
      const active = join(root, "plan-" + i + ".md");
      writeFileSync(active, scaffoldedPlan(plan));
      const r = spawnSync("bun", [join(pin.dir, "bin", "gstack-autoplan-snapshot.ts"), "scope", active], { cwd: root, encoding: "utf8" });
      expect(r.status).toBe(0);
      const theirs = JSON.parse(r.stdout);
      expect([i, scopeOf(plan, root)]).toEqual([i, { uiRequired: theirs.uiRequired, uiMatches: theirs.uiMatches, uiEvidence: theirs.uiEvidence }]);
    }
  }, 120_000);
});
