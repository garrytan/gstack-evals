// Copyright (c) 2026 Garry Tan. MIT License.
// The base-app screen's recipe sessions (plan section 8, R2-1, R2-7, the Captain's A1 ruling): down the frame order, each
// candidate that passed the file check gets one recipe session in a fresh recipe VM on a $5.00 allowance, admitted one
// at a time on dc-base-apps; then the controller qualifies its recipe from a clean copy. At most 30 candidates get a
// session; the first 20 that qualify under the strict reading are the base apps; fewer than 16 is E_DC_SUPPLY_SHORT.
import { RECIPES } from "../frozen.ts";
import { DcError, fail } from "../errors.ts";
import { causeText, sandboxed, sandboxLine, SESSION_MARK, type SandboxDeps, type SandboxTally, type Vm, type VmSpec } from "../stage3/sandbox.ts";
import { CapStopSignal, type AgentEnd, type AgentRun, type MoneySeam } from "../stage3/seams.ts";
import { nodeDeclared, nodeLine, type NodeDeclared } from "./node.ts";
import { qualify, type QualifyDeps, type Qualification } from "./qualify.ts";
import { parseRecipe, recipePrompt, type Recipe } from "./recipe.ts";
import type { BrowserSeam, Candidate, RecipeAgent, RouteMatcher } from "./seams.ts";

export const RECIPE_PATH = "/work/recipe.json";

/** Where a candidate's screen ended. */
export type CandidateEnd =
  | "qualified"
  | "not-qualified"
  | "own-limit"
  | "infra"
  | "no-recipe"
  | "bad-recipe";

export interface CandidateRecord {
  id: string;
  pin: string;
  end: CandidateEnd;
  /** Sessions this candidate used: 1, or 2 after a J1 retry. */
  sessions: number;
  /** Whether it qualifies under the strict reading (PD-10) and under the HTTP 200 reading. */
  strict: boolean;
  http200: boolean;
  why: string | null;
  recipe: Recipe | null;
  qualification: Qualification | null;
  /** The declared Node versions read from the candidate's tree (node.ts), printed only; null when the tree could not be read. */
  node: NodeDeclared | null;
  /** Each recipe session or qualification run that failed outside the agent or the app, by its label, with its cause (causeText). */
  causes: string[];
}

/** R2-1's funnel. Clone counts and file-check passes come from the frame area. */
export interface Funnel {
  cloneAttempts: number;
  clones: number;
  fileCheckPasses: number;
  /** Candidates that got a recipe session. */
  candidates: number;
  /** Sessions run, J1 retries included. */
  sessions: number;
  qualifiedStrict: number;
  qualifiedHttp200: number;
}

export interface Screen {
  records: CandidateRecord[];
  /** The first 20 that qualify under the strict reading, in frame order, each pinned with its recipe. */
  baseApps: Array<{ id: string; pin: string; recipe: Recipe }>;
  funnel: Funnel;
  /** A cap stop on dc-base-apps or dc-hosts, else null. */
  capStop: { item: "dc-base-apps" | "dc-hosts"; why: string } | null;
  /** Every recipe and qualification VM with its dropped connections, in the order they ran. */
  sandboxes: SandboxTally[];
}

export interface ScreenDeps {
  sandbox: SandboxDeps;
  money: MoneySeam;
  agent: RecipeAgent;
  browser: BrowserSeam;
  match: RouteMatcher;
  /** The recipe VM's spec: the proxy and the named mirrors. */
  recipeSpec: (label: string) => VmSpec;
  /** The qualification VM's spec: the named mirrors only. */
  qualifySpec: (label: string) => VmSpec;
  /** The Captain's B1 setting: a seeded local test user may sign in. */
  seededLogin: boolean;
  /** The frame's counts for the funnel. */
  frame: { cloneAttempts: number; clones: number; fileCheckPasses: number };
  /** Optional progress lines. */
  log?: (line: string) => void;
}

const ITEM = "dc-base-apps" as const;

/** What the screen counted so far, a cap-stopped candidate included. */
interface Tally {
  sessions: number;
  candidates: number;
  sandboxes: SandboxTally[];
}

interface Attempt {
  end: AgentEnd;
  recipeText: string | null;
  /** Why it ended outside the agent, masked (causeText); null otherwise. */
  cause: string | null;
}

/** One recipe session: admitted on its own at one allowance, run in a fresh recipe VM, audited, settled. */
async function session(c: Candidate, label: string, d: ScreenDeps, tally: Tally): Promise<{ attempt: Attempt; sub: string }> {
  const adm = await d.money.admit({ item: ITEM, run: label, reserveUsd: RECIPES.session.usd });
  if (!adm.ok) {
    await d.money.capStop(ITEM, adm.why);
    throw new CapStopSignal(ITEM, adm.why);
  }
  tally.sessions++;
  const seen: { agent: AgentRun | null } = { agent: null };
  let run;
  try {
    run = await sandboxed(
      d.sandbox,
      d.recipeSpec(label),
      async (vm: Vm): Promise<Attempt> => {
        const b = d.sandbox.backend;
        await b.write(vm, "/work/app.tar", await c.tree());
        const x = await b.exec(vm, "mkdir -p /work/app && tar -xf /work/app.tar -C /work/app && rm /work/app.tar && chown -R run /work", { user: "root" });
        if (x.exit !== 0) throw new Error("the clone did not unpack (exit " + x.exit + ")");
        const marked = await b.exec(vm, "touch " + SESSION_MARK, { user: "root" });
        if (marked.exit !== 0) throw new Error("the session's start marker failed (exit " + marked.exit + ")");
        const agent = (seen.agent = await d.agent(vm, { prompt: recipePrompt(), limits: RECIPES.session, sub: { item: ITEM, id: adm.id } }));
        const has = await b.exec(vm, "test -f " + RECIPE_PATH, { user: "root" });
        return { end: agent.end, recipeText: has.exit === 0 ? new TextDecoder().decode(await b.read(vm, RECIPE_PATH)) : null, cause: agent.end === "infra" ? causeText("the agent's session ended outside the agent" + (agent.why ? ": " + agent.why : "")) : null };
      },
      { scanExtra: (v) => (v?.recipeText !== null && v?.recipeText !== undefined ? [RECIPE_PATH] : []) },
    );
  } catch (e) {
    await d.money.settle(adm.id, seen.agent?.spentUsd ?? null);
    throw e;
  }
  tally.sandboxes.push({ label, blocked: run.blocked, portless: run.portless });
  await d.money.settle(adm.id, seen.agent?.spentUsd ?? null);
  if (!run.audit.ok) fail("E_DC_SANDBOX_AUDIT", label + ": the recipe VM's audit " + (run.audit.kind === "breach" ? "found " : "could not collect its evidence: ") + run.audit.reasons.join("; ") + ". The base-app screen stops for the Captain");
  if (run.destroyError) d.log?.(label + ": the VM was not deleted (" + run.destroyError + "); the reaper deletes it past its time to live");
  const attempt = run.value ?? { end: "infra", recipeText: null, cause: causeText(run.error ?? "the job returned nothing and recorded no error") };
  if (attempt.cause) d.log?.(label + ": failed outside the agent: " + attempt.cause);
  return { attempt, sub: adm.id };
}

/** One qualification, with one retry when the run fails outside the app (the VM, a preamble step, the browser). */
async function qualified(c: Candidate, recipe: Recipe, d: ScreenDeps, tally: Tally, causes: string[]): Promise<Qualification | null> {
  const qd: QualifyDeps = { sandbox: d.sandbox, spec: d.qualifySpec, browser: d.browser, match: d.match, seededLogin: d.seededLogin };
  for (let i = 1; i <= 2; i++) {
    const label = "qualify " + c.id + (i > 1 ? " retry" : "");
    const r = await qualify(c, recipe, qd, label);
    tally.sandboxes.push({ label, blocked: r.blocked, portless: r.portless });
    if (!r.audit.ok) fail("E_DC_SANDBOX_AUDIT", label + ": the qualification VM's audit " + (r.audit.kind === "breach" ? "found " : "could not collect its evidence: ") + r.audit.reasons.join("; ") + ". The base-app screen stops for the Captain");
    if (r.value) return r.value;
    const cause = causeText(r.error ?? "the job returned nothing and recorded no error");
    d.log?.(label + ": failed outside the app: " + cause);
    causes.push(label + ": " + cause);
  }
  return null;
}

async function screenOne(c: Candidate, d: ScreenDeps, tally: Tally): Promise<CandidateRecord> {
  const node = await c.tree().then(nodeDeclared, () => null);
  const causes: string[] = [];
  const rec = (end: CandidateEnd, sessions: number, why: string | null, recipe: Recipe | null = null, q: Qualification | null = null): CandidateRecord => ({ id: c.id, pin: c.pin, end, sessions, strict: q?.strict ?? false, http200: q?.http200 ?? false, why, recipe, qualification: q, node, causes });
  tally.candidates++;
  let label = "recipe session " + c.id;
  let { attempt, sub } = await session(c, label, d, tally);
  if (attempt.cause) causes.push(label + ": " + attempt.cause);
  let sessions = 1;
  if (attempt.end === "infra") {
    await d.money.reconcile(sub);
    label = "recipe session " + c.id + " retry";
    ({ attempt } = await session(c, label, d, tally));
    if (attempt.cause) causes.push(label + ": " + attempt.cause);
    sessions = 2;
  }
  if (attempt.end === "own-limit") return rec("own-limit", sessions, "the session stopped on its own limit; no retry");
  if (attempt.end === "infra") return rec("infra", sessions, "a failure outside the agent, twice: " + causes.join("; "));
  if (attempt.recipeText === null) return rec("no-recipe", sessions, "the session wrote no " + RECIPE_PATH);
  const parsed = parseRecipe(attempt.recipeText, { seededLogin: d.seededLogin });
  if (!parsed.ok) return rec("bad-recipe", sessions, parsed.problems.join("; "));
  const q = await qualified(c, parsed.recipe, d, tally, causes);
  if (!q) return rec("infra", sessions, "the qualification run failed outside the app, twice: " + causes.filter((x) => x.startsWith("qualify ")).join("; "), parsed.recipe);
  return rec(q.strict ? "qualified" : "not-qualified", sessions, q.strict ? null : q.strictWhy, parsed.recipe, q);
}

/**
 * Runs the screen down the candidates in frame order until 20 qualify, 30 candidates had a session, or a cap stop. A1
 * bounds recipe sessions at 30; the prereg words it as candidates that get a session, so a J1 retry spends no slot (BT).
 */
export async function runScreen(candidates: readonly Candidate[], d: ScreenDeps): Promise<Screen> {
  const records: CandidateRecord[] = [];
  const tally: Tally = { sessions: 0, candidates: 0, sandboxes: [] };
  let capStop: Screen["capStop"] = null;
  for (const c of candidates) {
    if (records.filter((r) => r.strict).length >= RECIPES.baseApps || tally.candidates >= RECIPES.maxSessions) break;
    try {
      const r = await screenOne(c, d, tally);
      records.push(r);
      d.log?.(recordLine(r));
    } catch (e) {
      if (!(e instanceof CapStopSignal)) throw e;
      if (e.item === "dc-hosts") await d.money.capStop("dc-hosts", e.message);
      capStop = { item: e.item === "dc-hosts" ? "dc-hosts" : "dc-base-apps", why: e.message };
      break;
    }
  }
  const strict = records.filter((r) => r.strict);
  return {
    records,
    baseApps: strict.slice(0, RECIPES.baseApps).map((r) => ({ id: r.id, pin: r.pin, recipe: r.recipe! })),
    funnel: { ...d.frame, candidates: tally.candidates, sessions: tally.sessions, qualifiedStrict: strict.length, qualifiedHttp200: records.filter((r) => r.http200).length },
    capStop,
    sandboxes: tally.sandboxes,
  };
}

export const recordLine = (r: CandidateRecord) => "candidate " + r.id + ": " + r.end + ", strict " + (r.strict ? "yes" : "no") + ", HTTP 200 " + (r.http200 ? "yes" : "no") + ", sessions " + r.sessions + (r.why ? " (" + r.why + ")" : "") + "; " + nodeLine(r.node ?? null, r.qualification?.engineError === true);

export const funnelLine = (f: Funnel) =>
  "funnel: clone attempts " + f.cloneAttempts + ", clones " + f.clones + ", file-check passes " + f.fileCheckPasses + ", candidates with a recipe session " + f.candidates + ", recipe sessions " + f.sessions + ", qualified " + f.qualifiedStrict + " under the strict reading and " + f.qualifiedHttp200 + " under the HTTP 200 reading";

export type SupplyRead = { status: "ok"; baseApps: Screen["baseApps"]; lines: string[] } | { status: "captain"; baseApps: Screen["baseApps"]; lines: string[]; why: string };

/**
 * The supply rule. 16 or more strict-qualified: the base apps, or, after a dc-base-apps cap stop, the base apps at that
 * count for the Captain (R2-7). Fewer than 16: E_DC_SUPPLY_SHORT with both counts. A dc-hosts cap stop stops every stage
 * and goes to the Captain whatever the count.
 */
export function supply(s: Screen): SupplyRead {
  const lines = [...s.records.map(recordLine), ...(s.sandboxes ?? []).map(sandboxLine), funnelLine(s.funnel)];
  if (s.capStop?.item === "dc-hosts") return { status: "captain", baseApps: s.baseApps, lines, why: "a dc-hosts cap stop stops every stage: " + s.capStop.why };
  const n = s.funnel.qualifiedStrict;
  if (n < RECIPES.minBaseApps)
    throw new DcError("E_DC_SUPPLY_SHORT", n + " base apps qualify under the strict reading of renders (" + s.funnel.qualifiedHttp200 + " under the HTTP 200 reading); at least " + RECIPES.minBaseApps + " are needed" + (s.capStop ? ", after a cap stop on " + s.capStop.item : "") + ". " + funnelLine(s.funnel));
  if (s.capStop) return { status: "captain", baseApps: s.baseApps, lines, why: "a dc-base-apps cap stop with " + n + " qualified leaves the base apps at that count" };
  return { status: "ok", baseApps: s.baseApps, lines };
}
