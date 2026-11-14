import { describe, expect, test } from "bun:test";
import { fixtureScreen } from "../../../lanes/design-constructed/recipes/fixtures.ts";
import { runScreen, supply } from "../../../lanes/design-constructed/recipes/sessions.ts";
import { bytes, fakeWorld } from "../../../lanes/design-constructed/stage3/fake.ts";
import { AGENT_CLAUDE, AGENT_ROOT, BROWSER_ROOT, controllerBackend } from "../../../lanes/design-constructed/stage3/install.ts";
import { causeText, secretHit } from "../../../lanes/design-constructed/stage3/sandbox.ts";

// Launch 7's recipe sessions each ended as a failure outside the agent, and sessions.ts dropped run.error, so nobody saw
// why. The cause now reaches the session record and the row's lines, masked.
const lines = (f: ReturnType<typeof fixtureScreen>) => {
  const out: string[] = [];
  f.deps.log = (l) => out.push(l);
  return out;
};
const withInstall = (f: ReturnType<typeof fixtureScreen>) => {
  const browser = { name: "browser", root: BROWSER_ROOT, tar: async () => bytes("browser"), apt: [], check: "true" };
  const agent = { name: "claude-code", root: AGENT_ROOT, tar: async () => bytes("claude"), apt: [], check: "'" + AGENT_CLAUDE + "' --version" };
  f.deps.sandbox = { ...f.deps.sandbox, backend: controllerBackend(f.deps.sandbox.backend, { browser, agent }) };
};

describe("the cause of a failure outside the agent", () => {
  test("a failed install step: each session's cause names the step, reaches the record and the row's lines, and the infra-twice reason names both", async () => {
    const world = fakeWorld({ handler: (_vm, c) => (c === "'" + AGENT_CLAUDE + "' --version" ? { exit: 126, stderr: "bash: line 1: " + AGENT_CLAUDE + ": Permission denied token sk-ant-" + "k".repeat(40) } : undefined) });
    const f = fixtureScreen([{ app: "content" }], { world });
    withInstall(f);
    const out = lines(f);
    const s = await runScreen(f.candidates, f.deps);
    const r = s.records[0]!;
    expect(r.end).toBe("infra");
    expect(r.sessions).toBe(2);
    expect(r.causes.length).toBe(2);
    expect(r.causes[0]).toMatch(/^recipe session c01: the controller's install failed: the controller's install on \S+ failed at claude-code's check \(exit 126\): bash: line 1: \/opt\/dc-agent\/package\/claude: Permission denied token \[redacted\]$/);
    expect(r.causes[1]).toStartWith("recipe session c01 retry: the controller's install failed: ");
    expect(r.why).toBe("a failure outside the agent, twice: " + r.causes.join("; "));
    expect(out.filter((l) => l.includes(": failed outside the agent: the controller's install failed: ")).length).toBe(2);
    expect(supply({ ...s, funnel: { ...s.funnel, qualifiedStrict: 16 } }).lines[0]).toContain(r.causes[1]!);
    for (const l of [...out, r.why!]) expect(secretHit(l)).toBeNull();
  });

  test("a job that throws before the first model call: the cause is kept with URLs and app paths masked", async () => {
    const f = fixtureScreen([{ app: "content" }, { app: "content" }]);
    const agent = f.deps.agent;
    let n = 0;
    f.deps.agent = async (vm, o) => {
      if (n++ === 0) throw new Error("could not bind the slot for https://github.com/acme/secret-app at http://10.0.0.2:8790/s1 after reading /work/app/apps/secret-app/package.json");
      return agent(vm, o);
    };
    const out = lines(f);
    const s = await runScreen(f.candidates, f.deps);
    const r = s.records[0]!;
    expect(r.sessions).toBe(2);
    expect(r.causes).toEqual(["recipe session c01: could not bind the slot for [redacted] at [redacted] after reading [redacted]"]);
    expect(out).toContain("recipe session c01: failed outside the agent: could not bind the slot for [redacted] at [redacted] after reading [redacted]");
    expect(s.records[1]!.causes).toEqual([]);
    for (const l of out) expect(l).not.toContain("secret-app");
  });

  test("a qualification that fails outside the app, twice: both causes in the record and the lines, masked", async () => {
    const f = fixtureScreen([{ app: "content" }]);
    f.deps.browser = { open: async () => { throw new Error("page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:3000/projects/secret-app"); } } as never;
    const out = lines(f);
    const s = await runScreen(f.candidates, f.deps);
    const r = s.records[0]!;
    expect(r.end).toBe("infra");
    expect(r.causes).toEqual(["qualify c01: page.goto: net::ERR_CONNECTION_REFUSED at [redacted]", "qualify c01 retry: page.goto: net::ERR_CONNECTION_REFUSED at [redacted]"]);
    expect(r.why).toBe("the qualification run failed outside the app, twice: " + r.causes.join("; "));
    expect(out.filter((l) => l.includes(": failed outside the app: ")).length).toBe(2);
    for (const l of out) expect(l).not.toContain("secret-app");
  });

  test("causeText masks URLs, app paths, keys and drive paths, and cuts to 400 characters", () => {
    expect(causeText("a\nb https://x.example/acme/app /work/app/x sk-ant-" + "k".repeat(40) + " /root/.capy/drive/x")).toBe("a b [redacted] [redacted] [redacted] [redacted]");
    expect(causeText("z".repeat(900)).length).toBe(400);
  });
});
