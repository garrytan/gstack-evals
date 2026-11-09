// Copyright (c) 2026 Garry Tan. MIT License.
// The harness mechanics eval's frozen values (prereg bundle BUNDLE, sections 3, 4, 5, 9, 12 and 22), the bundle loader and
// the split readers. Every other file of this lane takes its frozen values from here.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { HmArm } from "../../src/types.ts";

export const REPO = resolve(import.meta.dir, "../..");
export const BUNDLE = "wiki/plans/2026-11-09-geva-448-harness-mechanics-prereg";
export const HM = {
  // gstack main on the build day. The plan was written at planPin; none of the commits between touches verify/SKILL.md,
  // lib/skill-contract.ts, lib/skill-route.ts, careful/bin/check-careful.sh, the contract Stop hook or lib/shell-writes.ts.
  gstackPin: "ba2289e1cd9f2387d069b3b6c51b404d56c4a1e9",
  gstackPinVersion: "v1.98.0.0",
  planPin: "350d4196c3444d81590d36cc2d8752be71cf19b6",
  seed: 20261148,
  concurrent: 6,
  turns: 100,
  contextTokens: 200_000,
  lineUsd: 3000,
  // The crew's spend is read from thread counters; it is not a ledger item.
  crewCapUsd: 400,
  // Tasks per part: 20 tasks x 4 arms is 80 sessions, and with the judge arms 120, under the 140 of L1's largest part,
  // which fit the 16-hour part VM TTL.
  partTasks: 20,
  splits: { scored: 200, calibration: 40, spare: 96, judgeSubset: 60, judgePilot: 12 },
  hostRoot: "hm",
  ledgerPort: "9930",
  armManifests: "arms/manifests/hm",
} as const;

// Ledger items and their caps in USD (section 22). The crew's 400 is not a ledger item.
export const CAPS_USD = { "stage1-opus": 150, "stage1-sol": 180, "stage1-p1": 70, "stage2-replay": 90, "stage3-pilot": 90, "stage4-opus": 660, "stage4-sol": 800, "stage4-p1": 280, vms: 160 } as const;
export const ledgerCapsUsd = () => Object.values(CAPS_USD).reduce((a, b) => a + b, 0);
// The ledger items' caps plus the crew's: 2,880 inside the 3,000 line.
export const capsTotalUsd = () => ledgerCapsUsd() + HM.crewCapUsd;

// The closing line every arm's prompt ends with. grid.ts and prompt_builder.py hold the same text under this key.
export const CLOSING = { key: "hm-status", text: "When you finish, end your final message with one line: STATUS: FIXED or STATUS: NOT FIXED." } as const;

// Models under test as L1 ran them in Claude Code, with section 22's per-session allowance. cells.l1-p1.json allows $5, so
// particle-1 reads its own cells file at $2.
export const MODELS = {
  opus: { id: "claude-opus-5-5", cells: "cells.l1.json", allowanceUsd: 5 },
  sol: { id: "gpt-6.1-sol", cells: "cells.l1-sol.json", allowanceUsd: 5 },
  p1: { id: "particle-1", cells: "cells.hm-p1.json", allowanceUsd: 2 },
} as const;
export type ModelKey = keyof typeof MODELS;

// The six run arms as Lane B arm specs (grid.ts armSpec). bo2 has no session: none plus plain-2 plus one picker call.
// The judge backend is not an agent option yet; the judgment hooks' build adds it.
const TAIL = ":system_prompt=claude-code-preset:gstack_hooks=copy:closing_line=" + CLOSING.key;
export const ARMS: Record<HmArm, { spec: string; tar: string; backend?: "jev" | "p1" }> = {
  none: { spec: "none" + TAIL, tar: "none" },
  "plain-2": { spec: "plain-2:tar=none" + TAIL, tar: "none" },
  "verify-prose": { spec: "verify-prose:tar=prose:told=verify" + TAIL, tar: "prose" },
  "verify-hook": { spec: "verify-hook:tar=hook:told=verify" + TAIL, tar: "hook" },
  "judge-jev": { spec: "judge-jev:tar=judge:told=verify" + TAIL, tar: "judge", backend: "jev" },
  "judge-p1": { spec: "judge-p1:tar=judge:told=verify" + TAIL, tar: "judge", backend: "p1" },
};
export const FOUR: HmArm[] = ["none", "plain-2", "verify-prose", "verify-hook"];
export const JUDGE: HmArm[] = ["judge-jev", "judge-p1"];
export const TARS = ["none", "prose", "hook", "judge"];
export const NO_GSTACK: HmArm[] = ["none", "plain-2"];

export const sha256 = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const input = (m: string): never => { throw new Error("E_HM_INPUT " + m); };

// The attachments block of a wiki post's front matter: "  - <sha256>  <name>" lines.
export function frontMatterDigests(readme: string): Map<string, string> {
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(readme)?.[1] ?? input(BUNDLE + "/README.md has no front matter");
  const out = new Map<string, string>();
  let inside = false;
  for (const line of fm.split("\n")) {
    if (/^attachments:\s*$/.test(line)) { inside = true; continue; }
    if (!inside) continue;
    const m = /^  - ([0-9a-f]{64})  (\S+)$/.exec(line);
    if (m) out.set(m[2]!, m[1]!);
    else if (/^\S/.test(line)) inside = false;
  }
  if (!out.size) input(BUNDLE + "/README.md lists no attachments");
  return out;
}

export type Bundle = { digests: Map<string, string>; text: (name: string) => string };
// Every attachment, checked against the README front matter's sha256 as it loads.
export function loadBundle(repo = REPO): Bundle {
  const dir = join(repo, BUNDLE);
  const digests = frontMatterDigests(readFileSync(join(dir, "README.md"), "utf8"));
  const texts = new Map<string, string>();
  for (const [name, want] of digests) {
    const bytes = readFileSync(join(dir, name));
    if (sha256(bytes) !== want) input(BUNDLE + "/" + name + " hashes to " + sha256(bytes) + ", not the front matter's " + want);
    texts.set(name, bytes.toString("utf8"));
  }
  return { digests, text: (name) => texts.get(name) ?? input(name + " is not an attachment of " + BUNDLE) };
}

// One task per line, in the file's (shuffled) order.
export function readList(text: string, name: string, n?: number): string[] {
  const xs = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (new Set(xs).size !== xs.length) input(name + " names a task twice");
  if (n !== undefined && xs.length !== n) input(name + " holds " + xs.length + " tasks, not " + n);
  return xs;
}

export type Lists = { scored: string[]; calibration: string[]; spare: string[]; judgeSubset: string[]; judgePilot: string[] };
export function bundleLists(b: Bundle = loadBundle()): Lists {
  const s = HM.splits;
  const l: Lists = {
    scored: readList(b.text("scored.txt"), "scored.txt", s.scored),
    calibration: readList(b.text("calibration.txt"), "calibration.txt", s.calibration),
    spare: readList(b.text("spare.txt"), "spare.txt", s.spare),
    judgeSubset: readList(b.text("judge-subset.txt"), "judge-subset.txt", s.judgeSubset),
    judgePilot: readList(b.text("judge-pilot.txt"), "judge-pilot.txt", s.judgePilot),
  };
  if (l.judgeSubset.join() !== l.scored.slice(0, s.judgeSubset).join()) input("judge-subset.txt is not the first " + s.judgeSubset + " scored tasks");
  if (l.judgePilot.join() !== l.calibration.slice(0, s.judgePilot).join()) input("judge-pilot.txt is not the first " + s.judgePilot + " calibration tasks");
  return l;
}

// The task-fit screen's output, an input file checked by sha256: "<scored|calibration> <task>" lines in each split's
// shuffled order, a replacement in the replaced task's position. A split may run short when no spare fits.
export type Screened = { scored: string[]; calibration: string[]; sha256: string };
export function readScreened(text: string, want: string, l: Lists): Screened {
  if (sha256(text) !== want) input("the screened lists hash to " + sha256(text) + ", not " + want);
  const out = { scored: [] as string[], calibration: [] as string[] };
  for (const line of text.split("\n").filter((x) => x.trim())) {
    const m = /^(scored|calibration) (\S+)$/.exec(line.trim()) ?? input("a screened line is not '<scored|calibration> <task>': " + line);
    out[m[1] as "scored" | "calibration"].push(m[2]!);
  }
  const all = [...out.scored, ...out.calibration];
  if (new Set(all).size !== all.length) input("the screened lists name a task twice");
  const from = (xs: string[], ok: string[], name: string) => { const bad = xs.find((x) => !ok.includes(x)); if (bad) input("screened " + name + " task " + bad + " is in neither " + name + ".txt nor spare.txt"); };
  from(out.scored, [...l.scored, ...l.spare], "scored");
  from(out.calibration, [...l.calibration, ...l.spare], "calibration");
  if (out.scored.length > HM.splits.scored || out.calibration.length > HM.splits.calibration) input("a screened split is longer than the prereg's");
  return { ...out, sha256: want };
}
// The lists before the screen, in the screened file's format: the fixture and dry-run stand-in.
export const unscreenedText = (l: Lists) => [...l.scored.map((x) => "scored " + x), ...l.calibration.map((x) => "calibration " + x)].join("\n") + "\n";
export function screenedFromEnv(l: Lists): Screened {
  const f = process.env.HM_SCREENED ?? "", want = process.env.HM_SCREENED_SHA256 ?? "";
  if (!f || !/^[0-9a-f]{64}$/.test(want)) throw new Error("E_USAGE set HM_SCREENED to the task-fit screen's lists and HM_SCREENED_SHA256 to their digest");
  return readScreened(readFileSync(f, "utf8"), want, l);
}

// gstack files vendored byte for byte from gstackPin under GSTACK_VENDOR, with each file's upstream git blob sha. The
// matcher runs gstack's own checkContract from them, and the scorer imports the same lastBashWrite. The Stop hook is kept
// as text (its name plus .txt): it is read for its checkContract call, never run, and its other imports are not vendored.
export const GSTACK_VENDOR = "lanes/harness-mechanics/vendor/gstack";
export const GSTACK_BLOBS = {
  "lib/skill-contract.ts": "d10da8dae892ad57c2687d18c85ec8771ebb0f47",
  "lib/shell-writes.ts": "4502f77db5e7c06735e22678a7ea07616457e6cc",
  "lib/fs-atomic.ts": "4b453b455213041b08d8d8a245a914d6f11adc49",
  "lib/skill-route.ts": "b74e7374a3c642dab8733f414c2997eca8857710",
  "lib/skill-triggers.ts": "f0052bc6cf14a5f2fa1fedee7eda0922b2ac0639",
  "lib/state-root.ts": "34a0fa75638678c74f8fb7c7c799ab8c22463cf8",
  "hosts/claude/hooks/skill-contract-stop-hook.ts": "709a4f8e05533c635bfe785449ad711a5e9aa6c5",
} as const;

// Section 6's matcher numbers: match.txt's COUNT and NO cases, probes.txt's probes and timing cases, the timing bound (a
// tenth of the Stop hook's 5 s deadline), the time BEFORE must pass on one timing case and the limit its child is killed
// at, the built-in classifier's wrong count on the 72 cases, and the Node major the prereg names.
export const MATCHER = { count: 31, no: 41, probes: 189, time: 5, timeBoundMs: 500, beforePastMs: 5000, beforeLimitMs: 6000, builtinWrong: 34, nodeMajor: 24 } as const;
