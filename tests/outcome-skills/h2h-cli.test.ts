// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXIT, loadCommands, main, RERUN_RUNNER, refusal } from "../../lanes/outcome-skills/h2h/cli.ts";
import { rerun, type RerunRunner } from "../../lanes/outcome-skills/h2h/rerun.ts";
import { sessionRunner } from "../../lanes/outcome-skills/h2h/sessions/rerunner.ts";
import type { H2hSession } from "../../lanes/outcome-skills/h2h/types.ts";

const temp = (x: string) => mkdtempSync(join(tmpdir(), x));

async function quiet<T>(fn: () => Promise<T>) {
  const err = spyOn(console, "error").mockImplementation(() => {});
  const log = spyOn(console, "log").mockImplementation(() => {});
  try {
    const value = await fn();
    return { value, stderr: err.mock.calls.map((c) => String(c[0])).join("\n"), stdout: log.mock.calls.map((c) => String(c[0])).join("\n") };
  } finally {
    err.mockRestore();
    log.mockRestore();
  }
}

/** rerun with a stand-in runner, as main would exit. */
async function exitOf(argv: string[], runner: RerunRunner) {
  try {
    return await rerun(argv, runner);
  } catch (e) {
    return EXIT[refusal(e).code] ?? 2;
  }
}

function unitsFile(n = 3) {
  const f = join(temp("h2h-cli-units-"), "units.json");
  writeFileSync(f, JSON.stringify(Array.from({ length: n }, (_, k) => ({ id: "u" + k, kind: "O", repo: "r" + k, month: "2026-07", entry: "bug" }))));
  return f;
}
const session = (cost: number) => ({ kind: "session" as const, session: { cost_usd: cost, gap: null } as H2hSession, score: null });
const runner = (o: Partial<RerunRunner> & { outcomes?: Awaited<ReturnType<RerunRunner["run"]>>[] } = {}): RerunRunner & { ran: string[] } => {
  const ran: string[] = [];
  return {
    ran,
    preflight: o.preflight ?? (async () => null),
    run: o.run ?? (async (s) => {
      ran.push(s.unit.id);
      return o.outcomes?.[ran.length - 1] ?? session(1);
    }),
  };
};

describe("h2h dispatcher", () => {
  test("loads every part's commands and refuses a name two parts export", async () => {
    expect(Object.keys(await loadCommands()).sort()).toEqual(["analyze", "audit", "browser-check", "contain-home", "draw", "dryrun", "exposure", "image-build", "image-store", "install", "label-packet", "ledger-dryrun", "mine-b1", "mine-b2", "o-frame", "oracle-b", "pins", "power-table", "readout", "rerun", "runtimes", "score", "session-plan", "session-run"]);
    expect(RERUN_RUNNER).not.toBeNull();
    expect(loadCommands(["./score/commands.ts", "./score/commands.ts"])).rejects.toThrow(/^E_USAGE /);
  });

  test("help, unknown commands and unknown flags exit as section 12 says", async () => {
    expect((await quiet(() => main([]))).value).toBe(2);
    expect((await quiet(() => main(["--help"]))).value).toBe(0);
    const bad = await quiet(() => main(["nope"]));
    expect(bad.value).toBe(2);
    expect(bad.stderr).toStartWith("E_USAGE ");
    const flag = await quiet(() => main(["analyze", "--bogus", "x"]));
    expect(flag.value).toBe(2);
    expect(flag.stderr.split("\n").every((l) => l.startsWith("E_USAGE "))).toBe(true);
  });
});

describe("h2h rerun", () => {
  test("--dry-run prints the projection at planning prices and runs nothing", async () => {
    const r = await quiet(() => main(["rerun", "--arm", "gsd", "--units", unitsFile(), "--spend-cap", "5", "--dry-run"]));
    expect(r.value).toBe(0);
    expect(r.stdout).toContain("projected $8.40");
    expect(r.stdout).toContain("a real run would stop at the cap (exit 10)");
    expect(r.stdout).toContain("nothing ran");
  });

  test("an unwired runner, the wired runner without its environment, a usage error and a refused precondition exit 3, 3, 2 and 3", async () => {
    const units = unitsFile();
    const argv = ["--arm", "gstack", "--units", units, "--spend-cap", "100"];
    const unwired = await quiet(() => rerun(argv, null).catch((e) => refusal(e)));
    expect(unwired.value).toMatchObject({ code: "E_H2H_RERUN_UNWIRED" });
    expect(EXIT.E_H2H_RERUN_UNWIRED).toBe(3);
    const wired = await quiet(() => rerun(argv, sessionRunner({})).catch((e) => refusal(e)));
    expect(wired.value).toMatchObject({ code: "E_H2H_RERUN_PRECONDITION" });
    expect((wired.value as { text: string }).text).toContain("H2H_CONTROL, H2H_PROXY, H2H_HOMES, H2H_UNITS not set");
    expect((await quiet(() => main(["rerun", "--arm", "nobody", "--units", units, "--spend-cap", "100"]))).value).toBe(2);
    expect((await quiet(() => main(["rerun", "--arm", "gstack", "--units", "/nonexistent.json", "--spend-cap", "100"]))).value).toBe(3);
    const r = runner({ preflight: async () => "docker is not running" });
    expect(await quiet(() => exitOf(["--arm", "gstack", "--units", units, "--spend-cap", "100", "--out", temp("h2h-rr-")], r)).then((x) => x.value)).toBe(3);
    expect(r.ran).toEqual([]);
  });

  test("stops before a session whose allowance would pass the cap (exit 10) and halts on containment (exit 12)", async () => {
    const units = unitsFile(3);
    const out = temp("h2h-rr-");
    const capped = runner({ outcomes: [session(10)] });
    expect((await quiet(() => exitOf(["--arm", "gstack", "--units", units, "--spend-cap", "30", "--out", out], capped))).value).toBe(10);
    expect(capped.ran).toEqual(["u0"]);
    expect(JSON.parse(readFileSync(join(out, "rerun-summary.json"), "utf8"))).toMatchObject({ stop: "cap_stop", spent_usd: 10, sessions: [{ unit: "u0", cost_usd: 10 }] });
    const halted = runner({ outcomes: [session(1), { kind: "containment", detail: "a write outside the session tree" }] });
    const out2 = temp("h2h-rr-");
    expect((await quiet(() => exitOf(["--arm", "gstack", "--units", units, "--spend-cap", "200", "--out", out2], halted))).value).toBe(12);
    expect(halted.ran).toEqual(["u0", "u1"]);
    expect(JSON.parse(readFileSync(join(out2, "rerun-summary.json"), "utf8")).stop).toBe("containment");
    const retried = runner({ outcomes: [{ kind: "session", session: { cost_usd: 25, attempts: 2, gap: null } as H2hSession, score: null }] });
    const out4 = temp("h2h-rr-");
    expect((await quiet(() => exitOf(["--arm", "gstack", "--units", units, "--spend-cap", "25", "--out", out4], retried))).value).toBe(10);
    expect(retried.ran).toEqual(["u0"]);
    expect(JSON.parse(readFileSync(join(out4, "rerun-summary.json"), "utf8"))).toMatchObject({ stop: "cap_stop", spent_usd: 25, sessions: [{ unit: "u0", cost_usd: 25, attempts: 2 }] });
    const ok = runner();
    const out3 = temp("h2h-rr-");
    expect((await quiet(() => exitOf(["--arm", "gstack", "--units", units, "--spend-cap", "200", "--out", out3], ok))).value).toBe(0);
    expect(ok.ran).toEqual(["u0", "u1", "u2"]);
    expect(existsSync(join(out3, "rerun-summary.json"))).toBe(true);
  });
});
