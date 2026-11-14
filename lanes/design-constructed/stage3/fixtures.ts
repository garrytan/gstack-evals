// Copyright (c) 2026 Garry Tan. MIT License.
// Invented fixtures for stage 3's tests and dry-run cases: scripted authoring, build agent, reader and DES-4 judge over a
// fake Ubicloud. No real app, model or VM.
import { fakeBackend, fakeHosts, fakeMirrors, fakeMoney, fakeSpec, fakeWorld, bytes } from "./fake.ts";
import type { BuildDeps, BuildArm } from "./build.ts";
import type { Stage3Deps } from "./run.ts";
import type { AgentEnd, Authored, AuthoredAudit, BuildReads, PairwiseJudge, Stage3Authoring } from "./seams.ts";
import type { SelectDeps, Stage3Candidate } from "./units.ts";
import type { Recipe } from "../recipes/recipe.ts";
import type { Arm, Unit } from "../types.ts";

export const FIXTURE_RECIPE: Recipe = { install: "npm ci", seed: "", build: "npm run build", start: "npm start", baseUrl: "http://localhost:3000", routes: ["/projects", "/projects/1", "/tickets"], services: [], login: null };

export const unit = (i: number, baseApp = "app" + i): Unit => ({ id: "u" + String(i).padStart(2, "0"), baseApp, position: i, kind: "k1", author: i % 2 ? "argon" : "sol", tier: "base", set: "comparison", digest: "d" + i });

export const authored = (): Authored => ({
  fixtures: { empty: "[]", error: "{}", held: true },
  keyChecks: [
    { id: "k1", item: "i1", class: "S", body: null },
    { id: "k2", item: "i2", class: "R", body: null },
    { id: "k3", item: "i3", class: "A", body: null },
  ],
  scenarios: [{ id: "s1", body: null }, { id: "s2", body: null }, { id: "s3", body: null }],
});

export const reads = (o: Partial<BuildReads> = {}): BuildReads => ({
  readsDataSource: true,
  axe: [{ route: "/projects", width: 375, violations: ["color-contrast .badge"] }],
  overflow: [{ route: "/projects", width: 375, overflow: false }, { route: "/projects", width: 768, overflow: false }],
  smallTargets: 2,
  forced: (["empty", "error", "loading"] as const).map((state) => ({ route: "/projects", state, distinct: true, astra: "designed" as const })),
  keyChecks: { k1: true, k2: true, k3: false },
  agentUser: ["s1", "s2", "s3"].map((scenario) => ({ scenario, completed: true, steps: 8, failedActions: 0, consoleErrors: 0, deadEnds: 0 })),
  literalsAdded: 3,
  screens: { desktop: "desk", phone: "phone" },
  ...o,
});

export type BuildEndScript = AgentEnd | "own-limit-once" | "infra-once";

export interface Stage3Script {
  /** How a build's session ends, by its label ("build u01 none", "oracle build 1 u01"). */
  end?: (label: string) => BuildEndScript;
  /** Whether a checked tree serves, by the build label it came from. */
  serves?: (label: string) => boolean;
  /** The reads of a served tree, by the build label it came from. */
  reads?: (label: string) => BuildReads;
  audit?: (u: Unit, a: Authored) => AuthoredAudit;
  opusBlock?: (unit: string, arm: Arm) => string | null;
  judge?: PairwiseJudge;
  spentUsd?: number;
  caps?: Parameters<typeof fakeMoney>[0];
}

const dec = new TextDecoder();

/** Wires selection and stage 3 over the fake Ubicloud with the scripts. */
export function fixtureStage3(s: Stage3Script = {}) {
  const tries = new Map<string, number>();
  const world = fakeWorld({
    handler: (vm, command) => {
      if (command.startsWith("tar -C /work/repo -cf /work/out.tar")) vm.files.set("/work/out.tar", bytes("tree:" + vm.spec!.label.replace(/ retry$/, "")));
      if (command.includes("curl -s -o /dev/null -m 30")) {
        const label = dec.decode(vm.files.get("/work/app.tar") ?? new Uint8Array()).slice(5);
        const n = (command.match(/curl /g) ?? []).length;
        return { stdout: Array.from({ length: n }, () => ((s.serves ?? (() => true))(label) ? "200" : "500")).join("\n") + "\n" };
      }
      return undefined;
    },
  });
  const backend = fakeBackend(world);
  const money = fakeMoney(s.caps ?? { "dc-stage3-authoring": 185, "dc-stage3-builds": 210, "dc-stage3-reads": 165 });
  const labelOf = (vmLabel: string) => vmLabel.replace(/ retry$/, "");
  const builds: BuildDeps = {
    sandbox: { backend, hosts: fakeHosts(), now: () => 0 },
    agent: async (vm) => {
      const label = labelOf(vm.spec.label);
      const n = (tries.get(label) ?? 0) + 1;
      tries.set(label, n);
      const e = (s.end ?? (() => "completed"))(label);
      const end: AgentEnd = e === "own-limit-once" ? (n === 1 ? "own-limit" : "completed") : e === "infra-once" ? (n === 1 ? "infra" : "completed") : e;
      return { end, spentUsd: s.spentUsd ?? 1.5 };
    },
    buildSpec: (l) => fakeSpec({ label: l }),
    checkSpec: (l) => fakeSpec({ label: l, proxy: null, mirrors: fakeMirrors() }),
    reader: async (vm) => {
      const files = world.vms.find((v) => v.id === vm.id)!.files;
      const label = dec.decode(files.get("/work/app.tar") ?? new Uint8Array()).slice(5);
      return (s.reads ?? (() => reads()))(label);
    },
  };
  const authoring: Stage3Authoring = {
    author: async () => authored(),
    audit: async (u, a) => (s.audit ? s.audit(u, a) : { fixtures: true, keyChecks: Object.fromEntries(a.keyChecks.map((k) => [k.id, true])), scenarios: Object.fromEntries(a.scenarios.map((x) => [x.id, true])) }),
  };
  const select: SelectDeps = { builds, money, authoring };
  const candidate = (u: Unit): Stage3Candidate => ({ unit: u, plan: "# Plan\nA new screen.", oracleBlock: "1. Show an empty state.", tree: async () => bytes("unit tree " + u.id), recipe: FIXTURE_RECIPE, routes: ["/projects", "/projects/1", "/tickets"] });
  const deps = (units: Unit[]): Stage3Deps => ({
    builds,
    money,
    opusBlock: s.opusBlock ?? ((_u, arm) => "1. A change from the " + arm + " block."),
    judge: s.judge ?? (async (o) => (o.first.desktop === "control-desk" ? "second" : o.second.desktop === "control-desk" ? "first" : "tie")),
    baseAppOf: Object.fromEntries(units.map((u) => [u.id, u.baseApp])),
  });
  return { world, money, select, candidate, deps, tries };
}

/** Reads that mark the generic-look control's screens, so the default judge can tell it apart. */
export const armReads = (label: string, o: Partial<BuildReads> = {}): BuildReads => reads({ screens: label.endsWith("generic-look") ? { desktop: "control-desk", phone: "control-phone" } : { desktop: "desk", phone: "phone" }, ...o });

export const armOf = (label: string): BuildArm | null => {
  const m = /^build u\d+ (.+)$/.exec(label);
  return m ? (m[1] as BuildArm) : null;
};
