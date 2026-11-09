// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals outcome sm <sub>: the state machines family's commands. P1 builds source, screen, convert, draw, oracle,
// size and sample; later packages add their own.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CODES, docAnchor, isReasonCode } from "../../../src/errors/codes.ts";
import { draw, fill, readPrereg, type Draw, type DrawUnit } from "./draw.ts";
import { oracleUnit, Pacer } from "./oracle.ts";
import { sample } from "./sample.ts";
import { screen } from "./screen.ts";
import { fetchMultiLang, manifestSize, pinCandidates, readRows, splitCandidates, type Candidate } from "./source.ts";
import { readUnit, writeUnit } from "./unit.ts";

export const HELP = `gstack-evals outcome sm <command>
  source fetch --cache <dir>                         download the pinned MultiLang parquet files and check their sha256
  source pin --cache <dir> --out <candidates.json>   every row to a candidate, images pinned by linux/amd64 digest
  source split <candidates.json> --cache <dir> --out <file>   the in-source test split (base files from GitHub raw)
  screen <candidates.json> --out <file>              keyless eligibility, each drop with E_SM_INELIGIBLE and its rule
  convert <candidates.json> --cache <dir> --id <id> --out <unit dir>
  draw <units.json> --prereg <prereg.json> --out <file>   seeded orders; units.json is [{id, repo, month, stratum}]
  oracle <draw.json> --units <dir> --candidates <file> --cache <dir> --pull-log <file> [--pulls-per-hour 60] [--retry]
  size <candidates.json> --ids <a,b> --pull-log <file>    compressed image sizes by manifest GET (paced)
  sample <candidates.json> --cache <dir> --units <dir> --ids <a,b> --pull-log <file> --out <file>
Guide: lanes/outcome-skills/statemachines/README.md`;

function say(e: unknown): number {
  const m = (e as Error).message;
  const code = m.split(" ")[0]!;
  if (isReasonCode(code)) {
    console.error(m.split("\n").map((l) => (l.startsWith(code) ? l : code + " " + l)).join("\n"));
    console.error(code + " fix: " + CODES[code].fix + "\n" + code + " docs: " + docAnchor(code));
    return CODES[code].exit ?? 1;
  }
  console.error("E_USAGE " + m);
  return 2;
}

function flags(argv: string[], allowed: string[], bools: string[] = []): { pos: string[]; f: Map<string, string> } {
  const f = new Map<string, string>(), pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (bools.includes(a)) f.set(a, "1");
    else if (a.startsWith("--")) {
      if (!allowed.includes(a) || argv[i + 1] === undefined) throw new Error("E_USAGE " + a + (allowed.includes(a) ? " needs a value" : " is not a flag of this command"));
      f.set(a, argv[++i]!);
    } else pos.push(a);
  }
  return { pos, f };
}
const need = (f: Map<string, string>, k: string) => f.get(k) ?? (() => { throw new Error("E_USAGE " + k + " is required"); })();
const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;
const writeNew = (p: string, v: unknown) => writeFileSync(p, JSON.stringify(v, null, 1) + "\n", { flag: "wx" });
const loadCands = (p: string) => readJson<{ schema: string; candidates: Candidate[] }>(p).candidates;
function rowOf(cache: string, id: string) {
  const r = readRows(cache).find((x) => x.row.instance_id === id);
  if (!r) throw new Error("E_SM_SOURCE no row " + id + " in the cached revision");
  return r.row;
}

export async function main(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv;
  try {
    if (sub === undefined || sub === "--help" || sub === "-h") {
      console.log(HELP);
      return sub === undefined ? 2 : 0;
    }
    if (sub === "source") {
      const [what, ...r] = rest;
      if (what === "split") {
        const { pos, f } = flags(r, ["--cache", "--out"]);
        const c = await splitCandidates(need(f, "--cache"), loadCands(pos[0] ?? need(f, "<candidates>")));
        writeNew(need(f, "--out"), { schema: "sm-candidates.v1", rows: c.length, candidates: c });
        const sp = c.filter((x) => x.split);
        console.log("split=" + sp.length + " in_source=" + sp.filter((x) => x.split && "test_hunks" in x.split && x.split.test_hunks > 0).length + " mixed=" + sp.filter((x) => x.split && "mixed" in x.split && x.split.mixed > 0).length + " errors=" + sp.filter((x) => x.split && "error" in x.split).length);
        return 0;
      }
      const { f } = flags(r, ["--cache", "--out"]);
      await fetchMultiLang(need(f, "--cache"));
      if (what === "fetch") return 0;
      if (what !== "pin") throw new Error("E_USAGE sm source takes fetch, pin or split");
      const c = await pinCandidates(need(f, "--cache"));
      writeNew(need(f, "--out"), { schema: "sm-candidates.v1", rows: c.length, candidates: c });
      console.log("candidates=" + c.length + " pinned=" + c.filter((x) => x.image_digest).length);
      return 0;
    }
    if (sub === "screen") {
      const { pos, f } = flags(rest, ["--out"]);
      const s = screen(loadCands(pos[0] ?? need(f, "<candidates>")));
      writeNew(need(f, "--out"), s);
      console.log("eligible=" + s.eligible.length + " " + Object.entries(s.by_rule).map(([k, v]) => k + "=" + v).join(" ") + " mixed_by_lang=" + JSON.stringify(s.mixed_by_lang));
      return 0;
    }
    if (sub === "convert") {
      const { pos, f } = flags(rest, ["--cache", "--id", "--out"]);
      const id = need(f, "--id");
      const c = loadCands(pos[0]!).find((x) => x.id === id);
      if (!c) throw new Error("E_USAGE no candidate " + id);
      const u = writeUnit(need(f, "--out"), c, rowOf(need(f, "--cache"), id));
      console.log("unit=" + u.id + " image=" + u.image.ref);
      return 0;
    }
    if (sub === "draw") {
      const { pos, f } = flags(rest, ["--prereg", "--out"]);
      const { draw_seed } = readPrereg(need(f, "--prereg"));
      const d = draw(readJson<DrawUnit[]>(pos[0]!), draw_seed);
      writeNew(need(f, "--out"), d);
      console.log("admission=" + d.admission.length + " state=" + d.state.length + " other=" + d.other.length);
      return 0;
    }
    if (sub === "oracle") {
      const { pos, f } = flags(rest, ["--units", "--candidates", "--cache", "--pull-log", "--pulls-per-hour"], ["--retry"]);
      const d = readJson<Draw>(pos[0]!);
      const units = need(f, "--units"), cands = loadCands(need(f, "--candidates")), cache = need(f, "--cache");
      const pacer = new Pacer(need(f, "--pull-log"), Number(f.get("--pulls-per-hour") ?? 60));
      mkdirSync(units, { recursive: true });
      const res = await fill(d, async (id) => {
        const dir = join(units, id);
        if (!existsSync(dir)) writeUnit(dir, cands.find((c) => c.id === id)!, rowOf(cache, id));
        const prior = readUnit(dir).oracle?.verdict;
        const v = prior && prior !== "running" ? { id, verdict: prior, detail: "recorded" } : await oracleUnit(dir, pacer);
        console.log("ORACLE " + id + " " + v.verdict + " " + v.detail.replace(/\n/g, " ").slice(0, 300));
        return v.verdict === "kept";
      }, { retry: f.has("--retry") });
      writeFileSync(join(units, "fill.json"), JSON.stringify(res, null, 1) + "\n");
      console.log("admission=" + res.admission.length + " state=" + res.state.length + " other=" + res.other.length + " reserve=" + res.reserve.length + " retry=" + res.retry.length);
      return 0;
    }
    if (sub === "size") {
      const { pos, f } = flags(rest, ["--ids", "--pull-log"]);
      const cands = loadCands(pos[0]!), pacer = new Pacer(need(f, "--pull-log"));
      for (const id of need(f, "--ids").split(",")) {
        const c = cands.find((x) => x.id === id);
        if (!c?.image_digest) continue;
        console.log("SIZE " + id + " " + (await manifestSize(c.docker_image, c.image_digest, fetch, () => pacer.take())));
      }
      return 0;
    }
    if (sub === "sample") {
      const { pos, f } = flags(rest, ["--cache", "--units", "--ids", "--pull-log", "--out"]);
      await sample({ candidates: loadCands(pos[0]!), cache: need(f, "--cache"), units: need(f, "--units"), ids: need(f, "--ids").split(","), pacer: new Pacer(need(f, "--pull-log")), out: need(f, "--out"), row: (id) => rowOf(need(f, "--cache"), id) });
      return 0;
    }
    throw new Error("E_USAGE unknown sm command " + JSON.stringify(sub) + "; gstack-evals outcome sm --help lists them");
  } catch (e) {
    return say(e);
  }
}
