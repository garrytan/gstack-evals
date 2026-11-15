// Copyright (c) 2026 Garry Tan. MIT License.
// The labeller calls (plan section 7): the label audit (I3), its contingency (I4) and the duplicate linking (I5), on the
// arm driver in run.ts with the frozen codebook. A labeller sees the item, the numbered earlier asks with the answers the
// ledger's K1 rule quotes, the ask and the owner's next message, never the audit's label. The readout turns the sealed
// labels into kappa against the audit, chains from the Opus links, the answer judgements and the label views.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Link } from "./chains.ts";
import { fail, FROZEN } from "./frozen.ts";
import { ledgerRows } from "./ledger.ts";
import { lastObject } from "./parse.ts";
import { components, stamp, type BuiltPrompt } from "./prompt.ts";
import { requestBody, type LabelJob } from "./run.ts";
import { labelAudit } from "./stats.ts";
import { LABELS, type AnswerJudgement, type AskItem, type Label, type LabelKind, type LabelReply, type ModelKey, type Sample, type SampleRecord } from "./types.ts";

export const CODEBOOK = readFileSync(join(import.meta.dir, FROZEN.labelling.codebook), "utf8");

/** Refuses a codebook that differs from the frozen one (E_ASK_PIN), before any paid call. */
export function checkCodebook(text = CODEBOOK): void {
  const got = createHash("sha256").update(text).digest("hex");
  if (got !== FROZEN.labelling.codebook_sha256) fail("E_ASK_PIN", "codebook.md sha256 " + got + " differs from frozen.json labelling.codebook_sha256 " + FROZEN.labelling.codebook_sha256);
}

export const LABEL_HARNESS = [
  "You label one ask from a replay study of a coordinating agent and its owner. Read the codebook below, then the material in the user message: the standing rules in force, the conversation before the ask, the numbered earlier asks in this thread, the ask itself and the owner's first message after it.",
  'Reply with one JSON object and nothing else: {"class": "DECISION" or "DUPLICATE" or "PERMISSION_FOR_DEFAULT" or "OBSERVABLE", "repeats_of": the position of the earlier ask it repeats, or null, "answer_judgement": [{"row": position, "answers": "yes" or "no" or "unclear"}] with one entry for each earlier ask marked answered, "reason": "at most 40 words"}.',
].join("\n\n");

/** The labeller's prompt for one item: the codebook as system text; rules, conversation, numbered earlier asks, the ask and the owner's next message. */
export function labelPrompt(item: AskItem): BuiltPrompt {
  const parts = components(item, "a", null);
  const part = (name: string) => parts.find((p) => p.name === name)!.text;
  const rows = ledgerRows(item);
  const earlier = ["## Earlier asks in this thread, oldest first", "", ...(rows.length ? rows.flatMap((r, i) => ["[" + (i + 1) + "] asked " + stamp(r.at) + ": " + r.text, ...(r.status === "answered" ? ["    marked answered by the owner's message at " + stamp(r.answered_at!) + ": " + JSON.stringify(r.answer)] : [])]) : ["(none)"])].join("\n");
  const ask = ["## The ask to label, sent at " + stamp(item.at), "", item.draft].join("\n");
  const after = ["## The owner's first message after the ask (for labelling only)", "", item.after_reply ? stamp(item.after_reply.at) + ": " + item.after_reply.text : "(none)"].join("\n");
  return { system: LABEL_HARNESS + "\n\n" + CODEBOOK, user: [part("rules"), part("conversation"), earlier, ask, after].join("\n\n"), components: [] };
}

/** The labeller's reply schema, every field required as strict mode asks. */
export function labelSchema(): Record<string, unknown> {
  const judgement = { type: "object", properties: { row: { type: "integer" }, answers: { type: "string", enum: ["yes", "no", "unclear"] } }, required: ["row", "answers"], additionalProperties: false };
  return { type: "object", properties: { class: { type: "string", enum: [...LABELS] }, repeats_of: { type: ["integer", "null"] }, answer_judgement: { type: "array", items: judgement }, reason: { type: "string" } }, required: ["class", "repeats_of", "answer_judgement", "reason"], additionalProperties: false };
}

const whole = (v: unknown): number | null => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n >= 1 ? n : null;
};

/** A labeller reply from parsed JSON: a known class is required; a bad position reads as null and a bad judgement entry is dropped. */
export function toLabel(v: unknown): LabelReply | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const cls = typeof o.class === "string" ? o.class.trim().toUpperCase() : "";
  if (!(LABELS as readonly string[]).includes(cls)) return null;
  const answer_judgement = (Array.isArray(o.answer_judgement) ? o.answer_judgement : []).flatMap((x) => {
    const e = (x ?? {}) as Record<string, unknown>;
    const row = whole(e.row);
    const answers = typeof e.answers === "string" ? e.answers.trim().toLowerCase() : "";
    return row !== null && ["yes", "no", "unclear"].includes(answers) ? [{ row, answers: answers as AnswerJudgement }] : [];
  });
  return { class: cls as Label, repeats_of: whole(o.repeats_of), answer_judgement, reason: typeof o.reason === "string" ? o.reason : "" };
}

export const labelJob: LabelJob = {
  body: (item, s, maxTokens) => requestBody(s.model, labelPrompt(item), s.arm, maxTokens, labelSchema()),
  parse: (text) => lastObject(text, toLabel),
};

export const labelId = (item: string, kind: LabelKind, model: ModelKey): string => item + ".label-" + kind + "." + model + ".1";

/** One labeller call per item in the bundle, or per item of the kind's classes (link: duplicates), by item id, each carrying how many its shard scheduled. The contingency labels only the items outside the audit draw and refuses to run without it. */
export function labelSamples(items: readonly AskItem[], kind: LabelKind, model: ModelKey, audited?: ReadonlySet<string>): Sample[] {
  const spec = FROZEN.labelling.kinds[kind];
  if (!spec.models.includes(model)) fail("E_USAGE", "label --kind " + kind + " runs on " + spec.models.join(" or "));
  if (kind === "contingency" && !audited) fail("E_USAGE", "label --kind contingency labels only the items outside the audit draw; pass --audit-draw");
  const ids = [...items]
    .filter((i) => (!spec.classes || spec.classes.includes(i.label)) && !(kind === "contingency" && audited!.has(i.item)))
    .map((i) => i.item)
    .sort();
  return ids.map((item) => ({ id: labelId(item, kind, model), item, arm: "a", model, replicate: 1, scheduled: ids.length }));
}

type Pair = { opus: LabelReply; astra: LabelReply };
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** The labels' readout: kappa against the audit, the primary item labels and the views beside them, Opus chains, link agreement and answer judgements. */
export function labelReadout(items: readonly AskItem[], records: readonly SampleRecord[]) {
  const byId = new Map(items.map((i) => [i.item, i]));
  const kinds: Record<LabelKind, Map<string, Partial<Record<ModelKey, LabelReply>>>> = { audit: new Map(), contingency: new Map(), link: new Map() };
  const sealed: Record<string, { sealed: number; scheduled: number | null }> = {};
  let missing = 0;
  for (const r of records) {
    const m = /^(.+)\.label-(audit|contingency|link)\.([a-z]+)\.1$/.exec(r.sample.id);
    if (!m || !byId.has(m[1]!)) continue;
    const c = (sealed[m[2] + "." + m[3]] ??= { sealed: 0, scheduled: null });
    c.sealed++;
    if (r.sample.scheduled !== undefined) c.scheduled = Math.max(c.scheduled ?? 0, r.sample.scheduled);
    if (!r.label) {
      missing++;
      continue;
    }
    const map = kinds[m[2] as LabelKind];
    map.set(m[1]!, { ...map.get(m[1]!), [m[3]!]: r.label });
  }
  const pairs = (kind: LabelKind) => [...kinds[kind]].filter(([, l]) => l.opus && l.astra) as Array<[string, Pair]>;
  const audited = pairs("audit");
  const contingency = pairs("contingency");
  const kappa = audited.length ? labelAudit(audited.map(([id, l]) => ({ audit: byId.get(id)!.label, opus: l.opus.class, astra: l.astra.class }))) : null;
  const relabel = (id: string, label: Label): AskItem => ({ ...byId.get(id)!, label });
  const agreed = (ps: Array<[string, Pair]>) => ps.filter(([, l]) => l.opus.class === l.astra.class).map(([id, l]) => relabel(id, l.opus.class));
  const relabelled = !!kappa && !kappa.stands && contingency.length > 0;
  const all = [...audited, ...contingency];
  const primary = relabelled ? agreed(all) : [...items];
  const complete = (kind: LabelKind) => FROZEN.labelling.kinds[kind].models.every((m) => {
    const c = sealed[kind + "." + m];
    return !!c && c.scheduled !== null && c.sealed === c.scheduled;
  });
  const auditComplete = complete("audit");
  const contingencyComplete = complete("contingency");
  const withheld = !auditComplete ? "the label audit is incomplete: a labeller has scheduled audit labels with no sealed record" : kappa?.stands ? null : contingencyComplete ? null : "the label audit did not stand (a kappa below " + FROZEN.label_audit.kappa_min + ") and the contingency is not complete";
  const views = !kappa ? [] : relabelled ? [{ name: "the audit's labels", items: [...items] }, { name: "Opus labels", items: all.map(([id, l]) => relabel(id, l.opus.class)) }, { name: "Astra labels", items: all.map(([id, l]) => relabel(id, l.astra.class)) }] : [{ name: "the labellers' agreement on the audited items", items: agreed(audited) }];

  const linkTo = (item: AskItem, l?: LabelReply): number | null => {
    const rows = ledgerRows(item);
    const p = l?.repeats_of ?? null;
    return p !== null && p <= rows.length ? rows[p - 1]!.order : null;
  };
  const links: Link[] = [...kinds.link].flatMap(([id, l]) => {
    const to = linkTo(byId.get(id)!, l.opus);
    return to === null ? [] : [{ item: id, to }];
  });
  const linkPairs = audited.filter(([id]) => byId.get(id)!.label === "DUPLICATE" && kinds.link.get(id)?.opus);
  const linkAgree = linkPairs.filter(([id, l]) => linkTo(byId.get(id)!, l.astra) === linkTo(byId.get(id)!, kinds.link.get(id)!.opus)).length;

  const answered = new Map<string, boolean>();
  const tally = { opus: { yes: 0, no: 0, unclear: 0, missing: 0 }, astra: { yes: 0, no: 0, unclear: 0, missing: 0 } };
  const conflicts = new Set<string>();
  let rowsSeen = 0;
  let compared = 0;
  let agree = 0;
  let bothYes = 0;
  let bothNo = 0;
  const judge = (id: string, v: boolean) => {
    if (answered.has(id) && answered.get(id) !== v) conflicts.add(id);
    answered.set(id, v);
  };
  for (const [id, l] of audited) {
    ledgerRows(byId.get(id)!).forEach((row, i) => {
      if (row.status !== "answered") return;
      rowsSeen++;
      const o = l.opus.answer_judgement.find((x) => x.row === i + 1)?.answers ?? null;
      const a = l.astra.answer_judgement.find((x) => x.row === i + 1)?.answers ?? null;
      tally.opus[o ?? "missing"]++;
      tally.astra[a ?? "missing"]++;
      if (o && a && ++compared && o === a) agree++;
      if (o === "yes" && a === "yes") {
        judge(row.id, true);
        bothYes++;
      } else if (o === "no" && a === "no") {
        judge(row.id, false);
        bothNo++;
      }
    });
  }
  for (const id of conflicts) answered.delete(id);
  return {
    primary,
    views,
    links: kinds.link.size ? links : null,
    answer_judged: answered,
    summary: {
      missing_labels: missing,
      sealed,
      audit_complete: auditComplete,
      contingency_complete: contingencyComplete,
      decision_withheld: withheld,
      audited: audited.length,
      kappa,
      contingency: contingency.length,
      contingency_needed: !!kappa && !kappa.stands && contingency.length === 0,
      primary_labels: relabelled ? "the labellers' agreement" : "the audit's",
      primary_items: primary.length,
      links: { linked_duplicates: kinds.link.size, opus_links: links.length, astra_compared: linkPairs.length, astra_agreement: linkPairs.length ? r4(linkAgree / linkPairs.length) : null },
      answer_judgement: { answered_rows: rowsSeen, both_yes: bothYes, both_no: bothNo, judged_answer_share: bothYes + bothNo ? r4(bothYes / (bothYes + bothNo)) : null, judged_row_ids: answered.size, conflicting_row_ids: conflicts.size, labeller_agreement: compared ? r4(agree / compared) : null, opus: tally.opus, astra: tally.astra },
    },
  };
}
