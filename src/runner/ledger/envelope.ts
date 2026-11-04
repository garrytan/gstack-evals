// The program envelope (build step O6 of the outcome-per-skill plan v3): one ceiling for a program and one for each of
// its skills, each counting settled spend plus every open reservation. A line item joins a program and its skills at
// init, and openLease admits each lease on it here before the lease is written. Admission takes the program's next
// entry slot, a write-once file, so a check made against entries 1 to N-1 lands only in slot N: of two admissions at
// the same moment one wins the slot, and the other reads the winner's entry and is checked again. Settling a lease
// moves its metered amount to settled spend and releases the rest. Like every record slot, an entry slot has one winner
// within one host (wiki finding 2026-10-28-gsta-16-ledger-cross-host-claim), so an entry is refused on a network or FUSE
// mount (E_LEDGER_PATH) and a program's record lives on the local disk of its one envelope host.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReasonCode } from "../../errors/codes.ts";
import { isMicros, usd } from "./money.ts";
import { readMounts, remoteMount, type Mount } from "./paths.ts";
import { checkQuotes, claimSlot, isRecordFile, isSkillList, ITEM_NAME, LedgerError, listItems, readItem, type ItemState, type LeaseFile, type Quote } from "./record.ts";

/** Entry 1 of a program: the owner's ceilings, frozen. */
export interface ProgramFile {
  schema: 1;
  kind: "program";
  program: string;
  seq: 1;
  cap_micros: number;
  /** Each skill's ceiling; every skill has the same one. */
  skill_cap_micros: number;
  skills: string[];
  /** Dollars, in micros, that 1,000 credits of crew model use cost. */
  credit_rate_micros: number;
  quotes: Quote[];
  recorded_at: string;
}

/** A lease admitted against the envelope, written before the lease itself, so a crash between the two leaves it counted. */
export interface AdmitFile {
  schema: 1;
  kind: "admit";
  program: string;
  seq: number;
  lease: LeaseFile;
  recorded_at: string;
}

/** A crew thread's model use, a cumulative reading of its credits: the program counts each thread's latest reading once. */
export interface CrewFile {
  schema: 1;
  kind: "crew";
  program: string;
  seq: number;
  thread: string;
  credits_micros: number;
  spent_micros: number;
  /** The skills whose lines share it evenly; none means program overhead, counted against the program only. */
  skills: string[];
  source: string;
  recorded_at: string;
}

type Entry = ProgramFile | AdmitFile | CrewFile;

export interface EnvelopeLine {
  cap_micros: number;
  /** Closed leases at what they spent, unknown calls included, and crew use. */
  settled_micros: number;
  /** Open leases at their whole reserved amount, expired or not, until they are settled or reconciled. */
  open_micros: number;
  /** Admitted leases not yet written, until their lease could no longer admit a call. */
  pending_micros: number;
  committed_micros: number;
  left_micros: number;
}

export interface EnvelopeStatus {
  program: ProgramFile;
  total: EnvelopeLine;
  skills: Record<string, EnvelopeLine>;
  overhead_micros: number;
  items: string[];
  entries: number;
}

const ENTRY = /^entry-(\d{4})\.json$/;
const MAX_ENTRY = 9999;
const MAX_ATTEMPTS = 100;
const THREAD = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ESCALATE = "the owner's ceilings are recorded with gstack-evals ledger envelope and their exact words (docs/budget-ledger.md); on Capy, ask your Captain through a needs-you report";

const entryPath = (record: string, program: string, seq: number) => join(record, "programs", program, "entry-" + String(seq).padStart(4, "0") + ".json");

function checkProgram(program: string): void {
  if (!ITEM_NAME.test(program)) throw new LedgerError("E_USAGE", "program " + JSON.stringify(program) + " must match " + ITEM_NAME);
}

function isEntry(e: unknown, program: string): e is Entry {
  const r = e as Entry | null;
  if (typeof r !== "object" || r === null || r.schema !== 1 || r.program !== program || !Number.isSafeInteger(r.seq)) return false;
  if (r.kind === "program") return isMicros(r.cap_micros) && r.cap_micros > 0 && isMicros(r.skill_cap_micros) && r.skill_cap_micros > 0 && isSkillList(r.skills) && isMicros(r.credit_rate_micros) && r.credit_rate_micros > 0 && Array.isArray(r.quotes) && r.quotes.length > 0;
  if (r.kind === "admit") return isRecordFile(r.lease) && r.lease.kind === "lease";
  return r.kind === "crew" && THREAD.test(String(r.thread)) && isMicros(r.credits_micros) && isMicros(r.spent_micros) && Array.isArray(r.skills) && (r.skills.length === 0 || isSkillList(r.skills)) && typeof r.source === "string";
}

function readEntries(record: string, program: string): Entry[] {
  checkProgram(program);
  const dir = join(record, "programs", program);
  const names = existsSync(dir) ? readdirSync(dir).filter((n) => ENTRY.test(n)).sort() : [];
  if (names.length === 0) throw new LedgerError("E_ENVELOPE_MISSING", "no envelope is on record for program " + program + " in " + record + "; " + ESCALATE);
  return names.map((name, i) => {
    const path = join(dir, name);
    if (Number(ENTRY.exec(name)![1]) !== i + 1) throw new LedgerError("E_LEDGER_RECORD", "the envelope of program " + program + " in " + record + " is missing entry " + (i + 1));
    let e: unknown = null;
    try {
      e = JSON.parse(readFileSync(path, "utf8"));
    } catch {}
    if (!isEntry(e, program) || e.seq !== i + 1 || (i === 0) !== (e.kind === "program")) {
      throw new LedgerError("E_LEDGER_RECORD", "the envelope entry " + path + " does not parse as entry " + (i + 1) + " of program " + program + "; repair it by hand, never delete it");
    }
    return e;
  });
}

/** Claims an entry slot: "written" or "present" when it holds these bytes, "taken" when another entry won it. */
function claim(record: string, entry: Entry, mounts: Mount[] = readMounts()): "written" | "present" | "taken" {
  if (entry.seq > MAX_ENTRY) throw new LedgerError("E_LEDGER_RECORD", "program " + entry.program + " has used all " + MAX_ENTRY + " envelope entries in " + record);
  const path = entryPath(record, entry.program, entry.seq);
  const type = remoteMount(path, mounts);
  if (type) throw new LedgerError("E_LEDGER_PATH", "the record " + record + " is on a " + type + " mount, where an entry slot of program " + entry.program + " can have more than one winner; keep a program's record on the local disk of its one envelope host (docs/budget-ledger.md, Program envelopes)");
  const result = claimSlot(path, JSON.stringify(entry, null, 2) + "\n");
  return typeof result === "object" ? "taken" : result;
}

/** Splits an amount evenly across skills; the odd micro-dollars go to the first skills named, so the parts add up. */
function split(amount: number, skills: string[]): [string, number][] {
  const base = Math.floor(amount / skills.length);
  return skills.map((s, i) => [s, base + (i < amount - base * skills.length ? 1 : 0)]);
}

interface Tally {
  settled: number;
  open: number;
  pending: number;
}

function line(cap: number, t: Tally): EnvelopeLine {
  const committed = t.settled + t.open + t.pending;
  return { cap_micros: cap, settled_micros: t.settled, open_micros: t.open, pending_micros: t.pending, committed_micros: committed, left_micros: cap - committed };
}

/**
 * Reads a program's entries and every member item. Each lease on a member item counts once, on its item's skills: a
 * closed lease at what it spent, an open one at its reserved amount. An admission whose lease slot is still empty counts
 * its amount until that lease's expiry, after which no call can spend against it. A thread's crew use counts at its
 * latest reading. A damaged item anywhere in the record stops the read, so nothing is admitted against a total it hides.
 */
function readEnvelope(record: string, program: string, now: Date): { entries: Entry[]; status: EnvelopeStatus; pending: AdmitFile[] } {
  const entries = readEntries(record, program);
  const def = entries[0] as ProgramFile;
  const members = new Map(listItems(record).map((item) => readItem(record, item)).filter((s) => s.program === program).map((s) => [s.item, s]));
  const total: Tally = { settled: 0, open: 0, pending: 0 };
  const lines = new Map<string, Tally>(def.skills.map((s) => [s, { settled: 0, open: 0, pending: 0 }]));
  let overhead = 0;
  const add = (skills: string[], amount: number, kind: keyof Tally, where: string) => {
    total[kind] += amount;
    if (skills.length === 0) overhead += amount;
    for (const [s, part] of skills.length === 0 ? [] : split(amount, skills)) {
      const tally = lines.get(s);
      if (!tally) throw new LedgerError("E_LEDGER_RECORD", where + " names skill " + s + ", which program " + program + " does not have");
      tally[kind] += part;
    }
  };
  for (const s of members.values()) {
    for (const { lease, close } of s.leases) add(s.skills, close ? close.spent_micros + close.unknown_micros : lease.reserved_micros, close ? "settled" : "open", "line item " + s.item);
  }
  const pending: AdmitFile[] = [];
  const crew = new Map<string, CrewFile>();
  for (const e of entries) {
    if (e.kind === "crew") crew.set(e.thread, e);
    if (e.kind !== "admit") continue;
    const s = members.get(e.lease.item);
    if (!s) throw new LedgerError("E_LEDGER_RECORD", "envelope entry " + e.seq + " of program " + program + " admits a lease on line item " + e.lease.item + ", which is not in the program");
    if (s.leases.length >= e.lease.seq || now >= new Date(e.lease.expires_at)) continue;
    pending.push(e);
    add(s.skills, e.lease.reserved_micros, "pending", "line item " + s.item);
  }
  for (const c of crew.values()) add(c.skills, c.spent_micros, "settled", "the crew use of thread " + c.thread);
  const status: EnvelopeStatus = {
    program: def,
    total: line(def.cap_micros, total),
    skills: Object.fromEntries([...lines].map(([s, t]) => [s, line(def.skill_cap_micros, t)])),
    overhead_micros: overhead,
    items: [...members.keys()],
    entries: entries.length,
  };
  return { entries, status, pending };
}

const held = (l: EnvelopeLine) => usd(l.settled_micros) + " settled, " + usd(l.open_micros) + " in open leases and " + usd(l.pending_micros) + " admitted but not yet leased";

/** Why a new reservation of amount on these skills does not fit, or null when it fits at or under every ceiling. */
function refusal(st: EnvelopeStatus, skills: string[], amount: number): LedgerError | null {
  const p = st.program.program;
  const t = st.total;
  if (t.committed_micros + amount > t.cap_micros) {
    return new LedgerError("ENVELOPE_PROGRAM_STOP", "program " + p + " holds " + usd(t.committed_micros) + " of its " + usd(t.cap_micros) + " envelope (" + held(t) + "); this stage reserves " + usd(amount) + ", which would take it to " + usd(t.committed_micros + amount) + ", so it is refused before any spend");
  }
  for (const [s, part] of split(amount, skills)) {
    const l = st.skills[s]!;
    if (l.committed_micros + part > l.cap_micros) {
      return new LedgerError("ENVELOPE_SKILL_STOP", "skill " + s + " in program " + p + " holds " + usd(l.committed_micros) + " of its " + usd(l.cap_micros) + " ceiling (" + held(l) + "); its share of this stage is " + usd(part) + " of " + usd(amount) + ", which would take it to " + usd(l.committed_micros + part) + ", so the stage is refused before any spend");
    }
  }
  return null;
}

/**
 * Records a program's envelope, entry 1, the owner's ceilings with their words, and then mirrors it, so an envelope that
 * lost the race to entry 1 is refused before it mirrors. It never changes: a retry returns it and mirrors it again, which
 * completes a mirror that failed.
 */
export function recordProgram(record: string, p: { program: string; cap_micros: number; skill_cap_micros: number; skills: string[]; credit_rate_micros: number; quotes: Quote[]; now?: Date; mounts?: Mount[] }, mirror?: () => void): ProgramFile {
  checkProgram(p.program);
  if (!isMicros(p.cap_micros) || p.cap_micros === 0 || !isMicros(p.skill_cap_micros) || p.skill_cap_micros === 0) throw new LedgerError("E_USAGE", "the program's and each skill's ceiling must be positive amounts of dollars");
  if (!isSkillList(p.skills)) throw new LedgerError("E_USAGE", "an envelope needs one or more distinct skills, each matching " + ITEM_NAME);
  if (!isMicros(p.credit_rate_micros) || p.credit_rate_micros === 0) throw new LedgerError("E_USAGE", "the credit rate must be a positive amount of dollars per 1,000 credits");
  checkQuotes(p.quotes);
  const file: ProgramFile = { schema: 1, kind: "program", program: p.program, seq: 1, cap_micros: p.cap_micros, skill_cap_micros: p.skill_cap_micros, skills: p.skills, credit_rate_micros: p.credit_rate_micros, quotes: p.quotes, recorded_at: (p.now ?? new Date()).toISOString() };
  const same = (prior: ProgramFile) => JSON.stringify({ ...prior, recorded_at: "" }) === JSON.stringify({ ...file, recorded_at: "" });
  const current = () => {
    if (!existsSync(entryPath(record, p.program, 1))) return null;
    const prior = readEntries(record, p.program)[0] as ProgramFile;
    if (same(prior)) return prior;
    throw new LedgerError("E_USAGE", "program " + p.program + " already has an envelope of " + usd(prior.cap_micros) + " with " + usd(prior.skill_cap_micros) + " for each of " + prior.skills.join(", ") + "; an envelope never changes");
  };
  const recorded = current() ?? (claim(record, file, p.mounts) === "taken" ? current()! : file);
  mirror?.();
  return recorded;
}

/**
 * Admits a lease on a program's line item in one atomic step: settled spend, every open reservation and this lease must
 * stay at or under the program's ceiling and each of the item's skills' ceilings, or it is refused with
 * ENVELOPE_PROGRAM_STOP or ENVELOPE_SKILL_STOP. afterCheck runs after a check passes and before its slot is claimed.
 */
export function admitLease(record: string, state: ItemState, lease: LeaseFile, o: { now?: Date; afterCheck?: () => void; mounts?: Mount[] } = {}): AdmitFile {
  const program = state.program;
  if (program === null) throw new LedgerError("E_INTERNAL", "line item " + state.item + " is in no program, so it has no envelope to admit a lease against");
  const now = o.now ?? new Date();
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { entries, status, pending } = readEnvelope(record, program, now);
    const rival = pending.find((e) => e.lease.item === lease.item);
    if (rival) {
      throw new LedgerError("E_LEASE_UNSETTLED", "lease " + rival.lease.lease_id + " on line item " + lease.item + " was admitted at " + rival.recorded_at + " and its lease is not written yet; it is counted until it is written or until it expires at " + rival.lease.expires_at + ", so lease again after that");
    }
    const stop = refusal(status, state.skills, lease.reserved_micros);
    if (stop) throw stop;
    o.afterCheck?.();
    const file: AdmitFile = { schema: 1, kind: "admit", program, seq: entries.length + 1, lease, recorded_at: now.toISOString() };
    if (claim(record, file, o.mounts) !== "taken") return file;
  }
  throw new LedgerError("E_LEDGER_RECORD", "admitting lease " + lease.lease_id + " lost program " + program + "'s next entry slot " + MAX_ATTEMPTS + " times in a row; read gstack-evals ledger status --program " + program + " and lease again");
}

/** Credits at a rate per 1,000 credits, in micro-dollars, rounded up. */
export const creditsCost = (credits_micros: number, rate_micros: number) => Number((BigInt(credits_micros) * BigInt(rate_micros) + 999_999_999n) / 1_000_000_000n);

/**
 * Records a crew thread's model use as settled spend on its skills' lines, or as program overhead with no skills. It is
 * spent already, so it is recorded even past a ceiling, with an ENVELOPE_OVER warning for each line this reading takes past
 * its ceiling. A reading equal to the thread's last returns that entry; a lower reading, another split or a cost the
 * ledger cannot hold exactly is refused.
 */
export function recordCrew(record: string, c: { program: string; thread: string; credits_micros: number; skills: string[]; source: string; now?: Date; mounts?: Mount[] }, warn?: (code: ReasonCode, message: string) => void): CrewFile {
  if (!THREAD.test(c.thread)) throw new LedgerError("E_USAGE", "thread " + JSON.stringify(c.thread) + " must match " + THREAD);
  if (!isMicros(c.credits_micros)) throw new LedgerError("E_USAGE", "credits must be a non-negative number with up to six decimals");
  if (c.skills.length > 0 && !isSkillList(c.skills)) throw new LedgerError("E_USAGE", "crew skills must be distinct names, each matching " + ITEM_NAME);
  if (!c.source.trim()) throw new LedgerError("E_USAGE", "crew use needs --source, the counter reading it came from");
  const now = c.now ?? new Date();
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { entries, status } = readEnvelope(record, c.program, now);
    const missing = c.skills.find((s) => !status.program.skills.includes(s));
    if (missing) throw new LedgerError("E_USAGE", "program " + c.program + " has no skill " + missing + "; its skills are " + status.program.skills.join(", "));
    const prior = entries.filter((e): e is CrewFile => e.kind === "crew" && e.thread === c.thread).at(-1);
    if (prior && JSON.stringify(prior.skills) !== JSON.stringify(c.skills)) {
      throw new LedgerError("E_USAGE", "thread " + c.thread + "'s crew use is on " + (prior.skills.join(", ") || "program overhead") + "; a later reading keeps that split");
    }
    if (prior && c.credits_micros < prior.credits_micros) throw new LedgerError("E_USAGE", "thread " + c.thread + " already read " + prior.credits_micros / 1_000_000 + " credits; a reading is cumulative and never goes down");
    if (prior && c.credits_micros === prior.credits_micros) return prior;
    const spent_micros = creditsCost(c.credits_micros, status.program.credit_rate_micros);
    if (!isMicros(spent_micros)) throw new LedgerError("E_USAGE", "thread " + c.thread + "'s reading of " + c.credits_micros / 1_000_000 + " credits at " + usd(status.program.credit_rate_micros) + " per 1,000 credits costs more than the ledger can hold exactly; check --credits");
    const file: CrewFile = { schema: 1, kind: "crew", program: c.program, seq: entries.length + 1, thread: c.thread, credits_micros: c.credits_micros, spent_micros, skills: c.skills, source: c.source, recorded_at: now.toISOString() };
    if (claim(record, file, c.mounts) === "taken") continue;
    const after = readEnvelope(record, c.program, now).status;
    const over = [["program " + c.program, status.total, after.total] as const, ...Object.keys(after.skills).map((s) => ["skill " + s + " in program " + c.program, status.skills[s]!, after.skills[s]!] as const)].filter(([, before, l]) => before.left_micros >= 0 && l.left_micros < 0);
    for (const [name, , l] of over) warn?.("ENVELOPE_OVER", name + " holds " + usd(l.committed_micros) + ", past its " + usd(l.cap_micros) + " ceiling, after thread " + c.thread + "'s crew use; every new stage on it is refused");
    return file;
  }
  throw new LedgerError("E_LEDGER_RECORD", "recording thread " + c.thread + "'s crew use lost program " + c.program + "'s next entry slot " + MAX_ATTEMPTS + " times in a row; record it again");
}

/** The envelope's lines: the program's, each skill's and its overhead, from settled spend and every open reservation. */
export function envelopeStatus(record: string, program: string, now = new Date()): EnvelopeStatus {
  return readEnvelope(record, program, now).status;
}

/** The skills of a program's envelope, for a line item joining it at init; E_ENVELOPE_MISSING when none is on record. */
export function programSkills(record: string, program: string): string[] {
  return (readEntries(record, program)[0] as ProgramFile).skills;
}
