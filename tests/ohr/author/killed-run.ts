// Copyright (c) 2026 Garry Tan. MIT License.
// The run resume-ledger.test.ts kills: authoring through the real wire, meter and metering proxy over a fake provider,
// on a temporary ledger, sealing to a checkpoints folder. The provider holds one draft's first request unanswered; when
// it arrives, this writes the held file and waits to be killed. Its environment carries no provider key.
import { writeFileSync } from "node:fs";
import { sealedJournal } from "../../../lanes/office-hours-rewrite/author/custody.ts";
import { answersOf, fakeSealer, FIXTURE_SCREEN, fixtureParser, meteredScript, plantedFails, plantedFirstAttempt, providerStub, runCaller, wordLabeller } from "../../../lanes/office-hours-rewrite/author/fixtures.ts";
import { authorRun } from "../../../lanes/office-hours-rewrite/author/run.ts";
import { CAPS } from "../../../lanes/office-hours-rewrite/frozen.ts";
import { openWire } from "../../../lanes/office-hours-rewrite/wire.ts";

export interface KilledRun {
  record: string;
  ledger: string;
  item: string;
  meter: string;
  checkpoints: string;
  work: string;
  /** The draft reference whose first request the provider holds. */
  hold: string;
  held: string;
}

export const STUB_KEYS = { OPENAI_API_KEY: "stub-not-a-key", ANTHROPIC_API_KEY: "stub-not-a-key", OPENROUTER_API_KEY: "stub-not-a-key" };

if (import.meta.main) {
  const o = JSON.parse(process.argv[2]!) as KilledRun;
  const placed = await plantedFirstAttempt();
  const marker = "Brief reference: " + o.hold + '."';
  const upstream = providerStub((body) => body.includes(marker) && (writeFileSync(o.held, o.hold + "\n"), true));
  const w = await openWire({ dir: o.meter, item: o.item, capMicros: CAPS.authoring * 1e6, label: "ohr-author", record: o.record, ledger: o.ledger, env: STUB_KEYS, io: { out: () => {}, err: (t) => process.stderr.write(t + "\n") }, upstream });
  await authorRun(
    { call: meteredScript(w.call, runCaller({ fails: plantedFails })), label: wordLabeller(), parse: fixtureParser, screen: FIXTURE_SCREEN, spent: w.spent, spentOn: w.spentOn },
    { cap: CAPS.authoring, concurrency: 8, reuse: { placed, answers: answersOf(placed), failed: [] }, journal: sealedJournal({ dir: o.checkpoints, work: o.work, sealer: fakeSealer, runId: w.runId, item: o.item }) },
  );
  process.stderr.write("the run finished without reaching the held draft\n");
  process.exit(3);
}
