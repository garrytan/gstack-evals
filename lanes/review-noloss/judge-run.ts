// Copyright (c) 2026 Garry Tan. MIT License.
// noloss judge-run (stacks round 1 prereg, sections 3, 7 and 9): sends each judge the frozen brief, the batch's
// batch.json and one packet per request through an in-process metering proxy, on a lease of a ledger line item, and
// writes the reply files noloss judge-join reads. The primary judge reads every packet. The second and third read every
// packet that holds a blocker or finding of the sets judge-join names (judgeSets in judge.ts), and their reply files keep
// only those. The runner sets each reply's batch, judge, file and digest itself and takes only the answers from the
// model. An answer judge-join would refuse is asked again once in a fresh request; a second refusal leaves the packet
// unjudged for that role (unjudged.json). impact and verifiable go to TSV files, never into a reply. Adjudication packets
// go out with an evidence sheet: each finding's evidence, masked and leak-checked as packets are, and the unit head's code
// around the finding's line, read from a --source clone. The metering proxy retries a 429 or 5xx within JUDGE_RETRY, the
// retry budget the GST-456 post freezes; a transport error, or a 429 or 5xx past that budget, stops the run.
//
// --ceo is the CEO outcome eval's judge step (prereg 2026-11-04-geva-285 section 8, as the ladder amendment's items 9 and
// 10 and the stop-label amendment's readings change it): one judge per run over the packets gstack-evals ceo packets
// wrote. The D read sends the brief's text above its rule with each D packet, the remedy read the text below it with each
// remedy packet, both pinned by sha256. A reply that breaks section 8's failure rule gets one retry in a fresh request; a
// second failure, or a run that stops first, leaves that packet missing with its cause in replies.json.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { JUDGE_REASONING_EFFORT, JUDGE_ROUTE, judgeAnswer, judgeRequest } from "../../src/adapters/judge.ts";
import { CODES, type ReasonCode } from "../../src/errors/codes.ts";
import { openLease, settleLease } from "../../src/runner/ledger/ledger.ts";
import { openLocalLedger } from "../../src/runner/ledger/local.ts";
import { usd } from "../../src/runner/ledger/money.ts";
import { ledgerPath, recordPath } from "../../src/runner/ledger/paths.ts";
import { LedgerError, readItem } from "../../src/runner/ledger/record.ts";
import { chatPrice, openRouterRouting, priceRequest, reservationMicros, type Provider } from "../../src/runner/pricing/prices.ts";
import { MeteringProxy, reconcileJournal, type RetryBudget } from "../../src/runner/proxy/metering-proxy.ts";
import { rigAdmission } from "../../src/rig/admission.ts";
import { DEFAULT_POLICY, loadPolicy, modelProblem, providerOf } from "../../src/skill-eval/cli/policy.ts";
import type { NolossIo } from "./cli.ts";
import type { Ruling } from "./contract.ts";
import { readArmDir } from "./ingest.ts";
import { fieldText, findingSha256, judgeSets, leakRules, loadKey, packetAnswers, packetMask, packetRulings, type JudgeRole, type KeyEntry, type Unjudged } from "./judge.ts";
import { ScoreError } from "./score.ts";
import { holdsSealed, insideRepo, loadSuite, realPath, sealedAs, sha256, unitRef } from "./suite.ts";

const MAX_OUTPUT_TOKENS = 16000;
/** Per request: at most 3 sends, the first included, and no new send once 900 s have passed since the first began. */
export const JUDGE_ATTEMPTS = 3;
export const JUDGE_RETRY: RetryBudget = { attempts: JUDGE_ATTEMPTS, elapsed_ms: 900_000 };
const ROLES: JudgeRole[] = ["primary", "second", "third"];
const KEY_ENV: Record<Provider, string> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", openrouter: "OPENROUTER_API_KEY" };
const FLAGS: Record<string, "value" | "repeat" | "bool"> = { "--suite": "value", "--packets": "value", "--key": "value", "--arm": "repeat", "--brief": "value", "--primary": "value", "--second": "value", "--third": "value", "--item": "value", "--out": "value", "--source": "repeat", "--concurrency": "value", "--ledger": "value", "--record": "value", "--policy": "value", "--dry-run": "bool" };

const usage = (message: string): never => {
  throw new ScoreError("E_USAGE", message);
};
const blind = (message: string): never => {
  throw new ScoreError("E_NOLOSS_BLIND", message);
};
const inside = (child: string, dir: string) => child === dir || child.startsWith(dir + sep);
const read = (path: string, what: string) => {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    return usage("cannot read " + what + " " + path + ": " + (e as Error).message);
  }
};
const ledgerStep = <T>(f: () => T): T => {
  try {
    return f();
  } catch (e) {
    throw e instanceof LedgerError ? new ScoreError(e.code, e.message) : e;
  }
};
const git = (clone: string, args: string[]): string | null => {
  const r = spawnSync("git", ["-C", clone, ...args], { encoding: "utf8", maxBuffer: 256 << 20 });
  return r.status === 0 ? r.stdout : null;
};

/** The body the proxy prices: it adds these fields before it reserves, so the dry run's worst case is never under the proxy's. */
function asProxied(provider: Provider, body: Record<string, unknown>): Record<string, unknown> {
  if (provider === "anthropic") return { ...body, inference_geo: "global" };
  if (provider === "openai") return { ...body, service_tier: "default" };
  return { ...body, provider: openRouterRouting(chatPrice("openrouter:" + body.model)!) };
}

/** The first JSON object in a model's answer, inside a markdown fence or not. */
function firstObject(text: string): unknown {
  const start = text.indexOf("{");
  if (start < 0) throw new Error("the answer holds no JSON object");
  let depth = 0;
  let str = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (str) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') str = false;
    } else if (c === '"') str = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error("the answer's first JSON object never closes");
}

/** The head's code around a finding's line for an evidence sheet, with line numbers, or why there is none. */
function codeAt(clone: string, head: string, path: string | null, line: number | null): { code: { path: string; from: number; to: number; text: string } | null; code_note: string | null } {
  if (!path) return { code: null, code_note: "the finding names no file, so the sheet shows no code" };
  const text = git(clone, ["show", head + ":" + path]);
  if (text === null) return { code: null, code_note: path + " is not a file in the repository at the head, so the sheet shows no code" };
  const lines = text.replace(/\n$/, "").split("\n");
  if (line !== null && line > lines.length) return { code: null, code_note: "line " + line + " is past the end of " + path + " (" + lines.length + " lines) at the head" };
  const from = line === null ? 1 : Math.max(1, line - 30);
  const to = Math.min(lines.length, line === null ? 200 : line + 30);
  return { code: { path, from, to, text: lines.slice(from - 1, to).map((l, i) => String(from + i).padStart(String(to).length) + "  " + l).join("\n") }, code_note: null };
}

interface Answer {
  got: Map<string, Set<string> | Ruling>;
  /** impact (matching) or verifiable (adjudication) per opaque id: blocking, non-blocking, true, false or missing. */
  rated: Map<string, string>;
}

export async function judgeRunCmd(argv: string[], io: NolossIo, o: { env?: Record<string, string | undefined>; fetch?: (input: string, init: RequestInit) => Promise<Response>; sleep?: (ms: number) => Promise<void> } = {}): Promise<number> {
  if (argv.includes("--ceo")) return ceoJudgeRunCmd(argv.filter((a) => a !== "--ceo"), io, o);
  const env = o.env ?? process.env;
  const flags = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const kind = FLAGS[a] ?? usage("noloss judge-run does not take " + JSON.stringify(a) + "; gstack-evals noloss --help lists the flags");
    const v = kind === "bool" ? "true" : argv[++i];
    if (v === undefined || v.startsWith("--")) usage(a + " needs a value");
    if (kind !== "repeat" && flags.has(a)) usage(a + " is given twice");
    flags.set(a, [...(flags.get(a) ?? []), v!]);
  }
  const one = (f: string) => flags.get(f)?.[0] ?? usage("noloss judge-run needs " + f);
  const concurrency = Number(flags.get("--concurrency")?.[0] ?? 4);
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) usage("--concurrency must be a positive integer");

  const loadedSuite = loadSuite(one("--suite"));
  const { suite } = loadedSuite;
  const packetsDir = resolve(one("--packets"));
  const keyPath = resolve(one("--key"));
  const out = resolve(one("--out"));
  if (inside(out, packetsDir)) usage("--out " + out + " is inside --packets " + packetsDir + "; write the replies beside the packets, never among them");
  if (inside(keyPath, packetsDir)) blind("--key " + keyPath + " is inside --packets " + packetsDir + "; the key maps opaque ids back to arms and must never travel with the packets");
  if (existsSync(out) && readdirSync(out).length) usage("--out " + out + " is not empty; give each judge run a new directory");
  if (holdsSealed(suite) && insideRepo(out)) blind("suite " + suite.id + " " + sealedAs(suite) + ", so its judge run must be written outside the repo");
  const armDirs = (flags.get("--arm") ?? []).map((d) => resolve(d));
  const arms = armDirs.map((d) => readArmDir(d, suite, loadedSuite.sha256));
  const key = loadKey({ suite, suiteSha256: loadedSuite.sha256, key: keyPath, arms });
  const adjudicate = key.kind === "adjudicate";
  const findingOf = (e: KeyEntry, unit: string) => arms.find((a) => a.arm.arm.id === e.arm)!.arm.findings!.get(unit)!.find((x) => x.id === e.finding && x.pass === e.pass)!;
  const batchText = read(join(packetsDir, "batch.json"), "the batch instructions");
  if ((JSON.parse(batchText) as { batch?: unknown }).batch !== key.batch) blind(join(packetsDir, "batch.json") + " is not the instructions of batch " + key.batch + "; --packets and --key must come from one judge-packet run");
  const packets = key.packets.map((p) => {
    const text = read(join(packetsDir, p.file), "packet");
    if (sha256(text) !== p.sha256) blind(join(packetsDir, p.file) + " has sha256 " + sha256(text) + ", not the key's " + p.sha256 + "; it changed since judge-packet wrote it");
    return { ...p, text, unitOf: suite.units.find((u) => u.id === p.unit)! };
  });
  const briefPath = resolve(one("--brief"));
  const brief = read(briefPath, "the judge brief");

  const policy = loadPolicy(flags.get("--policy")?.[0] ?? DEFAULT_POLICY);
  if ("problem" in policy) throw new ScoreError("E_MODEL_POLICY", policy.problem);
  const models = Object.fromEntries(
    ROLES.map((role) => {
      const id = one("--" + role);
      const provider = id.slice(0, id.indexOf("/")) as Provider;
      const model = id.slice(id.indexOf("/") + 1);
      if (!Object.hasOwn(KEY_ENV, provider) || !model) usage("--" + role + " takes <provider>/<model> with provider anthropic, openai or openrouter, not " + JSON.stringify(id));
      const problem = modelProblem(policy, model, adjudicate ? "adjudicator" : "judge", { smoke: false });
      if (problem) throw new ScoreError("E_MODEL_POLICY", problem);
      if (providerOf(policy, model) !== provider) throw new ScoreError("E_MODEL_POLICY", model + " runs on " + providerOf(policy, model) + " under the policy, not " + provider);
      return [role, { id, provider, model }];
    }),
  ) as Record<JudgeRole, { id: string; provider: Provider; model: string }>;
  if (models.second.id === models.primary.id) usage("--second " + models.second.id + " is the primary judge; judge-join refuses a second read from the primary, so the second read needs another model");
  if (models.third.id === models.primary.id || models.third.id === models.second.id) usage("--third " + models.third.id + " already judges this batch as the primary or second; judge-join refuses a third read from either, so the third read needs a third model");

  const sheets = new Map<string, string>();
  if (adjudicate) {
    const sources = new Map((flags.get("--source") ?? []).map((s) => (s.indexOf("=") > 0 ? [s.slice(0, s.indexOf("=")), resolve(s.slice(s.indexOf("=") + 1))] : usage("--source takes <owner/repo>=<clone>, not " + JSON.stringify(s)))));
    const mask = packetMask(suite, arms);
    const leaks = leakRules(arms);
    const problems: string[] = [];
    for (const p of packets) {
      const unit = p.unitOf;
      const clone = sources.get(unit.repo) ?? usage("no --source clone for " + unit.repo + ", which unit " + unit.id + " needs at head " + unit.head + " for its evidence sheet");
      if (git(clone, ["cat-file", "-e", unit.head + "^{commit}"]) === null) usage("the --source clone " + clone + " for " + unit.repo + " does not hold head " + unit.head + "; fetch it");
      const findings = key.entries
        .filter((e) => e.packet === p.file)
        .map((e) => {
          const f = findingOf(e, unit.id);
          const evidence = mask(fieldText(f.fields.evidence));
          for (const { rule, re } of leaks) if (re.test(evidence)) problems.push(unitRef(suite, unit) + ", arm " + e.arm + ", finding " + JSON.stringify(f.id) + ": its evidence names " + rule);
          return { id: e.opaque, evidence, ...codeAt(clone, unit.head, f.path, f.line) };
        });
      sheets.set(p.file, JSON.stringify({ version: 1, packet: p.file, packet_sha256: p.sha256, findings }, null, 2) + "\n");
    }
    if (problems.length) blind("the evidence sheets would leak what blinding hides:\n" + problems.join("\n") + "\nremove it from the source arm's evidence and ingest it again");
  }

  const prompt = (p: (typeof packets)[number]) => ["=== Judge brief ===", brief, "=== Instructions: batch.json ===", batchText, "=== Packet: " + p.file + " ===", p.text, ...(adjudicate ? ["=== Evidence sheet: " + p.file + " ===", sheets.get(p.file)!] : [])].join("\n");
  const request = (role: JudgeRole, p: (typeof packets)[number]) => judgeRequest(models[role].provider, models[role].model, prompt(p), MAX_OUTPUT_TOKENS, models[role].provider === "openai" ? JUDGE_REASONING_EFFORT : undefined);
  const item = one("--item");
  const record = recordPath(flags.get("--record")?.[0], env).path;
  const itemState = ledgerStep(() => readItem(record, item));

  if (flags.has("--dry-run")) {
    const totals = new Map<JudgeRole, number>();
    for (const role of ROLES)
      for (const p of packets) {
        const m = models[role];
        const send = reservationMicros(priceRequest(m.provider, asProxied(m.provider, request(role, p)), MAX_OUTPUT_TOKENS));
        const worst = send * JUDGE_RETRY.attempts;
        totals.set(role, (totals.get(role) ?? 0) + worst);
        io.out(role + "  " + m.id + "  " + p.file + "  worst case " + usd(worst) + " (" + JUDGE_RETRY.attempts + " sends at " + usd(send) + ")");
      }
    const all = ROLES.reduce((n, r) => n + totals.get(r)!, 0);
    io.out("worst case: primary " + usd(totals.get("primary")!) + " on " + packets.length + " packets; second up to " + usd(totals.get("second")!) + " and third up to " + usd(totals.get("third")!) + " if they read every packet; " + usd(all) + " in all, " + usd(2 * all) + " if every answer is asked again. Each request counts " + JUDGE_RETRY.attempts + " sends, since the retry budget allows " + JUDGE_RETRY.attempts + " sends within " + JUDGE_RETRY.elapsed_ms / 1000 + " s and a 5xx without usage is charged its full reservation. Nothing was sent or written.");
    if (itemState.cap_micros === null) io.out("item " + item + ": no approval yet, so there is no cap to compare.");
    else {
      const left = itemState.cap_micros - itemState.committed_micros;
      const fits = (n: number) => usd(n) + (n <= left ? " fits" : " does not fit");
      io.out("item " + item + ": cap " + usd(itemState.cap_micros) + ", " + usd(itemState.committed_micros) + " committed, " + usd(Math.max(left, 0)) + " left; the worst case " + fits(all) + ", and asked again " + fits(2 * all) + ". The cap stops the run wherever it falls.");
    }
    return 0;
  }

  const missingKeys = [...new Set(ROLES.map((r) => KEY_ENV[models[r].provider]))].filter((name) => !env[name]);
  if (missingKeys.length) throw new ScoreError("E_KEY_MISSING", "the judges need " + missingKeys.join(" and ") + ", which " + (missingKeys.length > 1 ? "are" : "is") + " not set");
  mkdirSync(out, { recursive: true });
  const written = new Map<string, string>();
  const put = (name: string, text: string) => {
    mkdirSync(dirname(join(out, name)), { recursive: true });
    writeFileSync(join(out, name), text);
    written.set(name, sha256(text));
  };
  const runId = "judge-" + randomBytes(6).toString("hex");
  const journal = join(out, "journal.ndjson");
  const warn = (code: ReasonCode, message: string) => io.err(code + ": noloss judge-run: " + message);
  const local = ledgerStep(() => openLocalLedger(ledgerPath(flags.get("--ledger")?.[0], env)));
  const replies = new Map<JudgeRole, Map<string, Answer>>(ROLES.map((r) => [r, new Map()]));
  const unjudged: Unjudged[] = [];
  let stop: ScoreError | null = null;
  let crash: unknown = null;
  let proxy: MeteringProxy | undefined;
  let requests = 0;
  let lease: { lease_id: string; reserved_micros: number };
  try {
    lease = ledgerStep(() => openLease(record, local, { item, run_id: runId, warn, requireAdmission: rigAdmission({ proof: "direct" }) }));
  } catch (e) {
    local.close();
    throw e;
  }

  const validate = (role: JudgeRole, p: (typeof packets)[number], answer: string, need: string[]): Answer | string => {
    let body: Record<string, any> | undefined;
    try {
      const list = (firstObject(answer) as { packets?: unknown } | null)?.packets;
      const entries = (Array.isArray(list) ? list : []) as Array<Record<string, any>>;
      body = entries.find((x) => x?.file === p.file) ?? (entries.length === 1 ? entries[0] : undefined);
    } catch (e) {
      return (e as Error).message;
    }
    if (!body || typeof body !== "object") return "the answer has no packets entry for " + p.file;
    let got: Answer["got"];
    try {
      got = adjudicate ? packetRulings(p, { findings: body.findings }, key, suite, role) : packetAnswers(p, { blockers: body.blockers }, key, suite, role);
    } catch (e) {
      return (e as Error).message;
    }
    const short = need.filter((k) => !got.has(k));
    if (short.length) return "the answer leaves " + short.length + " of the " + need.length + (adjudicate ? " findings it must rule unruled: " : " blockers it must answer unanswered: ") + short.join(", ");
    const field = adjudicate ? body.verifiable : body.impact;
    const rate = (v: unknown) => (adjudicate ? (typeof v === "boolean" ? String(v) : "missing") : v === "blocking" || v === "non-blocking" ? v : "missing");
    return { got, rated: new Map(key.entries.filter((e) => e.packet === p.file).map((e) => [e.opaque, rate(field?.[e.opaque])])) };
  };

  const ask = async (role: JudgeRole, p: (typeof packets)[number], need: string[]) => {
    const m = models[role];
    let reason = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (stop) return;
      const binding = proxy!.bind({ cell: { run_id: runId, arm: role, task: p.file, model: m.model, trial: 1, attempt }, models: [m.provider + ":" + m.model], allowance_micros: lease.reserved_micros });
      let res: Response;
      let text: string;
      try {
        requests++;
        res = await fetch("http://127.0.0.1:" + proxy!.port + "/" + binding.slot + "/" + m.provider + JUDGE_ROUTE[m.provider], { method: "POST", headers: { authorization: "Bearer " + binding.token, "content-type": "application/json" }, body: JSON.stringify(request(role, p)), timeout: false } as RequestInit);
        text = await res.text();
      } finally {
        await proxy!.finalize(binding.meter_id);
        proxy!.unbind(binding.slot);
      }
      let answer: string | null = null;
      try {
        answer = judgeAnswer(m.provider, JSON.parse(text));
      } catch {
        answer = null;
      }
      put(join("raw", role, basename(p.file, ".json") + "." + attempt + ".txt"), res.status === 200 && answer !== null ? answer : text);
      if (res.status !== 200) {
        const problem = (res.headers.get("content-type") ?? "").includes("application/problem+json") ? (JSON.parse(text) as { code?: string; detail?: string }) : null;
        const code = problem?.code && Object.hasOwn(CODES, problem.code) ? (problem.code as ReasonCode) : "UPSTREAM";
        stop ??= new ScoreError(code, "the " + role + " judge (" + m.id + ") on " + p.file + ": " + (problem?.detail ?? "the provider answered HTTP " + res.status) + "; the run stops with no reply files, so start a fresh one");
        return;
      }
      const got = answer === null ? "the provider's response is not JSON" : validate(role, p, answer, need);
      if (typeof got !== "string") {
        replies.get(role)!.set(p.file, got);
        return;
      }
      reason = got;
      io.err("noloss judge-run: the " + role + " judge's answer for " + p.file + " was refused (attempt " + attempt + "): " + reason);
    }
    unjudged.push({ role, packet: p.file, reason });
  };
  const pool = async (jobs: Array<() => Promise<void>>) => {
    const queue = [...jobs];
    await Promise.all(
      Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
        while (!stop && queue.length) {
          try {
            await queue.shift()!();
          } catch (e) {
            if (!(e instanceof ScoreError)) crash ??= e;
            stop ??= e instanceof ScoreError ? e : new ScoreError("E_INTERNAL", "noloss judge-run: " + (e as Error).message + "; the run stops with no reply files, so start a fresh one");
          }
        }
      }),
    );
  };
  const armMap = new Map(arms.map((a) => [a.arm.arm.id, a.arm]));
  const merged = (role: JudgeRole) => new Map([...replies.get(role)!.values()].flatMap((a) => [...a.got]));
  const readers = (role: JudgeRole, set: Set<string>, judged: Array<{ k: string; packet: string }>) =>
    packets.filter((p) => judged.some((c) => c.packet === p.file && set.has(c.k))).map((p) => () => ask(role, p, judged.filter((c) => c.packet === p.file && set.has(c.k)).map((c) => c.k)));

  try {
    proxy = new MeteringProxy({ ledger: local, leaseId: lease.lease_id, host: "127.0.0.1", managementSocket: join(tmpdir(), "gse-judge-" + randomBytes(6).toString("hex") + ".sock"), managementToken: randomBytes(24).toString("hex"), journal, retry: JUDGE_RETRY, env, fetch: o.fetch, sleep: o.sleep, maxOutputTokens: MAX_OUTPUT_TOKENS });
    proxy.start();
    await pool(packets.map((p) => () => ask("primary", p, adjudicate ? key.entries.filter((e) => e.packet === p.file).map((e) => p.file + " " + e.opaque) : p.unitOf.blockers.map((b) => p.unit + " " + b.id))));
    if (!stop) {
      const first = judgeSets(key, suite, armMap, merged("primary"), null, unjudged);
      await pool(readers("second", first.second, first.judged));
    }
    if (!stop) {
      const second = judgeSets(key, suite, armMap, merged("primary"), merged("second"), unjudged);
      await pool(readers("third", second.third!, second.judged));
    }
  } finally {
    proxy?.stop();
    try {
      try {
        const reconciled = await reconcileJournal(journal, local);
        for (const r of reconciled.refused) warn(r.code as ReasonCode, "reconciling reservation " + (r.reservation_id ?? "(a lost reserve)") + " was refused: " + r.message);
      } finally {
        ledgerStep(() => settleLease(record, local, lease.lease_id, warn));
      }
    } finally {
      local.close();
    }
  }
  const runFile = (state: string) => JSON.stringify({ version: 1, run_id: runId, state, stop: stop?.code ?? null, kind: adjudicate ? "adjudication" : "matching", batch: key.batch, suite: key.suite, brief: { path: briefPath, sha256: sha256(brief) }, models: Object.fromEntries(ROLES.map((r) => [r, models[r].id])), item, lease_id: lease.lease_id, requests, unjudged: unjudged.length, files: Object.fromEntries([...written].sort(([a], [b]) => (a < b ? -1 : 1))) }, null, 2) + "\n";
  if (stop) {
    writeFileSync(join(out, "run.json"), runFile("stopped"));
    throw crash ?? stop;
  }
  const final = judgeSets(key, suite, armMap, merged("primary"), merged("second"), unjudged);
  unjudged.sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || key.packets.findIndex((p) => p.file === a.packet) - key.packets.findIndex((p) => p.file === b.packet));

  const reply = (role: JudgeRole, set: Set<string> | null) => {
    const id = (k: string) => k.slice(k.indexOf(" ") + 1);
    const list = packets.flatMap((p) => {
      const a = replies.get(role)!.get(p.file);
      const ks = a ? [...a.got.keys()].filter((k) => !set || set.has(k)) : [];
      if (!a || !ks.length) return [];
      return [{ file: p.file, sha256: p.sha256, ...(adjudicate ? { findings: ks.map((k) => ({ id: id(k), ruling: a.got.get(k) })) } : { blockers: ks.map((k) => ({ id: id(k), matches: [...(a.got.get(k) as Set<string>)] })) }) }];
    });
    return JSON.stringify({ batch: key.batch, judge: models[role].id, packets: list }, null, 2) + "\n";
  };
  put("primary.json", reply("primary", null));
  put("second.json", reply("second", final.second));
  if (final.third!.size) put("third.json", reply("third", final.third));
  if (unjudged.length) put("unjudged.json", JSON.stringify({ batch: key.batch, entries: unjudged }, null, 2) + "\n");
  const column = adjudicate ? "verifiable" : "impact";
  const entry = new Map(key.entries.map((e) => [e.packet + " " + e.opaque, e]));
  put(column + ".tsv", [["packet", "opaque", "judge", column, "batch", "finding_sha256"].join("\t"), ...ROLES.flatMap((r) => packets.flatMap((p) => [...(replies.get(r)!.get(p.file)?.rated ?? [])].map(([opaque, v]) => [p.file, opaque, models[r].id, v, key.batch, findingSha256(findingOf(entry.get(p.file + " " + opaque)!, p.unit).fields)].join("\t"))))].join("\n") + "\n");
  for (const [file, text] of sheets) put(join("sheets", basename(file)), text);

  if (adjudicate) {
    const clusters = new Set(suite.units.map((u) => u.cluster)).size;
    const counts = new Map(arms.map((a) => [a.arm.arm.id, 0]));
    const rows = ["arm\tunit\tpass\tfinding\tjudges"];
    for (const e of key.entries) {
      const k = e.packet + " " + e.opaque;
      const third = final.third!.has(k);
      if (final.dropped.has(k) || replies.get(third ? "third" : "primary")!.get(e.packet)!.got.get(k) !== "not-defect") continue;
      const judges = ROLES.filter((r) => r === "primary" || (r === "second" ? final.second.has(k) : third))
        .filter((r) => replies.get(r)!.get(e.packet)!.rated.get(e.opaque) === "false")
        .map((r) => models[r].id);
      if (!judges.length) continue;
      const unit = packets.find((p) => p.file === e.packet)!.unitOf;
      const f = findingOf(e, unit.id);
      rows.push([e.arm, unitRef(suite, unit), String(e.pass), /[;\s]/.test(f.id) ? "#" + f.index : f.id, judges.join(",")].join("\t"));
      counts.set(e.arm, counts.get(e.arm)! + 1);
    }
    put("unverifiable.tsv", rows.join("\n") + "\n");
    for (const a of arms) {
      const n = counts.get(a.arm.arm.id)!;
      io.out("unverifiable not-defect rulings, arm " + a.arm.arm.id + ": " + n + ", " + (n / a.arm.arm.passes / clusters).toFixed(4) + " per PR cluster per pass (" + a.arm.arm.passes + " passes, " + clusters + " PR clusters)");
    }
  }
  writeFileSync(join(out, "run.json"), runFile("finished"));
  const q = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : "'" + s.replace(/'/g, "'\\''") + "'");
  const next = ["gstack-evals", "noloss", "judge-join", "--suite", loadedSuite.path, "--key", keyPath, "--reply", join(out, "primary.json"), "--second", join(out, "second.json"), ...(written.has("third.json") ? ["--third", join(out, "third.json")] : []), ...(unjudged.length ? ["--unjudged", join(out, "unjudged.json")] : []), ...armDirs.flatMap((d) => ["--arm", d]), "--out", join(out, "joined")];
  io.out("judge-run: batch " + key.batch + ", " + requests + " requests; primary answered " + replies.get("primary")!.size + " packets, second " + replies.get("second")!.size + ", third " + replies.get("third")!.size + "; " + unjudged.length + " unjudged; files in " + out);
  io.out("next: " + next.map(q).join(" "));
  return 0;
}

/** The CEO judge brief (the ladder amendment's judge-brief.md), its D read (the text above the rule, the prereg's brief byte for byte) and its remedy read (every byte below the rule line). */
export const CEO_BRIEF_SHA256 = "d7b3dce1498e01e874f1dae024ac90e79e5ff5e3af12cc5ed37e2f8a48a14fb5";
export const CEO_D_READ_SHA256 = "83d5d644b97aa87003ea38a8cb273b64590f1c50129430612af2432072852589";
export const CEO_REM_READ_SHA256 = "75a90494a8a097cd5318b081b204bfd7b6b2fde8e11c147171b7cc1659c19923";
/** Section 8's three judges. */
export const CEO_JUDGES = ["openai/gpt-6.1-sol", "anthropic/claude-opus-5-5", "anthropic/claude-sonnet-5-5"] as const;
const CEO_RULE = "\n\n---\n";
const CEO_LABELS = ["D", "R1", "R2", "R3", "none"];
const CEO_FLAGS: Record<string, "value" | "bool"> = { "--packets": "value", "--key": "value", "--brief": "value", "--judge": "value", "--item": "value", "--out": "value", "--concurrency": "value", "--ledger": "value", "--record": "value", "--policy": "value", "--dry-run": "bool" };
const ceoUsage = (message: string, fix: string): never => {
  throw new ScoreError("E_USAGE", message + "\nfix: " + fix);
};

/** The two reads' prompts, cut at the brief's rule: the D read through the newline that ends its last line, the remedy read everything after the rule line. */
export function ceoBriefReads(brief: string): { D: string; rem: string } {
  const fix = "pass --brief wiki/plans/2026-11-05-geva-295-ceo-ladder-amendment/judge-brief.md, the frozen brief";
  if (sha256(brief) !== CEO_BRIEF_SHA256) ceoUsage("the judge brief has sha256 " + sha256(brief) + ", not the frozen " + CEO_BRIEF_SHA256, fix);
  const at = brief.indexOf(CEO_RULE);
  const D = brief.slice(0, at + 1);
  const rem = brief.slice(at + CEO_RULE.length);
  if (sha256(D) !== CEO_D_READ_SHA256) ceoUsage("the brief's D read has sha256 " + sha256(D) + ", not the prereg's " + CEO_D_READ_SHA256, fix);
  if (sha256(rem) !== CEO_REM_READ_SHA256) ceoUsage("the brief's remedy read has sha256 " + sha256(rem) + ", not the pinned " + CEO_REM_READ_SHA256, fix);
  return { D, rem };
}

export type CeoAnswer = { labels: string[]; leak: "yes" | "no" } | { rem: Array<"yes" | "no"> };
/**
 * A judge's answers for one packet, or why section 8's failure rule refuses the reply: no ceo-judge (D read) or
 * ceo-judge-rem (remedy read) block, or more than one; a line that isn't a JSON object naming a review; a review the
 * packet doesn't hold, or one answered twice; a list whose length differs from the review's issue count; a label or
 * value outside the brief's; a review left unanswered. A refusal holds no block, so it fails the same way.
 */
export function ceoReplyAnswers(read: "D" | "rem", reviews: Array<{ review: string; issues: number }>, text: string): Record<string, CeoAnswer> | string {
  const info = read === "D" ? "ceo-judge" : "ceo-judge-rem";
  const blocks = [...text.matchAll(/^\x60\x60\x60([^\n\x60]*)\n([\s\S]*?)^\x60\x60\x60[ \t]*$/gm)].filter((m) => m[1]!.trim() === info);
  if (blocks.length !== 1) return "the reply holds " + blocks.length + " " + info + " blocks, not one";
  const got: Record<string, CeoAnswer> = {};
  for (const line of blocks[0]![2]!.split("\n")) {
    if (!line.trim()) continue;
    let o: any;
    try {
      o = JSON.parse(line);
    } catch {
      return "a line of the " + info + " block is not JSON";
    }
    if (!o || typeof o !== "object" || typeof o.review !== "string") return "a line of the " + info + " block names no review";
    const r = reviews.find((x) => x.review === o.review);
    if (!r) return "the block answers a review the packet doesn't hold";
    if (Object.hasOwn(got, o.review)) return "the block answers review " + o.review + " twice";
    const list = read === "D" ? o.labels : o.rem;
    if (!Array.isArray(list) || list.length !== r.issues) return "review " + o.review + "'s " + (read === "D" ? "labels" : "rem") + " list has " + (Array.isArray(list) ? list.length : "no") + " entries, not " + r.issues;
    if (read === "D") {
      if (list.some((l: unknown) => !CEO_LABELS.includes(l as string))) return "review " + o.review + " has a label outside D, R1, R2, R3 and none";
      if (o.leak !== "yes" && o.leak !== "no") return "review " + o.review + "'s leak is not yes or no";
      got[o.review] = { labels: list, leak: o.leak };
    } else {
      if (list.some((v: unknown) => v !== "yes" && v !== "no")) return "review " + o.review + " has a rem value other than yes and no";
      got[o.review] = { rem: list };
    }
  }
  const left = reviews.filter((r) => !Object.hasOwn(got, r.review));
  return left.length ? "the block leaves " + left.length + " of " + reviews.length + " reviews unanswered" : got;
}

/** noloss judge-run --ceo: one judge over every packet of a ceo packets key. */
async function ceoJudgeRunCmd(argv: string[], io: NolossIo, o: { env?: Record<string, string | undefined>; fetch?: (input: string, init: RequestInit) => Promise<Response>; sleep?: (ms: number) => Promise<void> }): Promise<number> {
  const env = o.env ?? process.env;
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const kind = CEO_FLAGS[a] ?? ceoUsage("noloss judge-run --ceo does not take " + JSON.stringify(a), "use only --ceo, " + Object.keys(CEO_FLAGS).join(", "));
    const v = kind === "bool" ? "true" : argv[++i];
    if (v === undefined || v.startsWith("--")) ceoUsage(a + " needs a value", "pass " + a + " <value>");
    if (flags.has(a)) ceoUsage(a + " is given twice", "pass " + a + " once");
    flags.set(a, v!);
  }
  const one = (f: string) => flags.get(f) ?? ceoUsage("noloss judge-run --ceo needs " + f, "add " + f + " <value>");
  const concurrency = Number(flags.get("--concurrency") ?? 4);
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) ceoUsage("--concurrency must be a positive integer", "pass --concurrency <n>, or drop it for 4");
  const out = resolve(one("--out"));
  if (insideRepo(out)) ceoUsage("--out " + out + " is inside the repo; judge replies are keyed to sealed packets and stay sealed", "give --out a new directory outside the repo, beside the packets");
  const packetsDir = resolve(one("--packets"));
  const keyPath = resolve(one("--key"));
  const real = (p: string) => realPath(p) ?? p;
  if (inside(real(out), real(packetsDir))) ceoUsage("--out " + out + " is inside --packets " + packetsDir, "write the replies beside the packets, never among them");
  if (inside(real(keyPath), real(packetsDir))) blind("--key " + keyPath + " is inside --packets " + packetsDir + "; the key maps opaque ids back to rows and must never travel with the packets\nfix: move the key beside --packets and pass it from there");
  if (existsSync(out) && readdirSync(out).length) ceoUsage("--out " + out + " is not empty", "give each judge run a new directory; a stopped run doesn't resume");
  const keyText = read(keyPath, "the packet key");
  let key: { kind?: string; packets?: Array<{ file: string; unit: string; read: "D" | "rem"; sha256: string }> };
  try {
    key = JSON.parse(keyText);
  } catch {
    return ceoUsage("--key " + keyPath + " is not JSON", "pass the --key file gstack-evals ceo packets wrote");
  }
  if (key.kind !== "ceo-outcome" || !Array.isArray(key.packets) || !key.packets.length) ceoUsage("--key " + keyPath + " is not a ceo packets key", "pass the --key file gstack-evals ceo packets wrote");
  const packets = key.packets!.map((p) => {
    const text = read(join(packetsDir, p.file), "packet");
    if (sha256(text) !== p.sha256) blind(join(packetsDir, p.file) + " has sha256 " + sha256(text) + ", not the key's " + p.sha256 + "; it changed since ceo packets wrote it\nfix: rebuild the packets and the key with gstack-evals ceo packets");
    let reviews: Array<{ review: string; issues: number }> = [];
    try {
      reviews = (JSON.parse(text).reviews as Array<{ review: string; issues: unknown[] }>).map((r) => ({ review: r.review, issues: r.issues.length }));
    } catch {
      ceoUsage(join(packetsDir, p.file) + " is not a ceo packet", "rebuild the packets and the key with gstack-evals ceo packets");
    }
    return { ...p, text, reviews };
  });
  const briefPath = resolve(one("--brief"));
  const brief = read(briefPath, "the judge brief");
  const reads = ceoBriefReads(brief);
  const judge = one("--judge");
  if (!(CEO_JUDGES as readonly string[]).includes(judge)) ceoUsage("--judge " + judge + " is not one of section 8's judges", "pass --judge " + CEO_JUDGES.join(", --judge ") + ", one per run");
  const provider = judge.slice(0, judge.indexOf("/")) as Provider;
  const model = judge.slice(judge.indexOf("/") + 1);
  const policy = loadPolicy(flags.get("--policy") ?? DEFAULT_POLICY);
  if ("problem" in policy) throw new ScoreError("E_MODEL_POLICY", policy.problem);
  const problem = modelProblem(policy, model, "judge", { smoke: false });
  if (problem) throw new ScoreError("E_MODEL_POLICY", problem);
  if (providerOf(policy, model) !== provider) throw new ScoreError("E_MODEL_POLICY", model + " runs on " + providerOf(policy, model) + " under the policy, not " + provider);
  const prompt = (p: (typeof packets)[number]) => [p.read === "D" ? reads.D : reads.rem, "=== Packet: " + p.file + " ===", p.text].join("\n");
  const request = (p: (typeof packets)[number]) => judgeRequest(provider, model, prompt(p), MAX_OUTPUT_TOKENS, provider === "openai" ? JUDGE_REASONING_EFFORT : undefined);
  const item = one("--item");
  const record = recordPath(flags.get("--record"), env).path;
  const itemState = ledgerStep(() => readItem(record, item));

  if (flags.has("--dry-run")) {
    let all = 0;
    for (const p of packets) {
      const send = reservationMicros(priceRequest(provider, asProxied(provider, request(p)), MAX_OUTPUT_TOKENS));
      const worst = send * JUDGE_RETRY.attempts * 2;
      all += worst;
      io.out(judge + "  " + p.file + " (" + (p.read === "D" ? "D read" : "remedy read") + ")  worst case " + usd(worst) + " (2 requests of " + JUDGE_RETRY.attempts + " sends at " + usd(send) + ")");
    }
    io.out("worst case: " + usd(all) + " for " + judge + " on " + packets.length + " packets, each asked again once. Nothing was sent or written.");
    if (itemState.cap_micros === null) io.out("item " + item + ": no approval yet, so there is no cap to compare.");
    else {
      const left = itemState.cap_micros - itemState.committed_micros;
      io.out("item " + item + ": cap " + usd(itemState.cap_micros) + ", " + usd(itemState.committed_micros) + " committed, " + usd(Math.max(left, 0)) + " left; the worst case " + (all <= left ? "fits" : "does not fit") + ". The cap stops the run wherever it falls.");
    }
    return 0;
  }

  if (!env[KEY_ENV[provider]]) throw new ScoreError("E_KEY_MISSING", "the judge needs " + KEY_ENV[provider] + ", which is not set");
  mkdirSync(out, { recursive: true });
  const written = new Map<string, string>();
  const put = (name: string, text: string) => {
    mkdirSync(dirname(join(out, name)), { recursive: true });
    writeFileSync(join(out, name), text);
    written.set(name, sha256(text));
  };
  const runId = "judge-ceo-" + randomBytes(6).toString("hex");
  const journal = join(out, "journal.ndjson");
  const warn = (code: ReasonCode, message: string) => io.err(code + ": noloss judge-run --ceo: " + message);
  const local = ledgerStep(() => openLocalLedger(ledgerPath(flags.get("--ledger"), env)));
  const results = new Map<string, { status: "answered"; answers: Record<string, CeoAnswer>; attempts: number } | { status: "missing"; cause: string }>();
  let stop: ScoreError | null = null;
  let crash: unknown = null;
  let proxy: MeteringProxy | undefined;
  let requests = 0;
  let lease: { lease_id: string; reserved_micros: number };
  try {
    lease = ledgerStep(() => openLease(record, local, { item, run_id: runId, warn, requireAdmission: rigAdmission({ proof: "direct" }) }));
  } catch (e) {
    local.close();
    throw e;
  }
  const ask = async (p: (typeof packets)[number]) => {
    let reason = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (stop) return;
      const binding = proxy!.bind({ cell: { run_id: runId, arm: "ceo-" + p.read, task: p.file, model, trial: 1, attempt }, models: [provider + ":" + model], allowance_micros: lease.reserved_micros });
      let res: Response;
      let text: string;
      try {
        requests++;
        res = await fetch("http://127.0.0.1:" + proxy!.port + "/" + binding.slot + "/" + provider + JUDGE_ROUTE[provider], { method: "POST", headers: { authorization: "Bearer " + binding.token, "content-type": "application/json" }, body: JSON.stringify(request(p)), timeout: false } as RequestInit);
        text = await res.text();
      } finally {
        await proxy!.finalize(binding.meter_id);
        proxy!.unbind(binding.slot);
      }
      let answer: string | null = null;
      try {
        answer = judgeAnswer(provider, JSON.parse(text));
      } catch {
        answer = null;
      }
      put(join("raw", basename(p.file, ".json") + "." + attempt + ".txt"), res.status === 200 && answer !== null ? answer : text);
      if (res.status !== 200) {
        const prob = (res.headers.get("content-type") ?? "").includes("application/problem+json") ? (JSON.parse(text) as { code?: string; detail?: string }) : null;
        const code = prob?.code && Object.hasOwn(CODES, prob.code) ? (prob.code as ReasonCode) : "UPSTREAM";
        stop ??= new ScoreError(code, "the judge (" + judge + ") on " + p.file + ": " + (prob?.detail ?? "the provider answered HTTP " + res.status) + "; the run stops, replies.json marks every packet it didn't answer missing with this cause, and the run doesn't resume");
        return;
      }
      const got = answer === null ? "the provider's response is not JSON" : ceoReplyAnswers(p.read, p.reviews, answer);
      if (typeof got !== "string") {
        results.set(p.file, { status: "answered", answers: got, attempts: attempt });
        return;
      }
      reason = got;
      io.err("JUDGE_REPLY_REFUSED: noloss judge-run --ceo: the reply for " + p.file + " was refused (attempt " + attempt + "): " + reason);
    }
    results.set(p.file, { status: "missing", cause: "refused twice: " + reason });
  };
  try {
    proxy = new MeteringProxy({ ledger: local, leaseId: lease.lease_id, host: "127.0.0.1", managementSocket: join(tmpdir(), "gse-judge-" + randomBytes(6).toString("hex") + ".sock"), managementToken: randomBytes(24).toString("hex"), journal, retry: JUDGE_RETRY, env, fetch: o.fetch, sleep: o.sleep, maxOutputTokens: MAX_OUTPUT_TOKENS });
    proxy.start();
    const queue = [...packets];
    await Promise.all(
      Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
        while (!stop && queue.length) {
          try {
            await ask(queue.shift()!);
          } catch (e) {
            if (!(e instanceof ScoreError)) crash ??= e;
            stop ??= e instanceof ScoreError ? e : new ScoreError("E_INTERNAL", "noloss judge-run --ceo: " + (e as Error).message + "; the run stops and doesn't resume");
          }
        }
      }),
    );
  } finally {
    proxy?.stop();
    try {
      try {
        const reconciled = await reconcileJournal(journal, local);
        for (const r of reconciled.refused) warn(r.code as ReasonCode, "reconciling reservation " + (r.reservation_id ?? "(a lost reserve)") + " was refused: " + r.message);
      } finally {
        ledgerStep(() => settleLease(record, local, lease.lease_id, warn));
      }
    } finally {
      local.close();
    }
  }
  const halted = stop as ScoreError | null;
  for (const p of packets) if (!results.has(p.file)) results.set(p.file, { status: "missing", cause: "no answer: the run stopped (" + (halted?.code ?? "E_INTERNAL") + ")" });
  put("replies.json", JSON.stringify({ version: 1, kind: "ceo-judge", judge, brief_sha256: CEO_BRIEF_SHA256, key_sha256: sha256(keyText), run_id: runId, state: halted ? "stopped" : "finished", packets: packets.map((p) => ({ file: p.file, unit: p.unit, read: p.read, sha256: p.sha256, ...results.get(p.file)! })) }, null, 2) + "\n");
  const missing = packets.filter((p) => results.get(p.file)!.status === "missing");
  writeFileSync(join(out, "run.json"), JSON.stringify({ version: 1, run_id: runId, state: halted ? "stopped" : "finished", stop: halted?.code ?? null, kind: "ceo", judge, brief: { path: briefPath, sha256: CEO_BRIEF_SHA256 }, item, lease_id: lease.lease_id, requests, missing: missing.length, files: Object.fromEntries([...written].sort(([a], [b]) => (a < b ? -1 : 1))) }, null, 2) + "\n");
  if (halted) throw crash ?? halted;
  io.out("judge-run --ceo: " + judge + ", " + packets.length + " packets: " + (packets.length - missing.length) + " answered, " + missing.length + " missing (" + missing.filter((p) => p.read === "D").length + " D reads, " + missing.filter((p) => p.read === "rem").length + " remedy reads); " + requests + " requests; replies in " + join(out, "replies.json"));
  return 0;
}
