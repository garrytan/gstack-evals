// Copyright (c) 2026 Garry Tan. MIT License.
// The 2x tier (prereg section 3, plan K7, M9, M10, R2-16): a passing base unit's own author family rewrites only its
// evidence files and adds a decoy. The 2x key inherits each base id by byte-identical statement match (M2); a key that
// doesn't map one to one fails the 2x screen. The 2x version reruns step 3 plus the split and needle checks, the audit
// with the split and decoy additions, where a fix verdict drops the item from the 2x key because statements and
// details stay byte for byte (R2-16), and the unanimous key on the 2x evidence over the base unit's primary items. The
// give-away result and the generic screen carry over. A 2x version failing its screen or audit is rewritten once from
// the transform; a second failure drops the 2x version, never the base unit. An item's detail is keyed for the 10x
// read when all three 2x unanimous blocks carry it (M10).
import { AUTHORING, MONEY } from "../frozen.ts";
import type { AnyModel, AuthorFamily, KeyItem } from "../types.ts";
import { ask, readAudits, runAudits, validatorStep, type AuditReading, type StepReading } from "./checks.ts";
import { otherFamily } from "./pipeline.ts";
import { auditPrompt, rewritePrompt, transformPrompt, validatorPrompt } from "./prompts.ts";
import { screen2x, type Failure } from "./screen.ts";
import type { BaseAppView, Deps } from "./seams.ts";
import { digestOf, inheritIds, parseUnitReply, type CheckEntry, type UnitFiles } from "./unit.ts";

export interface X2Job {
  unitId: string;
  app: BaseAppView;
  author: AuthorFamily;
  bundle: string;
  /** The passing base unit's files and primary item ids. */
  base: UnitFiles;
  primary: readonly string[];
}

export interface X2Outcome {
  unitId: string;
  /** pass: a 2x key of at least 3 items; left: fewer than 3 stay unanimous, so the version leaves the 2x read; drop: the version failed. */
  status: "pass" | "left" | "drop";
  step: "transform" | "screen" | "audit" | "unanimous" | null;
  reason: string;
  files: UnitFiles | null;
  /** The 2x key: the base primary items unanimous on the 2x evidence, each with detailKeyed for the 10x read. */
  key: KeyItem[];
  rewrites: number;
  log: CheckEntry[];
  record: { audit: AuditReading | null; unanimous: StepReading | null };
}

/** The transform reply as 2x files, or the screen failure that refuses it. */
function from2xReply(base: UnitFiles, reply: string): UnitFiles | { failure: Failure } | string {
  const p = parseUnitReply(reply, { needPlan: false });
  if (typeof p === "string") return p;
  const items = inheritIds(base.key.items, p.items);
  if (typeof items === "string") return { failure: { check: "ids", detail: items } };
  return { plan: base.plan, context: base.context, evidence: p.evidence, key: { items, wrongWay: p.wrongWay.length ? p.wrongWay : base.key.wrongWay, decoy: p.decoy } };
}

export async function run2x(job: X2Job, deps: Deps): Promise<X2Outcome> {
  const writer = job.author as AnyModel;
  const auditors: AnyModel[] = ["opus", otherFamily(job.author) as AnyModel];
  const log: CheckEntry[] = [];
  const record: X2Outcome["record"] = { audit: null, unanimous: null };
  let rewrites = 0;
  let u: UnitFiles | null = null;
  const first = transformPrompt(job.base);
  const out = (status: X2Outcome["status"], step: X2Outcome["step"], reason: string, key: KeyItem[] = []): X2Outcome => ({ unitId: job.unitId, status, step, reason, files: u, key, rewrites, log, record });
  const entry = (step: string, ok: boolean, detail: string) => log.push({ step, digest: u ? digestOf(u) : "", ok, detail, void: false, carried: false });

  let previous = "";
  const transform = async (prompt: string, label: string) =>
    ask(deps.call, { model: writer, effort: "high", maxTokens: MONEY.outputCaps.transform2x, prompt, label: job.unitId + ":" + label + ":" + writer }, (t) => {
      previous = t;
      return from2xReply(job.base, t);
    });

  let reply = await transform(first, "transform");
  if (!reply.ok) return out("drop", "transform", "the transform reply didn't parse twice: " + reply.reason);

  for (;;) {
    const v = reply.ok ? reply.value : null;
    let failures: Failure[] = [];
    if (v && "failure" in v) {
      failures = [v.failure];
      entry("screen-2x", false, v.failure.check + ": " + v.failure.detail);
    }
    else if (v) {
      u = v;
      const primary = u.key.items.filter((i) => job.primary.includes(i.id));
      const s = screen2x(u, primary, job.app, { vocabulary: deps.vocabulary, today: deps.today });
      entry("screen-2x", s.pass, s.pass ? "every 2x check passes" : s.failures.map((f) => f.check).join(", "));
      failures = s.failures;
    }
    let step: X2Outcome["step"] = "screen";
    if (!failures.length) {
      const items = u!.key.items.filter((i) => job.primary.includes(i.id));
      const a = await runAudits(deps, auditors, auditPrompt(job.bundle, u!, items, true), items.map((i) => i.id), job.unitId + ":audit-2x-" + rewrites, true);
      if (!a.audits) return out("drop", "audit", a.reason);
      const r = readAudits(a.audits);
      record.audit = r;
      entry("audit-2x", r.inputFailures.length === 0, "input failures " + (r.inputFailures.map((f) => f.check).join(",") || "none") + "; drop " + ([...r.drop, ...r.fix].sort().join(",") || "none"));
      if (r.inputFailures.length) {
        step = "audit";
        failures = r.inputFailures.map((f) => ({ check: f.check, detail: f.auditor + ": " + f.reason }));
      } else {
        for (const i of u!.key.items) if (job.primary.includes(i.id) && (r.drop.includes(i.id) || r.fix.includes(i.id))) i.drop = "audit";
        const cands = u!.key.items.filter((i) => job.primary.includes(i.id) && i.drop === null);
        if (cands.length < AUTHORING.transform2x.minKeyItems) return out("left", "audit", "fewer than " + AUTHORING.transform2x.minKeyItems + " primary items left after the 2x audit");
        const cited = [...new Set(u!.key.items.flatMap((i) => i.evidence.map((e) => e.file)))].filter((p) => job.app.tree.includes(p) && !u!.evidence.some((e) => e.path === p)).sort();
        const st = await validatorStep(deps, "unanimous", cands, [], validatorPrompt("unanimous", u!, job.app, cited), { label: job.unitId + ":unanimous-2x", details: true, earlyExit: true, minPrimary: AUTHORING.transform2x.minKeyItems });
        record.unanimous = st;
        for (const i of u!.key.items) if (st.removed.includes(i.id)) i.drop = "not-unanimous";
        entry("unanimous-2x", st.dropped === null && st.kept.length >= AUTHORING.transform2x.minKeyItems, st.dropped ?? "kept " + st.kept.join(","));
        if (st.dropped !== null && !st.earlyExit) return out("drop", "unanimous", st.dropped);
        if (st.earlyExit || st.kept.length < AUTHORING.transform2x.minKeyItems) return out("left", "unanimous", "fewer than " + AUTHORING.transform2x.minKeyItems + " primary items unanimous on the 2x evidence");
        const key = u!.key.items.filter((i) => st.kept.includes(i.id)).map((i) => ({ ...i, detailKeyed: st.blocks.length === 3 && st.blocks.every((b) => b.detail[i.id] === true) }));
        for (const i of u!.key.items) i.detailKeyed = key.some((k) => k.id === i.id && k.detailKeyed);
        return out("pass", null, "a 2x key of " + key.length + " items, " + key.filter((k) => k.detailKeyed).length + " with a keyed detail", key);
      }
    }
    if (rewrites >= AUTHORING.rewritesPerUnit) return out("drop", step, "a second failure after the one rewrite: " + failures.map((f) => f.check + ": " + f.detail).join("; "));
    rewrites++;
    for (const e of log) e.void = true;
    reply = await transform(rewritePrompt(first, previous, failures), "transform-rewrite");
    if (!reply.ok) return out("drop", "transform", "the transform rewrite didn't parse twice: " + reply.reason);
  }
}
