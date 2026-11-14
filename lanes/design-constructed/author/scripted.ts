// Copyright (c) 2026 Garry Tan. MIT License.
// A scripted caller for the author area's tests, dry run and keyless gate check: it answers every model role the
// pipeline calls from the invented fixture, routed by the call's label, and any role can be overridden per case. It
// labels a block by tokens the scripted validators write into their changes: "[S]" names the S item's screen and
// condition, "[S+]" also states its detail. No network, no key, no model.
import { STOCK_ROWS } from "../frozen.ts";
import type { AnyModel, ItemClass } from "../types.ts";
import type { Verdict } from "./checks.ts";
import { authorReply, classOf, CONTEXT, transformReply } from "./fixture.ts";
import type { BlockParser, CallRequest, Caller, Deps } from "./seams.ts";
import { vocabularyFrom } from "./screen.ts";

export type Role = "author" | "rewrite" | "context" | "audit" | "audit2" | "audit2x" | "fix" | "generic" | "block" | "labels" | "transform" | "transform-rewrite";

export interface AuditSpec {
  verdicts?: Partial<Record<ItemClass, Verdict>>;
  mentioned?: ItemClass[];
  inputFailures?: string[];
}

export interface Script {
  author?: (n: number) => string;
  rewrite?: (n: number) => string;
  context?: (n: number) => string;
  /** round is "audit", "audit2" or "audit2x" with the version (0 or 1) after it, for example "audit-0". */
  audit?: (round: string, auditor: AnyModel, attempt: number) => AuditSpec | string;
  fix?: (ids: string[], attempt: number) => string | null;
  /** The changes a validator writes; null is a reply with no block. */
  block?: (step: string, validator: string, attempt: number) => string[] | null;
  /** Classes the generic screen's labellers mark anticipated, by labeller. */
  generic?: (labeller: AnyModel, attempt: number) => ItemClass[] | "drop" | { missing: ItemClass[] };
  /** True to leave every cell of this label call unlabelled. */
  dropLabels?: (step: string, validator: string, attempt: number) => boolean;
  transform?: (n: number) => string;
}

export const fence = (changes: readonly string[]): string => "My review.\n\n```plan-changes\n" + JSON.stringify({ changes }) + "\n```\n";

/** The fixture's block parser: the last plan-changes fence's changes, or null. */
export const parseFence: BlockParser = (reply) => {
  const all = [...reply.matchAll(/```plan-changes\n([\s\S]*?)\n```/g)];
  if (!all.length) return null;
  try {
    const v = JSON.parse(all.at(-1)![1]!);
    return Array.isArray(v.changes) && v.changes.every((c: unknown) => typeof c === "string") ? v.changes : null;
  } catch {
    return null;
  }
};

/** A stand-in vocabulary for keyless runs where the pinned skill files aren't checked out: the lens line only. */
export const STAND_IN_VOCABULARY = vocabularyFrom([]);

const ALL: ItemClass[] = ["S", "H", "R", "A", "Y"];

/** The default validator blocks: unanimous blocks name every item with its detail; give-away blocks name none. */
export const defaultBlock = (step: string): string[] => (step.startsWith("unanimous") ? ALL.map((c) => "Handle [" + c + "+] on the payments screen.") : ["Add a short help text above the table.", "Write release notes for the page."]);

function keyIds(prompt: string): { id: string; class: ItemClass }[] {
  const at = prompt.lastIndexOf("=== key.json ===\n");
  const j = JSON.parse(prompt.slice(at + "=== key.json ===\n".length));
  return j.items.map((i: { id: string; class: ItemClass }) => ({ id: i.id, class: i.class }));
}

function labelReply(prompt: string, mark: (cls: ItemClass, listId: string, changes: string[]) => { ant: number[]; det: number[] }): string {
  const items = [...prompt.matchAll(/^- (i\d+): (.*)$/gm)].map((m) => ({ id: m[1]!, cls: classOf(m[2]!) }));
  const lists = [...prompt.matchAll(/^List (\S+):\n((?:  \d+\. .*\n?)*)/gm)].map((m) => ({ id: m[1]!, changes: m[2]!.split("\n").filter(Boolean).map((l) => l.replace(/^\s*\d+\.\s/, "")) }));
  const details = /\nDetails: yes\n/.test(prompt);
  const cells = lists.flatMap((l) =>
    items.map((it) => {
      const { ant, det } = it.cls ? mark(it.cls, l.id, l.changes) : { ant: [], det: [] };
      return { list: l.id, item: it.id, anticipated: ant.length > 0, anticipated_changes: ant, screen_hit: ant.length > 0, screen_hit_changes: ant, ...(details ? { detail_changes: det } : {}) };
    }),
  );
  return JSON.stringify({ cells });
}

/** The scripted world: deps for the pipeline and the record of every call's label. */
export function scripted(script: Script = {}, o: { vocabulary?: ReadonlySet<string>; today?: string } = {}): { deps: Deps; calls: string[]; requests: CallRequest[]; count: (role: Role) => number } {
  const calls: string[] = [];
  const requests: CallRequest[] = [];
  const n: Record<string, number> = {};
  const roleOf = (label: string): { role: Role; parts: string[] } => {
    const parts = label.split(":");
    const p1 = parts[1]!;
    if (p1 === "author" || p1 === "rewrite" || p1 === "context" || p1 === "fix" || p1 === "transform" || p1 === "transform-rewrite") return { role: p1, parts };
    if (p1.startsWith("audit-2x")) return { role: "audit2x", parts };
    if (p1.startsWith("audit2")) return { role: "audit2", parts };
    if (p1.startsWith("audit")) return { role: "audit", parts };
    if (parts[2] === "generic") return { role: "generic", parts };
    if (parts[2] === "block") return { role: "block", parts };
    return { role: "labels", parts };
  };
  const call: Caller = async (req: CallRequest) => {
    calls.push(req.label);
    requests.push(req);
    const { role, parts } = roleOf(req.label);
    const k = role + ":" + parts.slice(0, -1).join(":");
    n[k] = (n[k] ?? 0) + 1;
    const attempt = Number(parts.at(-1));
    switch (role) {
      case "author":
        return { text: script.author ? script.author(n[k]!) : authorReply() };
      case "rewrite":
        return { text: script.rewrite ? script.rewrite(n[k]!) : authorReply() };
      case "context":
        return { text: script.context ? script.context(n[k]!) : CONTEXT };
      case "transform":
      case "transform-rewrite":
        return { text: script.transform ? script.transform(n[k]!) : transformReply() };
      case "audit":
      case "audit2":
      case "audit2x": {
        const ids = keyIds(req.prompt);
        const spec = script.audit ? script.audit(parts[1]!, parts[2] as AnyModel, attempt) : {};
        if (typeof spec === "string") return { text: spec };
        const items = ids.map((i) => ({ id: i.id, verdict: spec.verdicts?.[i.class] ?? "keep", reason: "scripted", mentioned: (spec.mentioned ?? []).includes(i.class) }));
        return { text: JSON.stringify({ items, input_failures: (spec.inputFailures ?? []).map((check) => ({ check, reason: "scripted" })) }) };
      }
      case "fix": {
        const ids = (/Items to fix: (.*)\n/.exec(req.prompt)?.[1] ?? "").split(", ").filter(Boolean);
        const custom = script.fix?.(ids, attempt);
        if (custom !== undefined && custom !== null) return { text: custom };
        const key = JSON.parse(req.prompt.slice(req.prompt.lastIndexOf("=== key.json ===\n") + 17, req.prompt.indexOf("\nAuditors' notes:")));
        const items = key.items.filter((i: { id: string }) => ids.includes(i.id)).map((i: { id: string; statement: string; detail: string }) => ({ id: i.id, statement: i.statement.replace("in src/pages/Payments.tsx", "in the new src/pages/Payments.tsx"), detail: i.detail }));
        return { text: JSON.stringify({ items }) };
      }
      case "generic": {
        const labeller = parts[3] as AnyModel;
        const g = script.generic ? script.generic(labeller, attempt) : [];
        if (g === "drop") return { text: "{}" };
        if (!Array.isArray(g)) {
          const full = JSON.parse(labelReply(req.prompt, () => ({ ant: [], det: [] })));
          const cls = new Map([...req.prompt.matchAll(/^- (i\d+): (.*)$/gm)].map((m) => [m[1]!, classOf(m[2]!)]));
          full.cells = full.cells.filter((c: { item: string }) => !g.missing.includes(cls.get(c.item)!));
          return { text: JSON.stringify(full) };
        }
        return { text: labelReply(req.prompt, (cls) => ({ ant: g.includes(cls) ? [1] : [], det: [] })) };
      }
      case "block": {
        const changes = script.block ? script.block(parts[1]!, parts[3]!, attempt) : defaultBlock(parts[1]!);
        return { text: changes === null ? "I have no changes to suggest." : fence(changes) };
      }
      case "labels": {
        if (script.dropLabels?.(parts[1]!, parts[3]!, attempt)) return { text: "{}" };
        return {
          text: labelReply(req.prompt, (cls, _list, changes) => {
            const ant = changes.flatMap((c, i) => (c.includes("[" + cls + "]") || c.includes("[" + cls + "+]") ? [i + 1] : []));
            const det = changes.flatMap((c, i) => (c.includes("[" + cls + "+]") ? [i + 1] : []));
            return { ant, det };
          }),
        };
      }
    }
  };
  const deps: Deps = { call, parseBlock: parseFence, vocabulary: o.vocabulary ?? STAND_IN_VOCABULARY, today: o.today ?? "2026-11-01" };
  return { deps, calls, requests, count: (role) => calls.filter((l) => roleOf(l).role === role).length };
}

/** The stock rows' changes, for checks that a generic packet holds rows 1 and 2 only. */
export const STOCK_TEXT = STOCK_ROWS.map((r) => r.changes.join(" "));
