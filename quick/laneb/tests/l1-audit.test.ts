// L1 Amendment C's read-audit procedures (l1/audit.ts): procedure (a), the line-wide xargs rule against the merged one per call,
// and procedure (b), one contamination decision per none session from whether gstack file content came back, and its apply step.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyDecisions, buildCorpus, decide, xargsAudit, type Decision } from "../l1/audit.ts";
import { row } from "./fixtures/l1/synthetic.ts";

const LAW = "Iron Law: no fixes without root cause investigation first, ever.";
const LAW2 = "Second rule: gather the evidence before you write any fix at all.";
const SHARED = "This line sits in the none arm tar too, so it proves nothing.";
const MIT = "Permission is hereby granted, free of charge, to any person obtaining a copy";
const MIT2 = 'of this software and associated documentation files (the "Software"), to deal';
const APACHE = 'Licensed under the Apache License, Version 2.0 (the "License");';
const APACHE2 = "you may not use this file except in compliance with the License.";
let n = 0;
const bash = (command: string, out: string, error = false) => {
  const id = "toolu_" + ++n;
  return [{ type: "AssistantMessage", content: [{ id, name: "Bash", input: { command } }] }, { type: "UserMessage", content: [{ tool_use_id: id, content: out, is_error: error }] }];
};
const read = (file_path: string, out: string) => {
  const id = "toolu_" + ++n;
  return [{ type: "AssistantMessage", content: [{ id, name: "Read", input: { file_path } }] }, { type: "UserMessage", content: [{ tool_use_id: id, content: out, is_error: false }] }];
};
function trials(sessions: Record<string, { arm?: string; calls: object[][] }>) {
  const root = mkdtempSync(join(tmpdir(), "l1-audit-"));
  mkdirSync(join(root, "job"));
  writeFileSync(join(root, "job", "config.json"), JSON.stringify({ job_name: "job", agents: [] }));
  for (const [name, s] of Object.entries(sessions)) {
    const d = join(root, "job", name);
    mkdirSync(join(d, "evaluator"), { recursive: true });
    writeFileSync(join(d, "config.json"), JSON.stringify({ agent: { name: "laneb-claude-code", kwargs: { arm: s.arm ?? "none" } } }));
    const log = [{ type: "SystemMessage", subtype: "init", init: { cwd: "/testbed" } }, ...s.calls.flat()];
    writeFileSync(join(d, "evaluator", "sdk-messages.jsonl"), log.map((r) => JSON.stringify(r)).join("\n") + "\n");
  }
  return root;
}
function corpus() {
  const root = mkdtempSync(join(tmpdir(), "l1-audit-arms-"));
  const put = (p: string, body: string) => { mkdirSync(join(root, p, ".."), { recursive: true }); writeFileSync(join(root, p), body); };
  put("after/.claude/skills/investigate/SKILL.md", "---\nname: investigate\n---\n" + LAW + "\n" + LAW2 + "\n" + SHARED + "\nshort line\n");
  put("after/.claude/skills/gstack/LICENSE", "MIT License\n" + MIT + "\n" + MIT2 + "\n");
  put("after/.claude/skills/gstack/NOTICE.md", MIT.replace("Permission", "Notice") + "\n");
  put("before/.local/share/gstack/COPYING.txt", MIT2.replace("of this", "copying") + "\n");
  put("after/.claude/skills/gstack/Licenses/MIT-elaya.txt", MIT.replace("Permission", "Mixed") + "\n" + MIT2.replace("of this", "mixed") + "\n");
  put("before/.claude/skills/gstack/LICENSES/Apache-2.0.txt", APACHE + "\n" + APACHE2 + "\n");
  put("after/.claude/skills/gstack/vendor/license.md", MIT.replace("Permission", "Lower") + "\n");
  put("after/.claude/skills/investigate/bin.dat", "\u0000" + LAW.replace("Iron", "Bin"));
  put("after/other/notes.md", LAW.replace("Iron", "Outside"));
  put("after/.claude/skills/gstack/node_modules/x/README.md", LAW.replace("Iron", "Vendored"));
  put("none/.claude/settings.json", SHARED + "\n");
  return buildCorpus([join(root, "before"), join(root, "after")], join(root, "none"));
}
const SKILL = "~/.claude/skills/investigate/SKILL.md";
const LINEWIDE = "echo " + SKILL + "; ls | xargs wc -l";

describe("procedure (a): the line-wide xargs rule against the merged rule, call by call", () => {
  // Value: protects=#218's promise that every call main's line-wide rule flags and the scoped rule does not is printed for a person, and the reverse; fails_when=a disagreement goes unprinted, an agreed call prints, or a gstack arm's session is read; why_new=GEVA-294; seam=audit.ts xargsAudit over trial dirs; no_claim=the person's reading of each line
  test("prints each call whose hits differ, both ways, skips agreeing calls and gstack arms, and counts them", () => {
    const root = trials({
      a: { calls: [bash(LINEWIDE, "3 total"), bash("cat /testbed/README.md", "hello"), bash("cat " + SKILL, "x: 1")] },
      b: { calls: [bash("find ~ -name SKILL.md -exec cat {} +", "x: 1")] },
      c: { arm: "after-u", calls: [bash(LINEWIDE, "3 total")] },
    });
    expect(xargsAudit([root])).toEqual([
      "line-wide only\ta\tBash\tBash /root/.claude/skills/investigate/SKILL.md\t" + LINEWIDE,
      "scoped only\tb\tBash\tBash /root\tfind ~ -name SKILL.md -exec cat {} +",
      "xargs-audit: 2 none sessions, 4 tool calls; line-wide only 1 calls in 1 sessions; scoped only 1 calls in 1 sessions; 0 calls hit by both with different hits",
    ]);
  });
});

describe("procedure (b): a drop stands only when gstack file content came back", () => {
  // Value: protects=the none arm's contamination drops: a mention or an empty or failed read is overturned, a real read of a gstack file stands, and a real read only the line-wide rule sees is listed; fails_when=any session lands in another class; why_new=GEVA-294; seam=audit.ts decide and buildCorpus; no_claim=real arm tars, which the dry run reads
  test("stands on gstack content (Bash, Read with line numbers, a drive read), overturned on a mention or a line the none arm holds, listed on a line-wide-only real read", () => {
    const root = trials({
      stands: { calls: [bash("cat " + SKILL, "---\n" + LAW + "\n" + LAW2 + "\n")] },
      read: { calls: [read("/root/.claude/skills/investigate/SKILL.md", "     4\u2192" + LAW + "\n     5\u2192" + LAW2)] },
      drive: { calls: [bash("cat ~/.capy/drive/x/SKILL.md", "anything at all")] },
      mention: { calls: [bash("cat " + SKILL, "x: 1")] },
      shared: { calls: [bash("cat " + SKILL, SHARED)] },
      outside: { calls: [bash("cat " + SKILL, LAW.replace("Iron", "Outside") + "\n" + LAW.replace("Iron", "Bin") + "\n" + LAW.replace("Iron", "Vendored"))] },
      listed: { calls: [bash(LINEWIDE, "  12 /x\n  prefix " + LAW + " suffix\n" + LAW2)] },
      quiet: { calls: [bash(LINEWIDE, "3 total")] },
      gstack: { arm: "after-u", calls: [bash("cat " + SKILL, LAW)] },
    });
    const { decisions, summary } = decide([root], corpus());
    expect(decisions.map((d) => d.trial + " " + d.decision)).toEqual(["drive stands", "listed listed", "mention overturned", "outside overturned", "read stands", "shared overturned", "stands stands"]);
    expect(decisions.find((d) => d.trial === "stands")!.evidence).toBe("Bash cat ~/.claude/skills/investigate/SKILL.md -> .claude/skills/investigate/SKILL.md: " + LAW + " | .claude/skills/investigate/SKILL.md: " + LAW2);
    expect(decisions.find((d) => d.trial === "drive")!.evidence).toContain("drive content from Bash /root/.capy/drive/x/SKILL.md");
    expect(summary).toBe("contamination: 8 none sessions, 2 gstack lines; the merged rule drops 6: stands 3, overturned 3; listed 1");
  });
  // Value: protects=the Captain's ruling 1 (GSTA-2, 2026-11-05): licence files are no corpus, and content needs two distinct corpus lines or a corpus file path the call did not name; fails_when=a clean session that prints a licence is listed, a real read is overturned, or one generic line or an echo of the agent's own path keeps a drop; why_new=GEVA-296 round 2 (p1/red-team#1, v1/adversarial-native#2); seam=audit.ts buildCorpus and decide; no_claim=real arm tars, which the dry run reads
  test("a line-wide-only call that prints licence lines leaves the session graded, since LICENSE, NOTICE and COPYING files are no corpus", () => {
    const root = trials({ licence: { calls: [bash(LINEWIDE, "repo/LICENSE:\n" + MIT + "\n" + MIT2 + "\n" + MIT.replace("Permission", "Notice") + "\n" + MIT2.replace("of this", "copying"))] } });
    const c = corpus();
    expect(c.lines).toBe(2);
    expect(decide([root], c).decisions).toEqual([]);
  });
  test("a licenses dir in any case (Licenses, LICENSES) and a lowercase licence name are no corpus either", () => {
    const root = trials({ dirs: { calls: [bash(LINEWIDE, MIT.replace("Permission", "Mixed") + "\n" + MIT2.replace("of this", "mixed") + "\n" + APACHE + "\n" + APACHE2 + "\n" + MIT.replace("Permission", "Lower"))] } });
    const c = corpus();
    expect(c.lines).toBe(2);
    expect(c.paths).toEqual([".claude/skills/investigate/SKILL.md"]);
    expect(decide([root], c).decisions).toEqual([]);
  });
  test("a merged-rule drop stands on two SKILL.md lines or one line and a gstack path the call did not name, and is overturned on one generic line or one line beside the call's own path", () => {
    const root = trials({
      real: { calls: [bash("cat " + SKILL, "---\n" + LAW + "\n" + LAW2 + "\n")] },
      grep: { calls: [bash("grep -rn Iron ~/.claude/skills", "/root/.claude/skills/investigate/SKILL.md:4:" + LAW)] },
      generic: { calls: [bash("cat " + SKILL, "---\n" + LAW + "\n")] },
      echo: { calls: [bash("cat " + SKILL, "cat: /root/.claude/skills/investigate/SKILL.md: line 4: " + LAW)] },
    });
    const { decisions } = decide([root], corpus());
    expect(decisions.map((d) => d.trial + " " + d.decision)).toEqual(["echo overturned", "generic overturned", "grep stands", "real stands"]);
    expect(decisions.find((d) => d.trial === "grep")!.evidence).toEndWith(" | prints .claude/skills/investigate/SKILL.md");
  });
  // Value: protects=the Captain's ruling 2: before a drop is overturned, every call result, errored ones included, gets the same content test; fails_when=gstack content in an errored result lets a drop be overturned, or one generic line in one saves it; why_new=GEVA-296 round 2 (v1/adversarial-native#1); seam=audit.ts decide; no_claim=real transcripts
  test("a drop on a mention stands when an errored result printed two SKILL.md lines, and is overturned when it printed one", () => {
    const root = trials({
      errored: { calls: [bash("cat " + SKILL + "; ls /missing", LAW + "\n" + LAW2 + "\nls: /missing: No such file", true), bash("ls ~/.claude/skills/investigate", "SKILL.md")] },
      onegeneric: { calls: [bash("cat " + SKILL + "; ls /missing", LAW + "\nls: /missing: No such file", true), bash("ls ~/.claude/skills/investigate", "SKILL.md")] },
    });
    const { decisions } = decide([root], corpus());
    expect(decisions.map((d) => d.trial + " " + d.decision)).toEqual(["errored stands", "onegeneric overturned"]);
    expect(decisions[0]!.evidence).toContain("(an error result) -> .claude/skills/investigate/SKILL.md: " + LAW);
  });
  test("an error result is no read, even when it quotes a gstack line: neither rule drops or adds the session", () => {
    const root = trials({ err: { calls: [bash("cat " + SKILL, LAW, true), bash(LINEWIDE, LAW, true)] } });
    expect(decide([root], corpus()).decisions).toEqual([]);
  });
});

describe("apply: the decisions rewrite the session table", () => {
  // Value: protects=the tables analyze.ts reads after procedure (b), with the listed sessions in and out; fails_when=an overturned row stays dropped, a listed row leaves the primary table or stays in the table without them, another outcome changes, or a decision with no single none row passes; why_new=GEVA-294, GEVA-296 round 2; seam=audit.ts applyDecisions; no_claim=analyze.ts, unchanged
  const rows = () => [
    row("opus", "f1", "none", "t1", { trial: "mention", outcome: "contaminated", reason: "read audit: Bash /root/x" }),
    row("opus", "f1", "none", "t2", { trial: "listed", outcome: "graded", reason: "graded" }),
    row("opus", "f1", "none", "t3", { trial: "infra", outcome: "infra", reason: "no verifier reward" }),
    row("opus", "f1", "after-u", "t4", { trial: "gstack", outcome: "graded", reason: "graded" }),
  ];
  test("overturned goes back to graded in both tables, listed stays graded and is contaminated only in the table without them, and a row of another outcome stays", () => {
    const r = applyDecisions(rows(), [{ trial: "mention", decision: "overturned", evidence: "1 flagged calls" }, { trial: "listed", decision: "listed", evidence: "Bash x -> f: l" }, { trial: "infra", decision: "listed", evidence: "e" }]);
    expect(r.rows.map((x) => x.trial + " " + x.outcome)).toEqual(["mention graded", "listed graded", "infra infra", "gstack graded"]);
    expect(r.withoutListed.map((x) => x.trial + " " + x.outcome)).toEqual(["mention graded", "listed contaminated", "infra infra", "gstack graded"]);
    expect(r.rows[0]!.reason).toBe("graded; read audit overturned (Amendment C): 1 flagged calls");
    expect(r.rows[1]!.reason).toBe("graded");
    expect(r.summary).toBe("apply: 1 rows back to graded, 1 listed rows left graded and taken out of the table without them, 1 decisions left their row as it was");
  });
  test("a rewritten row's pass is what table.ts sets for its new outcome: an overturned row with reward 1 and no stop passes, one with a stop still fails, and a listed row fails only in the table without them", () => {
    const r = applyDecisions([
      row("opus", "f1", "none", "t1", { trial: "won", outcome: "contaminated", pass: false, reward: 1 }),
      row("opus", "f1", "none", "t2", { trial: "turns", outcome: "contaminated", pass: false, reward: 1, turn_cap: true }),
      row("opus", "f1", "none", "t3", { trial: "spent", outcome: "contaminated", pass: false, reward: 1, allowance_stop: true }),
      row("opus", "f1", "none", "t4", { trial: "clean", outcome: "graded", pass: true, reward: 1 }),
    ], (["won", "turns", "spent"].map((trial) => ({ trial, decision: "overturned", evidence: "e" })) as Decision[]).concat([{ trial: "clean", decision: "listed", evidence: "e" }]));
    expect(r.rows.map((x) => x.trial + " " + x.outcome + " " + x.pass)).toEqual(["won graded true", "turns graded false", "spent graded false", "clean graded true"]);
    expect(r.withoutListed.map((x) => x.trial + " " + x.outcome + " " + x.pass)).toEqual(["won graded true", "turns graded false", "spent graded false", "clean contaminated false"]);
  });
  test("a decision for a trial with no row, or for a gstack arm's row, refuses", () => {
    expect(() => applyDecisions(rows(), [{ trial: "nope", decision: "listed", evidence: "" }])).toThrow("matches 0 rows, not one none row");
    expect(() => applyDecisions(rows(), [{ trial: "gstack", decision: "overturned", evidence: "" }])).toThrow("matches 1 rows of arm after-u");
  });
});

describe("audit.ts on the command line", () => {
  test("contamination refuses arm tars that are not the committed ones, and xargs prints its summary", () => {
    const root = trials({ a: { calls: [bash(LINEWIDE, "3 total")] } });
    const arms = mkdtempSync(join(tmpdir(), "l1-audit-tars-"));
    for (const a of ["before", "after", "none"]) writeFileSync(join(arms, a + ".tar.gz"), "not a tar");
    const cli = (...args: string[]) => Bun.spawnSync(["bun", join(import.meta.dir, "../l1/audit.ts"), ...args]);
    const c = cli("contamination", arms, root);
    expect(c.exitCode).toBe(2);
    expect(c.stderr.toString()).toContain("E_USAGE l1 audit: " + join(arms, "before.tar.gz") + " is ");
    expect(c.stderr.toString()).toContain("the committed manifest says 67f6e6156282f0df28fdb3352046b5f7f1c02e9287c27737d790f278695cdf55");
    const x = cli("xargs", root);
    expect(x.exitCode).toBe(0);
    expect(x.stdout.toString()).toContain("xargs-audit: 1 none sessions, 1 tool calls; line-wide only 1 calls in 1 sessions");
  });
  test("apply writes the table without the listed sessions when given a second output", () => {
    const d = mkdtempSync(join(tmpdir(), "l1-audit-apply-"));
    writeFileSync(join(d, "decisions.tsv"), "trial\tdecision\tevidence\nn-over\toverturned\te\nn-listed\tlisted\te\n");
    writeFileSync(join(d, "sessions.jsonl"), [row("opus", "f1", "none", "t1", { trial: "n-over", outcome: "contaminated" }), row("opus", "f1", "none", "t2", { trial: "n-listed", outcome: "graded" })].map((r) => JSON.stringify(r)).join("\n") + "\n");
    const a = Bun.spawnSync(["bun", join(import.meta.dir, "../l1/audit.ts"), "apply", join(d, "decisions.tsv"), join(d, "sessions.jsonl"), join(d, "in.jsonl"), join(d, "out.jsonl")]);
    expect(a.exitCode).toBe(0);
    const outcomes = (f: string) => readFileSync(join(d, f), "utf8").trim().split("\n").map((l) => JSON.parse(l).trial + "=" + JSON.parse(l).outcome).join(" ");
    expect(outcomes("in.jsonl")).toBe("n-over=graded n-listed=graded");
    expect(outcomes("out.jsonl")).toBe("n-over=graded n-listed=contaminated");
  });
});
