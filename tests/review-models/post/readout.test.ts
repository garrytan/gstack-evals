// Copyright (c) 2026 Garry Tan. MIT License.
// Value: protects=the pilot readout reads every Pilots-table column per arm from a finished pilot (exposure, the read audit,
// judge errors against engineers' labels from the desk packages (seat A on every review, seat B on a subset, seat C where they differ), A-vs-B agreement, supply, cost, wall time, pilot spend, reruns against the reserve), then the staged rule
// and the frozen proceed set, and names no unit by anything but its opaque label; fails_when=an unexposed review, a judge
// error, a rerun or a contaminated search goes uncounted, a step runs out of order, the validation batch's labels land on the pilot's, or the Markdown quotes a unit id, PR,
// fix commit or advisory; why_new=GEVA-590 Pilots table, change 1 items 1 to 3, change 2 sections 2 and 4; seam=rm-post's
// keyless reads, its two paid batches and the desk package with planted person files, on a stub upstream behind the real metering proxy and a temporary ledger;
// no_claim=that real sessions look like these planted ones, which only the pilot shows
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readItem } from "../../../src/runner/ledger/record.ts";
import { readContamination, writeContamination } from "../../../src/trial/review/contamination.ts";
import { contaminationInputs, main } from "../../../lanes/review-models/post/cli.ts";
import { loadPilot, type PostKey } from "../../../lanes/review-models/post/pilot.ts";
import { assertSafe, pilotReadout, renderReadout } from "../../../lanes/review-models/post/readout.ts";
import { deskPackage, importFirst, importThird, pilotBatch, type DeskKey } from "../../../lanes/review-models/post/desk.ts";
import { judgeSend, secondReadSend } from "../../../lanes/review-models/post/send.ts";
import type { FinalRow } from "../../../lanes/review-models/score/labels.ts";
import { DRY_ENV, ITEMS, personFile, plant, upstream } from "./fixture.ts";

describe("rm-post end to end on a planted pilot (keyless)", () => {
  test("contamination, second read, judge, person labels and the readout, with one planted failure per kind", async () => {
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
    expect(await main(["label-send", "--run", s.run, "--key", s.keyPath, "--post", s.post, "--run-id", "x", "--item", ITEMS.labels])).toBe(2);
    const waiting = pilotReadout(pilot, null, s.history, s.historySha);
    expect(waiting.labels_waiting).toBe(true);
    expect(waiting.arms.every((a) => a.judge.waiting && a.judge.misses.length === 0)).toBe(true);
    expect(waiting.arms.find((a) => a.arm === "FS")!.pass).toBe(true);
    expect(waiting.proceed.set).toBe("all");
    const waitingMd = renderReadout(waiting, pilot);
    expect(waitingMd.match(/- Judge check: waiting on person labels\./g)).toHaveLength(5);
    expect(waitingMd).toContain("Carbon judge check: waiting on person labels.");

    const desk = join(s.dir, "desk");
    const pkg = deskPackage({ reviews: pilotBatch(pilot), batch: "pilot", desk, post: s.post });
    expect([pkg.labelled, pkg.subset, pkg.screens.A, pkg.screens.B, pkg.key.shape]).toEqual([49, 15, 54, 19, "review"]);
    expect(pkg.dirs).toEqual({ A: join(desk, "geva590-review-labels-pilot-a"), B: join(desk, "geva590-review-labels-pilot-b") });
    const oa1 = pkg.key.screens.find((x) => x.kind === "review" && x.arm === "OA" && x.unit === s.key.pilot[0]!.unit)!;
    const split = pkg.key.subset!.includes(oa1.sid) ? 1 : 0;
    const first = importFirst({ post: s.post, batch: "pilot", reviews: pilotBatch(pilot), files: [{ name: "A1", text: personFile(pkg.dirs.A, "A1", "A") }, { name: "B1", text: personFile(pkg.dirs.B, "B1", "B", { none_on: "DISAGREE" }) }] });
    expect(first).toMatchObject({ reviews: 49, subset: 15, agreed: 15 - split, disagreements: split, final: !split });
    if (split) {
      expect(existsSync(join(s.post, "labels", "final.json"))).toBe(false);
      const settled = importThird({ post: s.post, batch: "pilot", file: { name: "C1", text: personFile(first.third!, "C1", "C") } });
      expect(settled).toMatchObject({ reviews: 49, disagreements: 1, unresolved: 0, final: true });
    }

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
    expect(md).toContain("- Person agreement (R125): seat A and seat B read " + (15 - split) + " of 15 subset reviews alike, kappa ");
    expect(() => assertSafe(md + "\n" + s.key.pilot[6]!.markers.commits[0], pilot)).toThrow(/E_RM_POST_INPUT the readout would name/);

    const out = join(s.dir, "readout.md");
    const code = await main(["readout", "--run", s.run, "--key", s.keyPath, "--post", s.post, "--history", s.history, "--md", out]);
    expect(code).toBe(2);
    expect(existsSync(out)).toBe(false);
  }, 120_000);

  test("the validation batch loads from its run dir by --batch and gets its own desk package, screen key and final labels", async () => {
    const s = plant();
    const up = upstream();
    const k = JSON.parse(readFileSync(s.keyPath, "utf8")) as PostKey;
    expect(() => loadPilot(s.run, k, s.post, "validation")).toThrow(/E_RM_POST_INPUT the post key has no validation units/);
    const vkey: PostKey = { ...k, pilot: k.pilot.filter((u) => u.pool === "decoy"), validation: k.pilot.filter((u) => u.pool !== "decoy") };
    const keyPath = join(s.dir, "key-validation.json");
    writeFileSync(keyPath, JSON.stringify(vkey));
    const desk = join(s.dir, "desk");
    const args = ["--run", s.run, "--key", keyPath, "--post", s.post];
    expect(await main(["desk-package", ...args, "--desk", desk, "--batch", "later"])).toBe(2);
    expect(await main(["contamination", ...args, "--batch", "validation"])).toBe(0);
    await secondReadSend(s.post, { item: ITEMS.second, run_id: "second-v", record: s.record, ledger: s.ledger, env: DRY_ENV, fetch: up.fetch, warn: () => {} });
    const pilot = loadPilot(s.run, vkey, s.post, "validation");
    expect(pilot.reviews.map((r) => r.unit).every((u) => vkey.validation!.some((v) => v.unit === u))).toBe(true);
    expect(await main(["desk-package", ...args, "--desk", desk, "--batch", "validation"])).toBe(0);
    const dir = join(desk, "geva590-review-labels-validation-a"), dirB = join(desk, "geva590-review-labels-validation-b");
    for (const d of [dir, dirB]) expect(readFileSync(join(d, "privacy-check.md"), "utf8")).toContain("Result: BLOCKING HITS: 0.");
    expect(existsSync(join(desk, "geva590-review-labels-pilot-a"))).toBe(false);
    const key = JSON.parse(readFileSync(join(s.post, "labels", "people", "validation", "key.json"), "utf8")) as DeskKey;
    expect(key).toMatchObject({ batch: "validation", schema: "rm-desk-key.v2" });
    expect(key.subset).toHaveLength(15);
    expect(key.screens.filter((x) => x.kind === "review").map((x) => x.arm + " " + x.unit).sort()).toEqual(pilotBatch(pilot).filter((r) => r.findings.length).map((r) => r.arm + " " + r.unit).sort());
    const f1 = join(s.dir, "labels-A1-A.txt"), f2 = join(s.dir, "labels-B1-B.txt");
    writeFileSync(f1, personFile(dir, "A1", "A"));
    writeFileSync(f2, personFile(dirB, "B1", "B"));
    expect(await main(["labels-import", ...args, "--batch", "validation", "--file", f1, "--round", "third"])).toBe(2);
    expect(await main(["labels-import", ...args, "--batch", "validation", "--file", f1, "--file", f2])).toBe(0);
    expect(JSON.parse(readFileSync(join(s.post, "labels", "final-validation.json"), "utf8"))).toHaveLength(key.screens.filter((x) => x.kind === "review").length + key.auto_no.length);
    expect(existsSync(join(s.post, "labels", "final.json"))).toBe(false);
    expect(await main(["readout", ...args, "--batch", "validation", "--history", s.history, "--md", join(s.dir, "v.md")])).toBe(2);
  }, 120_000);
});
