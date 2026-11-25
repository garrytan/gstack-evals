// Copyright (c) 2026 Garry Tan. MIT License.
// SR's units (plan section 2). The pool is the 48 known state-bug fixes from the pstack-checks and state machines prompt
// evals (the 7 SWE-rebench leaderboard ones need a Harbor export and are left out), the state machines eval's labelled
// state-shaped MultiLang rows, and SWE-rebench V2.1's keyword-screened rows (all years, at most 3 a repository in id
// order). Each pool row goes
// through SZZ and the git-level gates on a full host clone (bic.ts); a row that passes becomes an sm-unit.v1 dir at the
// fix's base, as the state machines harness converts it, so its oracle, prep and scoring run unchanged. pr.patch is the
// change under review (the BIC's hunks re-based onto the fix's base) and bic.json the gate record. Nothing here calls a
// model.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Lang } from "../statemachines/langs.ts";
import { REBENCH, rebenchPool, rebenchRowById } from "../statemachines/rebench.ts";
import { MULTILANG, pinDigest, readRows, toCandidate, type Candidate, type MlRow } from "../statemachines/source.ts";
import { addUnitFile, saveUnit, writeUnit, type SmUnit } from "../statemachines/unit.ts";
import { findBic, type BicRecord } from "./bic.ts";
import { srFail } from "./errors.ts";
import { screened, toolCheckout, V21, V21_LANG, v21Row, v21Rows, type V21Row } from "./v21.ts";

/** The known units: MultiLang rows the pstack-checks eval (#358) scored, and the SWE-rebench leaderboard rows the state
 *  machines prompt eval (#360) scored, frozen by id. */
export const KNOWN_ML = ["Automattic__mongoose-15534", "Azure__azure-mcp-604", "CleverRaven__Cataclysm-DDA-86096", "MudBlazor__MudBlazor-12775", "MudBlazor__MudBlazor-12915", "MudBlazor__MudBlazor-13097", "MudBlazor__MudBlazor-13109", "TecharoHQ__anubis-881", "actor-framework__actor-framework-2300", "bpg__terraform-provider-proxmox-2122", "c-ares__c-ares-1197", "chenhg5__cc-connect-567", "gastownhall__beads-2992", "getgauge__gauge-2836", "gitbutlerapp__gitbutler-14920", "go-task__task-2716", "go-vikunja__vikunja-2574", "google__starlark-go-599", "gui-cs__Terminal.Gui-4841", "gui-cs__Terminal.Gui-4860", "gui-cs__Terminal.Gui-4882", "gui-cs__Terminal.Gui-4982", "h4ckf0r0day__obscura-413", "jhlywa__chess.js-546", "jtroo__kanata-1681", "linebender__vello-1132", "monkeytypegame__monkeytype-6830", "mui__base-ui-2591", "ninja-build__ninja-2749", "notify-rs__notify-701", "openai__codex-plugin-cc-83", "openai__openai-agents-js-156", "openai__openai-agents-js-205", "openai__openai-agents-js-318", "quartznet__quartznet-2934", "quartznet__quartznet-2955", "react-hook-form__react-hook-form-12990", "siimon__prom-client-679", "sveltejs__svelte-16570", "sveltejs__svelte-16619", "sveltejs__svelte-18039"];
export const KNOWN_RB = ["agronholm__anyio-1121", "oemof__tespy-921", "pipecat-ai__pipecat-4283", "pyinfra-dev__pyinfra-1665", "python-wheel-build__fromager-1106", "raullenchai__rapid-mlx-289", "zauberzeug__nicegui-5914"];
/** MultiLang rows the state machines prompt eval's two labellers both marked a defect and state-shaped (GEVA-520's records,
 *  read back by sr labels sm), other than the known units, frozen by id. */
export const SM_STATE_ML = ["AvaloniaUI__Avalonia-20964", "CleverRaven__Cataclysm-DDA-86316", "CleverRaven__Cataclysm-DDA-86525", "JasperFx__wolverine-3162", "JasperFx__wolverine-3513", "JasperFx__wolverine-3523", "JasperFx__wolverine-3695", "MudBlazor__MudBlazor-12918", "NVIDIA__OpenShell-810", "NVIDIA__gpu-operator-2258", "OSGeo__gdal-14631", "OpenRCT2__OpenRCT2-26315", "SubtitleEdit__subtitleedit-12895", "TrenchBroom__TrenchBroom-5133", "apache__parquet-java-3638", "apache__rocketmq-10614", "can1357__oh-my-pi-489", "canonical__multipass-4808", "dragonflydb__dragonfly-7777", "duckdb__duckdb-23569", "duckdb__duckdb-23634", "duckdb__duckdb-24181", "duckdb__duckdb-24211", "duckdb__ducklake-1339", "duckdb__ducklake-1340", "elsa-workflows__elsa-core-7898", "floci-io__floci-1931", "floci-io__floci-299", "fluent__fluent-bit-12029", "gleam-lang__gleam-5493", "gohugoio__hugo-14685", "gohugoio__hugo-14741", "gsd-build__gsd-2-4400", "h4ckf0r0day__obscura-414", "haraka__Haraka-3535", "kubernetes-sigs__kueue-9866", "kvcache-ai__Mooncake-2964", "langchain4j__langchain4j-5757", "langchain4j__langchain4j-5850", "magefree__mage-14755", "ml-explore__mlx-3635", "oxc-project__oxc-21546", "pocoproject__poco-5270", "prefix-dev__pixi-6529", "quartznet__quartznet-2942", "ruffle-rs__ruffle-23197", "ruffle-rs__ruffle-23330", "rust-lang__rust-analyzer-22822", "rust-lang__rust-bindgen-3382", "saghul__txiki.js-881", "shader-slang__slang-10664", "tursodatabase__turso-8102", "xroche__httrack-422", "xroche__httrack-428", "xroche__httrack-482", "xroche__httrack-522", "xroche__httrack-560", "xroche__httrack-584", "xroche__httrack-763", "xroche__httrack-765", "xroche__httrack-784", "xroche__httrack-809", "xroche__httrack-810", "xroche__httrack-817", "xroche__httrack-830", "xroche__httrack-849", "xroche__httrack-851"];
export const PER_REPO = 3;

export type PoolSource = "live-multilang" | "rebench-r3a4" | "swe-rebench-v21";
export interface PoolRow { id: string; source: PoolSource; repo: string; lang: Lang; created_at: string; row_sha256: string; image: string; image_digest: string | null }
export interface Pool { schema: "sr-pool.v1"; multilang: string; v21: string; rows: PoolRow[] }

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Where each source's rows are read from. */
export interface Sources { cache: string; export?: string; v21: string; tool: string }

/** A reader of pool rows' dataset rows: each source is read once, and each row is checked against the pool's digest (for
 *  V2.1, the digest of the published row, before the converter's row shape). */
export function rowReader(s: Sources): (p: PoolRow) => MlRow {
  let ml: Map<string, MlRow> | null = null, v21: Map<string, V21Row> | null = null, tool: string | null = null;
  return (p) => {
    let row: MlRow, digest: string;
    if (p.source === "live-multilang") {
      ml ??= new Map(readRows(s.cache).map((x) => [x.row.instance_id, x.row]));
      row = ml.get(p.id) ?? srFail("E_SR_SOURCE", "no MultiLang row " + p.id);
      digest = sha(JSON.stringify(row));
    } else if (p.source === "rebench-r3a4") {
      row = rebenchRowById(s.export ?? srFail("E_SR_SOURCE", p.id + " needs --export, the SWE-rebench leaderboard's Harbor packages"), p.id);
      digest = sha(JSON.stringify(row));
    } else {
      v21 ??= new Map(v21Rows(s.v21).map((x) => [String(x.instance_id), x]));
      const raw = v21.get(p.id) ?? srFail("E_SR_SOURCE", "no V2.1 row " + p.id);
      digest = sha(JSON.stringify(raw));
      tool ??= toolCheckout(s.tool);
      row = v21Row(raw, tool);
    }
    if (digest !== p.row_sha256) srFail("E_SR_SOURCE", p.id + ": the row is not the one the pool recorded");
    return row;
  };
}

/** The pool: the known rows, then V2.1's screened rows (V2.1 rows that are known units are left out), capped per repo. */
export function buildPool(s: Sources): Pool {
  const rows: PoolRow[] = [];
  const ml = new Map(readRows(s.cache).map((x) => [x.row.instance_id, x]));
  for (const id of [...KNOWN_ML, ...SM_STATE_ML]) {
    const x = ml.get(id) ?? srFail("E_SR_SOURCE", "unit " + id + " is not in the cached MultiLang revision");
    rows.push({ id, source: "live-multilang", repo: x.row.repo, lang: x.lang, created_at: String(x.row.created_at), row_sha256: sha(JSON.stringify(x.row)), image: x.row.docker_image, image_digest: null });
  }
  if (s.export) {
    const pool = new Map(rebenchPool().map((t) => [t.task_id, t]));
    for (const id of KNOWN_RB) {
      const t = pool.get(id) ?? srFail("E_SR_SOURCE", "known unit " + id + " is not in the pinned SWE-rebench pool");
      const row = rebenchRowById(s.export, id);
      rows.push({ id, source: "rebench-r3a4", repo: row.repo, lang: "python", created_at: String(row.created_at), row_sha256: sha(JSON.stringify(row)), image: t.image, image_digest: t.image_digest });
    }
  }
  const known = new Set([...KNOWN_ML, ...SM_STATE_ML, ...KNOWN_RB]);
  const per = new Map<string, number>();
  for (const r of v21Rows(s.v21).filter((x) => !known.has(x.instance_id) && V21_LANG[x.language] && screened(x)).sort((a, b) => (a.instance_id < b.instance_id ? -1 : 1))) {
    if ((per.get(r.repo) ?? 0) >= PER_REPO) continue;
    per.set(r.repo, (per.get(r.repo) ?? 0) + 1);
    const m = String(r.image_name).match(/^(?:docker\.io\/)?([^@]+)@(sha256:[0-9a-f]{64})$/) ?? srFail("E_SR_SOURCE", r.instance_id + ": image_name " + r.image_name + " is not pinned by digest");
    rows.push({ id: r.instance_id, source: "swe-rebench-v21", repo: r.repo, lang: V21_LANG[r.language]!, created_at: String(r.created_at), row_sha256: sha(JSON.stringify(r)), image: m[1]!, image_digest: m[2]! });
  }
  return { schema: "sr-pool.v1", multilang: MULTILANG.revision, v21: V21.revision, rows: rows.sort(byId) };
}

/** A full clone of the repo under clones (owner__name), made when missing and fetched when it lacks the commit. */
export function cloneFor(clones: string, repo: string, commit: string): string {
  const dir = join(clones, repo.replace("/", "__"));
  const git = (args: string[]) => spawnSync("git", args, { encoding: "utf8", timeout: 3_600_000 });
  if (!existsSync(join(dir, ".git")) && !existsSync(join(dir, "HEAD"))) {
    mkdirSync(clones, { recursive: true });
    let c = git(["clone", "--quiet", "--no-checkout", "https://github.com/" + repo + ".git", dir]);
    for (let k = 1; k < 3 && c.status !== 0; k++) {
      rmSync(dir, { recursive: true, force: true });
      c = git(["clone", "--quiet", "--no-checkout", "https://github.com/" + repo + ".git", dir]);
    }
    if (c.status !== 0) srFail("E_SR_SOURCE", "cloning " + repo + " failed: " + (c.stderr ?? "").slice(-300));
  }
  if (git(["-C", dir, "cat-file", "-e", commit + "^{commit}"]).status !== 0) git(["-C", dir, "fetch", "--quiet", "origin", commit]);
  if (git(["-C", dir, "cat-file", "-e", commit + "^{commit}"]).status !== 0) srFail("E_SR_SOURCE", repo + " has no commit " + commit);
  return dir;
}

/** SZZ and the gates for every pool row, appended to out (a JSON line per row); a row already recorded is skipped. With
 *  prune, a repository's clone is deleted once its last row is recorded and none of its rows passed, to save disk. */
export function bicPool(pool: Pool, s: Sources, clones: string, out: string, log: (m: string) => void = () => {}, prune = false): BicRecord[] {
  const done = new Map<string, BicRecord>(existsSync(out) ? readFileSync(out, "utf8").split("\n").filter(Boolean).map((l) => [JSON.parse(l).id, JSON.parse(l)]) : []);
  const rowFor = rowReader(s);
  const left = new Map<string, number>();
  for (const p of pool.rows) if (!done.has(p.id)) left.set(p.repo, (left.get(p.repo) ?? 0) + 1);
  for (const p of pool.rows) {
    if (done.has(p.id)) continue;
    const row = rowFor(p);
    const b = findBic(cloneFor(clones, p.repo, row.base_commit), row, p.lang);
    writeFileSync(out, JSON.stringify(b.record) + "\n", { flag: "a" });
    done.set(p.id, b.record);
    log("BIC " + p.id + " " + (b.record.drop ?? "ok " + b.record.bic));
    left.set(p.repo, left.get(p.repo)! - 1);
    if (prune && left.get(p.repo) === 0 && pool.rows.every((q) => q.repo !== p.repo || done.get(q.id)?.drop)) rmSync(join(clones, p.repo.replace("/", "__")), { recursive: true, force: true });
  }
  return pool.rows.map((p) => done.get(p.id)!);
}

/** Writes one unit dir for a pool row that passed the gates: writeUnit on the dataset row, then pr.patch and bic.json. */
export async function convertUnit(dir: string, p: PoolRow, s: Sources, clones: string, fetchFn: typeof fetch = fetch): Promise<SmUnit> {
  const row = rowReader(s)(p);
  const b = findBic(cloneFor(clones, p.repo, row.base_commit), row, p.lang);
  if (b.record.drop) srFail(b.record.drop, p.id + " fails the BIC gates");
  const c: Candidate = { ...toCandidate(p.lang, row), source: p.source, revision: p.source === "swe-rebench-v21" ? V21.revision : p.source === "live-multilang" ? MULTILANG.revision : REBENCH.version, docker_image: p.image, image_digest: p.image_digest ?? (await pinDigest(p.image, fetchFn)) };
  const u = writeUnit(dir, c, row);
  addUnitFile(dir, u, "pr.patch", b.pr);
  addUnitFile(dir, u, "bic.json", JSON.stringify(b.record, null, 1) + "\n");
  saveUnit(dir, u);
  return u;
}
