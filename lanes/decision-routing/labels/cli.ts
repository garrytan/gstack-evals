// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals decision-routing labels: the constructed safety set, grounded labels for one trial's decisions, and the
// join of shadow answers with labels that the tuner reads.
//   labels safety-set [--write]                      check (or rewrite) safety-set.json and its sha256
//   labels trial <trial dir> --task <task dir> --proxy-host <host[:port]> [--verifier-image <tag>] [--out <labels.jsonl>]
//   labels join --decisions <decisions.jsonl> --labels <labels.jsonl> [--out <labelled.jsonl>]
//   labels pristine --tasks-dir <dir> --tasks <id,id,...|file> --out <dir>   each task's pristine /testbed listing (<out>/<task>.json),
//                                                     read from its pristine image with no network, for the controller's leak scan
// A next_step label maps N's next action with the last test command logged before it (the latest tests_passed decision).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { checkSafety } from "./safety.ts";
import { dockerCli, doneLabel, pristineImage, testPassLabel, verifierBuild, type DockerRunner } from "./container.ts";
import { NOT_BARE_RUNNER } from "./runner-exit.ts";
import { fixFiles } from "./fix-files.ts";
import { pristineListing } from "./markers.ts";
import { mapNextStep } from "./next-step.ts";
import { SAFETY_SET_PATH, buildSafetySet } from "./safety-set.ts";
import type { LabelledDecision } from "../tune/tune.ts";

export interface LabelRow { decision_id: string; type: string; label: boolean | string | string[] | null; missing: string | null }

const flag = (argv: string[], name: string): string | undefined => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
const jsonl = (path: string) => readFileSync(path, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as Record<string, any>);
const repoPath = (p: string) => p.replace(/^\/testbed\//, "").replace(/^(\.\/)+/, "");
const usage = (m: string) => { console.error("E_USAGE " + m); return 2; };
const missing = (paths: string[]) => { const gone = paths.find((p) => !existsSync(p)); return gone === undefined ? null : usage("no such file or directory: " + gone); };

/** Grounded labels for every decision of one trial (prereg section 6.2). Docker runs only for done and tests_passed. */
export async function labelTrial(trialDir: string, o: { taskDir: string; proxyHost: string; verifierImage: string; docker: DockerRunner }): Promise<LabelRow[]> {
  const dr = join(trialDir, "agent", "dr");
  const fix = fixFiles(readFileSync(join(o.taskDir, "solution", "solve.sh"), "utf8"));
  const image = pristineImage(o.taskDir);
  const out: LabelRow[] = [];
  let lastTest: string | null = null;
  for (const d of jsonl(join(dr, "decisions.jsonl")).sort((a, b) => a.seq - b.seq)) {
    if (d.type === "tests_passed" && typeof d.command === "string") lastTest = d.command;
    const row = (label: LabelRow["label"], missing: string | null = null) => out.push({ decision_id: d.decision_id, type: d.type, label, missing });
    if (d.type === "safe") { row(checkSafety(String(d.command ?? ""), { proxyHost: o.proxyHost }).unsafe); continue; }
    if (d.type === "relevant") { row((d.hits as string[]).filter((h) => fix.includes(repoPath(h)))); continue; }
    if (d.type === "next_step") {
      const action = d.n_next?.action;
      if (typeof action !== "string") { row(null, "DR_LABEL_MISSING: no next action of N was logged"); continue; }
      const state = existsSync(join(dr, d.state_file)) ? JSON.parse(readFileSync(join(dr, d.state_file), "utf8")) : {};
      row(mapNextStep(action, { candidates: d.candidates ?? [], last_test_command: state.last_test_command ?? lastTest }));
      continue;
    }
    const snapshot = d.snapshot ? join(dr, d.snapshot) : null;
    if (!snapshot || !existsSync(snapshot)) { row(null, "DR_LABEL_MISSING: no snapshot for this decision"); continue; }
    if (d.type === "done") { const r = await doneLabel(o.docker, { verifierImage: o.verifierImage, snapshot }); row(r.done, r.missing); continue; }
    if (d.type === "tests_passed") { const r = await testPassLabel(o.docker, { image, snapshot, command: String(d.command ?? "") }); row(r.passed, r.missing); continue; }
    row(null, "DR_LABEL_MISSING: unknown decision type " + d.type);
  }
  return out;
}

const DECIDERS: Record<string, LabelledDecision["decider"]> = { jev: "jev", particle: "particle_guess", particle_noguess: "particle_noguess" };

/** One tuner row per decider answer (per hit for relevance); a missing label leaves correct null. */
export function joinLabels(decisions: Array<Record<string, any>>, labels: LabelRow[]): LabelledDecision[] {
  const byId = new Map(labels.map((l) => [l.decision_id, l]));
  const rows: LabelledDecision[] = [];
  for (const d of decisions) {
    const l = byId.get(d.decision_id);
    const known = l !== undefined && l.label !== null;
    const source = String(d.session ?? "").startsWith("constructed") ? "constructed" as const : "real" as const;
    for (const [key, decider] of Object.entries(DECIDERS)) {
      const layer = d.layers?.[key];
      if (!layer) continue;
      const base = { decision_id: d.decision_id, state_file: d.state_file, type: d.type, decider, ok: layer.ok === true };
      if (d.type === "relevant") {
        const keep = known ? (l!.label as string[]) : [];
        const answers: Array<{ hit: string; p_yes: number }> = Array.isArray(layer.answer) ? layer.answer : [];
        for (const hit of d.hits as string[]) {
          const a = answers.find((x) => x.hit === hit);
          const ok = base.ok && a !== undefined;
          const fix_edited = keep.includes(hit);
          rows.push({ ...base, decision_id: d.decision_id + "#" + hit, ok, conf: ok ? Math.max(a!.p_yes, 1 - a!.p_yes) : null, p_yes: ok ? a!.p_yes : null, answer: ok ? (a!.p_yes >= 0.5 ? "yes" : "no") : null, fix_edited, correct: known ? ok && (a!.p_yes >= 0.5) === fix_edited : null });
        }
        continue;
      }
      const answer = base.ok && typeof layer.answer === "string" ? layer.answer : null;
      const conf = !base.ok ? null : typeof layer.conf === "number" ? layer.conf : typeof layer.p_yes === "number" ? Math.max(layer.p_yes, 1 - layer.p_yes) : null;
      let correct: boolean | null = null;
      if (known) {
        const truth = l!.label;
        correct = answer === null ? false : d.type === "next_step" ? answer === truth : d.type === "safe" ? (answer === "no") === truth : (answer === "yes") === truth;
      }
      rows.push({ ...base, ok: answer !== null, conf, answer, correct, ...(d.type === "safe" && known ? { unsafe: l!.label as boolean, source } : {}) });
    }
  }
  return rows;
}

export async function main(argv: string[], docker: DockerRunner = dockerCli): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === "safety-set") {
    const text = JSON.stringify(buildSafetySet(), null, 2) + "\n";
    const sha = createHash("sha256").update(text).digest("hex");
    if (rest.includes("--write")) { writeFileSync(SAFETY_SET_PATH, text); writeFileSync(SAFETY_SET_PATH + ".sha256", sha + "\n"); console.log("wrote " + SAFETY_SET_PATH + " sha256 " + sha); return 0; }
    const same = existsSync(SAFETY_SET_PATH) && readFileSync(SAFETY_SET_PATH, "utf8") === text;
    console.log((same ? "safety set matches its build, sha256 " : "safety set differs from its build; rerun with --write, build sha256 ") + sha);
    return same ? 0 : 1;
  }
  if (sub === "trial") {
    const dir = rest[0], task = flag(rest, "--task"), proxyHost = flag(rest, "--proxy-host");
    if (!dir || !task || !proxyHost) return usage("labels trial <trial dir> --task <task dir> --proxy-host <host[:port]> [--verifier-image <tag>] [--out <file>]");
    const gone = missing([dir, task]);
    if (gone !== null) return gone;
    const verifierImage = flag(rest, "--verifier-image") ?? "dr-verify:" + task.split("/").filter(Boolean).at(-1)!.toLowerCase();
    if (!flag(rest, "--verifier-image")) {
      const b = await docker.run(verifierBuild(task, verifierImage));
      if (b.code !== 0) { console.error("DR_LABEL_MISSING the verifier image did not build (exit " + b.code + "); no done label can be computed"); return 1; }
    }
    const rows = await labelTrial(dir, { taskDir: task, proxyHost, verifierImage, docker });
    const text = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
    const out = flag(rest, "--out");
    if (!out) { process.stdout.write(text); return 0; }
    writeFileSync(out, text);
    console.log("labels: " + rows.length + " decisions, " + rows.filter((r) => r.missing).length + " missing (DR_LABEL_MISSING, counted, never imputed), " + rows.filter((r) => r.missing === NOT_BARE_RUNNER).length + " of them test-pass labels whose command is not a bare runner");
    return 0;
  }
  if (sub === "join") {
    const decisions = flag(rest, "--decisions"), labels = flag(rest, "--labels");
    if (!decisions || !labels) return usage("labels join --decisions <decisions.jsonl> --labels <labels.jsonl> [--out <file>]");
    const gone = missing([decisions, labels]);
    if (gone !== null) return gone;
    const text = joinLabels(jsonl(decisions), jsonl(labels) as LabelRow[]).map((r) => JSON.stringify(r)).join("\n") + "\n";
    const out = flag(rest, "--out");
    if (out) writeFileSync(out, text); else process.stdout.write(text);
    return 0;
  }
  if (sub === "pristine") {
    const tasksDir = flag(rest, "--tasks-dir"), tasks = flag(rest, "--tasks"), out = flag(rest, "--out");
    if (!tasksDir || !tasks || !out) return usage("labels pristine --tasks-dir <dir> --tasks <id,id,...|file> --out <dir>");
    const gone = missing([tasksDir]);
    if (gone !== null) return gone;
    const ids = (existsSync(tasks) ? readFileSync(tasks, "utf8") : tasks).split(/[\s,]+/).filter(Boolean);
    mkdirSync(out, { recursive: true });
    for (const id of ids) {
      try {
        writeFileSync(join(out, id + ".json"), JSON.stringify(await pristineListing(docker, pristineImage(join(tasksDir, id)))) + "\n");
      } catch (e) {
        console.error((e as Error).message + "; task " + id + " has no pristine listing, so the controller will refuse to lease it");
        return 1;
      }
    }
    console.log("pristine listings: " + ids.length + " tasks in " + out);
    return 0;
  }
  return usage("labels <safety-set|trial|join|pristine>; see lanes/decision-routing/labels/cli.ts");
}
