// Copyright (c) 2026 Garry Tan. MIT License.
// sm sample, the build's open-point sample (decides nothing frozen): on a few units from before the post's window, how
// many images take the runtime layer and pass the smoke, and how long one base-tree run of the unit's own rebuild and test
// commands takes, in the root and the hardened container modes. Appends one JSON line per unit to out.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { smoke, prepare, pull, type Pacer } from "./oracle.ts";
import { manifestSize, type Candidate, type MlRow } from "./source.ts";
import { applyPatches, copyVolume, dropVolume, passed, runParser, runTests, type Mode } from "./testrun.ts";
import { readUnit, saveUnit, writeUnit } from "./unit.ts";

export async function sample(o: { candidates: Candidate[]; cache: string; units: string; ids: string[]; pacer: Pacer; out: string; row: (id: string) => MlRow }): Promise<void> {
  for (const id of o.ids) {
    const rec: Record<string, unknown> = { id };
    const log = () => appendFileSync(o.out, JSON.stringify(rec) + "\n");
    try {
      const c = o.candidates.find((x) => x.id === id)!;
      Object.assign(rec, { lang: c.lang, month: c.month, repo: c.repo });
      const dir = join(o.units, id);
      if (!existsSync(dir)) writeUnit(dir, c, o.row(id));
      const u = readUnit(dir);
      rec.size_bytes = await manifestSize(c.docker_image, c.image_digest!, fetch, () => o.pacer.take());
      const t0 = Date.now();
      u.image.image_id = await pull(u.image.ref, o.pacer);
      rec.pull_ms = Date.now() - t0;
      try {
        const s = smoke(u.image.image_id, id);
        u.image.runtime_id = s.runtime_id;
        rec.layer = "ok";
        rec.smoke = s.verdict;
      } catch (e) {
        rec.layer = /runtime layer did not build/.test((e as Error).message) ? "failed" : "ok";
        rec.smoke = (e as Error).message.slice(0, 500);
        log();
        saveUnit(dir, u);
        continue;
      }
      const p = prepare(u, u.image.runtime_id!, readFileSync(join(dir, "fix.patch"), "utf8"), true);
      u.strip = { removed: p.removed };
      u.scope = p.scope;
      Object.assign(rec, { repo_dir: u.repo_dir, work_dir: u.work_dir, history: p.preflight, strip_removed: p.removed.length, scope: p.scope, leak_needles: p.leak.needles, leak_hits: p.leak.hits.length, leak_hit_dirs: [...new Set(p.leak.hits.map((h) => h.path.split("/").slice(0, 4).join("/")))] });
      saveUnit(dir, u);
      for (const mode of ["root", "hardened"] as Mode[]) {
        const copy = p.volume + "-sample-" + mode;
        copyVolume(u.image.runtime_id!, p.volume, copy, mode);
        try {
          const bad = applyPatches(u.image.runtime_id!, copy, u.repo_dir, [["test.patch", readFileSync(join(dir, "test.patch"), "utf8")]], mode);
          if (bad) {
            rec[mode] = { apply_failed: bad };
            continue;
          }
          const t = runTests({ image: u.image.runtime_id!, volume: copy, repoDir: u.repo_dir, workDir: u.work_dir, commands: u.commands, mode, label: id + "-" + mode });
          const r: Record<string, unknown> = { wall_s: Math.round(t.wall_ms / 1000), exit: t.exit, stopped: t.stopped };
          if (!t.stopped) {
            try {
              const parsed = runParser(readFileSync(join(dir, "parser.py"), "utf8"), t.log, id);
              const st = Object.values(parsed);
              Object.assign(r, { parsed: st.length, passed: st.filter((v) => v === "PASSED").length, statuses: [...new Set(st)], f2p_failing: u.tests.f2p.filter((x) => !passed(parsed, x)).length, f2p: u.tests.f2p.length, p2p_passing: u.tests.p2p.filter((x) => passed(parsed, x)).length, p2p: u.tests.p2p.length });
            } catch (e) {
              r.parser = (e as Error).message.slice(0, 300);
              r.tail = t.stderr_tail.slice(-600);
            }
          }
          rec[mode] = r;
        } finally {
          dropVolume(copy);
        }
      }
    } catch (e) {
      rec.error = (e as Error).message.slice(0, 600);
    }
    log();
  }
}
