// Copyright (c) 2026 Garry Tan. MIT License.
// Value: protects=the pilot readout reads every Pilots-table column per arm from a finished pilot (exposure, the read audit,
// judge errors against the labels, supply, cost, wall time, pilot spend, reruns against the reserve), then the staged rule
// and the frozen proceed set, and names no unit by anything but its opaque label; fails_when=an unexposed review, a judge
// error, a rerun or a contaminated search goes uncounted, a step runs out of order, or the Markdown quotes a unit id, PR,
// fix commit or advisory; why_new=GEVA-590 Pilots table, change 1 items 1 to 3, change 2 sections 2 and 4; seam=rm-post's
// keyless reads and its three paid batches on a stub upstream behind the real metering proxy and a temporary ledger;
// no_claim=that real sessions look like these planted ones, which only the pilot shows
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readItem } from "../../../src/runner/ledger/record.ts";
import { readContamination, writeContamination } from "../../../src/trial/review/contamination.ts";
import { contaminationInputs, main } from "../../../lanes/review-models/post/cli.ts";
import { loadPilot } from "../../../lanes/review-models/post/pilot.ts";
import { assertSafe, pilotReadout, renderReadout } from "../../../lanes/review-models/post/readout.ts";
import { judgeSend, labelSend, secondReadSend, type FinalRow } from "../../../lanes/review-models/post/send.ts";
import { DRY_ENV, ITEMS, plant, upstream } from "./fixture.ts";

describe("rm-post end to end on a planted pilot (keyless)", () => {
  test("contamination, second read, judge, labels and the readout, with one planted failure per kind", async () => {
    const s = plant();
    const up = upstream();
    const opts = (item: string, run_id: string) => ({ item, run_id, record: s.record, ledger: s.ledger, env: DRY_ENV, fetch: up.fetch, warn: () => {} });
    const key = JSON.parse(readFileSync(s.keyPath, "utf8"));
    let pilot = loadPilot(s.run, key, s.post);
    expect(pilot.reviews.length).toBe(55);
    await expect(labelSend(pilot, s.post, opts(ITEMS.labels, "labels-early"))).rejects.toThrow(/E_RM_POST_INPUT no contamination report/);

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
    const labels = await labelSend(pilot, s.post, opts(ITEMS.labels, "labels-1"));
    expect(labels).toMatchObject({ items: 49, disagreements: 1, labelled: 49, unresolved: 0, missing: 0 });
    expect(labels.sent).toBe(49 * 2 + 2 + 1);
    const before = up.calls.length;
    const rerun = await labelSend(loadPilot(s.run, key, s.post), s.post, opts(ITEMS.labels, "labels-1"));
    expect([rerun.sent, up.calls.length - before]).toEqual([0, 0]);
    for (const item of Object.values(ITEMS)) expect(readItem(s.record, item).open).toBeNull();
    const items = JSON.parse(readFileSync(join(s.post, "labels", "items.json"), "utf8"));
    expect(items.items.every((it: { id: string; prompt: string }) => /^L[0-9a-z]{6,}$/.test(it.id) && !it.prompt.includes("acme/"))).toBe(true);

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

    const md = renderReadout(r, pilot);
    for (const u of s.key.pilot) {
      expect(md).not.toContain(u.unit);
      for (const c of u.markers.commits) expect(md).not.toContain(c.slice(0, 7));
      for (const id of u.markers.ids) expect(md).not.toContain(id);
    }
    expect(md).toContain("## OA: passes its pilot");
    expect(md).toContain("Proceed set: **all**");
    expect(() => assertSafe(md + "\n" + s.key.pilot[6]!.markers.commits[0], pilot)).toThrow(/E_RM_POST_INPUT the readout would name/);

    const out = join(s.dir, "readout.md");
    const code = await main(["readout", "--run", s.run, "--key", s.keyPath, "--post", s.post, "--history", s.history, "--md", out]);
    expect(code).toBe(2);
    expect(existsSync(out)).toBe(false);
  }, 120_000);
});
