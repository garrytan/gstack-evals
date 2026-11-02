// gstack-evals route-check (plan wiki/plans/2026-11-02-geva-165-planning-panel-v3-plan, section 4, "Route check"): E1's
// first paid step for a model that Claude Code runs through OpenRouter's Anthropic-compatible Messages route. Three parts
// must pass before any batch spends on the model.
//
// - tool: a one-turn session reads a random token from token.txt. It passes when a main-agent tool call gets a non-error
//   result that holds the token and the main agent's last text quotes it.
// - block: a two-turn none-arm plan session on a public fixture unit under tests/: PLAN_ASK, then PLAN_TURN2 as the
//   driver's follow-up, with the rec user and cap stops on. It passes when parsePlanSession gives findings, [] included.
// - metering: every call of both sessions has a spent outcome in the proxy journal with its spend and reasoning tokens,
//   and each session's metered spend is within 10% of what OpenRouter billed for its calls. The bill comes from
//   GET /api/v1/generation?id=<upstream id>, polled until every id is found or one shared deadline passes.
// - A run of the command is one try of every part not yet passed: both sessions while metering is open, else the one
//   session the open part needs. <out>/route-check.json keeps every try. A part gets two tries; a model that fails a part
//   twice leaves E1 with that part's code, and a third try is refused. Between tries the only change allowed is a repair
//   from the frozen list (REPAIRS), named with --repair and recorded with the try.
// - An endpoint, credential or proxy failure is E_ROUTE_INFRA (exit 2) and uses no try: a session that ended missing,
//   with rejected credentials, as an infra incident or before any model output; a rig that failed without a reason code;
//   a bill lookup the key or the network refused. Two infra failures stop the check for the Captain, and the model stays.
// - Sessions run on review-units' Docker rig (dockerRig, one bare none arm) under --item. The check's cap is four sessions
//   at the model's full allowance; a try starts only when its worst case fits under what is left, and its lease holds that
//   worst case. A ledger cap stop leaves the check incomplete (CAP_STOP, exit 2): neither passed nor failed.
// - On E_ROUTE_METERING the per-call comparison goes to <out>/metering-<try>.json, and the fix names the ledger reconcile
//   command for the try's lease with that file as its source. A metering retry first reads the approval record: the
//   try's lease must be closed as reconciled from that file (its sha256), else the retry is refused before any spend.
// - Every stderr line passes through scrubSecrets. OPENROUTER_API_KEY goes only into the bill lookup's header.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { BACKGROUND_WAIT_MS } from "../../adapters/claude-code/driver.ts";
import { hostDriver } from "../../adapters/host.ts";
import { REPO_ROOT } from "../../cli.ts";
import type { ReasonCode } from "../../errors/codes.ts";
import { ledgerPath, recordPath } from "../../runner/ledger/paths.ts";
import { ITEM_NAME, LedgerError, readItem } from "../../runner/ledger/record.ts";
import { chatPrice } from "../../runner/pricing/prices.ts";
import { UPSTREAM } from "../../runner/proxy/metering-proxy.ts";
import { newRunId } from "../../skill-eval/cli/call.ts";
import { allowanceMicros, SESSION_ALLOWANCE } from "../../skill-eval/cli/dry-run.ts";
import { DEFAULT_POLICY, loadPolicy, modelProblem, providerOf, type LoadedPolicy } from "../../skill-eval/cli/policy.ts";
import { dockerRig, slotModels, type HostRig } from "../../skill-eval/cli/run-host.ts";
import { scrubSecrets } from "../../skill-eval/verdict/error-record.ts";
import type { TrialRecord } from "../../types.ts";
import { runTrial } from "../trial.ts";
import { mainAgentTexts } from "./capped.ts";
import { readJournalLines } from "./cost.ts";
import { PLAN_ASK, PLAN_FENCE, PLAN_TURN2, parsePlanSession, REC_USER, recFreeformFor } from "./plan.ts";
import { readTranscript } from "./readers.ts";

type Env = Record<string, string | undefined>;
type Line = Record<string, any>;
interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}

export const PARTS = ["tool", "block", "metering"] as const;
export type Part = (typeof PARTS)[number];
export type Session = Exclude<Part, "metering">;
export const PART_CODES = { tool: "E_ROUTE_TOOL_ROUNDTRIP", block: "E_ROUTE_NO_BLOCK", metering: "E_ROUTE_METERING" } as const satisfies Record<Part, ReasonCode>;
export const MAX_TRIES = 2;
export const MAX_INFRA = 2;
export const CHECK_SESSIONS = 4;
export const METERING_TOLERANCE = 0.1;
export const ROUTE_LENS = "ceo" as const;
export const ENDPOINT = UPSTREAM.openrouter + "/v1/messages";
export const GENERATION_URL = UPSTREAM.openrouter + "/v1/generation";
export const BILLED_WAIT_MS = 180_000;
export const BILLED_POLL_MS = 5_000;
export const TOOL_TIMEOUT_S = 600;
export const BLOCK_TIMEOUT_S = 1800;
export const TOKEN_FILE = "token.txt";
export const TOOL_PROMPT = "Read the file " + TOKEN_FILE + " in this directory with your Read tool. Then reply with one line that quotes the token it holds, exactly as written.";

/** The frozen repair list: the only changes allowed between tries. */
export const REPAIRS = {
  "provider-pin": { value: /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9._-]+)?$/, takes: "an OpenRouter provider slug, such as openai" },
  "output-allowance": { value: /^[1-9][0-9]*$/, takes: "each session's output allowance in tokens, above " + SESSION_ALLOWANCE.output },
} as const;
export type Repair = keyof typeof REPAIRS;

export type PartResult = { result: "pass" } | { result: "fail"; code: ReasonCode; reason: string } | { result: "infra"; reason: string };

export interface RouteTry {
  try: number;
  at: string;
  /** The repairs named on this try; a repair stays in force for every later try. */
  repairs: Partial<Record<Repair, string>>;
  lease_id: string | null;
  spent_micros: number;
  /** The tool session's token, when this try ran it. */
  token: string | null;
  claude_code_version: string | null;
  parts: Partial<Record<Part, PartResult>>;
  stop?: "CAP_STOP";
  /** On E_ROUTE_METERING: the comparison file under the out dir, and the ledger command that reconciles the try's lease. */
  metering_file?: string;
  reconcile?: string;
}

export interface RouteState {
  schema: 1;
  model: string;
  item: string;
  /** The unit, relative to the repo root. */
  unit: string;
  /** One run id for every try: the first lease binds the item to it. */
  run_id: string;
  tries: RouteTry[];
}

export const partPassed = (s: RouteState, p: Part): boolean => s.tries.some((t) => t.parts[p]?.result === "pass");
export const partFails = (s: RouteState, p: Part): number => s.tries.filter((t) => t.parts[p]?.result === "fail").length;
export const infraFailures = (s: RouteState): number => s.tries.filter((t) => Object.values(t.parts).some((r) => r?.result === "infra")).length;

/** Why a session is an endpoint, credential or proxy failure rather than a result of the route, or null. */
export function sessionInfra(record: Pick<TrialRecord, "termination" | "model_output">): string | null {
  const t = record.termination;
  if (t.kind === "missing") return "the session ended missing (" + t.code + ")";
  if (t.kind === "credentials_rejected") return "the provider rejected the proxy's key (E_KEY_REJECTED)";
  if (t.kind === "infra") return "the session ended on an infra incident: " + t.incident;
  if ((t.kind === "timeout" || t.kind === "arm_failure" || t.kind === "completed") && record.model_output !== true) return "the session ended " + t.kind + " before any model output";
  return null;
}

const blockText = (content: unknown): string => (typeof content === "string" ? content : Array.isArray(content) ? content.map((b) => (typeof b?.text === "string" ? b.text : "")).join("\n") : "");

/** The tool part's judge: null when a main-agent tool call got a non-error result holding the token and the last main-agent text quotes it, else why not. */
export function judgeTool(record: Pick<TrialRecord, "termination">, transcript: string, token: string): string | null {
  if (record.termination.kind !== "completed") return "the session ended " + record.termination.kind;
  const messages = readTranscript(transcript) as unknown as Line[];
  const main = (m: Line, type: string) => m.type === type && !m.parent_tool_use_id && Array.isArray(m.message?.content);
  const calls = new Set(messages.filter((m) => main(m, "assistant")).flatMap((m) => m.message.content.filter((b: Line) => b?.type === "tool_use" && typeof b.id === "string").map((b: Line) => b.id as string)));
  if (!calls.size) return "the main agent made no tool call";
  const back = messages.some((m) => main(m, "user") && m.message.content.some((b: Line) => b?.type === "tool_result" && calls.has(b.tool_use_id) && b.is_error !== true && blockText(b.content).includes(token)));
  if (!back) return "no main-agent tool call got a non-error result holding the token";
  return mainAgentTexts(transcript).at(-1)?.includes(token) ? null : "the main agent's last text does not quote the token";
}

/** The block part's judge: null when the session completed with a plan-findings block that parses ([] counts), else why not. */
export function judgeBlock(record: Pick<TrialRecord, "termination" | "turns">): string | null {
  const parse = parsePlanSession(record);
  if (parse.kind === "findings") return null;
  return parse.kind === "missing" ? "the session completed with no " + PLAN_FENCE + " block" : parse.reason;
}

export interface JournalCall {
  session: Session;
  reservation_id: string;
  status: number | null;
  upstream_id: string | null;
  outcome: Line | null;
}

/** Each paid call of the sessions' meters in the proxy journal, with its outcome line's status, upstream id and outcome. */
export function journalCalls(lines: readonly Line[], meters: Partial<Record<Session, string>>): JournalCall[] {
  const sessionOf = new Map(Object.entries(meters).map(([s, m]) => [m, s as Session]));
  const calls = new Map<string, JournalCall>();
  for (const l of lines) {
    if (l.kind === "request" && sessionOf.has(l.cell?.meter_id) && !calls.has(l.reservation_id)) calls.set(l.reservation_id, { session: sessionOf.get(l.cell.meter_id)!, reservation_id: l.reservation_id, status: null, upstream_id: null, outcome: null });
    else if (l.kind === "outcome" && calls.has(l.reservation_id)) Object.assign(calls.get(l.reservation_id)!, { status: typeof l.status === "number" ? l.status : null, upstream_id: typeof l.upstream_id === "string" ? l.upstream_id : null, outcome: l.outcome ?? null });
  }
  return [...calls.values()];
}

const knownOutcome = (c: JournalCall): boolean => c.outcome?.kind === "spent" && typeof c.outcome.spent_micros === "number" && typeof c.outcome.usage?.reasoning === "number";
/** A call the provider refused (4xx or 429) and the proxy settled at nothing: billed nothing, so it needs no upstream id. */
const refusedFree = (c: JournalCall): boolean => knownOutcome(c) && c.outcome!.spent_micros === 0 && c.status !== null && c.status >= 400 && c.status < 500;
/** The upstream ids whose bill the metering part reads. */
export const billIds = (calls: readonly JournalCall[]): string[] => calls.filter((c) => knownOutcome(c) && !refusedFree(c) && c.upstream_id).map((c) => c.upstream_id!);

export interface Billed {
  micros: number;
  /** OpenRouter's native reasoning tokens, or null when it reports none. */
  reasoning: number | null;
}

export interface CallRow {
  session: Session;
  reservation_id: string;
  upstream_id: string | null;
  status: number | null;
  metered_micros: number | null;
  billed_micros: number | null;
  reasoning_tokens: { metered: number | null; billed: number | null };
}

/** The metering part's judge: the per-call comparison and every problem found; no problem is a pass. */
export function judgeMetering(calls: readonly JournalCall[], billed: ReadonlyMap<string, Billed>, sessions: readonly Session[]): { problems: string[]; rows: CallRow[] } {
  const problems: string[] = [];
  const rows = calls.map((c): CallRow => {
    const known = knownOutcome(c);
    const bill = refusedFree(c) ? { micros: 0, reasoning: 0 } : c.upstream_id ? (billed.get(c.upstream_id) ?? null) : null;
    const name = "call " + c.reservation_id + " (" + c.session + " session)";
    if (!known) problems.push(name + " has no spent outcome with its spend and reasoning tokens in the proxy journal");
    else if (!bill && !c.upstream_id) problems.push(name + " has no upstream id, so its billed cost cannot be read");
    else if (!bill) problems.push(name + ": OpenRouter has no billed generation " + c.upstream_id + " within the wait");
    return { session: c.session, reservation_id: c.reservation_id, upstream_id: c.upstream_id, status: c.status, metered_micros: known ? c.outcome!.spent_micros : null, billed_micros: bill?.micros ?? null, reasoning_tokens: { metered: known ? c.outcome!.usage.reasoning : null, billed: bill?.reasoning ?? null } };
  });
  for (const s of sessions) {
    const mine = rows.filter((r) => r.session === s);
    if (!mine.length) problems.push("the " + s + " session has no paid call in the proxy journal");
    if (!mine.length || mine.some((r) => r.metered_micros === null || r.billed_micros === null)) continue;
    const metered = mine.reduce((sum, r) => sum + r.metered_micros!, 0);
    const bill = mine.reduce((sum, r) => sum + r.billed_micros!, 0);
    if (Math.abs(metered - bill) > METERING_TOLERANCE * bill) problems.push("the " + s + " session metered " + usd6(metered) + " and OpenRouter billed " + usd6(bill) + ", more than " + METERING_TOLERANCE * 100 + "% apart");
  }
  return { problems, rows };
}

export interface BillDeps {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  key: string;
  waitMs?: number;
  pollMs?: number;
}

/**
 * OpenRouter's billed cost for each generation id, polled until found or one shared deadline passes. An id still not
 * found (404) at the deadline is left out, which the metering judge reports. A refused key, or a lookup that still fails
 * (a network error, another status, no total_cost) at the deadline, is infra.
 */
export async function billedCosts(ids: readonly string[], d: BillDeps): Promise<{ billed: Map<string, Billed> } | { infra: string }> {
  const poll = d.pollMs ?? BILLED_POLL_MS;
  const deadline = d.now() + (d.waitMs ?? BILLED_WAIT_MS);
  const billed = new Map<string, Billed>();
  for (const id of new Set(ids)) {
    for (;;) {
      let problem: string | null = null;
      try {
        const res = await d.fetch(GENERATION_URL + "?id=" + encodeURIComponent(id), { headers: { authorization: "Bearer " + d.key } });
        if (res.status === 401 || res.status === 403) return { infra: "OpenRouter answered " + res.status + " to the generation lookup's key" };
        if (res.ok) {
          const data = ((await res.json()) as { data?: { total_cost?: unknown; native_tokens_reasoning?: unknown } } | null)?.data;
          if (typeof data?.total_cost === "number") {
            billed.set(id, { micros: Math.round(data.total_cost * 1_000_000), reasoning: typeof data.native_tokens_reasoning === "number" ? data.native_tokens_reasoning : null });
            break;
          }
          problem = "OpenRouter's generation " + id + " has no total_cost";
        } else if (res.status !== 404) problem = "OpenRouter answered " + res.status + " to the generation lookup";
      } catch (e) {
        problem = "the generation lookup failed: " + (e as Error).message;
      }
      if (d.now() + poll > deadline) {
        if (problem) return { infra: problem };
        break;
      }
      await d.sleep(poll);
    }
  }
  return { billed };
}

/** What the proxy and the API said for these sessions: refusals and failed calls from the journal, API errors from the transcripts. */
export function proxyErrors(lines: readonly Line[], meters: readonly string[], transcripts: readonly string[]): string[] {
  const mine = new Set(meters);
  const journal = lines.filter((l) => mine.has(l.meter_id) && (l.kind === "refusal" || (l.kind === "outcome" && (l.reason || (typeof l.status === "number" && l.status >= 400))))).map((l) => (l.kind === "refusal" ? "refused " + l.code + ": " + l.reason : "status " + l.status + (l.reason ? ": " + l.reason : "")));
  const api = transcripts.flatMap((t) => (readTranscript(t) as unknown as Line[]).filter((m) => m.type === "assistant" && (m.is_api_error_message || m.error)).map((m) => "api error: " + blockText(m.message?.content)));
  return [...journal, ...api].slice(-5);
}

/** The ledger's reconcile of a metering try's lease, recorded from that try's comparison file, or why it is not there. */
export function reconcileProblem(record: string, item: string, t: RouteTry, out: string): string | null {
  const source = join(out, t.metering_file ?? "metering-" + t.try + ".json");
  const ask = "; a metering retry needs it first: " + (t.reconcile ?? "gstack-evals ledger reconcile --lease " + t.lease_id);
  let sha: string;
  try {
    sha = createHash("sha256").update(readFileSync(source)).digest("hex");
  } catch {
    return "metering failed on try " + t.try + ", and its comparison " + source + " is missing" + ask;
  }
  let close: ReturnType<typeof readItem>["leases"][number]["close"] | undefined;
  try {
    close = readItem(record, item).leases.find((l) => l.lease.lease_id === t.lease_id)?.close;
  } catch (e) {
    return "metering failed on try " + t.try + ", and the approval record " + record + " cannot be read (" + (e as Error).message + ")" + ask;
  }
  if (close?.how === "reconciled" && close.source_sha256 === sha) return null;
  return "metering failed on try " + t.try + ", and lease " + t.lease_id + " has no reconcile from " + source + " in the approval record " + record + ask;
}

export interface RoundInput {
  model: string;
  item: string;
  runId: string;
  /** The try's directory, <out>/try-<n>. */
  out: string;
  /** The fixture unit's real path. */
  unit: string;
  try: number;
  sessions: readonly Session[];
  token: string;
  allowanceMicros: number;
  /** The try's worst case: its lease amount. */
  leaseMicros: number;
  ledger: string | null;
  record: string | null;
  policy: LoadedPolicy;
  env: Env;
}

export interface RoundSession {
  meter_id: string;
  record: TrialRecord;
  transcript: string;
  claude_code_version: string | null;
}

export interface RoundResult {
  lease_id: string | null;
  spent_micros: number;
  sessions: Partial<Record<Session, RoundSession>>;
  journal: Line[];
}

const readText = (file: string): string => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
};

const initVersion = (file: string): string | null => {
  try {
    const v = JSON.parse(readFileSync(file, "utf8")).claude_code_version;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
};

/** A try's sessions on a rig: the tool session on a tree that holds only token.txt, the block session on the unit. */
export async function runSessions(input: RoundInput, rig: HostRig): Promise<RoundResult["sessions"]> {
  const empty = join(input.out, "fixtures");
  mkdirSync(empty, { recursive: true });
  const sessions: RoundResult["sessions"] = {};
  for (const part of input.sessions) {
    const block = part === "block";
    const tree = block ? input.unit : join(input.out, "tool-tree");
    if (!block) {
      mkdirSync(tree, { recursive: true });
      writeFileSync(join(tree, TOKEN_FILE), input.token + "\n");
    }
    const task = "route-" + part;
    const binding = await rig.bind({ cell: { run_id: input.runId, arm: "none", task, model: input.model, trial: input.try, attempt: 1 }, models: slotModels(input.policy, input.model, null), allowance_micros: input.allowanceMicros });
    const dir = join(input.out, part);
    rmSync(dir, { recursive: true, force: true });
    const agent = (rig.driver ?? hostDriver)({ host: "claude", model: input.model, provider: "openrouter", proxy: { baseUrl: rig.baseUrl, slot: binding.slot, token: binding.token }, interactive: block, skill: null, out: join(dir, "host"), capStops: true, backgroundWaitMs: BACKGROUND_WAIT_MS, ...(block ? { entry: { user: REC_USER }, freeform: recFreeformFor(ROUTE_LENS), followUp: { text: PLAN_TURN2.text, maxTurns: PLAN_TURN2.maxTurns, timeoutMs: PLAN_TURN2.timeoutS * 1000 } } : {}) });
    const trial = await runTrial({ cell: { model: input.model, arm: "none", round: 1, trial: input.try }, task: { id: task, prompt: block ? PLAN_ASK : TOOL_PROMPT }, tasksDir: empty, sandbox: rig.sandbox("none", false, input.model), agent, dir, timeoutS: block ? BLOCK_TIMEOUT_S : TOOL_TIMEOUT_S, network: rig.network, seed: tree });
    trial.record.cost_micros = (await rig.finalize(binding.meter_id)).micros;
    sessions[part] = { meter_id: binding.meter_id, record: trial.record, transcript: readText(join(dir, "host", "transcript.ndjson")), claude_code_version: initVersion(join(dir, "host", "init.json")) };
  }
  return sessions;
}

/** One try on review-units' Docker rig: one bare none arm, a lease of the try's worst case on the item, the metering proxy. */
export async function dockerRound(input: RoundInput): Promise<RoundResult> {
  const tasks = join(input.out, "fixtures", "tasks.json");
  mkdirSync(dirname(tasks), { recursive: true });
  writeFileSync(tasks, "[]\n");
  const call = { host: "claude" as const, arms: { arms: [{ name: "none", kind: "bare" as const }], base: null, skill: null, notes: [] }, tasks, out: { path: input.out, rule: "--out" }, ledger: ledgerPath(input.ledger ?? undefined, input.env), record: recordPath(input.record ?? undefined, input.env), item: input.item, runId: input.runId, models: [input.model], policy: input.policy };
  const rig = dockerRig(call, { env: input.env, skill: null, nonce: randomBytes(6).toString("hex"), cap: input.leaseMicros, voice: false });
  let sessions: RoundResult["sessions"] = {};
  let closed: Awaited<ReturnType<HostRig["close"]>>;
  try {
    sessions = await runSessions(input, rig);
  } finally {
    closed = await rig.close();
  }
  return { lease_id: closed.lease_id, spent_micros: closed.committed, sessions, journal: rig.recovery ? readJournalLines(rig.recovery.journal) : [] };
}

export const ROUTE_CHECK_HELP = [
  "gstack-evals route-check --model <id> --unit <fixture dir under tests/> --item e1-route-<model> --out <dir>",
  "    [--repair provider-pin=<openrouter provider>|output-allowance=<tokens>]... [--ledger <path>] [--record <dir>]",
  "    [--policy <file>] [--dry-run]",
  "",
  "Checks a model's OpenRouter route before E1: a tool round trip, a two-turn plan session that ends with a plan-findings",
  "block, and metering within 10% of OpenRouter's billed cost. Each run is one try of every part not yet passed, kept in",
  "<out>/route-check.json. A part gets two tries, and between them only a repair from the frozen list. Exit 0 when every",
  "part has passed, 1 on a route failure, 2 on a usage error, an infra stop (E_ROUTE_INFRA) or a cap stop (CAP_STOP).",
].join("\n");

const VALUE = new Set(["--model", "--unit", "--item", "--out", "--ledger", "--record", "--policy"]);
const LIST = new Set(["--repair"]);
const BOOL = new Set(["--dry-run"]);

class Usage extends Error {}

function parseArgs(argv: readonly string[]): Map<string, string[]> {
  const flags = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (BOOL.has(a)) flags.set(a, []);
    else if (VALUE.has(a)) {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Usage(a + " needs a value");
      if (flags.has(a)) throw new Usage(a + " is given twice");
      flags.set(a, [v]);
    } else if (LIST.has(a)) {
      const vals: string[] = [];
      while (i + 1 < argv.length && !argv[i + 1]!.startsWith("--")) vals.push(argv[++i]!);
      if (!vals.length) throw new Usage(a + " needs at least one value");
      flags.set(a, [...(flags.get(a) ?? []), ...vals]);
    } else throw new Usage("unknown argument " + JSON.stringify(a));
  }
  return flags;
}

/** The repairs named on the command line, each from the frozen list with a value it takes. */
export function parseRepairs(values: readonly string[]): Partial<Record<Repair, string>> {
  const repairs: Partial<Record<Repair, string>> = {};
  for (const v of values) {
    const at = v.indexOf("=");
    const name = v.slice(0, at) as Repair;
    if (at <= 0 || !Object.hasOwn(REPAIRS, name)) throw new Usage("--repair " + JSON.stringify(v) + " is not on the frozen list: " + Object.keys(REPAIRS).map((k) => k + "=<value>").join(" or "));
    const value = v.slice(at + 1);
    if (!REPAIRS[name].value.test(value)) throw new Usage("--repair " + name + " takes " + REPAIRS[name].takes + ", not " + JSON.stringify(value));
    if (repairs[name] !== undefined) throw new Usage("--repair names " + name + " twice");
    repairs[name] = value;
  }
  if (repairs["output-allowance"] !== undefined && Number(repairs["output-allowance"]) <= SESSION_ALLOWANCE.output) throw new Usage("--repair output-allowance takes " + REPAIRS["output-allowance"].takes);
  return repairs;
}

/** The fixture unit's real path: a directory under the repo's tests/ tree that holds plan.md. */
export function fixtureUnit(path: string): string {
  let real: string;
  try {
    real = realpathSync(resolve(path));
  } catch {
    throw new Usage("--unit " + path + " does not exist");
  }
  if (!real.startsWith(realpathSync(join(REPO_ROOT, "tests")) + sep)) throw new Usage("--unit " + path + " is outside the repo's tests/ tree; route-check runs a public fixture unit only, never a sealed one");
  if (!existsSync(join(real, "plan.md"))) throw new Usage("--unit " + path + " holds no plan.md");
  return real;
}

const usd = (micros: number) => "$" + (micros / 1_000_000).toFixed(2);
const usd6 = (micros: number) => "$" + (micros / 1_000_000).toFixed(6);

export interface Deps {
  round: (input: RoundInput) => Promise<RoundResult>;
  fetch: BillDeps["fetch"];
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  token: () => string;
}

const DEPS: Deps = { round: dockerRound, fetch: (url, init) => fetch(url, init), now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), token: () => randomBytes(12).toString("hex") };

export async function main(argv: string[], io: Io = { out: console.log, err: console.error }, env: Env = process.env, deps: Partial<Deps> = {}): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    io.out(ROUTE_CHECK_HELP);
    return 0;
  }
  const err = (text: string) => io.err(scrubSecrets(text, env));
  try {
    return await routeCheck(argv, { out: io.out, err }, env, { ...DEPS, ...deps });
  } catch (e) {
    if (e instanceof Usage) {
      err("E_USAGE route-check: " + e.message);
      err(ROUTE_CHECK_HELP);
      return 2;
    }
    const message = (e as Error).message;
    const code = (e as { code?: unknown }).code;
    err(/^E_[A-Z_]+[: ]/.test(message) ? message : (typeof code === "string" && /^E_[A-Z_]+$/.test(code) ? code : "E_INTERNAL") + " route-check: " + message);
    return 2;
  }
}

async function routeCheck(argv: string[], io: Io, env: Env, deps: Deps): Promise<number> {
  const flags = parseArgs(argv);
  const one = (f: string) => flags.get(f)?.[0] ?? null;
  for (const f of ["--model", "--unit", "--item", "--out"]) if (!flags.has(f)) throw new Usage("needs " + f);
  const model = one("--model")!;
  const item = one("--item")!;
  const policyFile = one("--policy") ?? DEFAULT_POLICY;
  const loaded = loadPolicy(policyFile);
  if ("problem" in loaded) throw new Usage("--policy " + policyFile + ": " + loaded.problem);
  const policy = loaded as LoadedPolicy;
  if (providerOf(policy, model) !== "openrouter") throw new Usage("--model: " + model + " has no OpenRouter route in the policy; route-check checks OpenRouter routes only");
  const problem = modelProblem(policy, model, "subject", { smoke: false, item });
  if (problem) throw new Usage("--model: " + problem);
  if (!ITEM_NAME.test(item) || !item.startsWith("e1-route-")) throw new Usage("--item takes the model's e1-route line item, such as e1-route-<model>, not " + JSON.stringify(item));
  const unit = fixtureUnit(one("--unit")!);
  const unitRef = relative(realpathSync(REPO_ROOT), unit);
  const out = resolve(one("--out")!);
  const file = join(out, "route-check.json");
  const prior = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as RouteState) : null;
  if (prior && (prior.model !== model || prior.item !== item || prior.unit !== unitRef)) throw new Usage(file + " checks " + prior.model + " on " + prior.unit + " under item " + prior.item + "; use a new --out for " + model + " on " + unitRef + " under " + item);
  const state: RouteState = prior ?? { schema: 1, model, item, unit: unitRef, run_id: newRunId("route-check"), tries: [] };
  if (infraFailures(state) >= MAX_INFRA) {
    io.err("E_ROUTE_INFRA route-check: " + model + " has had " + MAX_INFRA + " infra failures (" + file + "), so the check stops and the model stays in E1\n  fix: report the check to the Captain with the infra lines its tries printed; route-check runs no more tries on this --out");
    return 2;
  }
  const out2 = PARTS.find((p) => partFails(state, p) >= MAX_TRIES);
  if (out2) throw new Usage("part " + out2 + " failed both tries (" + PART_CODES[out2] + "), so " + model + " leaves E1 with that code; a third try is refused");
  const open = PARTS.filter((p) => !partPassed(state, p));
  if (!open.length) throw new Usage(model + " has already passed every part (" + file + "); nothing to run");
  const repairs = parseRepairs(flags.get("--repair") ?? []);
  if (Object.keys(repairs).length && !PARTS.some((p) => partFails(state, p) > 0)) throw new Usage("a repair applies between tries, after a part failed, and no part of " + model + " has failed yet");
  const applied: Partial<Record<Repair, string>> = Object.assign({}, ...state.tries.map((t) => t.repairs), repairs);
  const providers = chatPrice("openrouter:" + model)?.providers ?? [];
  const pin = applied["provider-pin"];
  if (pin !== undefined && (providers.length !== 1 || providers[0] !== pin)) throw new Usage("--repair provider-pin=" + pin + ": the proxy routes openrouter:" + model + " only to its price row's providers (" + (providers.join(", ") || "any") + ") and has no per-run pin, so this repair cannot be applied before the proxy gains one");
  const allowance = allowanceMicros({ policy }, model, { input: SESSION_ALLOWANCE.input, output: Number(applied["output-allowance"] ?? SESSION_ALLOWANCE.output) });
  if (allowance === null) throw new Usage("--model: " + model + " has no price row, so its session allowance is unknown");
  const record = recordPath(one("--record") ?? undefined, env);
  const metered = state.tries.findLast((t) => t.parts.metering?.result === "fail");
  const unreconciled = metered && open.includes("metering") ? reconcileProblem(record.path, item, metered, out) : null;
  if (unreconciled) throw new Usage(unreconciled);
  const runs: Session[] = open.includes("metering") ? ["tool", "block"] : open.filter((p): p is Session => p !== "metering");
  const cap = CHECK_SESSIONS * allowance;
  const spent = state.tries.reduce((s, t) => s + t.spent_micros, 0);
  const worst = runs.length * allowance;
  const n = state.tries.length + 1;
  if (spent + worst > cap) {
    io.err("CAP_STOP route-check: " + model + ": try " + n + "'s worst case (" + runs.length + " sessions at " + usd(allowance) + ") does not fit under the check's cap of " + CHECK_SESSIONS + " sessions (" + usd(cap) + ", " + usd(spent) + " spent), so the check is incomplete: neither passed nor failed\n  fix: report the incomplete check to the Captain; never rerun it to change a verdict");
    return 2;
  }
  if (flags.has("--dry-run")) {
    io.out("route-check dry run: nothing is built, written or spent");
    io.out(model + " on " + ENDPOINT + " (providers " + (providers.join(", ") || "any") + "); item " + item + "; unit " + unitRef);
    io.out("try " + n + ": parts " + open.join(", ") + "; sessions " + runs.join(", ") + (Object.keys(applied).length ? "; repairs " + Object.entries(applied).map(([k, v]) => k + "=" + v).join(", ") : ""));
    io.out("allowance " + usd(allowance) + " a session; cap " + CHECK_SESSIONS + " x " + usd(allowance) + " = " + usd(cap) + "; spent " + usd(spent) + "; this try's lease " + usd(worst));
    return 0;
  }
  const key = env.OPENROUTER_API_KEY;
  if (!key) throw new Usage("route-check reads OpenRouter's billed cost with OPENROUTER_API_KEY, which this env does not set");
  const token = deps.token();
  const entry: RouteTry = { try: n, at: new Date(deps.now()).toISOString(), repairs, lease_id: null, spent_micros: 0, token: runs.includes("tool") ? token : null, claude_code_version: null, parts: {} };
  mkdirSync(out, { recursive: true });
  const save = () => writeFileSync(file, JSON.stringify({ ...state, tries: [...state.tries, entry] }, null, 2) + "\n");
  const where = () => model + " on " + ENDPOINT + " (Claude Code " + (entry.claude_code_version ?? "unknown") + ")";
  const capStop = (detail: string): number => {
    entry.stop = "CAP_STOP";
    save();
    io.err("CAP_STOP route-check: " + where() + ": " + detail + " on try " + n + ", so the check is incomplete: neither passed nor failed\n  fix: report the incomplete check to the Captain; never rerun it to change a verdict");
    return 2;
  };
  let round: RoundResult;
  try {
    round = await deps.round({ model, item, runId: state.run_id, out: join(out, "try-" + n), unit, try: n, sessions: runs, token, allowanceMicros: allowance, leaseMicros: worst, ledger: one("--ledger"), record: one("--record"), policy, env });
  } catch (e) {
    const message = (e as Error).message;
    if ((e as { code?: unknown }).code === "CAP_STOP" || /^CAP_STOP\b/.test(message)) return capStop("the ledger refused the lease at item " + item + "'s cap (" + message + ")");
    if (e instanceof LedgerError || /^E_[A-Z_]+[: ]/.test(message)) throw e;
    for (const p of open) entry.parts[p] = { result: "infra", reason: "the rig failed: " + message };
    save();
    io.err("E_ROUTE_INFRA route-check: " + where() + ", try " + n + " (no try used): the rig failed: " + message + "\n  fix: " + infraFix(state, entry));
    return 2;
  }
  entry.lease_id = round.lease_id;
  entry.spent_micros = round.spent_micros;
  entry.claude_code_version = round.sessions.block?.claude_code_version ?? round.sessions.tool?.claude_code_version ?? null;
  if (Object.values(round.sessions).some((s) => s.record.termination.kind === "cap_stop")) return capStop("the proxy stopped a session at the lease's cap");
  const infraOf = (s: Session): string | null => {
    const r = round.sessions[s];
    return r ? sessionInfra(r.record) : "the " + s + " session did not run";
  };
  const judged = (p: Part, why: string | null): PartResult => (why === null ? { result: "pass" } : { result: "fail", code: PART_CODES[p], reason: why });
  const rows: CallRow[] = [];
  for (const p of open) {
    const why = p === "metering" ? (infraOf("tool") ?? infraOf("block")) : infraOf(p);
    if (why) entry.parts[p] = { result: "infra", reason: why };
    else if (p === "tool") entry.parts.tool = judged("tool", judgeTool(round.sessions.tool!.record, round.sessions.tool!.transcript, token));
    else if (p === "block") entry.parts.block = judged("block", judgeBlock(round.sessions.block!.record));
    else {
      const calls = journalCalls(round.journal, { tool: round.sessions.tool!.meter_id, block: round.sessions.block!.meter_id });
      const bill = await billedCosts(billIds(calls), { fetch: deps.fetch, now: deps.now, sleep: deps.sleep, key });
      if ("infra" in bill) entry.parts.metering = { result: "infra", reason: bill.infra };
      else {
        const m = judgeMetering(calls, bill.billed, ["tool", "block"]);
        rows.push(...m.rows);
        entry.parts.metering = judged("metering", m.problems.length ? m.problems.join("; ") : null);
      }
    }
  }
  if (entry.parts.metering?.result === "fail") {
    entry.metering_file = "metering-" + n + ".json";
    const source = join(out, entry.metering_file);
    const billed = rows.every((r) => r.billed_micros !== null) ? (rows.reduce((s, r) => s + r.billed_micros!, 0) / 1_000_000).toFixed(6) : "<billed usd>";
    entry.reconcile = "gstack-evals ledger reconcile --lease " + entry.lease_id + " --spent " + billed + " --words <the owner's words> --by <who> --source " + source + (one("--record") ? " --ledger-record " + record.path : "");
    writeFileSync(source, JSON.stringify({ model, item, try: n, lease_id: entry.lease_id, tolerance: METERING_TOLERANCE, problems: entry.parts.metering.reason.split("; "), calls: rows }, null, 2) + "\n");
  }
  save();
  const after: RouteState = { ...state, tries: [...state.tries, entry] };
  io.out("route-check " + model + " try " + n + ": " + open.map((p) => p + " " + entry.parts[p]!.result).join(", ") + "; spent " + usd(entry.spent_micros) + (entry.lease_id ? " on lease " + entry.lease_id : ""));
  const meters: Record<Part, Session[]> = { tool: ["tool"], block: ["block"], metering: ["tool", "block"] };
  for (const p of open) {
    const r = entry.parts[p]!;
    if (r.result === "pass") continue;
    const used = meters[p].flatMap((s) => (round.sessions[s] ? [round.sessions[s]!] : []));
    const said = proxyErrors(round.journal, used.map((s) => s.meter_id), used.map((s) => s.transcript)).map((l) => "\n  proxy: " + l).join("");
    if (r.result === "infra") io.err("E_ROUTE_INFRA route-check: " + where() + ", part " + p + ", try " + n + " (no try used): " + r.reason + said + "\n  fix: " + infraFix(state, entry));
    else io.err(r.code + " route-check: " + where() + ", part " + p + ", try " + partFails(after, p) + " of " + MAX_TRIES + ": " + r.reason + said + "\n  fix: " + failFix(after, p, entry));
  }
  if (open.some((p) => entry.parts[p]!.result === "fail")) return 1;
  if (open.some((p) => entry.parts[p]!.result === "infra")) return 2;
  io.out("route-check " + model + ": every part passed (" + file + ")");
  return 0;
}

const infraFix = (state: RouteState, entry: RouteTry): string =>
  infraFailures({ ...state, tries: [...state.tries, entry] }) >= MAX_INFRA ? "this is the second infra failure, so the check stops for the Captain and the model stays in E1; report the lines above" : "check the endpoint, credential or proxy named above, then rerun route-check with the same --out";

function failFix(after: RouteState, p: Part, entry: RouteTry): string {
  if (partFails(after, p) >= MAX_TRIES) return "none in this check: part " + p + " failed both tries, so " + after.model + " leaves E1 with " + PART_CODES[p] + "; the results name the code";
  if (p === "tool") return "apply a named repair from the frozen list (--repair provider-pin=<openrouter provider>), then rerun route-check with the same --out";
  if (p === "block") return "raise the output allowance (--repair output-allowance=<tokens>, above " + SESSION_ALLOWANCE.output + "), then rerun route-check with the same --out";
  return "reconcile the try's lease against OpenRouter's billed cost (" + entry.metering_file + " holds the per-call comparison), then rerun route-check with the same --out: " + entry.reconcile;
}
