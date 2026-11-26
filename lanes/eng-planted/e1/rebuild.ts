// Copyright (c) 2026 Garry Tan. MIT License.
// Eval 1's rebuild of attempt 3's pool from custody (prereg 2026-11-24-geva-587-design-time-state-modeling, run order step
// 3, and attempt 3's rulings A1 and B1). Run on a keyless screening VM, one Docker daemon per shard, from inputs streamed
// into RAM (--in, never committed): recipes.json (unit label to recipe), repos.json (repository to its one label),
// digests/<unit>.txt (the sealed ep-digests lines), dock/<unit> (the sealed Dockerfile) and cmp/<unit>.json (the sealed
// ep-unit.json). For each recipe it clones the repository, constructs, screens with the base image pinned to the sealed
// digest, recounts and emits the unit under its sealed label, then checks it: a unit is admitted only when ep digests
// --check matches line for line (A1) and its planted set equals the sealed one (B1). It prints counts only and writes
// one status row per unit to <run>/rebuild-status.json.
//
// bun lanes/eng-planted/e1/rebuild.ts --in /dev/shm/g --run ~/g/run --work ~/g/work --units ~/g/units --repos ~/g/repos
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { construct, type Constructed } from "../construct/build.ts";
import { compareDigests, unitDigests } from "../construct/digests.ts";
import { emitUnit, type LabelMap } from "../construct/emit.ts";
import { pinImages, qualify, recount, type Outcome } from "../construct/grade.ts";
import { digest, type Manifest, type MinedFix } from "../construct/local.ts";
import { cloneMirror } from "../construct/mine.ts";
import { removeLabelled } from "../../eng-build/screen.ts";

type Recipe = { candidate: string; repo: string; eco: MinedFix["eco"]; fix: string; mined: MinedFix };
export type Status = { unit: string; step: string; digests: "match" | "mismatch" | null; planted: "same" | "different" | null; admitted: boolean };

const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  const v = i > 0 ? process.argv[i + 1] : undefined;
  if (!v) throw new Error("E_USAGE needs " + k);
  return v;
};
const read = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;
const write = (p: string, v: unknown) => {
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, JSON.stringify(v, null, 1) + "\n", { mode: 0o600 });
};

/** The images map with each pin whose image name matches the sealed Dockerfile's FROM moved to the sealed digest. */
export function sealedImages(pinned: Record<string, string>, sealedDockerfile: string): Record<string, string> {
  const from = /^FROM\s+(\S+)/m.exec(sealedDockerfile)?.[1];
  if (!from || !from.includes("@sha256:")) return pinned;
  const name = from.split("@")[0];
  return Object.fromEntries(Object.entries(pinned).map(([t, v]) => [t, v.split("@")[0] === name ? from : v]));
}

if (import.meta.main) {
  const input = arg("--in"), run = arg("--run"), work = arg("--work"), units = arg("--units"), repos = arg("--repos");
  const recipes = read<Record<string, Recipe>>(join(input, "recipes.json"));
  const repoLabels = read<Record<string, string>>(join(input, "repos.json"));
  const byRepo = new Map<string, Array<[string, Recipe]>>();
  for (const [u, r] of Object.entries(recipes).sort()) byRepo.set(r.repo, [...(byRepo.get(r.repo) ?? []), [u, r]]);
  const manifest: Manifest = { searchedAt: "rebuild", seed: "rebuild", queries: [], rows: [...byRepo.keys()].map((repo) => ({ repo, eco: byRepo.get(repo)![0]![1].eco, stars: 0, sizeKB: 0, pushedAt: "", query: 0 })) };
  if (!existsSync(join(run, "manifest.json"))) {
    const text = JSON.stringify(manifest, null, 1) + "\n";
    mkdirSync(run, { recursive: true });
    writeFileSync(join(run, "manifest.json"), text, { mode: 0o600 });
    writeFileSync(join(run, "manifest.digest"), digest(text) + "\n");
  }
  const labelFile = join(run, "labels.json");
  const labels: LabelMap = { repos: { ...repoLabels }, units: Object.fromEntries(Object.entries(recipes).map(([u, r]) => [u, { candidate: r.candidate, repo: r.repo, fix: r.fix }])) };
  const statusFile = join(run, "rebuild-status.json");
  const status: Record<string, Status> = existsSync(statusFile) ? read(statusFile) : {};
  let i = 0;
  for (const [repo, rows] of byRepo) {
    const mirror = join(run, "mirrors", String(i++));
    const cloned = cloneMirror(repo, mirror);
    for (const [u, r] of rows) {
      if (status[u]) continue;
      const set = (s: Omit<Status, "unit">) => {
        status[u] = { unit: u, ...s };
        write(statusFile, status);
      };
      if (!cloned) {
        set({ step: "clone", digests: null, planted: null, admitted: false });
        continue;
      }
      const f: MinedFix = { ...r.mined, id: r.candidate };
      const c = construct(mirror, f);
      if (!c.ok) {
        set({ step: "construct:" + c.reason, digests: null, planted: null, admitted: false });
        continue;
      }
      const unit: Constructed = c.unit;
      const out = join(run, "units", r.candidate);
      let o: Outcome;
      try {
        const images = sealedImages(pinImages(mirror, unit.base, unit.merge, unit.fix), readFileSync(join(input, "dock", u), "utf8"));
        o = qualify({ mirror, fix: f, unit, out, work, labels: labelFile, images });
        if (o.step === "qualified") o = recount(o, out, work);
      } finally {
        removeLabelled();
      }
      write(join(run, "outcomes", r.candidate + ".json"), o);
      if (o.step !== "clean") {
        set({ step: o.step + ":" + (o.reason ?? ""), digests: null, planted: null, admitted: false });
        continue;
      }
      const emitted = emitUnit({ mirror, fix: f, unit, unitDir: out, units, repos, labels });
      if (emitted.id !== u) throw new Error("E_USAGE unit " + u + " emitted under another label");
      const d = compareDigests(readFileSync(join(input, "digests", u + ".txt"), "utf8").split("\n").filter(Boolean), unitDigests(join(units, u)));
      const sealed = read<{ planted: string[] }>(join(input, "cmp", u + ".json")).planted;
      const same = JSON.stringify([...sealed].sort()) === JSON.stringify([...emitted.planted].sort());
      set({ step: "clean", digests: d.match ? "match" : "mismatch", planted: same ? "same" : "different", admitted: d.match && same });
    }
  }
  const all = Object.values(status);
  const count = (f: (s: Status) => boolean) => all.filter(f).length;
  console.log("rebuild: " + all.length + " of " + Object.keys(recipes).length + " units done; clean " + count((s) => s.step === "clean") + ", digests match " + count((s) => s.digests === "match") + ", planted same " + count((s) => s.planted === "same") + ", admitted " + count((s) => s.admitted));
}
