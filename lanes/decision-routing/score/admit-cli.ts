// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals decision-routing admit: room, transfer and the cut's ceiling from the calibration N sessions, and
// per-contrast discordance from the pilot (R and P from the pilot, N from calibration, on the pilot's tasks and both models).
//   admit --calibration <dir> --pilot <dir> --journal <file>... --prices <prices.json> [--out <admission.json>]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { discordance, roomCheck, s3Share, transferCheck, turnsOf, type Turn } from "./admission.ts";
import { callUsd, loadPrices, pairOnTasks, readJournal, readTrial, type SessionOutcome } from "./session.ts";
import { trialDirs } from "./cli.ts";

const flag = (argv: string[], name: string): string | undefined => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
const flags = (argv: string[], name: string): string[] => argv.flatMap((a, i) => (a === name && argv[i + 1] !== undefined ? [argv[i + 1]!] : []));

export async function main(argv: string[]): Promise<number> {
  const calibration = flag(argv, "--calibration"), pilot = flag(argv, "--pilot"), journals = flags(argv, "--journal"), prices = flag(argv, "--prices");
  if (!calibration || !pilot || !journals.length || !prices) { console.error("E_USAGE admit --calibration <dir> --pilot <dir> --journal <file>... --prices <prices.json> [--out <admission.json>]"); return 2; }
  const ctx = { calls: readJournal(journals), prices: loadPrices(prices) };
  const read = (root: string) => trialDirs(root).map((d) => readTrial(d, ctx));
  const cal = read(calibration), pil = read(pilot);
  const lines: string[] = [];
  const out: Record<string, any> = { room: {}, ceiling: {}, contrasts: {} };
  let stop = false;
  for (const model of ["opus", "sol"] as const) {
    const n = cal.filter((s) => s.model === model && s.cell === "N" && s.status === "graded");
    const rate = n.length ? n.filter((s) => s.success === 1).length / n.length : 0;
    const room = roomCheck(rate);
    out.room[model] = { ...room, graded: n.length };
    lines.push("room " + model + ": N passes " + (100 * rate).toFixed(1) + "% of " + n.length + " graded calibration sessions; " + (room.ok ? "inside 15% to 90%" : "DR_ADMISSION_STOP outside 15% to 90%: this model's items stop for the Captain before the pilot"));
    if (!room.ok) stop = true;
    if (model === "opus") {
      out.transfer = transferCheck(rate);
      lines.push("transfer opus: " + (out.transfer.ok ? "at or above 40%" : "DR_ADMISSION_STOP under 40%: the run stops for the Captain before the pilot"));
      if (!out.transfer.ok) stop = true;
    }
    const turns: Turn[] = [];
    let unaligned = 0;
    for (const s of n) {
      const traj = join(s.dir, "agent", "dr", "trajectory.json");
      const meter = JSON.parse(readFileSync(join(s.dir, "agent", "dr", "meter.json"), "utf8")).meter_id;
      const calls = (ctx.calls.get(meter) ?? []).filter((c) => c.status !== null && c.status >= 200 && c.status < 300).map((c) => callUsd(c, ctx.prices));
      const t = existsSync(traj) ? turnsOf(JSON.parse(readFileSync(traj, "utf8")), calls) : { turns: [], aligned: false };
      if (t.aligned) turns.push(...t.turns); else unaligned++;
    }
    const s3 = s3Share(turns);
    out.ceiling[model] = { ...s3, sessions: n.length - unaligned, unaligned };
    lines.push("ceiling " + model + ": " + (100 * s3.share).toFixed(1) + "% of N's dollars in turns that edit no file (" + Object.entries(s3.by_kind).map(([k, v]) => k + " " + (100 * v).toFixed(1) + "%").join(", ") + "); " + unaligned + " sessions not aligned to the journal" + (s3.holds_possible ? "" : "; under 80%, so HOLDS can't occur and the run says so in advance"));
  }
  const pilotTasks = new Set(pil.map((s) => s.task));
  const pairsOf = (a: SessionOutcome[], b: SessionOutcome[]) => (["opus", "sol"] as const).flatMap((model) => pairOnTasks(a.filter((s) => s.model === model && pilotTasks.has(s.task)), b.filter((s) => s.model === model)).map((p) => ({ task: p.task, model, a: p.a.success!, b: p.b.success! })));
  for (const [name, control, source] of [["R-N", "N", cal], ["R-P", "P", pil]] as const) {
    const pairs = pairsOf(source.filter((s) => s.cell === control), pil.filter((s) => s.cell === "R"));
    if (!pairs.length) { lines.push(name + ": no pilot pairs"); out.contrasts[name] = { admitted: false, n_pairs: 0 }; continue; }
    const d = discordance(pairs);
    out.contrasts[name] = d;
    lines.push(name + ": d " + d.d.toFixed(3) + " over " + d.n_pairs + " pairs on " + d.n_tasks + " tasks, 80% upper bound " + d.upper80.toFixed(3) + "; " + (d.admitted ? "non-inferiority admitted" : "above 0.20: no non-inferiority verdict; the Captain hears before the scored stage"));
  }
  console.log(lines.join("\n"));
  const file = flag(argv, "--out");
  if (file) writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  return stop ? 1 : 0;
}
