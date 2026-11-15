// Screen evidence: when EP_EVIDENCE names a directory, the planted-unit screen keeps each candidate's raw drop
// evidence there (run output, per-case grids, leak hits), so a drop can be audited later. It never changes an
// outcome: with EP_EVIDENCE unset it does nothing, and a failed write is reported on stdout, never thrown.
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dirFor = (id: string): string | null => {
  const root = process.env.EP_EVIDENCE;
  if (!root) return null;
  const d = join(root, id);
  mkdirSync(d, { recursive: true, mode: 0o700 });
  return d;
};

const report = (id: string, name: string, error: unknown) => process.stdout.write("evidence: " + id + " " + name + " not kept (" + String(error).slice(0, 200) + ")\n");

/** Writes one evidence file for a candidate: a string as is, anything else as JSON. */
export function keepEvidence(id: string, name: string, data: unknown): void {
  try {
    const d = dirFor(id);
    if (d) writeFileSync(join(d, name), typeof data === "string" ? data : JSON.stringify(data, null, 1) + "\n", { mode: 0o600 });
  } catch (error) {
    report(id, name, error);
  }
}

/** Copies a directory of run output for a candidate, when the directory exists. */
export function keepEvidenceDir(id: string, name: string, src: string): void {
  if (!existsSync(src)) return;
  try {
    const d = dirFor(id);
    if (d) cpSync(src, join(d, name), { recursive: true });
  } catch (error) {
    report(id, name, error);
  }
}
