// A synthetic plan panel for the planning lane's tests (plan 2026-10-31-geva-79-planning-lane-plan, B1, B6 and B7): a
// git repo whose unit heads each add plan.md over a base that holds context/, plan cases in a catalog under a sealed root
// outside the repo, the sealed suite built from them, its stub, and arms in contract v1 written from per-blocker
// outcomes. Every plan, flaw and finding here is invented.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PlanStratum } from "../../lanes/review-replay/catalog/catalog.ts";
import { REPO_ROOT, suiteFromCatalog, suiteStub, type Suite, type Unit } from "../../lanes/review-noloss/suite.ts";

export const PANEL_REPO = "example/plan-panel";
export const CUSTODY = "procedural custody: a synthetic test panel, key held apart";
const sha256 = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");

function git(dir: string, ...args: string[]): string {
  const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("git " + args.join(" ") + ": " + r.stderr);
  return r.stdout.trim();
}

const write = (path: string, text: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

/** plan.md for unit n: four sections, each heading on a fixed line (3, 6, 9, 12). */
export const planText = (n: number) =>
  ["# Plan " + n + ": a reading-list app", "", "## Problem", "Readers lose links they mean to read later.", "", "## Users", "Commuters who read on their phones.", "", "## Scope", "Build a sync server, three native apps and a summarizer in the first release.", "", "## Success measure", "Weekly active readers.", ""].join("\n");

const SECTIONS = { Problem: 3, Users: 6, Scope: 9, "Success measure": 12 } as const;
type Flaw = { section: keyof typeof SECTIONS; flaw_class: "wrong-thing" | "right-thing-badly" | "bait"; cause: string };
const FLAWS: Record<PlanStratum, Flaw[]> = {
  seeded: [
    { section: "Problem", flaw_class: "wrong-thing", cause: "The plan solves losing links, which the context says readers do not have; they asked for reading offline." },
    { section: "Scope", flaw_class: "right-thing-badly", cause: "The first release builds three apps and a summarizer where the goal needs one offline reader." },
  ],
  "real-neutral": [{ section: "Success measure", flaw_class: "right-thing-badly", cause: "Weekly active readers can rise while articles read offline fall, so the measure is a proxy." }],
  "home-field": [{ section: "Users", flaw_class: "wrong-thing", cause: "The target user contradicts the context, which names desk readers." }],
  decoy: [{ section: "Scope", flaw_class: "bait", cause: "The plan runs its own sync server, which the context justifies: the customer's data rules forbid the hosted option." }],
  pilot: [{ section: "Problem", flaw_class: "wrong-thing", cause: "A pilot flaw." }],
};

export interface Panel {
  dir: string;
  clone: string;
  sealedRoot: string;
  suite: Suite;
  /** The sealed suite: <sealedRoot>/suites/<id>.json. */
  suitePath: string;
  /** The stub, outside the sealed root. */
  stubPath: string;
}

/** Builds the panel under dir: n units per stratum, numbered from 1 in stratum order, then the suite (pilot left out) and its stub. */
export function planPanel(dir: string, counts: Partial<Record<PlanStratum, number>>, o: { id?: string; visibility?: "sealed" | "public" } = {}): Panel {
  const clone = join(dir, "clone");
  write(join(clone, "context", "goals.md"), "Readers asked for offline reading. Nobody asked for summaries.\n");
  spawnSync("git", ["-C", clone, "init", "-q", "-b", "main"]);
  git(clone, "config", "user.email", "eval@example.com");
  git(clone, "config", "user.name", "eval");
  git(clone, "add", "-A");
  git(clone, "commit", "-q", "-m", "context");
  const base = git(clone, "rev-parse", "HEAD");
  const sealedRoot = join(dir, "sealed");
  const catalog = join(sealedRoot, "catalog", "plans");
  mkdirSync(catalog, { recursive: true });
  let pr = 0;
  for (const stratum of ["seeded", "real-neutral", "home-field", "decoy", "pilot"] as const) {
    for (let i = 0; i < (counts[stratum] ?? 0); i++) {
      pr++;
      git(clone, "checkout", "-q", "-b", "unit-" + pr, base);
      write(join(clone, "plan.md"), planText(pr));
      git(clone, "add", "-A");
      git(clone, "commit", "-q", "-m", "plan " + pr);
      const head = git(clone, "rev-parse", "HEAD");
      FLAWS[stratum].forEach((f, k) => {
        const id = "planpanel-" + pr + "-" + (k + 1);
        const bait = f.flaw_class === "bait";
        write(join(catalog, id + ".json"), JSON.stringify({
          schema_version: 1, kind: "plan", id, visibility: o.visibility ?? "sealed", repo: PANEL_REPO, pr, reviewed_head: head, merge_base: base,
          plan: { digest: sha256(planText(pr)), lens: "ceo", stratum, source: k === 0 ? "taxonomy A (synthetic)" : "taxonomy B (synthetic)", plan_type: pr % 3 === 0 ? "fix" : pr % 3 === 1 ? "greenfield" : "added-capability", flaw_class: f.flaw_class },
          defect: { file: "plan.md", line: SECTIONS[f.section], section: f.section, cause: f.cause, summary: f.cause },
          severity: { deserved: bait ? "INFORMATIONAL" : "CRITICAL", basis: "synthetic" },
          receipt: { source: "synthetic", evidence: ["context/goals.md"] },
          answer_key_audit: { by: "synthetic", at: "2026-10-31", verdict: "confirmed", notes: "synthetic" },
          credit: "synthetic",
        }, null, 2) + "\n");
      });
    }
  }
  git(clone, "checkout", "-q", "main");
  const id = o.id ?? "planpanel-test";
  const suite = suiteFromCatalog({ id, catalogs: ["catalog/plans"], released: null, root: sealedRoot });
  const text = JSON.stringify(suite, null, 2) + "\n";
  const suitePath = join(sealedRoot, "suites", id + ".json");
  write(suitePath, text);
  const stubPath = join(dir, "stub", id + ".json");
  if (suite.sealed) write(stubPath, JSON.stringify(suiteStub(suite, text, sealedRoot, CUSTODY), null, 2) + "\n");
  return { dir, clone, sealedRoot, suite, suitePath, stubPath };
}

export type Outcome = "F" | "D" | "M";
export interface PlanArm {
  id: string;
  passes: number;
  /** The outcome of each blocker in each pass: F flagged Critical or High, D flagged Medium, M not named. */
  outcome: (u: Unit, b: Unit["blockers"][number], pass: number) => Outcome;
  /** Critical findings per decoy per pass that name no blocker, each adjudicated not-defect. */
  noise?: number;
  /** Raw: findings only, no judgments.tsv or adjudication.tsv, as judge-packet reads it. */
  raw?: boolean;
  /** Text for each finding's claim, section, evidence and fix; the default names the blocker's section. */
  text?: (u: Unit, b: Unit["blockers"][number] | null) => { section: string; claim: string; evidence: string; fix: string };
}

/** Writes an arm in contract v1 for the panel's suite under dir and returns dir. */
export function writePlanArm(dir: string, suite: Suite, arm: PlanArm): string {
  const example = JSON.parse(readFileSync(join(REPO_ROOT, "lanes/review-noloss/example/arm-example/arm.json"), "utf8"));
  const armJson = { ...example, id: arm.id, label: arm.id + " (synthetic plan arm)", suite: suite.id, passes: arm.passes, date: "2026-10-31", status: "complete", models: [{ role: "driver", model: "anthropic/claude-opus-5-5", effort: "medium" }], run_by: "tests/noloss/plan-panel.ts", severity_map: { default: { Critical: "CRITICAL", High: "CRITICAL", Medium: "INFORMATIONAL", Low: "INFORMATIONAL" } }, notes: "Synthetic." };
  delete armJson.coverage_gaps;
  write(join(dir, "arm.json"), JSON.stringify(armJson, null, 2) + "\n");
  const text = arm.text ?? ((u, b) => ({ section: b ? (b.line === 3 ? "Problem" : b.line === 9 ? "Scope" : b.line === 12 ? "Success measure" : "Users") : "Users", claim: b ? "Synthetic finding on unit " + u.pr + " " + b.id + "." : "Synthetic finding that names no flaw.", evidence: "plan.md and context/goals.md", fix: "Synthetic." }));
  const judgments = ["pr\tblocker_id\toutcome\tmatched_finding\traw_severity\tmapped_severity\tjudge\tsaw_label\tnote\tpass\tcoverage"];
  const rulings = ["pr\tfinding\tpass\truling\tjudge\tsaw_label\tversion\tbatch\tnote"];
  const cost = ["pr\tscope\ttotal_tokens\tmeter_source"];
  for (const u of suite.units) {
    const lines: string[] = [];
    for (let pass = 1; pass <= arm.passes; pass++) {
      for (const b of u.blockers) {
        const o = arm.outcome(u, b, pass);
        const fid = "p" + pass + "-" + b.id.toLowerCase();
        if (o !== "M") lines.push(JSON.stringify({ id: fid, severity: o === "F" ? "High" : "Medium", path: "plan.md", line: b.line, summary: text(u, b).claim, ...text(u, b), pass }));
        judgments.push([u.pr, b.id, o, o === "M" ? "" : fid, o === "F" ? "High" : o === "D" ? "Medium" : "", o === "F" ? "CRITICAL" : o === "D" ? "INFORMATIONAL" : "", "synthetic", "no", o === "M" ? "no finding names this flaw" : "", pass, "complete"].join("\t"));
      }
      const decoy = u.blockers.every((b) => b.counts === "over-blocking");
      for (let k = 1; decoy && k <= (arm.noise ?? 0); k++) {
        const fid = "p" + pass + "-n" + k;
        lines.push(JSON.stringify({ id: fid, severity: "Critical", path: "plan.md", line: 1, summary: text(u, null).claim, ...text(u, null), pass }));
        rulings.push([u.pr, fid, pass, "not-defect", "synthetic", "no", 1, "synthetic", ""].join("\t"));
      }
    }
    write(join(dir, "findings", u.pr + ".jsonl"), lines.map((l) => l + "\n").join(""));
    cost.push([u.pr, "all", 3000, "lane-counter-delta"].join("\t"));
  }
  if (!arm.raw) {
    write(join(dir, "judgments.tsv"), judgments.join("\n") + "\n");
    if (rulings.length > 1) write(join(dir, "adjudication.tsv"), rulings.join("\n") + "\n");
  }
  write(join(dir, "cost.tsv"), cost.join("\n") + "\n");
  return dir;
}
