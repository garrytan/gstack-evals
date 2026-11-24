// Copyright (c) 2026 Garry Tan. MIT License.
// GEVA-583 prereg section 4's regression check, run before any paid call: replay the fixed exposure detector over the
// parent's 104 stage 2 cso transcripts (the GEVA-561 export) and require the correction post's counts (#444,
// recount.json: 40 of 52 on Opus, 52 of 52 on particle-1) with every run the frozen detector found still found.
// Run from the repository root: bun lanes/outcome-skills/cso/regress-exposure.ts <export>/stage2/sessions/stage2
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { csoExposure } from "./exposure.ts";

const WANT: Record<string, number> = { opus: 40, particle: 52 };

export function main(argv: string[]): number {
  const dir = argv[0];
  if (!dir || !existsSync(dir)) {
    console.error("E_USAGE regress-exposure needs the export's sessions/stage2 directory");
    return 2;
  }
  let ok = true;
  for (const model of Object.keys(WANT)) {
    const t = { sessions: 0, frozen_ran: 0, fixed_ran: 0, lost: [] as string[], added: [] as string[] };
    for (const unit of readdirSync(dir).sort()) {
      const f = join(dir, unit, "cso-" + model + "-0", "sdk-messages.jsonl");
      if (!existsSync(f)) continue;
      const recs = readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
      const a = csoExposure(recs).exposure, b = csoExposure(recs, [], { fixed: true }).exposure;
      t.sessions++;
      if (a.procedure_ran) t.frozen_ran++;
      if (b.procedure_ran) t.fixed_ran++;
      if ((a.procedure_ran && !b.procedure_ran) || (a.run_id !== null && a.run_id !== b.run_id)) t.lost.push(unit);
      if (b.procedure_ran && !a.procedure_ran) t.added.push(unit);
    }
    const pass = t.sessions === 52 && t.fixed_ran === WANT[model] && t.lost.length === 0;
    ok &&= pass;
    console.log(JSON.stringify({ model, pass, want: WANT[model] + "/52", ...t }));
  }
  return ok ? 0 : 1;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
