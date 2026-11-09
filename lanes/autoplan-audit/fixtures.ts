// Copyright (c) 2026 Garry Tan. MIT License.
// Constructed fixtures for the keyless dry run and the lane's tests: run directories in the frame's schema variants,
// a wiki repository with dated posts, a gstack-like repository with a VERSION history and a Pre-Gate table at the
// pinned lines, and a stub provider for the metering proxy. Every name, code and sentence here is invented; nothing
// is copied from the frame, the told sessions or gstack.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { sha256 } from "./frame.ts";

export const T0 = Date.parse("2030-01-01T00:00:00Z");
export const at = (h: number) => new Date(T0 + h * 3_600_000).toISOString();
export const tmp = (name: string) => mkdtempSync(join(tmpdir(), "ar-" + name + "-"));

export interface RecordSpec {
  id: string;
  kind?: "lean" | "full";
  status?: string;
  answered?: boolean;
  decisions?: Array<Record<string, unknown>>;
  findings?: Array<Record<string, unknown>>;
  amendments?: Array<Record<string, unknown>>;
  bound?: string | null;
  review?: string | null;
  prompt?: string;
  plan?: string;
  restore?: string;
  scope?: Record<string, unknown>;
  run?: Record<string, unknown>;
  phases?: Record<string, unknown>;
  files?: Record<string, string>;
  gateOwner?: string | null;
}

const LENS_PROMPT = "## Checklist\n\n### CEO lens\n- name the premise\n\n### Eng lens\n- draw the architecture\n";

export function writeRecord(root: string, s: RecordSpec): string {
  const dir = join(root, s.id);
  mkdirSync(dir, { recursive: true });
  const lean = (s.kind ?? "lean") === "lean";
  const answered = s.answered ?? true;
  const phases = s.phases ?? (lean
    ? { ceo: { native: { status: "skipped" }, outside: { status: "skipped" }, skipped: "lean" }, design: { native: { status: "skipped" }, outside: { status: "skipped" }, skipped: "no UI scope" }, dx: { native: { status: "skipped" }, outside: { status: "skipped" }, skipped: "no developer scope" }, eng: { native: { status: "completed", model: "anthropic/claude-opus-5-5", output: "eng-native.a1.bound.md" }, outside: { status: "disabled" }, consensus: { coverage: "native_only", confirmed: 0 }, opened_at: at(0.5), closed_at: at(1) } }
    : { ceo: { native: { status: "completed", model: "anthropic/claude-opus-5-5", output: "ceo-native.a1.bound.md" }, outside: { status: "completed", model: "openai/gpt-6-astra" }, consensus: { coverage: "both", confirmed: 2 }, closed_at: at(0.8) }, design: { native: { status: "skipped" }, outside: { status: "skipped" }, skipped: "no UI scope" }, dx: { native: { status: "skipped" }, outside: { status: "skipped" }, skipped: "no developer scope" }, eng: { native: { status: "completed", model: "anthropic/claude-opus-5-5", output: "eng-native.a1.bound.md" }, outside: { status: "completed", model: "openai/gpt-6-astra" }, consensus: { coverage: "both", confirmed: 3 }, closed_at: at(1) } });
  const run = {
    schema_version: 1, run: s.id, status: s.status ?? "complete", required_phases: lean ? ["eng"] : ["ceo", "eng"], phase_order: lean ? ["eng"] : ["ceo", "eng"], phases,
    scope: { ui: false, dx: false, docs_only: false, ...(s.scope ?? {}) }, outside_enabled: !lean, gstack_version: "9.1.0.0", created_at: at(0), updated_at: at(4), history: [], amendments: s.amendments ?? [],
    plan_source: "/work/handoffs/abcd-12/autoplan-run/plan.md", out: "/work/abcd-12/out", plan_input: "/work/abcd-12/plan.md", active_plan: "/work/abcd-12/plan-active.md", deviations: [],
    ...(answered ? { gate: { rev: 1, gate_rev: 1, written_at: at(2), answered_at: at(3), reply: "rec", overrides: [], answered_by: "agent:ZZZZ-1", ...(s.gateOwner === null ? {} : { owner_reply: s.gateOwner ?? "take every recommendation please" }) } } : {}),
    ...(s.run ?? {}),
  };
  writeFileSync(join(dir, "run.json"), JSON.stringify(run, null, 1));
  if (s.decisions) writeFileSync(join(dir, "decisions.jsonl"), s.decisions.map((d) => JSON.stringify({ schema_version: 1, run: s.id, label: "D1", title: "t", kind: "auto", status: "approved", recommended: "a", gate_rev: 1, ...d })).join("\n") + "\n");
  if (s.findings) writeFileSync(join(dir, "findings.jsonl"), s.findings.map((f) => JSON.stringify({ schema_version: 1, run: s.id, phase: "eng", voice: "native", severity: "High", title: "t", disposition: "open", model: "anthropic/claude-opus-5-5", resolution: "r", source: "F1", ...f })).join("\n") + "\n");
  if (answered) writeFileSync(join(dir, "gate.json"), JSON.stringify({ schema_version: 1, run: s.id, gate_rev: 1, title: "g", rec_rev: 1, items: (s.decisions ?? []).map((d) => ({ id: d.id, kind: "auto", recommended: "a", options: d.options ?? [] })) }));
  if (s.bound !== null) writeFileSync(join(dir, "eng-native.a1.bound.md"), s.bound ?? "# Engineering review\n");
  if (!lean && s.bound !== null) writeFileSync(join(dir, "ceo-native.a1.bound.md"), "# CEO review\n\nREALITY: the premise holds for the stated users.\n");
  if (s.review !== null) writeFileSync(join(dir, "review-record.md"), s.review ?? "## Review record\n");
  writeFileSync(join(dir, "eng-native-prompt.md"), s.prompt ?? LENS_PROMPT);
  writeFileSync(join(dir, "plan-active.md"), "<!-- restore point: r0 -->\n" + (s.plan ?? "# A plan\n\nSome words.\n"));
  writeFileSync(join(dir, "restore.md"), s.restore ?? "# A plan\n");
  for (const [f, t] of Object.entries(s.files ?? {})) writeFileSync(join(dir, f), t);
  return dir;
}

/** Writes MANIFEST files for a frame directory and returns its frozen digests. */
export function manifest(frame: string, ids: string[], approvals: Record<string, string> = {}) {
  const rec: string[] = [];
  for (const id of ids) for (const f of readdirSync(join(frame, "records", id)).sort()) rec.push([id, f, sha256(readFileSync(join(frame, "records", id, f)))].join("\t"));
  mkdirSync(join(frame, "approvals"), { recursive: true });
  const app: string[] = [];
  for (const [p, t] of Object.entries(approvals)) {
    mkdirSync(dirname(join(frame, "approvals", p)), { recursive: true });
    writeFileSync(join(frame, "approvals", p), t);
    app.push(p + "\t" + sha256(t));
  }
  writeFileSync(join(frame, "MANIFEST-records.tsv"), rec.join("\n") + "\n");
  writeFileSync(join(frame, "MANIFEST-approvals.tsv"), app.join("\n") + (app.length ? "\n" : ""));
  return {
    records_manifest_sha256: sha256(readFileSync(join(frame, "MANIFEST-records.tsv"))),
    approvals_manifest_sha256: sha256(readFileSync(join(frame, "MANIFEST-approvals.tsv"))),
    ids_sha256: sha256([...ids].sort().join("\n")),
    records: rec.length,
    approvals: app.length,
    runs: ids.length,
  };
}

export const git = (cwd: string, ...args: string[]) => {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("git " + args[0] + " failed: " + r.stderr.slice(0, 200));
  return r.stdout.trim();
};

/** A git repository with one commit per step; returns the head. */
export function repo(steps: Array<Record<string, string>>): { dir: string; commits: string[] } {
  const dir = tmp("repo");
  git(dir, "init", "-q", "-b", "main");
  const commits: string[] = [];
  for (const files of steps) {
    for (const [p, t] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, p)), { recursive: true });
      writeFileSync(join(dir, p), t);
    }
    git(dir, "add", "-A");
    git(dir, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "fixture step");
    commits.push(git(dir, "rev-parse", "HEAD"));
  }
  return { dir, commits };
}

/** An invented Pre-Gate table that names every frozen cell, placed at the pinned lines 596-605. */
export function preGateSkill(o: { ceoExtra?: string; dims?: [number, number] } = {}): string {
  const [d, x] = o.dims ?? [7, 8];
  const lines = Array.from({ length: 593 }, (_, i) => "filler line " + (i + 1));
  lines.push(
    "## Pre-Gate Verification",
    "",
    "Check each deliverable:",
    "",
    "| Phase | Required outputs |",
    "|---|---|",
    "| CEO | premise rows; per applicable section notes; error & rescue and failure modes lists; not in scope; already exists; dream state; completion summary; consensus" + (o.ceoExtra ?? "") + " |",
    "| Design, if UI | all " + d + " dimensions; issues; litmus |",
    "| DX, if developer-facing | all " + x + " dimensions; journey; empathy; tthw; implementation checklist; consensus |",
    "| Eng, always last | scope challenge; architecture; codepath map; test plan; not in scope; already exists; failure modes; completion summary; consensus |",
    "",
  );
  return lines.join("\n") + "\n";
}

/** A stub upstream for the metering proxy (shapes as lanes/product-value's dry run uses). answer may throw to simulate a crash. */
export function stubUpstream(answer: (judge: "astra" | "opus" | "argon", prompt: string) => string | { status: number; text?: string; provider?: string; truncated?: boolean }): typeof fetch {
  return (async (url: any, init?: any) => {
    const u = String(url);
    const body = JSON.parse(String(init?.body ?? "{}"));
    const prompt = String((body.input ?? body.messages)?.[0]?.content ?? "");
    const judge = u.includes("anthropic") ? "opus" : u.includes("openrouter") ? "argon" : "astra";
    const a = answer(judge, prompt);
    const o = typeof a === "string" ? { status: 200, text: a } : a;
    if (o.status !== 200) return Response.json({ error: { message: "stub failure" } }, { status: o.status });
    if (judge === "opus") return Response.json({ id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5-20260922", content: [{ type: "text", text: o.text }], stop_reason: o.truncated ? "max_tokens" : "end_turn", usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
    if (judge === "argon") return Response.json({ id: "gen-1", model: "google/gemini-4-argon-20261001", provider: o.provider ?? "Google", choices: [{ message: { role: "assistant", content: o.text }, finish_reason: o.truncated ? "length" : "stop" }], usage: { prompt_tokens: 1000, completion_tokens: 200 } });
    return Response.json({ id: "resp_1", object: "response", model: "gpt-6-astra-2026-09-01", status: o.truncated ? "incomplete" : "completed", output: [{ type: "message", content: [{ type: "output_text", text: o.text }] }], usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 0 }, output_tokens: 200, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 1200 } });
  }) as typeof fetch;
}

export const reply = (label: string, quote = "") => "Checked.\n" + JSON.stringify({ label, quote });
export const DRY_ENV = { ANTHROPIC_API_KEY: "dry-run", OPENAI_API_KEY: "dry-run", OPENROUTER_API_KEY: "dry-run" };
