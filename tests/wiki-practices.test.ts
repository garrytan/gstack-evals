import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkWiki, gitBaseFiles } from "../scripts/wiki.ts";

const repoRoot = join(import.meta.dir, "..");
const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

const PREREG_ID = "2026-11-20-geva-9-hook-prereg";
const PREREG = "wiki/plans/" + PREREG_ID + ".md";
const QUICK_ID = "2026-11-20-geva-9-hook-quick-look";
const QUICK = "wiki/plans/" + QUICK_ID + ".md";
const RESULTS_ID = "2026-11-20-geva-9-hook-results";
const RESULTS = "wiki/board/" + RESULTS_ID + ".md";

function post(id: string, kind: string, body: string, title = "A title"): string {
  return ["---", "id: " + id, "kind: " + kind, 'title: "' + title + '"', "summary: A summary.", "author: GEVA-9", "date: " + id.slice(0, 10), "status: open", "---", "", body].join("\n");
}

const PASSING_PREREG = `# Preregistration: does the hook help?

## Decision

- If the hook raises loads: it stays on by default.
- If the interval includes 0: it ships off by default.

## Pilots

| Arm | Budget | Pilot cap | Part ran | Judge check | Supply |
|---|---|---|---|---|---|
| hook on | $400 | $40 | the hook log shows the line in every pilot session | 10 pilot outputs hand-labelled; the judge agrees on this arm | 6 tasks build and grade, 6 at once |
| no gstack | $300 | $30 | the read audit finds no gstack file read | 10 pilot outputs hand-labelled; the judge agrees on this arm | 6 tasks build and grade, 6 at once |

## Judge check

Judge: openai/gpt-6-astra scores anthropic/claude-opus-5-5
Labelled outputs: 40
Kappa at least: 0.6
Errors read: per arm

## Interim look

Planned paid spend: $700
At: half the units, 30 of 60, in seeded order
Stop bounds: |z| of at least 2.797 at the look and 1.977 at the end
Other looks: none
`;

const PASSING_QUICK = `# Quick look: does the edit help?

## Quick look

Question: does the shorter skill text still get the test run?
Decision: if it does, the cut goes to a counted run; if not, the cut is dropped.
Stop rule: stop at 10 sessions or $60, whichever comes first.
Paid cap: $60
Days: 1
`;

const PASSING_RESULTS = `# The hook raised loads

Call settled: the hook stays on by default (KEEP)
`;

function check(files: Record<string, string>, baseFiles: Map<string, Buffer> | null = new Map()): string[] {
  const root = mkdtempSync(join(tmpdir(), "wiki-practices-"));
  roots.push(root);
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  write("wiki/README.md", "# rules\n");
  for (const [path, text] of Object.entries(files)) write(path, text);
  return checkWiki(root, { baseFiles, markers: [] }).problems.map((p) => p.file + ": " + p.message);
}

const prereg = (body: string, id = PREREG_ID, title = "Preregistration: does the hook help?") => ({ ["wiki/plans/" + id + ".md"]: post(id, "plan", body, title) });
const swap = (from: string | RegExp, to: string) => {
  const out = PASSING_PREREG.replace(from, to);
  if (out === PASSING_PREREG) throw new Error("fixture edit matched nothing: " + from);
  return out;
};
const has = (problems: string[], text: string) => problems.some((p) => p.includes(text));

describe("practice 1: the decision", () => {
  test("a prereg that names two outcomes passes", () => {
    expect(check(prereg(PASSING_PREREG))).toEqual([]);
  });

  test("a decision table with two rows passes", () => {
    const table = "## Decision\n\n| Result | What we do |\n|---|---|\n| Loads go up | Keep it on |\n| Interval includes 0 | Ship it off |\n";
    expect(check(prereg(swap(/## Decision\n\n- If[^\n]*\n- If[^\n]*\n/, table)))).toEqual([]);
  });

  test("a prereg with no decision section fails", () => {
    const problems = check(prereg(swap(/## Decision\n\n- If[^\n]*\n- If[^\n]*\n/, "")));
    expect(has(problems, 'practice 1: no "## Decision" section')).toBe(true);
  });

  test("a decision that names one outcome fails", () => {
    const problems = check(prereg(swap("- If the interval includes 0: it ships off by default.\n", "")));
    expect(has(problems, "practice 1: \"## Decision\" names 1 outcome(s)")).toBe(true);
  });
});

describe("practice 3: a pilot for every arm", () => {
  test("a pilot cap of exactly a tenth passes", () => {
    expect(check(prereg(PASSING_PREREG))).toEqual([]);
  });

  test("a prereg with no pilots section fails", () => {
    const problems = check(prereg(swap(/## Pilots\n[\s\S]*?(?=## Judge check)/, "")));
    expect(has(problems, 'practice 3: no "## Pilots" section')).toBe(true);
  });

  test("a pilot cap above a tenth of its arm's budget fails", () => {
    const problems = check(prereg(swap("| $300 | $30 |", "| $300 | $31 |")));
    expect(problems).toEqual([PREREG + ': practice 3: arm "no gstack" pilot cap $31 is more than a tenth of its budget $300']);
  });

  test("a pilot that does not show the part ran, the judge or the supply fails", () => {
    const problems = check(prereg(swap("| hook on | $400 | $40 | the hook log shows the line in every pilot session | 10 pilot outputs hand-labelled; the judge agrees on this arm | 6 tasks build and grade, 6 at once |", "| hook on | $400 | $40 | - | none |  |")));
    expect(has(problems, 'arm "hook on" does not say how its pilot shows the part under test ran')).toBe(true);
    expect(has(problems, 'arm "hook on" does not say how its pilot shows the tasks can be supplied')).toBe(true);
    expect(has(problems, 'arm "hook on" does not say how its pilot shows the judge passes')).toBe(true);
  });

  test("plain, comma and k dollar figures parse; a glued unit fails closed", () => {
    const row = (budget: string, cap: string) => check(prereg(swap("| $300 | $30 |", "| " + budget + " | " + cap + " |")));
    expect(row("$700", "$700")).toEqual([PREREG + ': practice 3: arm "no gstack" pilot cap $700 is more than a tenth of its budget $700']);
    expect(row("$1,200", "$1.2k")).toEqual([PREREG + ': practice 3: arm "no gstack" pilot cap $1200 is more than a tenth of its budget $1200']);
    expect(row("$300USD", "$30")).toEqual([PREREG + ': practice 3: arm "no gstack" needs its budget and pilot cap in dollars, such as $400 and $40']);
  });

  test("a pilot row with the wrong number of cells fails", () => {
    const problems = check(prereg(swap("| $300 | $30 |", "| $300 |")));
    expect(has(problems, 'pilot row "no gstack | $300 |')).toBe(true);
  });
});

describe("practice 5: the judge check", () => {
  const noJudge = swap(/Judge: openai[\s\S]*?Errors read: per arm\n/, "Judge: none\n").replaceAll("10 pilot outputs hand-labelled; the judge agrees on this arm", "none");

  test("a plan with no model judge passes with Judge: none", () => {
    expect(check(prereg(noJudge))).toEqual([]);
  });

  test("a bare, dash or n/a judge line fails", () => {
    for (const line of ["Judge:", "Judge: -", "Judge: n/a"]) {
      const problems = check(prereg(noJudge.replace("Judge: none", line)));
      expect(problems).toEqual([PREREG + ': practice 5: "Judge:" line is empty; write "Judge: none" or "<lab>/<model> scores <lab>/<model>" (wiki/README.md, Eval plans and results, gives the format)']);
    }
  });

  test("a prereg with no judge check section fails", () => {
    const problems = check(prereg(swap(/## Judge check\n[\s\S]*?(?=## Interim look)/, "")));
    expect(has(problems, 'practice 5: no "## Judge check" section')).toBe(true);
  });

  test("a judge from the same family as the model it scores fails", () => {
    const problems = check(prereg(swap("Judge: openai/gpt-6-astra scores", "Judge: anthropic/claude-opus-5-5 scores")));
    expect(has(problems, 'practice 5: judge "anthropic/claude-opus-5-5" is from the same model family as "anthropic/claude-opus-5-5"')).toBe(true);
  });

  test("a label count written with a thousands comma is read whole", () => {
    expect(check(prereg(swap("Labelled outputs: 40", "Labelled outputs: 1,000")))).toEqual([]);
  });

  test("fewer than 40 labels, a kappa under 0.6 or pooled errors fail", () => {
    const problems = check(prereg(swap("Labelled outputs: 40\nKappa at least: 0.6\nErrors read: per arm", "Labelled outputs: 39\nKappa at least: 0.5\nErrors read: pooled")));
    expect(problems.filter((p) => p.includes("practice 5"))).toHaveLength(3);
  });
});

describe("practice 6: one planned look above $500 paid", () => {
  test("a run planned at $500 paid or less needs no look", () => {
    expect(check(prereg(swap(/Planned paid spend: \$700\n[\s\S]*$/, "Planned paid spend: $500\nLook: none, at or under $500\n")))).toEqual([]);
  });

  test("a planned spend written with a k suffix is read in thousands and needs the look", () => {
    const problems = check(prereg(swap(/Planned paid spend: \$700\n[\s\S]*$/, "Planned paid spend: $1.2k\n")));
    expect(has(problems, 'practice 6: a run planned above $500 paid needs "At: half the units')).toBe(true);
  });

  test("a spend with a unit glued on or spelled out fails closed", () => {
    for (const spend of ["$700USD", "$1.2kUSD", "$1.5 million"]) {
      const problems = check(prereg(swap(/Planned paid spend: \$700\n[\s\S]*$/, "Planned paid spend: " + spend + "\n")));
      expect(has(problems, 'practice 6: "## Interim look" needs "Planned paid spend: $<n>"')).toBe(true);
    }
  });

  test("a prereg with no interim look section fails", () => {
    const problems = check(prereg(swap(/## Interim look\n[\s\S]*$/, "")));
    expect(has(problems, 'practice 6: no "## Interim look" section')).toBe(true);
  });

  test("a run above $500 paid with no half-way look, bounds or ban on other looks fails", () => {
    const problems = check(prereg(swap(/At: [\s\S]*$/, "At: when it looks good\nOther looks: weekly\n")));
    expect(problems.filter((p) => p.includes("practice 6"))).toHaveLength(3);
  });
});

describe("which posts are checked", () => {
  test("a plan titled Preregistration is checked whatever its id", () => {
    const problems = check(prereg("# Plan\n", "2026-11-20-geva-9-hook-plan"));
    expect(problems.filter((p) => p.includes("practice"))).toHaveLength(4);
  });

  test("an amendment that is not a preregistration is not checked", () => {
    expect(check(prereg("# Amendment\n", "2026-11-20-geva-9-hook-prereg-addendum", "Addendum 1 to the hook preregistration"))).toEqual([]);
  });
});

describe("code fences", () => {
  test("a fenced copy of the template does not count as the plan", () => {
    for (const fence of ["```", "~~~"]) {
      const problems = check(prereg("# Plan\n\nThis is only an example, not the plan.\n\n" + fence + "markdown\n" + PASSING_PREREG + fence + "\n"));
      expect(problems.filter((p) => p.includes("practice"))).toHaveLength(4);
    }
  });

  test("a heading-like comment inside a fence does not end the section around it", () => {
    expect(check(prereg(swap("## Pilots\n", "## Pilots\n\n```bash\n# run the pilot\n```\n")))).toEqual([]);
  });

  test("a line opening with an inline code span is prose, not a fence", () => {
    const problems = check(prereg(swap("Judge: openai/gpt-6-astra scores anthropic/claude-opus-5-5\n", "Judge: openai/gpt-6-astra scores anthropic/claude-opus-5-5\n```inline``` code opens this prose line\nJudge: anthropic/claude-opus-5-5 scores anthropic/claude-sonnet-5-5\n")));
    expect(has(problems, 'practice 5: judge "anthropic/claude-opus-5-5" is from the same model family')).toBe(true);
  });

  test("a fenced results line does not count", () => {
    const problems = check({ [RESULTS]: post(RESULTS_ID, "finding", "# Results\n\n```\n" + PASSING_RESULTS + "```\n") });
    expect(has(problems, "practice 12")).toBe(true);
  });
});

describe("the quick-look exemption", () => {
  test("a quick look with its three-line plan passes without the prereg sections", () => {
    expect(check({ [QUICK]: post(QUICK_ID, "plan", PASSING_QUICK) })).toEqual([]);
  });

  test("a quick look missing its stop rule fails", () => {
    const problems = check({ [QUICK]: post(QUICK_ID, "plan", PASSING_QUICK.replace(/Stop rule:[^\n]*\n/, "")) });
    expect(problems).toEqual([QUICK + ': quick look: "Stop rule:" line is missing or empty (wiki/README.md, Eval plans and results, gives the format)']);
  });

  test("a quick look above $100 or longer than a day is not exempt", () => {
    const problems = check({ [QUICK]: post(QUICK_ID, "plan", PASSING_QUICK.replace("Paid cap: $60", "Paid cap: $150").replace("Days: 1", "Days: 3")) });
    expect(has(problems, "paid cap $150 is above $100")).toBe(true);
    expect(has(problems, "3 days is longer than one day")).toBe(true);
  });
});

describe("practice 12: the results line", () => {
  test("a results page with its call line passes", () => {
    expect(check({ [RESULTS]: post(RESULTS_ID, "finding", PASSING_RESULTS) })).toEqual([]);
  });

  test("a call of none passes", () => {
    expect(check({ [RESULTS]: post(RESULTS_ID, "finding", "Call settled: none\n") })).toEqual([]);
  });

  test("a results page titled Quick look is checked as a results page", () => {
    const quickResults = (body: string) => ({ [RESULTS]: post(RESULTS_ID, "finding", body, "Quick look 4 results") });
    expect(has(check(quickResults("# Quick look 4 results\n\nIt cost $40.\n")), 'practice 12: no "Call settled: <the ship-or-kill call, or none>" line')).toBe(true);
    expect(check(quickResults(PASSING_RESULTS))).toEqual([]);
  });

  test("the old cost and call line no longer counts", () => {
    const problems = check({ [RESULTS]: post(RESULTS_ID, "finding", "Cost and call: paid $412.50, meter $96; settled: KEEP\n") });
    expect(has(problems, 'practice 12: no "Call settled:')).toBe(true);
  });

  test("a results page without the line fails", () => {
    const problems = check({ [RESULTS]: post(RESULTS_ID, "finding", "# The hook raised loads\n\nIt cost $412.50.\n") });
    expect(has(problems, 'practice 12: no "Call settled: <the ship-or-kill call, or none>" line')).toBe(true);
  });
});

describe("old posts stay closed", () => {
  const failing = { ...prereg("# Plan\n"), [RESULTS]: post(RESULTS_ID, "finding", "# No line\n") };

  test("a failing prereg and results page already at the base are exempt", () => {
    const base = new Map(Object.entries(failing).map(([path, text]) => [path, Buffer.from(text)]));
    expect(check(failing, base)).toEqual([]);
  });

  test("the same posts, new in this change, fail", () => {
    expect(check(failing).filter((p) => p.includes("practice"))).toHaveLength(5);
  });

  test("with no base to compare against, the practices are not checked", () => {
    expect(check(failing, null)).toEqual([]);
  });

  test("every post on the committed wiki is exempt, though many older ones lack the format", () => {
    expect(checkWiki(repoRoot, { baseFiles: gitBaseFiles(repoRoot, "HEAD") }).problems.filter((p) => p.message.startsWith("practice"))).toEqual([]);
    expect(checkWiki(repoRoot, { baseFiles: new Map() }).problems.filter((p) => p.message.startsWith("practice")).length).toBeGreaterThan(0);
  });
});

describe("tighter parsing", () => {
  const spend = (v: string) => swap("Planned paid spend: $700", "Planned paid spend: " + v);

  test("a spaced multiplier fails closed, a glued one still reads", () => {
    expect(has(check(prereg(spend("$1.2 k"))), 'practice 6: "## Interim look" needs "Planned paid spend: $<n>"')).toBe(true);
    expect(has(check(prereg(spend("$1.2 M"))), 'practice 6: "## Interim look" needs "Planned paid spend: $<n>"')).toBe(true);
    expect(check(prereg(spend("$1.2k")))).toEqual([]);
    const quick = check({ [QUICK]: post(QUICK_ID, "plan", PASSING_QUICK.replace("Paid cap: $60", "Paid cap: $1.2 k")) });
    expect(has(quick, 'quick look: "Paid cap: $<n>" is missing')).toBe(true);
  });

  test("a value with more than one dollar figure fails closed", () => {
    expect(has(check(prereg(spend("$300 per arm, $1,200 in all"))), 'practice 6: "## Interim look" needs "Planned paid spend: $<n>"')).toBe(true);
    expect(has(check(prereg(swap("| $300 | $30 |", "| $300 | $20 to $30 |"))), 'arm "no gstack" needs its budget and pilot cap in dollars')).toBe(true);
    expect(check(prereg(spend("$1,200 for the largest counted run")))).toEqual([]);
  });

  test("the judge's lab is read before the model name, past a router prefix", () => {
    const same = check(prereg(swap("Judge: openai/gpt-6-astra scores", "Judge: openrouter/anthropic/claude-opus-5-5 scores")));
    expect(has(same, 'practice 5: judge "openrouter/anthropic/claude-opus-5-5" is from the same model family as "anthropic/claude-opus-5-5"')).toBe(true);
    expect(check(prereg(swap("Judge: openai/gpt-6-astra scores", "Judge: openrouter/openai/gpt-6-astra scores")))).toEqual([]);
  });

  test("numbered prereg and results ids are checked", () => {
    expect(check(prereg("# Plan\n", "2026-11-20-geva-9-hook-prereg-v2", "A plan")).filter((p) => p.includes("practice"))).toHaveLength(4);
    expect(check(prereg("# Plan\n", "2026-11-20-geva-9-hook-prereg-2", "A plan")).filter((p) => p.includes("practice"))).toHaveLength(4);
    const id = "2026-11-20-geva-9-hook-results-v2";
    expect(has(check({ ["wiki/board/" + id + ".md"]: post(id, "finding", "# No line\n") }), "practice 12")).toBe(true);
    expect(check({ ["wiki/board/" + id + ".md"]: post(id, "finding", PASSING_RESULTS) })).toEqual([]);
  });

  test("sections inside an HTML comment are not read", () => {
    const hidden = PASSING_PREREG.replace(/## Decision\n\n- If[^\n]*\n- If[^\n]*\n/, (m) => "<!--\n" + m + "-->\n");
    expect(has(check(prereg(hidden)), 'practice 1: no "## Decision" section')).toBe(true);
    expect(check(prereg(PASSING_PREREG + "\n<!-- a reviewer's note -->\n"))).toEqual([]);
    expect(has(check(prereg(swap("## Judge check", "<!-- unclosed\n## Judge check"))), 'practice 5: no "## Judge check" section')).toBe(true);
  });

  test("a comment that closes and reopens on one line stays hidden, and text after a close is read", () => {
    const reopened = swap(/## Judge check\n[\s\S]*?Errors read: per arm\n/, "<!--\nnote\n--> <!--\n## Judge check\n\nJudge: none\n-->\n");
    expect(has(check(prereg(reopened)), 'practice 5: no "## Judge check" section')).toBe(true);
    const after = check(prereg(swap("Judge: openai/gpt-6-astra scores anthropic/claude-opus-5-5", "<!--\n-->Judge: none")));
    expect(after.filter((p) => p.includes('no "Judge:" line') || p.includes('no "## Judge check"'))).toEqual([]);
    expect(has(check(prereg(swap("Judge: openai/gpt-6-astra scores anthropic/claude-opus-5-5", "<!--\n-->"))), 'practice 5: "## Judge check" has no "Judge:" line')).toBe(true);
  });

  test("a backtick inside a closed comment does not hide the text after it", () => {
    const body = "# The hook raised loads\n\n<!-- A literal backtick: ` --> and `inline code`\n\n" + PASSING_RESULTS.replace(/^# [^\n]*\n\n/, "");
    expect(check({ [RESULTS]: post(RESULTS_ID, "finding", body) })).toEqual([]);
    expect(check(prereg("Write `` <!-- `` to hide a note.\n\n" + PASSING_PREREG))).toEqual([]);
  });

  test("a fenced <!-- does not hide the real sections after it", () => {
    expect(check(prereg("```\n<!-- a template note\n```\n\n" + PASSING_PREREG))).toEqual([]);
  });

  test("an inline-code <!-- does not open a comment that swallows a fence opener", () => {
    const template = PASSING_PREREG.replace(/^# [^\n]*\n\n/, "");
    for (const fenced of ["-->\n" + template, template + "-->\n"]) {
      const problems = check(prereg("# Plan\n\nWrite `<!--` to hide a note.\n\n```markdown\n" + fenced + "```\n"));
      for (const missing of ['practice 1: no "## Decision" section', 'practice 3: no "## Pilots" section', 'practice 5: no "## Judge check" section', 'practice 6: no "## Interim look" section']) {
        expect(has(problems, missing)).toBe(true);
      }
    }
  });

  test("a file with Windows line endings gets the line-ending problem, not missing sections", () => {
    const problems = check({ [PREREG]: post(PREREG_ID, "plan", PASSING_PREREG, "Preregistration: does the hook help?").replaceAll("\n", "\r\n") });
    expect(has(problems, "use LF line endings")).toBe(true);
    expect(problems.filter((p) => p.includes("practice"))).toEqual([]);
  });
});
