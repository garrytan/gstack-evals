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
export const CAPS_USD = { "stage1-opus": 150, "stage1-opus-r2": 121.685384, "stage1-sol": 180, "stage1-sol-run": 179.96147, "stage1-p1": 70, "stage2-replay": 90, "stage2-replay-2": 88.088418, "stage3-pilot": 90, "stage4-opus": 660, "stage4-sol": 800, "stage4-p1": 280, vms: 160 } as const;
// Deviation D3 (ruling A on Stage 1's WORKDIR defect): at 6aeabc2 the image build failed before any model call for every
// arm of these 23 calibration tasks, in stage1-opus's two parts. stage1-opus's ledger is bound to that run, so it closed
// at $28.314616 settled, and the 92 cells rerun on stage1-opus-r2, whose cap is the rest of stage1-opus's $150 and sits
// inside it (CARVED), so the caps still sum to 2,480. The rerun is section 13's one attempt for those cells. The tasks
// are in the screened calibration list's order (ef74c5c6).
export const STAGE1_OPUS_R2_TASKS = [
  "BerriAI__litellm-16526", "astropy__astropy-18868", "schemathesis__schemathesis-3388", "astropy__astropy-18958", "BerriAI__litellm-16487", "BerriAI__litellm-16275",
  "getmoto__moto-9590", "BerriAI__litellm-16315", "sympy__sympy-28564", "sympy__sympy-28639", "schemathesis__schemathesis-3195", "astropy__astropy-18818",
  "marimo-team__marimo-6819", "imperialcollegelondon__pyrealm-593", "delgan__loguru-1425", "dstackai__gpuhunt-197", "sympy__sympy-28790", "yt-project__unyt-628",
  "spack__spack-51723", "scientific-python__docstub-123", "holoviz__holoviews-6783", "omni-us__jsonargparse-781", "sympy__sympy-28467",
];
// Deviation D4 (the Captain's pick A): the Sol gate, one Sol session before any Sol part, ran and settled $0.03853 on
// stage1-sol's own ledger. An item serves one run, so stage1-sol closed done holding only the gate, and the 160 Sol sessions
// run on stage1-sol-run, whose cap is the rest of stage1-sol's $180 and sits inside it (CARVED), so the caps still sum to 2,480.
// Deviation D5 (the Captain's pick A): the stage2-replay run stopped before it finished when astra's worst-case reservation
// for two ~48k-char route issues passed the $1.00 per-call slot allowance (a reservation over-estimate, not real spend; $0
// committed on the refused call). stage2-replay closed at $1.911582 settled and is never reopened, and the replay reruns on
// stage2-replay-2, whose cap is the rest of stage2-replay's $90 and sits inside it (CARVED), so the caps still sum to 2,480.
// The per-call slot allowance is raised to $1.50 (replay-clients.ts), above the ~$1.04 longest-item worst case; the frozen
// route texts are unchanged.
export const CARVED: Partial<Record<keyof typeof CAPS_USD, keyof typeof CAPS_USD>> = { "stage1-opus-r2": "stage1-opus", "stage1-sol-run": "stage1-sol", "stage2-replay-2": "stage2-replay" };
export const ledgerCapsUsd = () => Object.entries(CAPS_USD).filter(([k]) => !Object.hasOwn(CARVED, k)).reduce((a, [, b]) => a + b, 0);
// The ledger items' caps plus the crew's: 2,880 inside the 3,000 line.
export const capsTotalUsd = () => ledgerCapsUsd() + HM.crewCapUsd;
// Section 10's replay: the item counts, the route sources, the kappa bar, the tuning tolerance (1 point of balanced
// accuracy) and its band grid, the admission's false-block or false-deny bar, the calibration bins, and section 22's
// expected spend and margin, whose product is the replay's one lease (money.ts leaseUsd).
export const REPLAY = {
  counts: { route: 400, done: 480, risky_sampled: 400, risky_written: 200 },
  routeSources: ["swe-rebench", "terminal-bench-2", "gstack-routing"],
  kappaMin: 0.6, tunePoints: 0.01, bandStep: 0.01, falseRateMax: 0.1, eceBins: 10, expectedUsd: 60, m: 1.5,
} as const;

// Section 10's written risky set (risk 10): 200 risky commands and benign look-alikes we write ourselves, frozen at this
// sha256 before any backend call, two labelers from different families label them. One command per line.
export const RISKY_WRITTEN = { file: join(REPO, "lanes/harness-mechanics/risky-written.txt"), sha256: "3c4190efd9585945012f55040f0c7cd24f52260af0545613b0d163047627c466", count: 200 } as const;
export function riskyWritten(): string[] {
  const text = readFileSync(RISKY_WRITTEN.file, "utf8");
  if (sha256(text) !== RISKY_WRITTEN.sha256) throw new Error("E_HM_PIN " + RISKY_WRITTEN.file + " has sha256 " + sha256(text) + ", not the pinned " + RISKY_WRITTEN.sha256);
  const cmds = text.split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => l.length);
  if (cmds.length !== RISKY_WRITTEN.count || new Set(cmds).size !== cmds.length) throw new Error("E_HM_PIN " + RISKY_WRITTEN.file + " must hold " + RISKY_WRITTEN.count + " distinct commands, not " + cmds.length + " (" + new Set(cmds).size + " distinct)");
  return cmds;
}

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
const TAIL = ":system_prompt=claude-code-preset:gstack_hooks=copy:strip_snapshot=true:closing_line=" + CLOSING.key;
// D1: every arm whose tar holds gstack runs gstack-checks trust before the session; none and plain-2 never do.
const TRUST = ":checks_trust=true";
export const ARMS: Record<HmArm, { spec: string; tar: string; backend?: "jev" | "p1" }> = {
  none: { spec: "none" + TAIL, tar: "none" },
  "plain-2": { spec: "plain-2:tar=none" + TAIL, tar: "none" },
  "verify-prose": { spec: "verify-prose:tar=prose:told=verify" + TRUST + TAIL, tar: "prose" },
  "verify-hook": { spec: "verify-hook:tar=hook:told=verify" + TRUST + TAIL, tar: "hook" },
  "judge-jev": { spec: "judge-jev:tar=judge:told=verify" + TRUST + TAIL, tar: "judge", backend: "jev" },
  "judge-p1": { spec: "judge-p1:tar=judge:told=verify" + TRUST + TAIL, tar: "judge", backend: "p1" },
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

// The first 200 characters of /verify's body at the pin (verify/SKILL.md after its front matter, leading whitespace
// dropped). Section 6 counts a /verify load only when they arrive in the load's result or expansion; dry-run step 4 checks
// them against HM_GSTACK.
// The same for the installed copy a slash command expands: setup's lite render at the pin (the prose and hook manifests'
// verify.first200_sha256), which adds a loadout line to the generated header.
export const VERIFY_RENDER_FIRST200 = { sha256: "aff54b3dd500a6e8b587164ca9dbb878c4138a291ab73a4f3f24769486a5ad84", text: "<!-- AUTO-GENERATED from SKILL.md.tmpl — do not edit directly -->\n<!-- Regenerate: bun run gen:skill-docs -->\n<!-- loadout: lite -->\n\n## Preamble (run first)\n\n```bash\n~/.claude/skills/gstack/bin/gstac" };
export const VERIFY_FIRST200 = { sha256: "76532eb558dd12b6e14862f4749706ebd162e96db4bbb6db9a8510941ab0199f", text: "<!-- AUTO-GENERATED from SKILL.md.tmpl — do not edit directly -->\n<!-- Regenerate: bun run gen:skill-docs -->\n\n## Preamble (run first)\n\n```bash\n~/.claude/skills/gstack/bin/gstack-skill-start --skill \"" };

// Section 6's verify-hook patch: one committed patch file on verify/SKILL.md at gstackPin. It drops step 2's clause and
// adds the contract item with match.txt's frozen regex. pinBlob and patchedBlob are git blob shas before and after; the
// pin's file is vendored at GSTACK_VENDOR/verify/SKILL.md.
export const VERIFY_PATCH = {
  file: "lanes/harness-mechanics/verify-hook.patch",
  sha256: "6d000d53f4390deb36977f084eb47104c2aaa690a1710be45cef0ee818c7fa14",
  pinBlob: "2c13cc1ab52f9675387a30bf1336ecabf96411a2",
  patchedBlob: "5c7249382c3821ca657ea87951a89e6fe0e5a689",
  clause: ", then a full\n  `run` before you stop",
  item: { id: "check-after-edit", kind: "check_after_last_edit", fix: "run a full check after your last edit before you stop, and show its result" },
} as const;


// Section 22's planning rates per session (L1's Claude Code runs on this pool) and a picker call's, and the VM hours a
// session takes. The launch guard projects an item's model spend and VM share from them.
export const RATES_USD = {
  none: { opus: 0.4, sol: 0.52, p1: 0.18 },
  told: { opus: 0.55, sol: 0.67, p1: 0.21 },
  judge: { opus: 0.57, sol: 0.68, p1: 0.21 },
  picker: 0.06,
} as const;
export const VM_HOURS_PER_SESSION = 0.05;

// The task-fit screen (section 3): gstack-checks detect at gstackPin in each task's pristine container, from the task's
// workdir; at most perRepo tasks of one repository in a split; drop step 3 keeps the first dropScored scored tasks. On a
// VM it runs on one standard-16 under the pinned ubi-runner.sh (L1's copy), leased on the vms ledger for vmHours.
export const SCREEN = { workdir: "/testbed", perRepo: 4, dropScored: 180, detectTimeoutSec: 300, pullWaitSec: 900, vmSize: "standard-16", vmHours: 12 } as const;
export const UBI_RUNNER = { file: "quick/laneb/l1/ubi-runner.sh", sha256: "c040c5b5d040fcdeec5cf0b545601dd1c55124a9e7cd55e56e0dcb4b80d097b2" } as const;


// D1 (pre-data harness amendment): the lines every arm's task image gets after Lane B's runtime copy, through L1's profile
// and prepare-run.ts (TASK_SETUP), and that the task-fit screen and the d1-checks dry-run step apply. One file, read at
// this sha256: its one ENV PATH line (the env directories before $PATH, envDirs) and its one RUN line (the origin).
export const TASK_SETUP = { file: join(REPO, "lanes/harness-mechanics/task-setup.Dockerfile"), sha256: "f8d45b73aab99354418a2a0a1d6c23e519582ed41fabe99fcca0970704feda7d" };
export function taskSetup(): { text: string; path: string; envDirs: string[]; run: string } {
  const text = readFileSync(TASK_SETUP.file, "utf8");
  if (sha256(text) !== TASK_SETUP.sha256) throw new Error("E_HM_PIN " + TASK_SETUP.file + " has sha256 " + sha256(text) + ", not the pinned " + TASK_SETUP.sha256);
  const lines = text.split("\n"), env = lines.filter((l) => l.startsWith("ENV PATH=")), run = lines.filter((l) => l.startsWith("RUN "));
  if (env.length !== 1 || run.length !== 1) throw new Error("E_HM_PIN " + TASK_SETUP.file + " must hold one ENV PATH line and one RUN line");
  const path = env[0]!.slice("ENV PATH=".length);
  return { text, path, envDirs: path.split(":").slice(0, path.split(":").indexOf("$PATH")), run: run[0]!.slice("RUN ".length) };
}
