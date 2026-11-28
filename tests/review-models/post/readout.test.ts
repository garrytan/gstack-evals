// Copyright (c) 2026 Garry Tan. MIT License.
// Value: protects=the pilot readout reads every Pilots-table column per arm from a finished pilot (exposure, the read audit,
// judge errors against change 9's labels (Grok 4.7, with Kimi K3.1 Pro where Grok can't), the labeller and fallback counts per arm, supply, cost, wall time, pilot spend, reruns against the reserve), then the staged rule
// and the frozen proceed set, and names no unit by anything but its opaque label; fails_when=an unexposed review, a judge
// error, a rerun or a contaminated search goes uncounted, a step runs out of order, the validation batch's labels land on the pilot's, the R78 gate leaves out a batch, a fallback goes unnamed, a judge-check line lacks change 9's wording, or the Markdown quotes a unit id, PR,
// fix commit or advisory; why_new=GEVA-590 Pilots table, change 1 items 1 to 3, change 2 sections 2 and 4; seam=rm-post's
// keyless reads and its three paid batches on a stub upstream behind the real metering proxy and a temporary ledger;
// no_claim=that real sessions look like these planted ones, which only the pilot shows
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readItem } from "../../../src/runner/ledger/record.ts";
import { readContamination, writeContamination } from "../../../src/trial/review/contamination.ts";
import { contaminationInputs, main } from "../../../lanes/review-models/post/cli.ts";
import { loadPilot, type PostKey } from "../../../lanes/review-models/post/pilot.ts";
import { assertSafe, pilotReadout, renderReadout } from "../../../lanes/review-models/post/readout.ts";
import { finalPath, judgeSend, labelOrder, labelSend, pilotBatch, secondReadSend } from "../../../lanes/review-models/post/send.ts";
import { CHECK_LINE } from "../../../lanes/review-models/score/frozen.ts";
import { labelPrompt, type FinalRow } from "../../../lanes/review-models/score/labels.ts";
import { DRY_ENV, ITEMS, plant, upstream } from "./fixture.ts";

describe("rm-post end to end on a planted pilot (keyless)", () => {
  test("contamination, second read, judge, labels and the readout, with one planted failure per kind", async () => {
    const s = plant();
    const up = upstream();
    const opts = (item: string, run_id: string) => ({ item, run_id, record: s.record, ledger: s.ledger, env: DRY_ENV, fetch: up.fetch, warn: () => {} });
    const key = JSON.parse(readFileSync(s.keyPath, "utf8"));
    let pilot = loadPilot(s.run, key, s.post);
    expect(pilot.reviews.length).toBe(55);
    expect(() => pilotBatch(pilot)).toThrow(/E_RM_POST_INPUT no contamination report/);

    const report = readContamination(contaminationInputs(pilot), pilot.markers, []);
    const { cases } = writeContamination(join(s.post, "contamination"), report, pilot.markers);
    expect(report.contaminated).toEqual(["OS " + s.key.pilot[6]!.unit]);
    expect(cases).toBe(1);
    const second = await secondReadSend(s.post, opts(ITEMS.second, "second-1"));
    expect([second.cases, second.clean, second.contaminated, second.failed, second.sent]).toEqual([1, 1, 0, 0, 1]);
    expect(up.calls.at(-1)!.body.model).toBe("gpt-6.2-astra");

    pilot = loadPilot(s.run, key, s.post);
    const judged = await judgeSend(pilot, s.post, opts(ITEMS.judge, "judge-1"));
    expect([judged.judged, judged.failed, judged.sent]).toEqual([50, 0, 51]);
    const carbon = up.calls.filter((c) => c.provider === "openrouter");
    expect(carbon.length).toBe(51);
    expect(carbon[0]!.body).toMatchObject({ model: "google/gemini-4-carbon", provider: { only: ["google-vertex"], allow_fallbacks: false } });
    expect(carbon.every((c) => !/claude|fable|opus|codex|astra|sol\b/i.test(c.body.messages[0].content.split("The review's findings, numbered:")[1]))).toBe(true);
    const again = await judgeSend(loadPilot(s.run, key, s.post), s.post, opts(ITEMS.judge, "judge-1"));
    expect([again.judged, again.sent]).toEqual([0, 0]);

    pilot = loadPilot(s.run, key, s.post);
    const args = ["--run", s.run, "--key", s.keyPath, "--post", s.post];
    expect(await main(["desk-package", ...args, "--desk", join(s.dir, "desk")])).toBe(2);
    expect(await main(["labels-import", ...args, "--file", join(s.dir, "x.txt")])).toBe(2);
    const waiting = pilotReadout(pilot, null, s.history, s.historySha);
    expect(waiting.labels_waiting).toBe(true);
    expect(waiting.arms.every((a) => a.judge.waiting && a.judge.misses.length === 0)).toBe(true);
    expect(waiting.arms.find((a) => a.arm === "FS")!.pass).toBe(true);
    expect(waiting.proceed.set).toBe("all");
    const waitingMd = renderReadout(waiting, pilot);
    expect(waitingMd.match(/- Judge check: waiting on labels\./g)).toHaveLength(5);
    expect(waitingMd).toContain("Carbon judge check: waiting on labels (rm-post label-send).");

    const order = labelOrder(pilotBatch(pilot).filter((r) => r.findings.length));
    const refused = order.find((r) => r.arm === "N")!, lost = order.find((r) => r.arm === "OA")!;
    const plantOn = (r: (typeof order)[number]) => labelPrompt(r.bug, r.findings);
    const labelFetch = (async (url: any, init?: any) => {
      const b = JSON.parse(String(init?.body ?? "{}"));
      const prompt = b.messages?.[0]?.content;
      if (b.model === "x-ai/grok-4.7" && (prompt === plantOn(refused) || prompt === plantOn(lost))) return Response.json({ id: "g", model: b.model, provider: "Amazon Bedrock", choices: [{ message: { role: "assistant", content: "" }, finish_reason: "content_filter" }], usage: { prompt_tokens: 900, completion_tokens: 0 } });
      if (b.model === "moonshotai/kimi-k3.1-pro" && prompt === plantOn(lost)) return Response.json({ error: { message: "planted" } }, { status: 400 });
      return up.fetch(url, init);
    }) as typeof fetch;
    const labels = await labelSend(pilotBatch(pilot), s.post, "pilot", { ...opts(ITEMS.labels, "labels-1"), fetch: labelFetch });
    expect([labels.reviews, labels.by.grok, labels.by.kimi, labels.cant_tell]).toEqual([49, order.length - 2, 1, 1]);

    pilot = loadPilot(s.run, key, s.post);
    const final: FinalRow[] = JSON.parse(readFileSync(join(s.post, "labels", "final.json"), "utf8"));
    const r = pilotReadout(pilot, final, s.history, s.historySha);
    const arm = (a: string) => r.arms.find((x) => x.arm === a)!;
    expect(arm("OA").part_ran).toMatchObject({ pass: true, measured: expect.stringContaining("9 of 10") });
    expect(arm("OA").part_ran.misses[0]).toContain("the Claude adversarial subagent was never launched");
    expect(arm("FS").judge).toMatchObject({ pass: true, errors: 1, labelled: 10 });
    expect(arm("FS").judge.misses[0]).toContain("Carbon names, labels say no");
    expect(arm("OS").judge).toMatchObject({ pass: true, labelled: 9, taken: 9 });
    expect(arm("OS").judge.left_out).toEqual([s.key.pilot[6]!.label + " (contaminated)"]);
    expect(arm("OS").contaminated).toBe(1);
    expect([arm("FA").reruns, arm("FA").rerun_usd]).toEqual([1, 2.5]);
    expect(arm("N").part_ran).toMatchObject({ pass: true, measured: "11 of 11 sessions clean" });
    expect(r.arms.every((a) => a.supply.pass && a.within_cap)).toBe(true);
    expect(r.reserve).toMatchObject({ reruns: 1, pilot_reviews: 55, rerun_usd: 2.5 });
    expect(r.reserve.sets.find((x) => x.set === "all")).toMatchObject({ counted_reviews: 560, holds: true });
    expect(r.staged.rule!.drop_fable).toBe(false);
    expect(r.proceed.set).toBe("all");
    expect(r.check_rows.length).toBe(49);
    expect(r.labels!.per_arm.N).toMatchObject({ kimi: 1, cant_tell: 0 });
    expect(r.labels!.per_arm.OA).toMatchObject({ kimi: 0, cant_tell: 1, unlabelled: 1 });
    expect(r.gate).toBeNull();

    const md = renderReadout(r, pilot);
    for (const u of s.key.pilot) {
      expect(md).not.toContain(u.unit);
      for (const c of u.markers.commits) expect(md).not.toContain(c.slice(0, 7));
      for (const id of u.markers.ids) expect(md).not.toContain(id);
    }
    expect(md).toContain("## OA: passes its pilot");
    expect(md).toContain("Proceed set: **all**");
    expect(md).toContain("- " + r.kappa.line + "; " + CHECK_LINE + ".");
    expect(md).toContain("judge checked against Grok 4.7, a fourth model family, not against people; Gemini 4 Neon was not used because the judge is a Gemini model");
    expect(md).toContain("- Labels: 49 reviews, " + (order.length - 2) + " by Grok 4.7, 1 by Kimi K3.1 Pro after Grok could not label them");
    expect(md).toContain("N 10 labels, 1 Kimi fallback, 0 can't tell (0 labelled by neither)");
    expect(md).toContain("OA 10 labels, 0 Kimi fallbacks, 1 can't tell (1 labelled by neither)");
    expect(md).toContain(refused.label + " N: labelled by Kimi (Grok: refused)");
    expect(md).toContain(lost.label + " OA: can't tell, labelled by neither model (Grok: refused; Kimi: harness failure (HTTP 400))");
    expect(md).toContain("- R78 gate: waiting on the validation batch's labels");
    expect(md).not.toMatch(/person labels?\.|seat [ABC]|labelling desk|subset reviews/);
    expect(() => assertSafe(md + "\n" + s.key.pilot[6]!.markers.commits[0], pilot)).toThrow(/E_RM_POST_INPUT the readout would name/);

    const out = join(s.dir, "readout.md");
    const code = await main(["readout", "--run", s.run, "--key", s.keyPath, "--post", s.post, "--history", s.history, "--md", out]);
    expect(code).toBe(2);
    expect(existsSync(out)).toBe(false);
  }, 120_000);

  test("the validation batch loads by --batch, gets its own labels, and joins the pilot's in the R78 gate", async () => {
    const s = plant();
    const up = upstream();
    const k = JSON.parse(readFileSync(s.keyPath, "utf8")) as PostKey;
    expect(() => loadPilot(s.run, k, s.post, "validation")).toThrow(/E_RM_POST_INPUT the post key has no validation units/);
    // The validation batch reuses the pilot's bug units in memory (readKey refuses a key that repeats a unit), so both batches
    // load from the one planted run.
    const vkey: PostKey = { ...k, validation: k.pilot.filter((u) => u.pool !== "decoy") };
    const opts = (item: string, run_id: string) => ({ item, run_id, record: s.record, ledger: s.ledger, env: DRY_ENV, fetch: up.fetch, warn: () => {} });
    const args = ["--run", s.run, "--key", s.keyPath, "--post", s.post];
    expect(await main(["label-send", ...args, "--batch", "later", "--run-id", "x", "--item", ITEMS.labels])).toBe(2);
    const p0 = loadPilot(s.run, vkey, s.post);
    writeContamination(join(s.post, "contamination"), readContamination(contaminationInputs(p0), p0.markers, []), p0.markers);
    await secondReadSend(s.post, opts(ITEMS.second, "second-v"));
    const pilot = loadPilot(s.run, vkey, s.post), vpilot = loadPilot(s.run, vkey, s.post, "validation");
    expect(vpilot.reviews.map((r) => r.unit).every((u) => vkey.validation!.some((v) => v.unit === u))).toBe(true);
    await judgeSend(pilot, s.post, opts(ITEMS.judge, "judge-1"));
    await judgeSend(vpilot, s.post, opts(ITEMS.judge, "judge-1"));
    const v = await labelSend(pilotBatch(loadPilot(s.run, vkey, s.post, "validation")), s.post, "validation", opts(ITEMS.labels, "labels-1"));
    expect(existsSync(finalPath(s.post))).toBe(false);
    const vfinal: FinalRow[] = JSON.parse(readFileSync(finalPath(s.post, "validation"), "utf8"));
    expect(vfinal).toHaveLength(v.reviews);
    expect(existsSync(join(s.post, "labels", "validation", "replies.jsonl"))).toBe(true);
    await labelSend(pilotBatch(loadPilot(s.run, vkey, s.post)), s.post, "pilot", opts(ITEMS.labels, "labels-1"));
    const final: FinalRow[] = JSON.parse(readFileSync(finalPath(s.post), "utf8"));
    const r = pilotReadout(loadPilot(s.run, vkey, s.post), final, s.history, s.historySha, { pilot: loadPilot(s.run, vkey, s.post, "validation"), final: vfinal });
    expect(r.gate).toMatchObject({ labels: final.length + vfinal.length, pass: false });
    expect(r.gate!.tally.reviews).toBe(final.length + vfinal.length);
    const md = renderReadout(r, pilot);
    expect(md).toContain("### R78 gate (change 9 item 5): pilot and validation");
    expect(md).toContain("- R78 gate fails: Carbon judge check: " + (final.length + vfinal.length) + " labelled reviews, kappa ");
    expect(md.split("### R78 gate")[1]!.split("\n").filter((l) => l.includes("kappa")).every((l) => l.endsWith(CHECK_LINE + "."))).toBe(true);
    expect(await main(["readout", ...args, "--batch", "validation", "--history", s.history, "--md", join(s.dir, "v.md")])).toBe(2);
  }, 120_000);
});
