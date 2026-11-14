// Copyright (c) 2026 Garry Tan. MIT License.
// dc probe and dc labels on dc-judges: the live judge probe down every route, then the label passes. Production labels
// run their first stage 1 packet alone and re-project the item from its cost; stage 2 production carries the blind
// re-check's gold packets at evenly spaced queue positions. The check pass labels at maximum effort with three
// families and gates each production judge against the stage 1 production labels. Every judge call goes through the
// metered model caller on dc-judges, and each launch writes its packets and labels so score and later passes read them.
import { copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fail } from "../errors.ts";
import { JUDGE_OF, JUDGING } from "../frozen.ts";
import { afterFirstPacket, committedMicros, FIRST_PACKET_TAG, holdForFirstPacket } from "../money/projection.ts";
import { applyStop, stopPlan } from "../money/stops.ts";
import { show } from "../read/num.ts";
import { CHECK_SUBJECTS, goldFor, judgeCheck, liveProbe, recheckGate, recheckPackets, recheckPositions, recheckSample, ROUTES, type CheckInput, type CheckSubject, type GateReading } from "../score/check.ts";
import { labelAll } from "../score/labels.ts";
import { buildCheckPackets, buildLabelPackets, derangePartners } from "../score/packets.ts";
import type { Built, PacketLabels, ReviewRow, ScoreUnit, Stage } from "../score/types.ts";
import type { AnyModel, Model, Tier } from "../types.ts";
import { build, judgeCaller, termsGuard } from "../wire.ts";
import { readJson, writeJson } from "./json.ts";
import { closeAll, need, oneOf, start, termsFrom, type Row } from "./start.ts";

const JUDGES: readonly AnyModel[] = ["astra", "opus", "argon"];
const TIERS: readonly Tier[] = ["base", "2x", "10x"];
const f4 = (x: number | null) => (x === null ? "n/a" : show(x));

type Pass = { built: Built; labels: Map<string, PacketLabels> };

/** A label sink: packet-files.json (the packets as sent), packets.json (the sealed map) and labels.json. */
export function readPass(dir: string, what: string): Pass {
  const d = resolve(dir);
  return {
    built: { packets: readJson(join(d, "packet-files.json"), what + " packet-files.json"), metas: readJson(join(d, "packets.json"), what + " packets.json") },
    labels: new Map(readJson<PacketLabels[]>(join(d, "labels.json"), what + " labels.json").map((l) => [l.packet, l])),
  };
}

function writePass(sink: string, built: Built, labels: readonly PacketLabels[]): void {
  writeJson(join(sink, "packet-files.json"), built.packets);
  writeJson(join(sink, "packets.json"), built.metas);
  writeJson(join(sink, "labels.json"), labels);
}

/** dc probe --terms --out: one call down every judge route; a route passes when text comes back. */
export const probeRow: Row = async (a, io, env) => {
  const usage = "probe --terms <terms.json> --out <new sink folder>";
  const sink = need(a, "--out", usage);
  const terms = termsFrom(a);
  const launch = await start({ row: "probe", sink, items: ["dc-judges"], models: JUDGES, terms, record: { routes: ROUTES.length } }, env);
  for (const l of launch.lines) io.out(l);
  const models = await build(env.providers, "model", "probe");
  try {
    const r = await liveProbe(judgeCaller(models, "dc-judges", termsGuard(launch.ledger.controller, terms, io.out)));
    for (const x of r) io.out("probe " + x.route + ": " + (x.ok ? "ok" : "FAILED (" + x.problem + ")"));
    writeJson(join(launch.sink, "probe.json"), r);
    const bad = r.filter((x) => !x.ok);
    if (bad.length) fail("E_DC_INFRA_MISSING", bad.length + " of " + r.length + " judge routes gave no text (" + bad.map((x) => x.route).join(", ") + "); no label pass starts until every route answers");
    io.out("probe: all " + r.length + " judge routes answered");
    return 0;
  } finally {
    await closeAll(models, launch.ledger);
  }
};

const PASSES = ["production", "check"] as const;

/** A subject's re-check size: 80 cells in 8 packets for a production judge, 40 in 4 for each particle-1 panel member. */
const recheckSize = (s: CheckSubject) =>
  JUDGE_OF[s.model] === "panel"
    ? { cells: JUDGING.recheck.cells / 2, packets: JUDGING.recheck.packets / 2, perClass: JUDGING.recheck.perClass / 2 }
    : { cells: JUDGING.recheck.cells, packets: JUDGING.recheck.packets, perClass: JUDGING.recheck.perClass };

const gateText = (g: GateReading) => g.reading + ", kappa " + f4(g.kappa) + ", catch " + f4(g.catchRate) + ", false-fail " + f4(g.falseFail) + ", " + g.anticipated + " anticipated and " + g.not + " not from " + g.lists + " lists";

/**
 * dc labels --pass production|check --in <dir> --read <tier> --stage <1|2> --terms --out.
 * production: label packets for the stage's final rows (shuffled-key packets with --shuffled). Stage 1 runs its first
 * packet alone and re-projects dc-judges; stage 2 also takes --check and --production (the stage 1 check and production
 * sinks) and carries each subject's blind re-check. check: the judge check on stage 1 lists against --production.
 */
export const labelsRow: Row = async (a, io, env) => {
  const usage = "labels --pass production|check --in <folder with units.json, rows.json> --read base|2x|10x --stage 1|2 --terms <terms.json> [--shuffled] [--production <stage 1 production sink>] [--check <stage 1 check sink>] --out <new sink folder>";
  const pass = oneOf(a, "--pass", PASSES, usage);
  const dir = resolve(need(a, "--in", usage));
  const read = oneOf(a, "--read", TIERS, usage);
  const stage = Number(oneOf(a, "--stage", ["1", "2"] as const, usage)) as Stage;
  const sink = need(a, "--out", usage);
  const terms = termsFrom(a);
  if (pass === "check" && stage !== 1) fail("E_USAGE", "the judge check runs on stage 1 lists; --stage is 1");
  const production = pass === "check" || stage === 2 ? readPass(need(a, "--production", usage), "--production") : null;
  const checked = pass === "production" && stage === 2 ? readPass(need(a, "--check", usage), "--check") : null;
  const list = readJson<ScoreUnit[]>(join(dir, "units.json"), "units.json");
  const units = new Map(list.map((u) => [u.unit.id, u]));
  const rows = readJson<ReviewRow[]>(join(dir, "rows.json"), "rows.json");
  const calibration = new Set(list.filter((u) => u.unit.set === "calibration").map((u) => u.unit.id));
  const partners = a.bools.has("--shuffled") ? (derangePartners(list) ?? fail("E_USAGE", "no derangement of the units in units.json keeps every partner on another base app")) : null;

  const launch = await start({ row: "labels", sink, items: ["dc-judges"], models: JUDGES, terms, record: { pass, read, stage, shuffled: partners !== null } }, env);
  for (const l of launch.lines) io.out(l);
  for (const f of ["units.json", "rows.json"]) copyFileSync(join(dir, f), join(launch.sink, f));
  const models = await build(env.providers, "model", "labels");
  const c = launch.ledger.controller;
  const guard = termsGuard(c, terms, io.out);
  const caller = judgeCaller(models, "dc-judges", guard);
  try {
    if (pass === "check") {
      const built = buildCheckPackets({ stage: 1, read, units, rows, calibration });
      const labels = await labelAll(built, caller);
      writePass(launch.sink, built, labels);
      io.out("labels: " + built.packets.length + " check packets labelled by astra, opus and argon");
      const inp: CheckInput = { units, check: { built, labels: new Map(labels.map((l) => [l.packet, l])) }, production: production! };
      const readings = CHECK_SUBJECTS.map((s) => ({ s, ...judgeCheck(s, inp) }));
      for (const r of readings) io.out("check " + r.s.judge + " on " + r.s.model + ": " + gateText(r.label) + "; detail " + gateText(r.detail));
      writeJson(join(launch.sink, "check.json"), readings.map((r) => ({ judge: r.s.judge, model: r.s.model, label: r.label, detail: r.detail })));
      const failing = (["opus", "sol", "particle"] as const satisfies readonly Model[]).filter((m) => readings.some((r) => r.s.model === m && r.label.reading === "kappa under 0.6"));
      for (const m of failing) {
        const plan = stopPlan("E_DC_JUDGE_KAPPA", { model: m, stage: 1 });
        await applyStop(c, plan);
        io.out("stop E_DC_JUDGE_KAPPA on " + m + ": reaches " + plan.reach);
      }
      if (failing.length) fail("E_DC_JUDGE_KAPPA", "a judge's kappa is under 0.6 on " + failing.join(", ") + " lists; that model's contrasts stop");
      io.out("labels: the judge check is written; a judge short of gold is read by dc read");
      return 0;
    }

    const prod = buildLabelPackets({ stage, read, units, rows, calibration, partners });
    const gold: { s: CheckSubject; built: Built; short: boolean; perClass: number }[] = [];
    if (stage === 2) {
      const inp: CheckInput = { units, check: checked!, production: production! };
      const taken = new Set(prod.packets.map((p) => p.id));
      for (const s of CHECK_SUBJECTS) {
        const size = recheckSize(s);
        const sample = recheckSample(s, goldFor(s, inp), { tier: read, cells: size.cells, packets: size.packets });
        gold.push({ s, built: recheckPackets(s, sample.packets, taken), short: sample.short, perClass: size.perClass });
      }
    }
    const goldPackets = gold.flatMap((g) => g.built.packets);
    const at = new Set(recheckPositions(prod.packets.length, goldPackets.length));
    const queue: Built = { packets: [], metas: [...prod.metas, ...gold.flatMap((g) => g.built.metas)] };
    for (let i = 0, p = 0, g = 0; i < prod.packets.length + goldPackets.length; i++) queue.packets.push(at.has(i) ? goldPackets[g++]! : prod.packets[p++]!);

    const labels: PacketLabels[] = [];
    let rest = queue.packets;
    if (stage === 1 && rest.length) {
      await holdForFirstPacket(c);
      const before = committedMicros(c.figures("dc-judges"));
      labels.push(...(await labelAll({ packets: rest.slice(0, 1), metas: queue.metas }, judgeCaller(models, "dc-judges", guard, FIRST_PACKET_TAG))));
      const p = await afterFirstPacket(c, { firstPacketMicros: committedMicros(c.figures("dc-judges")) - before, packetsLeft: rest.length - 1 });
      io.out(p.line);
      rest = rest.slice(1);
      if (!p.fits) {
        writePass(launch.sink, { packets: queue.packets.slice(0, 1), metas: queue.metas }, labels);
        io.out("labels: dc-judges is held for the Captain after the first packet; " + rest.length + " packets wait");
        return 2;
      }
    }
    labels.push(...(await labelAll({ packets: rest, metas: queue.metas }, caller)));
    const byPacket = new Map(labels.map((l) => [l.packet, l]));
    const ids = new Set(prod.packets.map((p) => p.id));
    writePass(launch.sink, prod, labels.filter((l) => ids.has(l.packet)));
    io.out("labels: " + prod.packets.length + " production packets at " + read + " in stage " + stage + (partners ? ", shuffled-key packets included" : ""));
    if (gold.length) {
      const gates = gold.map((g) => ({ g, gate: recheckGate(g.s, g.built, byPacket, { perClass: g.perClass }) }));
      for (const x of gates) io.out("recheck " + x.g.s.judge + " on " + x.g.s.model + ": " + gateText(x.gate) + (x.g.short ? " (sample short)" : ""));
      writeJson(join(launch.sink, "recheck.json"), gates.map((x) => ({ judge: x.g.s.judge, model: x.g.s.model, sampleShort: x.g.short, gate: x.gate, packets: x.g.built.packets, metas: x.g.built.metas, labels: labels.filter((l) => x.g.built.metas.some((m) => m.id === l.packet)) })));
    }
    return 0;
  } finally {
    await closeAll(models, launch.ledger);
  }
};
