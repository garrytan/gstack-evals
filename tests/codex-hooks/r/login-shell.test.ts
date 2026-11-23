import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { codexDriver, type CodexOptions } from "../../../src/adapters/codex/driver.ts";
import { detect, LOGIN_REFUSED } from "../../../lanes/codex-hooks/r/detect.ts";
import { ARM_SETTINGS, R_SETTINGS } from "../../../lanes/codex-hooks/r/pins.ts";
import { codexOptions } from "../../../lanes/codex-hooks/r/prepare-run.ts";
import { HAS_CODEX_CLI, harness, type Harness, type ResponsesScript } from "../../adapters/harness.ts";

let open: Harness[] = [];
afterEach(() => {
  for (const h of open) h.close();
  open = [];
});

const PROBE = 'echo "profile=${PROFILE_RAN:-no}"; echo "bun=$(command -v bun || echo none)"; echo "path=$PATH"';

/** One Codex session whose model runs PROBE in its default shell, then asks for a login shell directly and from Code Mode.
 *  HOME's .profile resets PATH the way a task image's /etc/profile does; bun sits on PATH's tail as /opt/laneb/bin does. */
async function probe(settings: CodexOptions["settings"], cm = "const r = await tools.exec_command({ cmd: 'echo cm', login: true });\ntext(JSON.stringify(r));") {
  let seen = new Map<string, string>();
  const script: ResponsesScript = ({ outputs }) => {
    if (!outputs.has("call_env")) return [{ type: "shell", id: "call_env", cmd: PROBE }];
    if (!outputs.has("call_login")) return [{ type: "call", id: "call_login", name: "exec_command", args: { cmd: PROBE, login: true } }];
    if (!outputs.has("call_cm")) return [{ type: "code", id: "call_cm", js: cm }];
    seen = new Map(outputs);
    return [{ type: "message", text: "FINAL: done." }];
  };
  const h = harness(() => [], { responses: script });
  open.push(h);
  const home = join(h.dir, "home"), work = join(h.dir, "work", "t"), laneb = join(h.dir, "opt", "laneb", "bin"), testbed = join(h.dir, "opt", "testbed", "bin");
  for (const d of [home, laneb, testbed]) mkdirSync(d, { recursive: true });
  writeFileSync(join(laneb, "bun"), "#!/bin/sh\n");
  chmodSync(join(laneb, "bun"), 0o755);
  writeFileSync(join(home, ".profile"), "export PROFILE_RAN=yes\nexport PATH=/usr/bin:/bin\n");
  const { model, effort } = codexOptions(true);
  const binding = h.bind(model, "openai");
  const out = join(h.dir, "host");
  const driver = codexDriver({ model, provider: "openai", proxy: { baseUrl: h.baseUrl, slot: binding.slot, token: binding.token }, effort, settings, skill: null, out });
  const session = h.session(work, home, { ...driver.env, PATH: [testbed, "/usr/bin:/bin", laneb].join(":") });
  const outcome = await driver.run(session, { id: "t", prompt: "Print the environment." }, 120_000);
  return { outcome, seen, laneb, testbed, out };
}

describe.skipIf(!HAS_CODEX_CLI)("part R's shell on Codex (pre-run change 3)", () => {
  // Value: protects=part R's Codex settings run the model's shell commands in a non-login shell, so a profile that resets
  //   PATH (a task image's /etc/profile) cannot drop bun and the testbed's bin, and a request for a login shell is refused and
  //   counted; fails_when=allow_login_shell=false leaves R_SETTINGS or an arm's options, Codex starts reading the profile
  //   again, or the refusal's text changes so the table counts none; why_new=GEVA-569's B2 pilot, where every gstack start
  //   in Codex 0.170 refused with "bun not found on PATH" for this reason (pre-run change 3).
  test("every arm's shell is non-login and finds bun and the testbed; a login shell is refused and counted", async () => {
    for (const gstack of [true, false]) expect(codexOptions(gstack).settings).toEqual({ ...R_SETTINGS });
    expect(R_SETTINGS).toEqual({ ...ARM_SETTINGS, allow_login_shell: false });
    const r = await probe(codexOptions(true).settings);
    expect(r.outcome.termination).toEqual({ kind: "completed" });
    const env = r.seen.get("call_env")!;
    expect(env).toContain("profile=no\n");
    expect(env).toContain("bun=" + join(r.laneb, "bun") + "\n");
    expect(env).toMatch(new RegExp("path=.*" + r.testbed + ":"));
    expect(r.seen.get("call_login")).toContain(LOGIN_REFUSED);
    expect(r.seen.get("call_cm")).toContain(LOGIN_REFUSED);
    expect(detect(r.out).login_refused).toBe(2);
    const before = await probe({ ...ARM_SETTINGS });
    expect(before.seen.get("call_env")).toContain("profile=yes\nbun=none\n");
    expect(detect(before.out).login_refused).toBe(0);
  }, 300_000);

  // Value: protects=login_refused counts refusals, not tool outputs, so a Code Mode exec that asks for a login shell twice and
  //   prints both errors counts 2; fails_when=the table counts outputs that hold the refusal text, or one refusal's own output
  //   holds the text twice; why_new=the review of #410, which found two refusals in one exec counted as 1.
  test("two login-shell refusals inside one Code Mode exec count as two", async () => {
    const twice = ["a", "b"].map((k) => `try { text(JSON.stringify(await tools.exec_command({ cmd: 'echo ${k}', login: true }))); } catch (e) { text(String(e)); }`).join("\n");
    const r = await probe(codexOptions(true).settings, twice);
    expect(r.outcome.termination).toEqual({ kind: "completed" });
    const count = (s: string | undefined) => (s ?? "").split(LOGIN_REFUSED).length - 1;
    expect(count(r.seen.get("call_login"))).toBe(1);
    expect(count(r.seen.get("call_cm"))).toBe(2);
    expect(detect(r.out).login_refused).toBe(3);
  }, 300_000);
});
