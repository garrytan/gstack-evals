// Copyright (c) 2026 Garry Tan. MIT License.
// Decision-routing task directories (preregistration section 4, "Hidden tests"): each task of the pinned SWE-rebench pool
// (quick/laneb/tasks/swerebench-r3a4.json), read from the pinned Harbor's export of the Hub package, checked against its
// pool digest and written in Lane B's separate-verifier layout with no runtime stages, because the decision-routing agent
// installs its own runtime tarball (agent/dr_harbor.py). The controller's --tasks-dir is this command's --out.
//   tasks.ts --export <harbor export dir> --out <dir> --tasks <id,id,...>
import { join, resolve } from "node:path";
import { loadRebenchPool, materializeRebench, R3A4_POOL_FILE, R3A4_POOL_SHA256, type RebenchTask } from "../../../quick/laneb/runner/materialize.ts";

const POOL = join(import.meta.dir, "..", "..", "..", "quick", "laneb", R3A4_POOL_FILE);

export function materializeTasks(exportRoot: string, out: string, ids: string[], pool: RebenchTask[] = loadRebenchPool(POOL, R3A4_POOL_SHA256)) {
  const byId = new Map(pool.map((t) => [t.task_id, t]));
  return Object.fromEntries(
    ids.map((id) => {
      const task = byId.get(id);
      if (!task) throw new Error("E_USAGE: task " + id + " is not in the pinned SWE-rebench pool");
      return [id, materializeRebench(exportRoot, task, join(out, id), { runtimeStages: "", runtimeCopy: "", network: "allowlist" })];
    }),
  );
}

export async function main(argv: string[]): Promise<number> {
  const flag = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const [exportRoot, out, ids] = [flag("--export"), flag("--out"), flag("--tasks")];
  if (!exportRoot || !out || !ids) {
    console.error("E_USAGE usage: tasks.ts --export <harbor export dir> --out <dir> --tasks <id,id,...>");
    return 2;
  }
  try {
    console.log(JSON.stringify(materializeTasks(resolve(exportRoot), resolve(out), ids.split(",").filter(Boolean)), null, 2));
    return 0;
  } catch (e) {
    const m = (e as Error).message;
    console.error(/^E_[A-Z_]+: /.test(m) ? m : "E_USAGE: " + m);
    return 2;
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
