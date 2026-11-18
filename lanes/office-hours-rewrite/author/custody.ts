// Copyright (c) 2026 Garry Tan. MIT License.
// Custody for the office-hours rewrite eval's briefs (prereg section 3, "Sealing"; the founder lane's custody rules).
// Briefs are written through the founder lane's sink into a fresh work directory under /dev/shm, which is memory-backed,
// then sealed with age to an output path outside the repository and the work directory is deleted. Decryption goes only
// into /dev/shm. Every refusal raises E_OHR_CUSTODY before anything is written. The repository and the printed summary
// get counts and digests only. The sealer and the decrypter are injected so tests need no age binary.
// The second attempt (its sections 4 and 5.2) adds three readers and writers over the same custody:
// - sealedJournal seals each settled draft's record to draft-<seq>.age as it settles, and after every batch the outcome
//   log, the reused briefs, the projection reads and every placed brief to checkpoint-<drafts>.age, each a new path in
//   the run's checkpoints folder. Each sealed file carries the run id and the ledger item, which also sit in plain
//   run.json beside them; the last checkpoint and run.json also record why the run ended.
// - readJournal decrypts a checkpoint and every draft record sealed after it into /dev/shm, refuses a gap, a record of
//   another run or item, a run that ended on a cap stop (final), a resume on another ledger item or a brief whose files
//   no longer match its digest, deletes the plaintext and returns the state a resume starts from, with the run id it
//   continues on the same ledger item.
// - lockCheckpoints holds a flock on a run's checkpoints folder for the process's life, so two authors never write one
//   run's journal or lease its item at once.
// Every /dev/shm check reads the realpath of the path's nearest existing ancestor, so a symlinked parent cannot point
// plaintext outside memory-backed storage.
// - plaintextSha256 hashes a sealed file's plaintext as age streams it, so the command can check the first attempt's
//   output against the digest section 4 records before reading it.
// - readReuse decrypts the first attempt's sealed authoring output into /dev/shm and takes its placed briefs
//   (briefs/<id>/, authoring/outcomes.jsonl and authoring/check-answers.json). A brief is reused only when its slot is one
//   of the 13 reused slots and its files on disk, its outcome and its brief.json name one digest; a pair only with both
//   twins. Every other brief is listed as failed, and its slot is drafted again.
import { spawnSync } from "node:child_process";
import { dlopen, FFIType } from "bun:ffi";
import { closeSync, existsSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { realOf, REPO_ROOT } from "../../product-value/io.ts";
import { AuthorError, keyJson, openSink, writeSealed } from "../../office-hours-founder/author/files.ts";
import { REUSED_SLOTS } from "../frozen.ts";
import type { CheckAnswer } from "../score/packets.ts";
import type { BriefMeta, PriorSession, Sheet } from "../types.ts";
import type { Outcome } from "./brief.ts";
import { schedule } from "./draws.ts";
import { digestOf, priorJson, sheetJson, type BriefFiles } from "./files.ts";
import { metaOf, summaryOf, type AuthorRun, type Checkpoint, type End, type Journal, type LogEntry, type Reuse } from "./run.ts";

export const SHM = "/dev/shm";

const inRepo = (p: string) => {
  const real = realOf(p), root = realOf(REPO_ROOT);
  return real === root || real.startsWith(root + sep);
};
/** The path, followed through the realpath of its nearest existing ancestor, lies under /dev/shm. */
export const inShm = (p: string): boolean => realOf(p).startsWith(realOf(SHM) + sep);

/** Refuses a work directory outside /dev/shm or already there, and a sealed output inside the repository or already there. */
export function openCustody(work: string, out: string): string {
  if (inRepo(out)) throw new AuthorError("E_OHR_CUSTODY", out + " is inside the repository; sealed briefs go only outside it");
  if (existsSync(out)) throw new AuthorError("E_OHR_CUSTODY", out + " already exists; every run seals to a new path");
  if (!inShm(work)) throw new AuthorError("E_OHR_CUSTODY", work + " is not under " + SHM + "; plaintext briefs live only in memory-backed storage");
  if (existsSync(work)) throw new AuthorError("E_OHR_CUSTODY", work + " already exists; every run writes into a new work directory");
  return openSink(work);
}

/** Seals a work directory to out; the default is tar piped to age for the recipients file. */
export type Sealer = (work: string, out: string) => void;
export const ageSealer = (recipients: string): Sealer => (work, out) => {
  const r = spawnSync("bash", ["-o", "pipefail", "-c", 'tar -C "$1" -cf - . | age -R "$2" -o "$3.tmp" && mv "$3.tmp" "$3"', "seal", work, recipients, out], { encoding: "utf8" });
  if (r.status !== 0) throw new AuthorError("E_OHR_CUSTODY", "sealing with age failed (exit " + r.status + "): " + (r.stderr || "").trim().split("\n")[0]);
};

/** Seals the work directory, checks the sealed file exists, then deletes the plaintext. */
export function sealCustody(work: string, out: string, sealer: Sealer): void {
  sealer(work, out);
  if (!existsSync(out)) throw new AuthorError("E_OHR_CUSTODY", "the sealer left no file at " + out + "; the plaintext stays in " + work + ": delete it before anything else");
  rmSync(work, { recursive: true, force: true });
  if (existsSync(work)) throw new AuthorError("E_OHR_CUSTODY", "the plaintext work directory " + work + " survived its deletion");
}

/** Decrypts a sealed file into a new directory under /dev/shm only. */
export type Decrypter = (sealed: string, dir: string) => void;
export const ageDecrypter = (identity: string): Decrypter => (sealed, dir) => {
  const r = spawnSync("bash", ["-o", "pipefail", "-c", 'mkdir -m 700 "$3" && age -d -i "$2" "$1" | tar -C "$3" -xf -', "unseal", sealed, identity, dir], { encoding: "utf8" });
  if (r.status !== 0) throw new AuthorError("E_OHR_CUSTODY", "decrypting with age failed (exit " + r.status + ")");
};
/** The sha256 of a sealed file's plaintext, hashed from age's output stream so the plaintext never reaches a disk. */
export function plaintextSha256(sealed: string, identity: string): string {
  const r = spawnSync("bash", ["-o", "pipefail", "-c", 'age -d -i "$2" "$1" | sha256sum', "digest", sealed, identity], { encoding: "utf8" });
  if (r.status !== 0) throw new AuthorError("E_OHR_CUSTODY", "decrypting with age failed (exit " + r.status + ")");
  return r.stdout.split(" ")[0]!;
}
export function unsealTo(sealed: string, dir: string, decrypt: Decrypter): string {
  if (!inShm(dir)) throw new AuthorError("E_OHR_CUSTODY", dir + " is not under " + SHM + "; sealed briefs are decrypted only into memory-backed storage");
  if (existsSync(dir)) throw new AuthorError("E_OHR_CUSTODY", dir + " already exists");
  try {
    decrypt(sealed, dir);
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  return dir;
}

const jsonl = (xs: readonly unknown[]) => xs.map((x) => JSON.stringify(x) + "\n").join("");
const readJsonl = <T>(p: string): T[] => readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as T);

/** Writes placed briefs in types.ts's layout under an open sink. */
function writeBriefs(sink: string, placed: readonly Outcome[]): void {
  const slots = new Map(schedule().map((s) => [s.slot, s]));
  for (const x of placed) {
    const f = x.files!, dir = join("briefs", x.id);
    writeSealed(sink, join(dir, "opening.md"), f.opening);
    writeSealed(sink, join(dir, "sheet.json"), sheetJson(f.sheet));
    writeSealed(sink, join(dir, "key.json"), keyJson(f.key));
    writeSealed(sink, join(dir, "brief.json"), keyJson(metaOf(slots.get(x.slot)!, x)));
    if (f.prior) writeSealed(sink, join(dir, "prior.json"), priorJson(f.prior));
  }
}

/** Writes the placed briefs, this run's outcome log, the reused briefs' outcomes and the summary under an open sink; returns the summary. */
export function writeAuthoring(sink: string, run: AuthorRun) {
  const ids = new Set([...run.sets.calibration, ...run.sets.comparison, ...run.sets.reserve].map((m) => m.id));
  writeBriefs(sink, [...run.reuse.placed, ...run.outcomes].filter((x) => x.status === "pass" && ids.has(x.id)));
  writeSealed(sink, "authoring/outcomes.jsonl", jsonl(run.outcomes));
  writeSealed(sink, "authoring/reused.jsonl", jsonl(run.reuse.placed));
  const summary = summaryOf(run);
  writeSealed(sink, "authoring/summary.json", keyJson(summary));
  return summary;
}

/** Opens custody, writes the run and seals it; returns the summary (counts and digests only, safe to print). */
export function authorToCustody(run: AuthorRun, o: { work: string; out: string; sealer: Sealer }) {
  const sink = openCustody(o.work, o.out);
  const summary = writeAuthoring(sink, run);
  sealCustody(sink, o.out, o.sealer);
  return summary;
}


const pad = (n: number) => String(n).padStart(6, "0");
const DRAFT = /^draft-(\d{6})\.age$/;
const CHECKPOINT = /^checkpoint-(\d{6})(?:_\d+)?\.age$/;

/** What each sealed file's run.json and the plain run.json beside them hold. */
interface RunFile {
  run_id: string;
  item: string;
  end?: End;
}

let libc: { symbols: { flock: (fd: number, operation: number) => number } } | null = null;
/** Holds an exclusive flock on dir until this process exits; refuses at once while another process holds it. */
export function lockCheckpoints(dir: string): void {
  libc ??= dlopen(process.platform === "darwin" ? "libc.dylib" : "libc.so.6", { flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 } });
  const fd = openSync(dir, "r");
  if (libc.symbols.flock(fd, 2 | 4) === 0) return;
  closeSync(fd);
  throw new AuthorError("E_OHR_RESUME", dir + " is locked by another ohr author process; one process writes a run's journal and leases its item at a time");
}

/** The journal authorRun writes through: one sealed file a settled draft, and a checkpoint after every batch, each a new path in dir. Plaintext goes only into fresh directories beside work under /dev/shm. */
export function sealedJournal(o: { dir: string; work: string; sealer: Sealer; runId: string; item: string }): Journal {
  const run: RunFile = { run_id: o.runId, item: o.item };
  const plain = join(o.dir, "run.json");
  const prior = existsSync(plain) ? (JSON.parse(readFileSync(plain, "utf8")) as RunFile) : null;
  if (prior && (prior.run_id !== o.runId || prior.item !== o.item)) throw new AuthorError("E_OHR_RESUME", plain + " names run " + prior.run_id + " on " + prior.item + ", not " + o.runId + " on " + o.item + "; a checkpoints folder serves one run on one ledger item");
  writeFileSync(plain, JSON.stringify(run) + "\n");
  const seal = (name: string, write: (sink: string) => void) => {
    const out = join(o.dir, name);
    const sink = openCustody(o.work + "." + name.replace(/\.age$/, ""), out);
    write(sink);
    writeSealed(sink, "run.json", JSON.stringify(run) + "\n");
    sealCustody(sink, out, o.sealer);
  };
  return {
    record: (e) => seal("draft-" + pad(e.seq) + ".age", (sink) => writeSealed(sink, "record.json", JSON.stringify(e) + "\n")),
    checkpoint: (c, placed) => {
      let name = "checkpoint-" + pad(c.log.length) + ".age";
      for (let k = 2; existsSync(join(o.dir, name)); k++) name = "checkpoint-" + pad(c.log.length) + "_" + k + ".age";
      seal(name, (sink) => {
        writeBriefs(sink, placed);
        writeSealed(sink, "authoring/log.jsonl", jsonl(c.log));
        writeSealed(sink, "authoring/reuse.json", JSON.stringify(c.reuse) + "\n");
        writeSealed(sink, "authoring/reads.json", JSON.stringify(c.reads) + "\n");
        if (c.end) writeSealed(sink, "authoring/end.json", JSON.stringify(c.end) + "\n");
      });
      if (c.end) writeFileSync(plain, JSON.stringify({ ...run, end: c.end }) + "\n");
    },
  };
}

/** Decrypts one sealed file into a new directory under /dev/shm, reads it and deletes the plaintext. */
function opened<T>(sealed: string, dir: string, decrypt: Decrypter, read: (d: string) => T): T {
  const d = unsealTo(sealed, dir, decrypt);
  try {
    return read(d);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
}

const runOf = (d: string, what: string): RunFile => {
  const r = existsSync(join(d, "run.json")) ? (JSON.parse(readFileSync(join(d, "run.json"), "utf8")) as Partial<RunFile>) : {};
  if (typeof r.run_id !== "string" || !r.run_id || typeof r.item !== "string" || !r.item) throw new AuthorError("E_OHR_RESUME", what + " carries no run id and ledger item, so a resume cannot continue its run on the item");
  return { run_id: r.run_id, item: r.item };
};
const capped = (what: string, run: string, end: End | undefined) => {
  if (end?.stopped === "cap") throw new AuthorError("E_OHR_RESUME", what + " records that run " + run + " ended on a cap stop (" + (end.codes.join(", ") || "the cap less the spend held no brief allowance") + "); a cap stop is final, so the run never resumes");
};

/** A resume's state: a sealed checkpoint and every draft record sealed after it in the same folder, in order, with the run they belong to; item is the ledger item the resume leases. */
export function readJournal(checkpoint: string, decrypt: Decrypter, work: string, item: string): Checkpoint & { run_id: string; item: string } {
  const at = CHECKPOINT.exec(basename(checkpoint));
  if (!at) throw new AuthorError("E_OHR_RESUME", checkpoint + " is not a sealed checkpoint (checkpoint-<drafts>.age)");
  const dir = dirname(checkpoint);
  const plain = join(dir, "run.json");
  const side = existsSync(plain) ? (JSON.parse(readFileSync(plain, "utf8")) as RunFile) : null;
  if (side) capped(plain, side.run_id, side.end);
  const c = opened(checkpoint, work + ".open-checkpoint", decrypt, (d) => {
    const end = join(d, "authoring", "end.json");
    return { ...runOf(d, checkpoint), log: readJsonl<LogEntry>(join(d, "authoring", "log.jsonl")), reuse: JSON.parse(readFileSync(join(d, "authoring", "reuse.json"), "utf8")) as Reuse, reads: JSON.parse(readFileSync(join(d, "authoring", "reads.json"), "utf8")) as Checkpoint["reads"], ...(existsSync(end) ? { end: JSON.parse(readFileSync(end, "utf8")) as End } : {}) };
  });
  capped(checkpoint, c.run_id, c.end);
  if (c.item !== item) throw new AuthorError("E_OHR_RESUME", checkpoint + " belongs to ledger item " + c.item + ", not --item " + item + "; a run resumes only on its own item");
  if (side && (side.run_id !== c.run_id || side.item !== c.item)) throw new AuthorError("E_OHR_RESUME", plain + " names run " + side.run_id + " on " + side.item + ", and " + checkpoint + " run " + c.run_id + " on " + c.item);
  if (c.log.length !== Number(at[1])) throw new AuthorError("E_OHR_RESUME", checkpoint + " names " + Number(at[1]) + " drafts and its log holds " + c.log.length);
  const after = readdirSync(dir).flatMap((n) => (DRAFT.test(n) ? [Number(DRAFT.exec(n)![1])] : [])).filter((n) => n > c.log.length).sort((a, b) => a - b);
  after.forEach((n, i) => {
    if (n !== c.log.length + 1 + i) throw new AuthorError("E_OHR_RESUME", dir + " holds draft record " + n + " but not draft " + (c.log.length + 1 + i) + "; a sealed draft is missing, so the run cannot resume without paying for it twice");
  });
  for (const n of after) {
    const name = join(dir, "draft-" + pad(n) + ".age");
    c.log.push(
      opened(name, work + ".open-draft-" + pad(n), decrypt, (d) => {
        const r = runOf(d, name);
        if (r.run_id !== c.run_id || r.item !== c.item) throw new AuthorError("E_OHR_RESUME", name + " belongs to run " + r.run_id + " on " + r.item + ", and " + checkpoint + " to run " + c.run_id + " on " + c.item);
        return JSON.parse(readFileSync(join(d, "record.json"), "utf8")) as LogEntry;
      }),
    );
  }
  c.log.forEach((e, i) => {
    if (e.seq !== i + 1) throw new AuthorError("E_OHR_RESUME", "draft record " + (i + 1) + " names place " + e.seq);
    if (e.status === "pass" && digestOf(e.files!) !== e.digest) throw new AuthorError("E_OHR_RESUME", "draft " + e.id + "'s files no longer match its digest");
  });
  return c;
}

const fileOf = (dir: string, name: string) => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), "utf8") : null);

/** The first attempt's placed briefs, each checked against its recorded digest and its slot against the reused slots. */
export function readReuse(sealed: string, decrypt: Decrypter, work: string): Reuse {
  const kept = new Set(schedule().map((s) => s.slot));
  return opened(sealed, work + ".open-reuse", decrypt, (d): Reuse => {
    const passed = readJsonl<Outcome>(join(d, "authoring", "outcomes.jsonl")).filter((x) => x.status === "pass" && existsSync(join(d, "briefs", x.id)));
    const answers = JSON.parse(readFileSync(join(d, "authoring", "check-answers.json"), "utf8")) as CheckAnswer[];
    const failed: Reuse["failed"] = [];
    const ok: Outcome[] = [];
    for (const x of passed) {
      const dir = join(d, "briefs", x.id);
      const opening = fileOf(dir, "opening.md"), sheet = fileOf(dir, "sheet.json"), key = fileOf(dir, "key.json"), meta = fileOf(dir, "brief.json"), prior = fileOf(dir, "prior.json");
      const files: BriefFiles | null = opening !== null && sheet !== null && key !== null ? { opening, sheet: JSON.parse(sheet) as Sheet, key: JSON.parse(key) as BriefFiles["key"], prior: prior === null ? null : (JSON.parse(prior) as PriorSession) } : null;
      const why = !REUSED_SLOTS.includes(x.slot) || !kept.has(x.slot) ? "its slot " + x.slot + " is not one of the reused slots" : !files || meta === null ? "a file is missing" : digestOf(files) !== x.digest || (JSON.parse(meta) as BriefMeta).digest !== x.digest ? "its files do not match its recorded digest" : null;
      if (why) failed.push({ id: x.id, slot: x.slot, why });
      else ok.push({ ...x, files });
    }
    const placed = ok.filter((x) => {
      const twin = x.files!.key.twin;
      if (twin === null || ok.some((y) => y.id === twin)) return true;
      failed.push({ id: x.id, slot: x.slot, why: "its twin " + twin + " failed the check" });
      return false;
    });
    const ids = new Set(placed.map((x) => x.id));
    return { placed, answers: answers.filter((a) => ids.has(a.brief)), failed };
  });
}
