// Copyright (c) 2026 Garry Tan. MIT License.
// dc modelprobe: PD-19's one short call per model, run first after the go and before any stage spends, every call
// charged to dc-gate-check as PD-34 rules. It runs under the same start rules and ledger admission as the other paid
// rows, so off the controller host it refuses with E_DCW_OFF_HOST. Each call goes through the metered model caller and
// start rule 9's guard; a reply that names no provider resolves through OpenRouter's generation record in the caller,
// and one that still names none, or names another provider, is a drift that stops that model (PD-9). The row prints a
// line per model and every problem, and leaves dc-gate-check's lease open for the gate check.
import { join } from "node:path";
import { DcError, fail } from "../errors.ts";
import { DIRECT_MODELS } from "../money/price.ts";
import { modelProbePlan, runModelProbe } from "../paid/pin.ts";
import { build, termsGuard } from "../wire.ts";
import { writeJson } from "./json.ts";
import { closeAll, need, start, termsFrom, type Row } from "./start.ts";

export const modelProbeRow: Row = async (a, io, env) => {
  const usage = "modelprobe --terms <terms.json> --out <new sink folder>";
  const sink = need(a, "--out", usage);
  const terms = termsFrom(a);
  const plan = modelProbePlan();
  const launch = await start({ row: "modelprobe", sink, items: ["dc-gate-check"], models: plan.map((p) => p.model), terms, record: { probes: plan.length } }, env);
  for (const l of launch.lines) io.out(l);
  const models = await build(env.providers, "model", "modelprobe");
  try {
    const guard = termsGuard(launch.ledger.controller, terms, io.out);
    const r = await runModelProbe(plan, async (p) => {
      try {
        const reply = await models.call({ item: "dc-gate-check", model: p.model, prompt: p.prompt, maxTokens: p.maxTokens, effort: null, label: p.label, subject: null, tag: null });
        await guard(p.model, reply.served);
        const provider = DIRECT_MODELS[p.model].provider;
        return { servedBy: provider === "openrouter" ? (reply.served?.provider ?? null) : provider, problem: reply.problem };
      } catch (e) {
        if (!(e instanceof DcError)) throw e;
        return { servedBy: null, problem: e.code + " " + e.message };
      }
    });
    for (const l of r.lines) io.out(l);
    for (const p of r.problems) io.out("probe problem: " + p);
    writeJson(join(launch.sink, "probe.json"), r);
    if (r.problems.length) fail("E_DCW_MODEL_PROBE", r.problems.length + " of " + plan.length + " models failed the probe; no stage spends until the Captain clears them");
    io.out("modelprobe: all " + plan.length + " models answered and named their provider");
    return 0;
  } finally {
    await closeAll(models, launch.ledger);
  }
};
