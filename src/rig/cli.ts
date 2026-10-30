// gstack-evals rig: the Docker tier, the keyless probes and rig admission (CI plan v5, U20). docs/rig.md is the guide;
// every error line on stderr starts with its reason code.
import { spawnSync } from "node:child_process";
import { CODES, docAnchor, type ReasonCode } from "../errors/codes.ts";
import { machineId } from "../runner/ledger/ledger.ts";
import { recordPath } from "../runner/ledger/paths.ts";
import { LedgerError } from "../runner/ledger/record.ts";
import { buildTrialImage, stateRoot } from "../trial/image.ts";
import { admit, ghCli, hostFingerprint, redness, RigError, type AdmissionRecord, type ProbeResult, type ProofKind } from "./admission.ts";
import { replayProbe, rigProbes } from "./probes.ts";
import { RIG_ROOT } from "./recipe.ts";
import { runTier, tierAnnotation } from "./tier.ts";

export const HELP = `Usage: gstack-evals rig <command> [options]

  tier    --out <dir>
          Run the Docker tier (stage m1b of gate/manifest.json) with no credential in the env, and write
          <dir>/rig-tier.json beside its JUnit report. GREEN only when every case passes and none is skipped.
          rig.yml runs it on GitHub. Exits 0 when GREEN and 2 (E_RIG_RED) when RED.
  probes  --proof trial|direct
          Run the proof set's keyless probes on this machine and print each result. Writes nothing.
  admit   --item <name> --proof trial|direct --prereg <file> [--run <id>] [--check-run <id>] [--repo <owner/name>]
          Gather the proof set for the line item's next lease and write its admission record, green or red.
          trial (arms in src/trial, such as Lane A): a green rig.yml run at this tree and recipe, plus the R5 and R6
          probes here. direct (direct-API runs, judge calibration): a green ci.yml push or dispatch run at this tree,
          plus the replay lane's fake-upstream tests here. Exits 0 when green and 2 (E_RIG_RED) when red.

admit takes --ledger-record <dir> (GSTACK_EVALS_LEDGER_RECORD). Every command takes --json. GitHub is read with gh
(GSTACK_EVALS_GH_BIN), and Docker is GSTACK_EVALS_DOCKER_BIN or docker. Guide: docs/rig.md`;

const ALLOWED: Record<string, string[]> = {
  tier: ["--out"],
  probes: ["--proof"],
  admit: ["--item", "--proof", "--prereg", "--run", "--check-run", "--repo", "--ledger-record"],
};

export interface RigIo {
  out: (text: string) => void;
  err: (text: string) => void;
}

const errorLines = (code: ReasonCode, message: string): string =>
  [message, "fix: " + CODES[code].fix, "docs: " + docAnchor(code)]
    .flatMap((text) => text.split(/\r\n|\r|\n/))
    .map((line) => code + " " + line)
    .join("\n");

const short = (s: string | null) => (s ?? "none").slice(0, 12);
const probeLine = (p: ProbeResult) => "probe " + p.id + " " + (p.pass ? "pass" : "FAIL") + ": " + p.detail;

/** The owner/name of this checkout's origin remote. */
function originRepo(root: string): string | null {
  const url = spawnSync("git", ["remote", "get-url", "origin"], { cwd: root, encoding: "utf8" }).stdout?.trim() ?? "";
  return /[/:]([^/:]+\/[^/]+?)(?:\.git)?\/?$/.exec(url)?.[1] ?? null;
}

function proofProbes(proof: ProofKind, env: Record<string, string | undefined>): () => ProbeResult[] {
  if (proof === "direct") return () => [replayProbe()];
  return () => {
    const docker = env.GSTACK_EVALS_DOCKER_BIN || "docker";
    const built = buildTrialImage({ state: stateRoot(env), docker });
    if (!built.ok) throw new Error(built.code + ": " + built.message);
    return rigProbes({ image: built.tag, docker });
  };
}

export async function rigCli(argv: string[], io: RigIo, env: Record<string, string | undefined> = process.env): Promise<number> {
  const [cmd, ...rest] = argv;
  if (cmd === undefined || cmd === "--help" || cmd === "-h" || rest.includes("--help")) {
    io.out(HELP);
    return cmd === undefined ? 2 : 0;
  }
  const flags = new Map<string, string>();
  let json = false;
  try {
    if (!ALLOWED[cmd]) throw new RigError("E_USAGE", "unknown rig command " + JSON.stringify(cmd) + "; run gstack-evals rig --help");
    for (let i = 0; i < rest.length; i++) {
      const flag = rest[i]!;
      if (flag === "--json") json = true;
      else if (!ALLOWED[cmd]!.includes(flag)) throw new RigError("E_USAGE", "gstack-evals rig " + cmd + " does not take " + flag);
      else if (rest[i + 1] === undefined || rest[i + 1]!.startsWith("--")) throw new RigError("E_USAGE", flag + " needs a value");
      else if (flags.has(flag)) throw new RigError("E_USAGE", flag + " is given twice");
      else flags.set(flag, rest[++i]!);
    }
    const need = (flag: string) => {
      const v = flags.get(flag);
      if (v === undefined) throw new RigError("E_USAGE", "gstack-evals rig " + cmd + " needs " + flag);
      return v;
    };
    const proofFlag = () => {
      const p = need("--proof");
      if (p !== "trial" && p !== "direct") throw new RigError("E_USAGE", "--proof is trial or direct, not " + JSON.stringify(p));
      return p as ProofKind;
    };

    if (cmd === "tier") {
      const t = runTier({ out: need("--out") });
      if (env.GITHUB_ACTIONS === "true") io.out(tierAnnotation(t));
      io.out(json ? JSON.stringify(t, null, 2) : "TIER: " + t.verdict + " head=" + short(t.head_sha) + " tree=" + short(t.tree) + " recipe=" + short(t.recipe_sha256) + " pass=" + t.counts.pass + " fail=" + t.counts.fail + " skip=" + t.counts.skip);
      if (t.verdict === "GREEN") return 0;
      io.err(errorLines("E_RIG_RED", "the Docker tier is RED:\n" + t.problems.slice(0, 50).join("\n") + (t.problems.length > 50 ? "\n(" + (t.problems.length - 50) + " more in rig-tier.json)" : "")));
      return CODES.E_RIG_RED.exit;
    }

    if (cmd === "probes") {
      let results: ProbeResult[];
      try {
        results = proofProbes(proofFlag(), env)();
      } catch (error) {
        if (error instanceof RigError) throw error;
        throw new RigError("E_RIG_PROBE", "the keyless probes could not run on this machine: " + (error as Error).message);
      }
      io.out(json ? JSON.stringify(results, null, 2) : results.map(probeLine).join("\n"));
      const failed = results.filter((p) => !p.pass);
      if (!failed.length) return 0;
      io.err(errorLines("E_RIG_RED", failed.length + " probe(s) failed on this machine: " + failed.map((p) => p.id).join(", ")));
      return CODES.E_RIG_RED.exit;
    }

    const proof = proofFlag();
    const repo = flags.get("--repo") ?? originRepo(RIG_ROOT);
    if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new RigError("E_USAGE", "--repo must be owner/name; this checkout's origin names none");
    const checkRun = flags.get("--check-run");
    if (checkRun !== undefined && !/^\d+$/.test(checkRun)) throw new RigError("E_USAGE", "--check-run is a workflow run id, not " + JSON.stringify(checkRun));
    const runId = flags.get("--run");
    const result = admit({
      record: recordPath(flags.get("--ledger-record"), env).path,
      item: need("--item"),
      proof,
      prereg: need("--prereg"),
      repo,
      machineId: machineId(),
      gh: ghCli(env.GSTACK_EVALS_GH_BIN || "gh"),
      probes: proofProbes(proof, env),
      fingerprint: (p) => hostFingerprint(p, env.GSTACK_EVALS_DOCKER_BIN || "docker"),
      ...(runId !== undefined ? { runId } : {}),
      ...(checkRun !== undefined ? { checkRun: Number(checkRun) } : {}),
    });
    const a: AdmissionRecord = result.admission;
    if (json) io.out(JSON.stringify({ path: result.path, written: result.written, admission: a }, null, 2));
    else {
      io.out("ADMIT: " + a.verdict + " item=" + a.item + " slot=" + a.seq + " attempt=" + a.attempt + " proof=" + a.proof + " run=" + (a.run_id ?? "none") + " machine=" + a.machine_id + " tree=" + short(a.tree) + " recipe=" + short(a.recipe_sha256) + " expires=" + a.expires_at + (result.written ? "" : " (already admitted)"));
      io.out("record: " + result.path);
      for (const c of a.checks) io.out("check: " + c.workflow + " run " + c.run_id + " (" + c.event + ", " + c.conclusion + ") " + c.url);
      for (const p of a.probes) io.out(probeLine(p));
    }
    if (a.verdict === "green") return 0;
    io.err(errorLines("E_RIG_RED", "the admission record at " + result.path + " is red, so a lease on slot " + a.seq + " refuses:\n" + redness(a).join("\n")));
    return CODES.E_RIG_RED.exit;
  } catch (error) {
    if (error instanceof RigError || error instanceof LedgerError) {
      const code = error.code as ReasonCode;
      io.err(errorLines(code, error.message));
      return (CODES[code] as { exit: number | null }).exit ?? 2;
    }
    throw error;
  }
}

export async function main(argv: string[]): Promise<number> {
  return rigCli(argv, { out: (t) => console.log(t), err: (t) => console.error(t) });
}
