// Copyright (c) 2026 Garry Tan. MIT License.
// Custody for the office-hours rewrite eval's briefs (prereg section 3, "Sealing"; the founder lane's custody rules).
// Briefs are written through the founder lane's sink into a fresh work directory under /dev/shm, which is memory-backed,
// then sealed with age to an output path outside the repository and the work directory is deleted. Decryption goes only
// into /dev/shm. Every refusal raises E_OHR_CUSTODY before anything is written. The repository and the printed summary
// get counts and digests only. The sealer and the decrypter are injected so tests need no age binary.
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { realOf, REPO_ROOT } from "../../product-value/io.ts";
import { AuthorError, keyJson, openSink, writeSealed } from "../../office-hours-founder/author/files.ts";
import { schedule } from "./draws.ts";
import { priorJson, sheetJson } from "./files.ts";
import { metaOf, summaryOf, type AuthorRun } from "./run.ts";

export const SHM = "/dev/shm";

const inRepo = (p: string) => {
  const real = realOf(p), root = realOf(REPO_ROOT);
  return real === root || real.startsWith(root + sep);
};
const inShm = (p: string) => resolve(p).startsWith(SHM + sep);

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
export function unsealTo(sealed: string, dir: string, decrypt: Decrypter): string {
  if (!inShm(dir)) throw new AuthorError("E_OHR_CUSTODY", dir + " is not under " + SHM + "; sealed briefs are decrypted only into memory-backed storage");
  if (existsSync(dir)) throw new AuthorError("E_OHR_CUSTODY", dir + " already exists");
  decrypt(sealed, dir);
  return dir;
}

/** Writes the placed briefs in types.ts's layout, every draft's outcome and the summary under an open sink; returns the summary. */
export function writeAuthoring(sink: string, run: AuthorRun) {
  const slots = new Map(schedule().map((s) => [s.slot, s]));
  const byId = new Map(run.outcomes.filter((x) => x.status === "pass").map((x) => [x.id, x]));
  for (const set of ["calibration", "comparison", "reserve"] as const) {
    for (const m of run.sets[set]) {
      const x = byId.get(m.id)!, f = x.files!, dir = join("briefs", m.id);
      writeSealed(sink, join(dir, "opening.md"), f.opening);
      writeSealed(sink, join(dir, "sheet.json"), sheetJson(f.sheet));
      writeSealed(sink, join(dir, "key.json"), keyJson(f.key));
      writeSealed(sink, join(dir, "brief.json"), keyJson(metaOf(slots.get(x.slot)!, x)));
      if (f.prior) writeSealed(sink, join(dir, "prior.json"), priorJson(f.prior));
    }
  }
  writeSealed(sink, "authoring/outcomes.jsonl", run.outcomes.map((x) => JSON.stringify(x)).join("\n") + "\n");
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
