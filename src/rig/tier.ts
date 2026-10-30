// The Docker tier (CI plan v5, U20): stage m1b of gate/manifest.json. gstack-evals rig tier runs it with no credential in
// the env, reads its JUnit report, and writes rig-tier.json: the commit, tree and recipe hash it tested, and its verdict. The
// tier is GREEN only when the tests exit 0, every expected case in the stage passes and no case in the report was skipped,
// so a Docker test that silently skips makes the tier red. rig.yml runs it, annotates the job with the record's summary
// (title gstack-evals-rig-tier), which rig admit reads (src/rig/admission.ts), and keeps the out dir as an artifact. scripts/gate.ts runs stage m0 only: its
// JUnit cases match bare test names, and m1b's are full keys, file > describe > test.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseManifest } from "../../scripts/gate.ts";
import { looksLikeCredential } from "../trial/env.ts";
import { checkout } from "./checkout.ts";
import { recipeHash, recipeInputs, RIG_ROOT, type RecipeInputs } from "./recipe.ts";

export const TIER_STAGE = "m1b";
export const TIER_ARTIFACT = "gstack-evals-rig-tier";
export const TIER_FILE = "rig-tier.json";
const TIER_TIMEOUT_MS = 3 * 60 * 60 * 1000;

/** The part of a tier record rig.yml's tier job annotates, which admission reads back through the REST API. */
export type TierSummary = Pick<TierRecord, "schema" | "kind" | "stage" | "verdict" | "head_sha" | "tree" | "clean" | "recipe_sha256" | "counts">;

export const tierSummary = (t: TierRecord): TierSummary => ({ schema: t.schema, kind: t.kind, stage: t.stage, verdict: t.verdict, head_sha: t.head_sha, tree: t.tree, clean: t.clean, recipe_sha256: t.recipe_sha256, counts: t.counts });

/** The GitHub Actions workflow command that annotates the tier summary on the job. */
export const tierAnnotation = (t: TierRecord): string => "::notice title=" + TIER_ARTIFACT + "::" + JSON.stringify(tierSummary(t)).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

export interface JunitCase {
  key: string;
  status: "pass" | "fail" | "skip";
}

export interface TierRecord {
  schema: 1;
  kind: "rig-tier";
  stage: typeof TIER_STAGE;
  head_sha: string;
  tree: string;
  /** The working directory's tree equals HEAD's, so nothing uncommitted was tested. */
  clean: boolean;
  recipe_sha256: string;
  recipe: RecipeInputs;
  verdict: "GREEN" | "RED";
  exit_code: number | null;
  counts: { pass: number; fail: number; skip: number };
  problems: string[];
  started_at: string;
  finished_at: string;
}

const unescapeXml = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const attr = (attrs: string, name: string) => unescapeXml(new RegExp("\\b" + name + '="([^"]*)"').exec(attrs)?.[1] ?? "");

/** Every test case in a JUnit report, keyed file > describe > ... > test, with its status. */
export function junitCases(xml: string): JunitCase[] {
  const cases: JunitCase[] = [];
  const suites: string[] = [];
  for (const m of xml.matchAll(/<testsuite\b([^>]*?)(\/?)>|<\/testsuite>|<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
    if (m[0] === "</testsuite>") suites.pop();
    else if (m[0].startsWith("<testsuite")) {
      if (m[2] !== "/") suites.push(attr(m[1]!, "name"));
    } else {
      const body = m[4] ?? "";
      cases.push({ key: [...suites, attr(m[3]!, "name")].join(" > "), status: /<skipped\b/.test(body) ? "skip" : /<(failure|error)\b/.test(body) ? "fail" : "pass" });
    }
  }
  return cases;
}

/**
 * Why a tier run is not GREEN: the tests did not exit 0, an expected file or case has no passing case, or any case failed
 * or was skipped. An expected entry is a test file or a key prefix (file > describe), and every case under it counts.
 */
export function judgeTier(cases: readonly JunitCase[], expected: readonly string[], exitCode: number | null): string[] {
  const problems: string[] = [];
  if (exitCode !== 0) problems.push("the tier's tests exited " + (exitCode ?? "without a status (killed or timed out)"));
  if (!cases.length) problems.push("the JUnit report holds no test case");
  for (const e of expected) if (!cases.some((c) => c.key === e || c.key.startsWith(e + " > "))) problems.push("expected, and absent from the report: " + e);
  for (const c of cases) if (c.status !== "pass") problems.push((c.status === "skip" ? "skipped: " : "failed: ") + c.key);
  return problems;
}

/** This process's env without any name that looks like a credential, for the tier and the keyless probes. */
export function keylessEnv(extra: Record<string, string> = {}): Record<string, string> {
  const kept = Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && !looksLikeCredential(e[0]));
  return { ...Object.fromEntries(kept), ...extra };
}

/** Stage m1b's one junit case from gate/manifest.json: its command and the cases it must pass. */
export function tierCase(root: string = RIG_ROOT): { run: string; tests: string[] } {
  const m = parseManifest(readFileSync(join(root, "gate", "manifest.json"), "utf8"));
  if ("error" in m) throw new Error(m.error);
  const cases = m.stages[TIER_STAGE];
  if (!cases || cases.length !== 1 || cases[0]!.kind !== "junit") throw new Error("gate/manifest.json's " + TIER_STAGE + " stage must hold one junit case");
  return { run: cases[0]!.run, tests: cases[0]!.tests! };
}

/** Runs the Docker tier in root and writes <out>/rig-tier.json beside the JUnit report. */
export function runTier(o: { out: string; root?: string }): TierRecord {
  const root = o.root ?? RIG_ROOT;
  const c = tierCase(root);
  mkdirSync(o.out, { recursive: true });
  const junit = join(o.out, "junit.xml");
  const started = new Date().toISOString();
  const r = spawnSync("bash", ["--noprofile", "--norc", "-o", "pipefail", "-c", c.run], { cwd: root, env: keylessEnv({ GATE_JUNIT: junit }), stdio: ["ignore", "inherit", "inherit"], timeout: TIER_TIMEOUT_MS });
  const cases = existsSync(junit) ? junitCases(readFileSync(junit, "utf8")) : [];
  const problems = judgeTier(cases, c.tests, r.status);
  const tree = checkout(root);
  const inputs = recipeInputs(root);
  const count = (s: JunitCase["status"]) => cases.filter((x) => x.status === s).length;
  const record: TierRecord = {
    schema: 1,
    kind: "rig-tier",
    stage: TIER_STAGE,
    head_sha: tree.commit,
    tree: tree.tree,
    clean: tree.tree === tree.head_tree,
    recipe_sha256: recipeHash(inputs),
    recipe: inputs,
    verdict: problems.length ? "RED" : "GREEN",
    exit_code: r.status,
    counts: { pass: count("pass"), fail: count("fail"), skip: count("skip") },
    problems,
    started_at: started,
    finished_at: new Date().toISOString(),
  };
  writeFileSync(join(o.out, TIER_FILE), JSON.stringify(record, null, 2) + "\n");
  return record;
}
