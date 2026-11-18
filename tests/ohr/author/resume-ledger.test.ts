// Copyright (c) 2026 Garry Tan. MIT License.
// Value: protects=the second attempt's resume after its meter dir is lost (section 5.2) through the real wire, meter and metering proxy on a temporary ledger: a run killed between a draft's sealed record and its batch's checkpoint, its meter dir deleted, continues its run id on the same ledger item at another concurrency; fails_when=a sealed draft is requested again, the ledger item passes its cap, the resumed run's committed spend differs from the ledger's, or the projection's scale is not rebuilt from the sealed records' per-draft spend.
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readJournal, sealedJournal } from "../../../lanes/office-hours-rewrite/author/custody.ts";
import { answersOf, fakeDecrypter, fakeMeter, fakeSealer, FIXTURE_SCREEN, fixtureParser, meteredScript, plantedFails, plantedFirstAttempt, providerStub, runCaller, wordLabeller } from "../../../lanes/office-hours-rewrite/author/fixtures.ts";
import { predicted } from "../../../lanes/office-hours-rewrite/author/pilot.ts";
import { authorRun, type AuthorRun, type Reuse } from "../../../lanes/office-hours-rewrite/author/run.ts";
import { CAPS } from "../../../lanes/office-hours-rewrite/frozen.ts";
import { openWire } from "../../../lanes/office-hours-rewrite/wire.ts";
import { recordApproval } from "../../../src/runner/ledger/ledger.ts";
import { readItem } from "../../../src/runner/ledger/record.ts";
import { STUB_KEYS, type KilledRun } from "./killed-run.ts";

const D = 1_000_000;
const CAP = CAPS.authoring * D;
const made: string[] = [];
afterAll(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })));
const temp = (prefix: string) => (made.push(mkdtempSync(prefix)), made.at(-1)!);
const refOf = (x: { id: string; attempt: number }) => x.id + (x.attempt > 1 ? "." + x.attempt : "");
const placedSet = (r: AuthorRun) => [...r.sets.calibration, ...r.sets.comparison, ...r.sets.reserve].map((m) => m.id + " " + m.digest).sort();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const drafts = (dir: string) => readdirSync(dir).filter((n) => n.startsWith("draft-")).length;

test("a run killed between a draft's sealed record and its batch's checkpoint, its meter dir deleted, resumes on its run id at concurrency 3: no sealed draft is requested again, the ledger item never passes its cap, and the run's committed spend is the ledger's", async () => {
  const placed = await plantedFirstAttempt();
  const reuse: Reuse = { placed, answers: answersOf(placed), failed: [] };
  const fake = fakeMeter(runCaller({ fails: plantedFails }));
  const unbroken = await authorRun({ call: fake.call, label: wordLabeller(), parse: fixtureParser, screen: FIXTURE_SCREEN, spent: fake.spent, spentOn: fake.spentOn }, { cap: CAPS.authoring, concurrency: 8, reuse });
  const hold = refOf(unbroken.outcomes[unbroken.reads[0]!.drafts + 20]!);

  const root = temp(join(tmpdir(), "ohr-resume-")), shm = temp("/dev/shm/ohr-resume-");
  const o: KilledRun = { record: join(root, "record"), ledger: join(root, "ledger.sqlite"), item: "ohr-resume-test", meter: join(shm, "meter-1"), checkpoints: join(root, "checkpoints"), work: join(shm, "w1"), hold, held: join(root, "held") };
  recordApproval(o.record, { action: "init", item: o.item, cap_micros: CAP, quotes: [{ words: "resume test on a temporary ledger, not an approval", by: "tests/ohr/author/resume-ledger.test.ts", source: "section 5.2" }], admission: "warn" });
  mkdirSync(o.checkpoints);
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "killed-run.ts"), JSON.stringify(o)], { env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR }, stdout: "ignore", stderr: "pipe" });
  for (let t = 0; !existsSync(o.held); t++) {
    if (child.exitCode !== null || t > 1200) throw new Error("the killed run never reached the held draft: " + (await new Response(child.stderr).text()));
    await sleep(50);
  }
  for (let n = -1; n !== drafts(o.checkpoints); ) (n = drafts(o.checkpoints)), await sleep(1000);
  child.kill("SIGKILL");
  await child.exited;

  const names = readdirSync(o.checkpoints);
  const records = drafts(o.checkpoints);
  const newest = names.filter((n) => n.startsWith("checkpoint-")).sort().at(-1)!;
  expect(records).toBeGreaterThan(Number(/(\d{6})/.exec(newest)![1]));
  const runId = (JSON.parse(readFileSync(join(o.checkpoints, "run.json"), "utf8")) as { run_id: string }).run_id;
  const dead = readItem(o.record, o.item);
  expect(dead.open?.run_id).toBe(runId);
  expect(dead.committed_micros).toBe(CAP);
  rmSync(o.meter, { recursive: true, force: true });

  const resumed = readJournal(join(o.checkpoints, newest), fakeDecrypter, join(shm, "open"), o.item);
  expect(resumed.run_id).toBe(runId);
  expect(resumed.log).toHaveLength(records);
  const sealedRefs = new Set(resumed.log.map(refOf));
  expect(sealedRefs.has(hold)).toBe(false);

  const w = await openWire({ dir: join(shm, "meter-2"), item: o.item, capMicros: CAP, label: "ohr-author", runId: resumed.run_id, record: o.record, ledger: o.ledger, env: STUB_KEYS, io: { out: () => {}, err: () => {} }, upstream: providerStub() });
  expect(w.runId).toBe(runId);
  const opened = readItem(o.record, o.item);
  const close = opened.leases.find((l) => l.lease.lease_id === dead.open!.lease_id)!.close!;
  expect(close.how).toBe("settled");
  const earlier = close.spent_micros + close.unknown_micros;
  expect(close.unknown_calls).toBeGreaterThanOrEqual(1);
  expect(opened.open!.reserved_micros).toBe(CAP - earlier);
  expect(opened.committed_micros).toBe(CAP);
  expect(Math.round(w.spent() * D)).toBe(earlier);
  expect(Math.round(resumed.log.reduce((t, x) => t + x.spend, 0) * D)).toBeLessThanOrEqual(earlier);

  let peak = 0;
  const spent = () => {
    peak = Math.max(peak, readItem(o.record, o.item).committed_micros, Math.round(w.spent() * D));
    return w.spent();
  };
  const script = runCaller({ fails: plantedFails });
  const journal = sealedJournal({ dir: o.checkpoints, work: join(shm, "w2"), sealer: fakeSealer, runId: w.runId, item: o.item });
  const r = await authorRun({ call: meteredScript(w.call, script), label: wordLabeller(), parse: fixtureParser, screen: FIXTURE_SCREEN, spent, spentOn: w.spentOn }, { cap: CAPS.authoring, concurrency: 3, resume: resumed, journal });
  const committed = w.spent();
  await w.close("resume test");
  const end = readItem(o.record, o.item);

  const asked = script.calls.filter((c) => /:author:1$/.test(c.label)).map((c) => c.label.split(":")[0]!);
  expect(asked.filter((ref) => sealedRefs.has(ref))).toEqual([]);
  expect(asked).toContain(hold);
  expect(r.stopped).toBe("quotas");
  expect(placedSet(r)).toEqual(placedSet(unbroken));
  expect(peak).toBeLessThanOrEqual(CAP);
  expect(end.open).toBeNull();
  expect(end.committed_micros).toBeLessThanOrEqual(CAP);
  expect(Math.round(committed * D)).toBe(end.committed_micros);
  expect((JSON.parse(readFileSync(join(shm, "meter-2", "run.json"), "utf8")) as { spent_micros: number }).spent_micros).toBe(end.committed_micros);

  const read = r.reads[resumed.reads.length]!;
  const upTo = r.outcomes.slice(0, read.drafts);
  expect(read.drafts - resumed.log.length).toBeOneOf([1, 2, 3]);
  expect(r.outcomes.slice(0, resumed.log.length)).toEqual(resumed.log);
  expect(resumed.log.reduce((t, x) => t + x.spend, 0)).toBeGreaterThan(0);
  expect(read.scale).toBe(upTo.reduce((t, x) => t + x.spend, 0) / upTo.reduce((t, x) => t + predicted(x.role), 0));
  expect(Math.round(read.committed * D)).toBeGreaterThan(earlier);
  expect(readdirSync("/dev/shm").some((n) => n.includes(".open-"))).toBe(false);
}, 180_000);
