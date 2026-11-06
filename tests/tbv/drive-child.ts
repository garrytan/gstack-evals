// Copyright (c) 2026 Garry Tan. MIT License.
// The child process the SIGKILL test kills: it drives a six-reading item whose fourth reading hangs on its report turn.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runItem, type DrivePlan } from "../../lanes/tbv/drive.ts";
import { fakeBuild, history, KEYS, shape, stub, text, TURNS } from "./drive-fixture.ts";

export const childPlan = (): DrivePlan => ({ item: process.argv[3] ?? "tbv-test", tasks: ["t1", "t2", "t3"].map((t) => history(t)), arms: ["none", "current"], models: ["opus"], passes: { opus: 1 }, turns: TURNS, shape: (a) => shape(a), splice: () => null, roundWorstMicros: 1 });
/** A stub seal script: a header line, then base64. Production uses age. */
export const sealCmd = (root: string) => "printf 'STUB-SEALED\\n'; base64 -w0";
export const unsealCmd = (root: string) => "tail -n +2 | base64 -d";

if (import.meta.main) {
  const root = process.argv[2]!;
  const item = process.argv[3]!;
  const s = stub(async (c) => {
    if (c.task === "t2" && c.arm === "current") {
      writeFileSync(join(root, "hung"), "");
      return new Promise<Response>(() => {});
    }
    return text();
  });
  await runItem({ item, runId: "run-crash", record: join(root, "record"), ledger: join(root, "ledger.sqlite"), out: join(root, "out"), env: KEYS, fetch: s.fetch, plan: { ...childPlan(), item }, plaintext: join(root, "plain"), sealCmd: sealCmd(root), unsealCmd: unsealCmd(root), devPlaintext: false, held: false, mounts: "tmpfs " + root + " tmpfs rw 0 0\n", deps: { build: fakeBuild, validate: () => ({ ok: true }), closer: () => true }, log: (t) => console.error(t) });
}
