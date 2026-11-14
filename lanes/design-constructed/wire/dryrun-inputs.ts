// Copyright (c) 2026 Garry Tan. MIT License.
// The keyless input rows' dry-run cases: pins terms writes the --terms file from the pin record (and refuses a record
// with problems); exports writes each unit's folder in the layout the sessions row reads, and its c2.json passes C2 on
// this host against the folder's own mounts; stage3inputs writes the stage3 row's candidates with each oracle list
// rendered. No key, no network.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { endpointsFixture } from "../paid/dryrun-cases.ts";
import { termsRecordsOf, type PinRecord, type ProbePlan } from "../paid/pin.ts";
import { runC2, type C2Expect } from "../run/contain.ts";
import type { Exec } from "../run/types.ts";
import type { DryRunCase } from "../types.ts";
import type { ExportInput } from "./exports.ts";
import { rowEnv } from "./dryrun-host.ts";
import { runRow } from "./fixtures.ts";
import type { Stage3Input } from "./stage3.ts";

const all = (...checks: (string | null)[]): string | null => checks.find((x) => x !== null) ?? null;

async function withTemp(fn: (dir: string) => Promise<string | null>): Promise<string | null> {
  const dir = mkdtempSync(join(tmpdir(), "dc-inputs-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const exec: Exec = (command) =>
  new Promise((resolve) => {
    const p = spawn("sh", ["-c", command]);
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    p.stdout.on("data", (d: Buffer) => out.push(d));
    p.stderr.on("data", (d: Buffer) => err.push(d));
    p.on("close", (code) => resolve({ code: code ?? 1, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") }));
  });

/** A base app clone with one commit, and its record. */
function baseApp(dir: string): { clone: string; commit: string; tree: string } {
  const clone = join(dir, "app");
  mkdirSync(join(clone, "src"), { recursive: true });
  writeFileSync(join(clone, "package.json"), "{\"name\":\"demo\"}\n");
  writeFileSync(join(clone, "src", "page.tsx"), "export default function Page() { return null; }\n");
  writeFileSync(join(clone, "CLAUDE.md"), "instructions\n");
  const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: dir, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
  const g = (args: string[], input?: string) => spawnSync("git", args, { cwd: clone, env, input, encoding: "utf8" }).stdout.trim();
  g(["init", "-q", "--template="]);
  g(["add", "-A", "-f"]);
  const tree = g(["write-tree"]);
  const commit = g(["hash-object", "-t", "commit", "-w", "--stdin"], "tree " + tree + "\nauthor t <t@invalid> 1 +0000\ncommitter t <t@invalid> 1 +0000\n\nfixture\n");
  g(["update-ref", "HEAD", commit]);
  return { clone, commit, tree };
}

export function inputCases(): DryRunCase[] {
  return [
    {
      rule: "W-inputs",
      name: "pins terms writes start rule 9's terms file from the pin record, and refuses a record with problems",
      check: () =>
        withTemp(async (root) => {
          const env = rowEnv();
          await runRow(["pins", "plan", "--dir", join(root, "probe")], env);
          const plan = JSON.parse(readFileSync(join(root, "probe", "plan.json"), "utf8")) as ProbePlan;
          const bare = await runRow(["pins", "record", "--dir", join(root, "probe"), "--run", "dry-run", "--commit", "0".repeat(40), "--out", join(root, "bare.json")], env);
          for (const c of plan.commands) writeFileSync(join(root, "probe", c.file), endpointsFixture(c.model));
          await runRow(["pins", "record", "--dir", join(root, "probe"), "--run", "dry-run", "--commit", "0".repeat(40), "--dated", "2026-11-13T00:00:00Z", "--out", join(root, "pins.json")], env);
          const t = await runRow(["pins", "terms", "--pin", join(root, "pins.json"), "--out", join(root, "terms.json")], env);
          const refused = await runRow(["pins", "terms", "--pin", join(root, "bare.json"), "--out", join(root, "bad.json")], env);
          const want = termsRecordsOf(JSON.parse(readFileSync(join(root, "pins.json"), "utf8")) as PinRecord);
          return all(
            bare.code === 1 ? null : "the bare record was not refused",
            t.code === 0 && want.length === 3 && readFileSync(join(root, "terms.json"), "utf8") === JSON.stringify(want, null, 2) + "\n" ? null : "terms.json is not the record's terms: exit " + t.code + " " + t.err.join(" "),
            refused.code === 2 && refused.err.join(" ").includes("has problems") && !existsSync(join(root, "bad.json")) ? null : "a record with problems wrote a terms file",
          );
        }),
    },
    {
      rule: "W-inputs",
      name: "exports writes each unit's repo/, plan.md, context/ and c2.json, and the unit's own C2 passes on it",
      check: () =>
        withTemp(async (root) => {
          const app = baseApp(root);
          writeFileSync(join(root, "notes.md"), "# Notes\n\nCustomers asked for an orders view.\n");
          writeFileSync(join(root, "plan.md"), "# Plan\n\nA new orders screen.\n");
          mkdirSync(join(root, "ctx"));
          writeFileSync(join(root, "ctx", "project.md"), "An orders app.\n");
          writeFileSync(join(root, "key.json"), "{\"items\":[]}\n");
          const input: ExportInput[] = [{ unit: "u1", source: { clone: app.clone }, base: { commit: app.commit, tree: app.tree }, evidence: [{ path: "docs/notes.md", file: join(root, "notes.md") }], plan: join(root, "plan.md"), context: join(root, "ctx"), sealed: [join(root, "key.json")] }];
          writeFileSync(join(root, "exports.json"), JSON.stringify(input));
          const r = await runRow(["exports", "--in", join(root, "exports.json"), "--out", join(root, "exports")], rowEnv());
          if (r.code !== 0) return "exports: " + r.err.join(" ");
          const u = join(root, "exports", "u1");
          const c2 = JSON.parse(readFileSync(join(u, "c2.json"), "utf8")) as C2Expect;
          const problems = await runC2(exec, join(u, "repo"), [join(u, "repo"), join(u, "plan.md"), join(u, "context")], c2);
          writeFileSync(join(u, "context", "leak.json"), readFileSync(join(root, "key.json")));
          const caught = await runC2(exec, join(u, "repo"), [join(u, "repo"), join(u, "plan.md"), join(u, "context")], c2);
          return all(
            ["repo/docs/notes.md", "plan.md", "context/project.md", "c2.json"].every((p) => existsSync(join(u, p))) ? null : "the unit folder is not in the exports layout",
            existsSync(join(u, "repo", "CLAUDE.md")) ? "the strip left CLAUDE.md" : null,
            problems.length ? "C2 failed the fresh export: " + problems.join("; ") : null,
            caught.some((p) => p.includes("sealed")) ? null : "C2 missed a mount holding the sealed key's bytes",
          );
        }),
    },
    {
      rule: "W-inputs",
      name: "stage3inputs writes each candidate with its recipe, the changed screen's route and the rendered oracle list",
      check: () =>
        withTemp(async (root) => {
          const unit = { id: "u1", baseApp: "app-a", position: 1, kind: "screen", author: "sol", tier: "base", set: null, digest: "d" };
          const recipe = { install: "npm ci", seed: "", build: "npm run build", start: "npm start", baseUrl: "http://localhost:3000", routes: ["/", "/projects"], services: [], login: null };
          writeFileSync(join(root, "units.json"), JSON.stringify([unit]));
          writeFileSync(join(root, "recipes.json"), JSON.stringify({ "app-a": recipe }));
          writeFileSync(join(root, "oracles.json"), JSON.stringify({ u1: { source: "oracle", changes: ["Show an empty state.", "Keep the filter."] } }));
          writeFileSync(join(root, "routes.json"), JSON.stringify({ u1: "/orders" }));
          const args = ["stage3inputs", "--units", join(root, "units.json"), "--recipes", join(root, "recipes.json"), "--oracles", join(root, "oracles.json"), "--routes", join(root, "routes.json"), "--out", join(root, "stage3.json")];
          const r = await runRow(args, rowEnv());
          if (r.code !== 0) return "stage3inputs: " + r.err.join(" ");
          const rows = JSON.parse(readFileSync(join(root, "stage3.json"), "utf8")) as Stage3Input[];
          writeFileSync(join(root, "oracles.json"), JSON.stringify({ u1: { source: "none", changes: [] } }));
          const wrong = await runRow([...args.slice(0, -1), join(root, "again.json")], rowEnv());
          return all(
            rows.length === 1 && JSON.stringify(rows[0]!.routes) === JSON.stringify(["/", "/projects", "/orders"]) ? null : "routes: " + JSON.stringify(rows[0]?.routes),
            rows[0]!.oracleBlock.includes("Show an empty state.") && rows[0]!.oracleBlock.includes("Keep the filter.") ? null : "the oracle block: " + rows[0]!.oracleBlock,
            wrong.code === 2 && wrong.err.join(" ").includes("not its oracle list") ? null : "a non-oracle list was taken",
          );
        }),
    },
  ];
}
