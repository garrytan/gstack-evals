// l1.ts under L1's profile with a stand-in for a lane's section 13 attempt 2, for l1-host.test.ts. A cell owes attempt 2
// when its session closed with no successful response (fake-vm-run.ts's NO_RESPONSE_AT), and A2_SKIP names an item that
// takes none.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { l1Main, L1_PROFILE, relaunchRects, trialTasksFrom } from "../../../l1/l1.ts";

l1Main(Bun.argv.slice(2), {
  ...L1_PROFILE,
  attempt2: {
    skip: (item) => (item === process.env.A2_SKIP ? item + " takes no attempt 2 in this test" : null),
    owed: (runs) => {
      const owed = runs.flatMap((r) => {
        const tasks = trialTasksFrom(join(r.dir, "jobs")), f = join(r.dir, "out/proxy-sessions.jsonl");
        const rows = existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
        return rows.filter((s) => s.ok_responses === 0).map((s) => ({ task: tasks.get(s.trial.replace(/__env$/, ""))!, arm: String(s.meta.arm), reason: "no model response reached the agent" }));
      });
      return { owed, rects: relaunchRects(owed.map((c) => ({ task: c.task, arm: c.arm, replicates: 1 }))) };
    },
  },
});
