import { describe, expect, test } from "bun:test";
import { DcError } from "../../../lanes/design-constructed/errors.ts";
import { checkInstallReach, INSTALL_HOSTS, installCause, installReachCommand } from "../../../lanes/design-constructed/run/docker.ts";
import { secretHit } from "../../../lanes/design-constructed/stage3/sandbox.ts";

// Launch 9's preflight printed only "gstack install: exited 1" and the container was removed, so the install's own log,
// the one place its cause was, was lost. A failed install now carries its log's last lines, masked, and a check before
// ./setup names any host the install needs that does not answer from the install network.
const runner = (stdout: string, code = 0, stderr = "") => {
  const commands: string[] = [];
  return { commands, run: (command: string) => (commands.push(command), { code, stdout, stderr }) };
};
const reachError = (f: () => void): DcError => {
  try {
    f();
  } catch (e) {
    return e as DcError;
  }
  throw new Error("checkInstallReach did not stop the install");
};

describe("a failed install's cause", () => {
  test("keeps the log's last lines, each masked, colour codes and URLs gone, joined in order", () => {
    // Value: protects=the Captain's ruling that no cause is dropped, for the install; fails_when=the cause loses the log's last line, carries a URL or a colour code, or reads lines out of order
    const log = ["bun install v1.4.4", "\x1b[31merror\x1b[0m: GET https://registry.npmjs.org/marked - 403", "", "bin/gstack-host-renders.sh: line 54: .gstack-installed-hosts.tmp.29: Permission denied", ""].join("\n");
    const cause = installCause(log);
    expect(cause).toBe("bun install v1.4.4 / error: GET [redacted] - 403 / bin/gstack-host-renders.sh: line 54: .gstack-installed-hosts.tmp.29: Permission denied");
    expect(secretHit(cause)).toBeNull();
  });
  test("keeps only the last lines and cuts from the front, so the final line survives a long log", () => {
    // Value: protects=the trim to the last lines within 400 characters; fails_when=a long log pushes ./setup's final error out of the cause
    const log = Array.from({ length: 40 }, (_, i) => "line " + i + " " + "x".repeat(60)).join("\n") + "\nthe final error";
    const cause = installCause(log);
    expect(cause.length).toBeLessThanOrEqual(400);
    expect(cause).toStartWith("...");
    expect(cause).toEndWith(" / the final error");
    expect(cause).not.toContain("line 27 ");
    expect(installCause("\n\n")).toBe("the install printed nothing");
  });
});

describe("the check before ./setup", () => {
  test("checks the npm registry, the one host ./setup needs to exit 0, and passes when it resolves and answers", () => {
    // Value: protects=the host list and the pass path; fails_when=the needed host is left out or an answering host stops the install
    expect([...INSTALL_HOSTS]).toEqual(["registry.npmjs.org"]);
    expect(installReachCommand(INSTALL_HOSTS)).toContain("https://$h/");
    const r = runner("registry.npmjs.org\t104.16.1.34\t 200\n");
    checkInstallReach(r, "dc-install-a");
    expect(r.commands).toEqual([installReachCommand(INSTALL_HOSTS)]);
  });
  test("a host that does not resolve stops the install with E_DCW_INSTALL_REACH naming it and the install network", () => {
    // Value: protects=a DNS failure named before ./setup; fails_when=./setup runs anyway or the line does not name the host
    const e = reachError(() => checkInstallReach(runner("registry.npmjs.org\t\t\n"), "dc-install-a"));
    expect(e.code).toBe("E_DCW_INSTALL_REACH");
    expect(e.message).toBe("gstack install: registry.npmjs.org does not resolve from the install network dc-install-a, so ./setup did not run");
  });
  test("a host that resolves but gives no HTTPS answer stops the install with curl's cause, masked", () => {
    // Value: protects=a blocked route named with its cause; fails_when=a timeout reads as a pass or the cause carries a URL
    const e = reachError(() => checkInstallReach(runner("registry.npmjs.org\t104.16.1.34\tcurl: (28) Failed to connect to registry.npmjs.org port 443 after 20002 ms: Timeout was reached via https://registry.npmjs.org/ 000\n"), "dc-install-a"));
    expect(e.code).toBe("E_DCW_INSTALL_REACH");
    expect(e.message).toBe("gstack install: registry.npmjs.org resolves to 104.16.1.34 but gives no HTTPS answer: curl: (28) Failed to connect to registry.npmjs.org port 443 after 20002 ms: Timeout was reached via [redacted] from the install network dc-install-a, so ./setup did not run");
  });
  test("a check that prints no line for a host stops the install with the check's own exit and error", () => {
    // Value: protects=a check that could not run never reads as a pass; fails_when=a missing line lets ./setup run
    const e = reachError(() => checkInstallReach(runner("", 127, "sh: 1: getent: not found"), "dc-install-a"));
    expect(e.code).toBe("E_DCW_INSTALL_REACH");
    expect(e.message).toBe("gstack install: registry.npmjs.org could not be checked (the check exited 127: sh: 1: getent: not found) from the install network dc-install-a, so ./setup did not run");
  });
});
