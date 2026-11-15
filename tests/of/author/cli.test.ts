// Value: protects=the authoring commands' wiring: sealed paths, the gstack pin check, the frame file, one metered client with the production labeller on one item, the strict Argon check and the printed counts.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkGstack, authorCommand, mddAt, readFrame, realCommand, type Wire } from "../../../lanes/office-hours-founder/author/cli.ts";
import { FIXTURE, FIXTURE_ASKS, REAL_FILES, REAL_NOTES, REAL_PAGE, authorReply, blockReply } from "../../../lanes/office-hours-founder/author/fixtures.ts";
import { PROBE, QUERIES } from "../../../lanes/office-hours-founder/author/prompts.ts";
import { FIRST_LINE } from "../../../lanes/office-hours-founder/frozen.ts";
import { ENV, capture, ledgerWith, tmp } from "../../pv/fixtures.ts";

const PASS = JSON.stringify({ a: "pass", b: "pass", c: "pass", d: "pass", e: "pass", r1: "pass", r2: "pass", r3: "pass", foreseeable: { customer: "yes", wedge: "maybe" } });
const credit = "Sell " + FIXTURE.key.wedge;

/** Answers each prompt the authoring steps send, by its opening words. */
function answer(prompt: string): string {
  if (prompt.startsWith("You are labelling founders' first-move blocks")) {
    const yes = prompt.includes(credit);
    return JSON.stringify({ labels: ["b1", "b2"].map((block) => ({ block, customer: yes, wedge: yes, multi_target: false, next: false, alt: false, doubt: false })) });
  }
  if (prompt.startsWith("Invent a startup founder")) return authorReply(FIXTURE);
  if (prompt.includes("Here is everything else I know:")) return blockReply("Sell " + FIXTURE.key.wedge + " to " + FIXTURE.key.customer + ".");
  if (prompt.startsWith(FIRST_LINE.none)) return blockReply("Build the full platform and offer it free to every town.");
  if (prompt.startsWith("Audit this invented startup")) return PASS;
  if (prompt.startsWith(PROBE)) return "I don't know.";
  if (prompt.startsWith("Below are an invented startup and a model's answer")) return '{"matches": []}';
  if (prompt.startsWith("Below are the names of a real company")) return '{"identifies": false}';
  if (prompt.startsWith("Classify this startup")) return '{"type": "B2B", "stage": "has users"}';
  if (prompt.startsWith("Is the page below")) return '{"founder_account": true}';
  if (prompt.startsWith("Below are public accounts")) return REAL_NOTES;
  if (prompt.startsWith("Invent a new startup")) return authorReply({ opening: REAL_FILES.opening, sheet: REAL_FILES.sheet });
  if (prompt.startsWith("Below are a note on what happened next")) return authorReply({ key: REAL_FILES.key });
  if (prompt.startsWith("Below are two notes")) return JSON.stringify({ t1: "pass", t2: "pass", t3: "pass", t4: "pass", t5: "pass", pointing: REAL_FILES.key.key_facts, opening_date: "2014", first_sale_date: "2015", industry: "pottery studios" });
  return "unrouted";
}

/** The three providers' wire formats, with OpenRouter naming the provider each model is pinned to (or argon's override). */
function upstream(argon = "Google", seen: string[] = []): typeof fetch {
  return (async (url: any, init?: any) => {
    const body = JSON.parse(String(init?.body));
    const prompt = String((body.input ?? body.messages)[0].content);
    seen.push(String(url));
    const text = answer(prompt);
    if (String(url).includes("anthropic")) return Response.json({ id: "m1", model: "claude-opus-5-5-20261101", content: [{ type: "text", text }], usage: { input_tokens: 100, output_tokens: 50 } });
    if (String(url).includes("openai.com")) return Response.json({ id: "r1", model: "gpt-6-astra-20261101", output: [{ type: "message", content: [{ type: "output_text", text }] }], usage: { input_tokens: 100, output_tokens: 50 } });
    const provider = body.model.startsWith("google/") ? argon : body.model.startsWith("openai/") ? "OpenAI" : "Particle";
    return Response.json({ id: "g1", model: body.model, provider, choices: [{ message: { role: "assistant", content: text } }], usage: { prompt_tokens: 100, completion_tokens: 50 } });
  }) as typeof fetch;
}

const setup = (item: string) => {
  const dir = tmp();
  const { record, ledger } = ledgerWith(dir, [item]);
  return { dir, record, ledger, units: join(dir, "units") };
};
const wire = (o: Partial<Wire> = {}): Wire => ({ gstack: () => FIXTURE_ASKS, python: () => JSON.stringify([{ w: 0.13, guard: 0.14 }]), upstream: upstream(), ...o });

describe("refusals", () => {
  test("units inside the repo, an existing units dir without --resume, and --resume with none", async () => {
    const s = setup("of-auth");
    const base = ["--gstack", "g", "--item", "of-auth", "--spend-cap", "5", "--record", s.record, "--ledger", s.ledger];
    await expect(authorCommand(["--units", "units-here", ...base], capture().io, ENV, wire())).rejects.toThrow(/inside the repo/);
    mkdirSync(s.units);
    await expect(authorCommand(["--units", s.units, ...base], capture().io, ENV, wire())).rejects.toThrow(/already exists/);
    await expect(authorCommand(["--units", join(s.dir, "none"), "--resume", ...base], capture().io, ENV, wire())).rejects.toThrow(/does not exist/);
    await expect(authorCommand(["--units", s.units, "--gstack", "g", "--item", "x"], capture().io, ENV, wire())).rejects.toThrow(/E_USAGE missing --spend-cap/);
    await expect(authorCommand(["--units", s.units, ...base.slice(0, 4), "--spend-cap", "0"], capture().io, ENV, wire())).rejects.toThrow(/positive number/);
  });
  test("a gstack checkout off the pin is refused", () => {
    const dir = tmp();
    expect(() => checkGstack(dir)).toThrow(/no git HEAD/);
    spawnSync("git", ["init", "-q", dir]);
    spawnSync("git", ["-C", dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "x"]);
    expect(() => checkGstack(dir)).toThrow(/not the pin b6155921/);
  });
  test("the frame needs every frozen query, no other, and at most 10 URLs each", () => {
    const dir = tmp();
    const file = (v: unknown) => (writeFileSync(join(dir, "f.json"), JSON.stringify(v)), join(dir, "f.json"));
    const full = Object.fromEntries(QUERIES.map((q) => [q, ["https://a.invalid/1"]]));
    expect(Object.keys(readFrame(file(full)))).toHaveLength(40);
    expect(() => readFrame(file({ ...full, extra: [] }))).toThrow(/1 queries the prereg does not freeze/);
    const { [QUERIES[3]!]: _, ...short } = full;
    expect(() => readFrame(file(short))).toThrow(/lacks 1 of the 40/);
    expect(() => readFrame(file({ ...full, [QUERIES[0]!]: Array.from({ length: 11 }, (_, k) => "https://a.invalid/" + k) }))).toThrow(/query 1 has 11 results/);
    expect(() => readFrame(file({ ...full, [QUERIES[1]!]: ["not a url"] }))).toThrow(/query 2 needs/);
  });
  test("the supply stop's MDD reads power.py at the planning design, and none under 2 units", () => {
    let sent = "";
    const mdd = mddAt((_, stdin) => ((sent = stdin), JSON.stringify([{ w: 0.2, guard: 0.21 }])));
    expect(mdd(40)).toBe(0.21);
    expect(JSON.parse(sent)).toEqual([{ p0: 0.25, rho: 0.5, s: 0.05, n: 40, passes: 2 }]);
    expect(mdd(1)).toBeNull();
  });
});

describe("of author through the metered client", () => {
  test("--pilot runs the 4-unit pilot on one lease, labels through the same meter, and prints counts only", async () => {
    const s = setup("of-auth");
    const seen: string[] = [];
    const c = capture();
    const code = await authorCommand(["--units", s.units, "--gstack", "g", "--item", "of-auth", "--spend-cap", "20", "--pilot", "--record", s.record, "--ledger", s.ledger], c.io, ENV, wire({ upstream: upstream("Google", seen) }));
    expect(code).toBe(0);
    const out = c.out.join("\n");
    expect(out).toMatch(/supply projection: 4 of 4 pilot units passed/);
    expect(out).toMatch(/stopped at pilot; 4 drawn, 4 passed/);
    expect(out).toMatch(/drops by step: none; not unanimous 0, given away 0/);
    expect(out).toMatch(/of author: settled \d+\.\d{4} dollars on of-auth/);
    expect(out).not.toContain(FIXTURE.key.customer);
    expect(seen.some((u) => u.includes("anthropic")) && seen.some((u) => u.includes("openai.com")) && seen.some((u) => u.includes("openrouter"))).toBe(true);
    expect(existsSync(join(s.units, "constructed", "outcomes.jsonl"))).toBe(true);
    expect(readdirSync(join(s.units, "cache", "versions")).length).toBeGreaterThan(0);
    const run = JSON.parse(readFileSync(join(s.units, "run.json"), "utf8"));
    expect(run.spent_micros).toBeGreaterThan(0);
    const again = capture();
    expect(await authorCommand(["--units", s.units, "--gstack", "g", "--item", "of-auth", "--spend-cap", "20", "--pilot", "--resume", "--record", s.record, "--ledger", s.ledger], again.io, ENV, wire({ upstream: upstream("Google", seen) }))).toBe(0);
    expect(again.out.join("\n")).toMatch(/settled 0\.0000 dollars/);
  });
  test("Argon served by Google AI Studio stops the command with E_OF_PROVIDER_DRIFT and settles the lease", async () => {
    const s = setup("of-auth");
    const c = capture();
    await expect(authorCommand(["--units", s.units, "--gstack", "g", "--item", "of-auth", "--spend-cap", "20", "--pilot", "--record", s.record, "--ledger", s.ledger], c.io, ENV, wire({ upstream: upstream("Google AI Studio") }))).rejects.toThrow(/^E_OF_PROVIDER_DRIFT .*not Google Vertex/);
    expect(c.out.join("\n")).toMatch(/settled/);
  });
  test("a pilot whose projection passes the cap prints it and raises E_OF_SUPPLY_SHORT", async () => {
    const s = setup("of-auth");
    const c = capture();
    await expect(authorCommand(["--units", s.units, "--gstack", "g", "--item", "of-auth", "--spend-cap", "0.001", "--pilot", "--record", s.record, "--ledger", s.ledger], c.io, ENV, wire())).rejects.toThrow(/^E_OF_SUPPLY_SHORT /);
    expect(c.out.join("\n")).toMatch(/does not fit/);
  });
  test("a pilot on its own item leases --spend-cap and projects against --authoring-cap, which only a pilot takes", async () => {
    const s = setup("of-auth");
    const c = capture();
    await expect(authorCommand(["--units", s.units, "--gstack", "g", "--item", "of-auth", "--spend-cap", "20", "--pilot", "--authoring-cap", "0.001", "--record", s.record, "--ledger", s.ledger], c.io, ENV, wire())).rejects.toThrow(/^E_OF_SUPPLY_SHORT /);
    expect(c.out.join("\n")).toMatch(/against a cap of 0\.001 \(does not fit/);
    await expect(authorCommand(["--units", setup("of-auth2").units, "--gstack", "g", "--item", "of-auth2", "--spend-cap", "20", "--authoring-cap", "330"], capture().io, ENV, wire())).rejects.toThrow(/^E_USAGE .*--authoring-cap/);
  });
});

describe("of author --twins", () => {
  test("needs --resume, takes no --pilot, and refuses a run whose outcome log rebuilds unfilled sets before any call", async () => {
    const s = setup("of-auth");
    const base = ["--units", s.units, "--gstack", "g", "--item", "of-auth", "--spend-cap", "20", "--record", s.record, "--ledger", s.ledger];
    await expect(authorCommand([...base, "--twins"], capture().io, ENV, wire())).rejects.toThrow(/^E_USAGE --twins .*needs --resume/);
    await expect(authorCommand([...base, "--twins", "--resume", "--pilot"], capture().io, ENV, wire())).rejects.toThrow(/^E_USAGE --twins .*no --pilot/);
    expect(existsSync(s.units)).toBe(false);
    expect(await authorCommand([...base, "--pilot"], capture().io, ENV, wire())).toBe(0);
    const seen: string[] = [];
    const c = capture();
    await expect(authorCommand([...base, "--resume", "--twins"], c.io, ENV, wire({ upstream: upstream("Google", seen) }))).rejects.toThrow(/^E_USAGE --twins needs a run that stopped at its quotas/);
    expect(seen).toHaveLength(0);
    expect(c.out.join("\n")).toMatch(/settled 0\.0000 dollars on of-auth/);
  });
});

describe("of real through the metered client", () => {
  test("mines the frame through the gate, one GET at a time, and writes names.txt per unit", async () => {
    const s = setup("of-real");
    const frame = Object.fromEntries(QUERIES.map((q, k) => [q, k === 0 ? ["https://a.invalid/story", "https://b.invalid/post", "https://medium.com/x"] : []]));
    writeFileSync(join(s.dir, "frame.json"), JSON.stringify(frame));
    const site: Record<string, { status: number; text: string }> = {
      "https://a.invalid/robots.txt": { status: 404, text: "" },
      "https://a.invalid/terms": { status: 200, text: "<p>Be kind.</p>" },
      "https://a.invalid/story": { status: 200, text: "<p>" + REAL_PAGE + "</p>" },
      "https://b.invalid/robots.txt": { status: 200, text: "User-agent: *\nAllow: /" },
      "https://b.invalid/terms": { status: 200, text: "You agree not to crawl this site." },
    };
    let open = 0, most = 0;
    const web = async (url: string) => {
      most = Math.max(most, ++open);
      await Promise.resolve();
      open--;
      return site[url] ?? { status: 404, text: "" };
    };
    const c = capture();
    const code = await realCommand(["--units", s.units, "--frame", join(s.dir, "frame.json"), "--gstack", "g", "--item", "of-real", "--spend-cap", "20", "--record", s.record, "--ledger", s.ledger], c.io, ENV, wire({ web, today: "2026-11-12" }));
    expect(code).toBe(0);
    expect(most).toBe(1);
    const out = c.out.join("\n");
    expect(out).toMatch(/2 sources; gate fetched 1, refused 1/);
    expect(out).toMatch(/1 authored, 1 passed/);
    expect(out).not.toContain("Fernwick");
    const names = readdirSync(join(s.units, "real")).filter((d) => existsSync(join(s.units, "real", d, "names.txt")));
    expect(names).toHaveLength(1);
    expect(readFileSync(join(s.units, "real", names[0]!, "names.txt"), "utf8")).toContain("Fernwick Labs");
    expect(existsSync(join(s.units, "units", names[0]!, "unit.json"))).toBe(true);
  });
});
