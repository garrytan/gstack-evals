// Copyright (c) 2026 Garry Tan. MIT License.
// Part B's commands. The h2h command table maps its rows here; each takes argv after the command name and returns the
// exit code. label-send is the one paid command: it sends the B1 label packets under h2h-labels (label-send.ts). Every refusal throws an H2hError whose message starts with its reason code.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Pacer } from "../../statemachines/oracle.ts";
import { readUnit } from "../../statemachines/unit.ts";
import type { SecondRead } from "../ordinary/frame.ts";
import { fetchTemplates, loadTemplates, readLicenceFilesGraphQl } from "../ordinary/licences.ts";
import { h2hFail, readPrereg } from "../prereg.ts";
import { B1_LICENCES_SCHEMA, mineB1, reposFile, screenRepos, searchRepos } from "./b1.ts";
import { cloneAdvisoryDb, mineB2 } from "./b2.ts";
import { browserCheck } from "./browser.ts";
import { readDiscovery } from "./discover.ts";
import { FREEZE_DATE, ghGql, licenceStatus, secondReadCounts, writeJson } from "./frame.ts";
import { sendLabels } from "./label-send.ts";
import { writePacket } from "./label.ts";
import { buildB, findCandidate, oracleB, prepareB, type BUnitExtra, type BuildRecord } from "./oracle-b.ts";
import type { ReportFormat } from "./parse.ts";
import type { TestRunner } from "./recipes.ts";
import { storeFrom } from "./store.ts";

const FLAGS: Record<string, { need: string[]; opt: string[]; bool?: string[] }> = {
  "mine-b2": { need: ["--db", "--work"], opt: ["--templates"], bool: ["--clone", "--read-licence-files"] },
  "mine-b1": { need: ["--work"], opt: ["--templates"], bool: ["--read-licence-files"] },
  "image-build": { need: ["--frame", "--id", "--work"], opt: ["--docker-host"] },
  "image-store": { need: ["--store", "--image"], opt: ["--docker-host"] },
  "oracle-b": { need: ["--frame", "--id", "--work", "--store", "--ref"], opt: ["--db", "--docker-host", "--pull-log"] },
  "browser-check": { need: ["--unit", "--discovery"], opt: [] },
  "label-packet": { need: ["--unit", "--out"], opt: [] },
  "label-send": { need: ["--run", "--units", "--out"], opt: ["--record", "--ledger", "--lift-halt"] },
};

export function flags(cmd: string, argv: readonly string[]): Map<string, string> {
  const spec = FLAGS[cmd]!;
  const m = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (spec.bool?.includes(a)) m.set(a, "1");
    else if (spec.need.includes(a) || spec.opt.includes(a)) {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) h2hFail("E_USAGE", cmd + ": " + a + " needs a value");
      m.set(a, v!);
    } else h2hFail("E_USAGE", cmd + ": unknown argument " + JSON.stringify(a) + "; takes " + [...spec.need, ...spec.opt, ...(spec.bool ?? [])].join(" "));
  }
  for (const k of spec.need) if (!m.has(k)) h2hFail("E_USAGE", cmd + ": " + k + " is required");
  return m;
}

const log = (s: string) => console.error(new Date().toISOString() + " " + s);
const host = (f: Map<string, string>) => (f.has("--docker-host") ? { docker_host: f.get("--docker-host")! } : {});
const line = (x: unknown) => console.log(JSON.stringify(x));

/** Section 5's second licence read, once, with part C's reader and classifier over the pending repositories; refused when
 *  the licence file already holds one. Templates are the pinned SPDX templates, fetched into dir when missing. */
async function readSecond(licPath: string, repos: string[], dir: string): Promise<SecondRead> {
  const prior = existsSync(licPath) ? (JSON.parse(readFileSync(licPath, "utf8")) as { second_read?: SecondRead }) : null;
  if (prior?.second_read) h2hFail("E_H2H_B_MINE", licPath + " already holds a second read from " + prior.second_read.read_at + "; it is read once");
  const p = readPrereg();
  await fetchTemplates(dir, p.licences);
  const s = readLicenceFilesGraphQl(repos, loadTemplates(dir, p.licences));
  log("second licence read: " + JSON.stringify(secondReadCounts(s)));
  return s;
}
const priorSecond = (licPath: string): SecondRead | undefined => (existsSync(licPath) ? JSON.parse(readFileSync(licPath, "utf8")).second_read : undefined);

export const commands: Record<string, (argv: string[]) => Promise<number>> = {
  async "mine-b2"(argv) {
    const f = flags("mine-b2", argv);
    const db = f.get("--db")!, work = f.get("--work")!;
    if (f.has("--clone")) cloneAdvisoryDb(db);
    if (!existsSync(join(db, "advisories"))) h2hFail("E_H2H_B_MINE", db + " holds no advisories; pass --clone to fetch the pinned database");
    const cache = join(work, "b2-licences-read.json");
    const read = existsSync(cache) ? JSON.parse(readFileSync(cache, "utf8")).repos : undefined;
    const licPath = join(work, "b2-licences.json");
    let second = priorSecond(licPath);
    if (f.has("--read-licence-files")) {
      const framePath = join(work, "b2-frame.json");
      if (!existsSync(framePath) || !existsSync(licPath)) h2hFail("E_H2H_B_MINE", "mine the B2 frame once before its second licence read; " + framePath + " or " + licPath + " is missing");
      const rows = JSON.parse(readFileSync(framePath, "utf8")).advisories as { repo: string; second_read_pending: boolean }[];
      second = await readSecond(licPath, [...new Set(rows.filter((r) => r.second_read_pending).map((r) => r.repo))], f.get("--templates") ?? join(work, "spdx-templates"));
      writeJson(licPath, { ...JSON.parse(readFileSync(licPath, "utf8")), second_read: second });
    }
    const { frame, licences } = await mineB2({ db, work, gql: ghGql({ log }), licences: read, second, log });
    if (!read) writeJson(cache, licences);
    writeJson(join(work, "b2-frame.json"), frame);
    writeJson(join(work, "b2-licences.json"), licences);
    line(frame.counts);
    return 0;
  },
  async "mine-b1"(argv) {
    const f = flags("mine-b1", argv);
    const work = f.get("--work")!;
    const gql = ghGql({ log, maxCost: 3 });
    const reposPath = join(work, "b1-repos.json");
    let repos = existsSync(reposPath) ? JSON.parse(readFileSync(reposPath, "utf8")) : undefined;
    if (!repos) {
      repos = reposFile(await searchRepos(gql, undefined, log));
      writeJson(reposPath, repos);
    }
    const licPath = join(work, "b1-licences.json");
    let second = priorSecond(licPath);
    if (f.has("--read-licence-files")) {
      const p = readPrereg();
      const pending = screenRepos(repos.repos, p).kept.filter((r) => licenceStatus(r.licence, p.licences) === "second_read_pending");
      second = await readSecond(licPath, pending.map((r) => r.repo), f.get("--templates") ?? join(work, "spdx-templates"));
      writeJson(licPath, { schema: B1_LICENCES_SCHEMA, freeze_date: FREEZE_DATE, read: "the licence b1-repos.json froze from the repository search (licenseInfo.spdxId); the second read covers every kept repository where it is null or NOASSERTION", repos: Object.fromEntries(pending.map((r) => [r.repo, { spdx: r.licence }])), second_read: second });
    }
    const { frame } = await mineB1({ gql, work, repos, second, log });
    writeJson(join(work, "b1-frame.json"), frame);
    line(frame.counts);
    return 0;
  },
  async "image-build"(argv) {
    const f = flags("image-build", argv);
    const r = buildB({ c: findCandidate(f.get("--frame")!, f.get("--id")!), work: f.get("--work")!, host: host(f) });
    line({ id: r.id, verdict: r.verdict, rule: r.rule, tag: r.tag, image_id: r.image_id });
    if (r.verdict === "built") return 0;
    console.error(r.verdict + " " + r.id + ": " + r.rule);
    return 2;
  },
  async "image-store"(argv) {
    const f = flags("image-store", argv);
    const s = storeFrom(f.get("--store")!, host(f)).push(f.get("--image")!);
    line(s);
    return 0;
  },
  async "oracle-b"(argv) {
    const f = flags("oracle-b", argv);
    const work = f.get("--work")!, id = f.get("--id")!;
    const c = findCandidate(f.get("--frame")!, id);
    const buildPath = join(work, "builds", id + ".json");
    if (!existsSync(buildPath)) h2hFail("E_H2H_B_BUILD", id + " has no build record at " + buildPath + "; run image-build first");
    const build: BuildRecord = JSON.parse(readFileSync(buildPath, "utf8"));
    const store = storeFrom(f.get("--store")!, host(f));
    const prep = await prepareB({ c, work, ref: f.get("--ref")!, store, build, host: host(f), gql: c.kind === "B1" ? ghGql({ log }) : undefined, db: f.get("--db") });
    if (prep.verdict !== "ready") {
      line({ id, stage: "prep", verdict: prep.verdict, rule: prep.rule });
      console.error(prep.verdict + " " + id + ": " + prep.rule);
      return 2;
    }
    const v = await oracleB(prep.unit_dir!, store, new Pacer(f.get("--pull-log") ?? join(work, "pull-pacer.log")));
    line({ stage: "oracle", ...v });
    return v.verdict === "kept" ? 0 : 2;
  },
  async "browser-check"(argv) {
    const f = flags("browser-check", argv);
    const u = readUnit(f.get("--unit")!) as ReturnType<typeof readUnit> & { h2h?: BUnitExtra };
    if (!u.h2h) h2hFail("E_H2H_B_BROWSER", f.get("--unit")! + " is not a B unit");
    const r = browserCheck({ runner: u.h2h!.runner as TestRunner, format: u.h2h!.format as ReportFormat, f2p: u.oracle?.f2p ?? u.tests.f2p, testFiles: u.test_patch.files, discovery: readDiscovery(readFileSync(f.get("--discovery")!, "utf8")) });
    line(r);
    if (r.ok) return 0;
    console.error("E_H2H_B_BROWSER " + u.id + ": " + r.rule);
    return 2;
  },
  async "label-packet"(argv) {
    const f = flags("label-packet", argv);
    line({ unit: f.get("--unit"), out: f.get("--out"), sha256: writePacket(f.get("--unit")!, f.get("--out")!) });
    return 0;
  },
  async "label-send"(argv) {
    const f = flags("label-send", argv);
    const s = await sendLabels({ run_id: f.get("--run")!, units: f.get("--units")!, out: f.get("--out")!, record: f.get("--record"), ledger: f.get("--ledger"), lift_halts: f.get("--lift-halt")?.split(",").filter(Boolean) });
    log("label-send item=" + s.item + " run=" + s.run_id + " lease=" + (s.lease_id ?? "none") + " sent=" + s.sent + " " + Object.entries(s.counts).map(([k, v]) => k + "=" + v).join(" ") + " spent_micros=" + s.spent_micros + " unknown_micros=" + s.unknown_micros + " replies=" + s.replies);
    return 0;
  },
};
