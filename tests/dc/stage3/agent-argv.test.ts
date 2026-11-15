// Copyright (c) 2026 Garry Tan. MIT License.
// The in-VM agent session's ssh argv (stage3/agent.ts sshAgentSession) against a stub ssh program that prints its
// arguments: the options, then the login and host, then the remote command, in exec and in spawn.
import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sshAgentSession } from "../../../lanes/design-constructed/stage3/agent.ts";
import { asUser } from "../../../lanes/design-constructed/stage3/ubicloud-real.ts";

const dir = mkdtempSync(join(tmpdir(), "dc-agent-argv-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const program = join(dir, "ssh");
writeFileSync(program, "#!/bin/sh\nfor a in \"$@\"; do printf '%s\\n' \"$a\"; done\n");
chmodSync(program, 0o755);

const session = sshAgentSession({ program, keyPath: join(dir, "key"), knownHosts: join(dir, "known_hosts"), extra: ["-p", "2222"] }, "10.0.0.5", "/run/dc-agent/env");
const remote = (command: string) => asUser(". '/run/dc-agent/env' && cd '/work' && " + command, "run");

const check = (argv: string[], command: string) => {
  expect(argv[0]).toBe("-i");
  expect(argv.slice(0, -2)).toEqual(expect.arrayContaining(["-p", "2222", "BatchMode=yes"]));
  expect(argv.at(-2)).toBe("ubi@10.0.0.5");
  expect(argv.at(-1)).toBe(remote(command));
};

describe("sshAgentSession's argv", () => {
  // Value: protects=every in-VM agent session; fails_when=the remote command comes before the host, so ssh reads it as the host name and exits 255; why_new=launch 10's 60 recipe sessions never started Claude Code; seam=sshAgentSession exec; no_claim=a real sshd (tests/dc/stage3/ssh.test.ts)
  test("exec puts the remote command after the login and host", () => {
    const r = session.exec("claude --version", 10_000);
    expect(r.exitCode).toBe(0);
    check(r.stdout.trimEnd().split("\n"), "claude --version");
  });

  // Value: protects=the CLI start and the adapter's liveness probe (spawn(["true"])); fails_when=spawn puts the remote command before the host; why_new=the probe had the same fault; seam=sshAgentSession spawn; no_claim=the SDK's own spawn options
  test("spawn puts the remote command, with its env pairs, after the login and host", async () => {
    const p = session.spawn(["true"], { A_B: "1" });
    let out = "";
    p.stdout!.on("data", (b: Buffer) => (out += b.toString()));
    const code = await new Promise<number | null>((ok) => p.on("close", ok));
    expect(code).toBe(0);
    check(out.trimEnd().split("\n"), "exec env 'A_B=1' 'true'");
  });
});
