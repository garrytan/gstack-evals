// Copyright (c) 2026 Garry Tan. MIT License.
// The VM sandbox and its fail-closed audit, through the real Ubicloud backend's commands and parsing on invented fixtures.
import { describe, expect, test } from "bun:test";
import { DcError } from "../../../lanes/design-constructed/errors.ts";
import { bytes, fakeBackend, fakeHosts, fakeSpec, fakeWorld, type FakeFaults, type FakeVm } from "../../../lanes/design-constructed/stage3/fake.ts";
import { AUDIT_COMMANDS, ownerFromEnv, parseEgress, preamble, sandboxed, secretHit, specFor, specProblems, termsRecord } from "../../../lanes/design-constructed/stage3/sandbox.ts";
import { CapStopSignal } from "../../../lanes/design-constructed/stage3/seams.ts";

const run = async (o: { faults?: FakeFaults; plant?: (vm: FakeVm) => void; scanExtra?: string[] } = {}) => {
  const w = fakeWorld({ faults: o.faults, plant: o.plant });
  const hosts = fakeHosts();
  const r = await sandboxed({ backend: fakeBackend(w), hosts, now: () => 0 }, fakeSpec(), async () => "done", { scanExtra: o.scanExtra });
  return { r, w, hosts };
};

describe("sandbox spec", () => {
  test("a clean spec has no problems and names every mirror in its terms record", () => {
    expect(specProblems(fakeSpec())).toEqual([]);
    expect(termsRecord(fakeSpec()).map((l) => l.split(" ")[0])).toEqual(["npm", "pypi", "apt", "dockerhub"]);
  });
  test("owner, time to live, mounts, key names, key values, root and hostnames are refused", () => {
    const p = specProblems(fakeSpec({ owner: " ", ttlMinutes: 60, runMinutes: 90, mounts: ["/drive"], env: { OPENAI_API_KEY: "x", NOTE: "see ~/.capy/drive/x" }, runUser: "root", proxy: { host: "proxy.local", port: 80 } }));
    expect(p.join("\n")).toContain("UBI_OWNER");
    expect(p.join("\n")).toContain("does not cover the run");
    expect(p.join("\n")).toContain("mounts");
    expect(p.join("\n")).toContain("key names: OPENAI_API_KEY");
    expect(p.join("\n")).toContain("key or drive path in: NOTE");
    expect(p.join("\n")).toContain("non-root");
    expect(p.join("\n")).toContain("not an IPv4 literal");
  });
  test("a mirror without terms, named twice or off its endpoint is refused", () => {
    const m = fakeSpec().mirrors;
    const p = specProblems(fakeSpec({ mirrors: [{ ...m[0]!, terms: "" }, { ...m[0]!, url: "http://10.9.9.9/npm/" }] }));
    expect(p).toContain("mirror npm has no terms record line");
    expect(p).toContain("mirror npm is named twice");
    expect(p).toContain("mirror npm's URL is not served on its endpoint");
  });
  test("UBI_OWNER comes from the environment by name", () => {
    expect(ownerFromEnv({ UBI_OWNER: "owner-1" })).toBe("owner-1");
    expect(() => ownerFromEnv({})).toThrow(DcError);
  });
  test("specFor: owner from the environment, a time to live past the run, the proxy only on recipe and build runs", () => {
    const o = { proxy: { host: "10.0.0.2", port: 8080 }, mirrors: fakeSpec().mirrors, env: { UBI_OWNER: "owner-2" } };
    const recipe = specFor("recipe", "recipe session c01", o);
    const check = specFor("check", "check u01 none", o);
    expect([recipe.owner, recipe.proxy?.port, check.proxy]).toEqual(["owner-2", 8080, null]);
    expect(specProblems(recipe)).toEqual([]);
    expect(specProblems(check)).toEqual([]);
    expect(specFor("build", "b", o).ttlMinutes).toBeGreaterThan(120);
  });
  test("the preamble stops apt's timers and masks unattended-upgrades before the filter and anything else", () => {
    const p = preamble(fakeSpec());
    expect(p[0]).toContain("systemctl stop apt-daily.timer");
    expect(p[2]).toContain("mask --now unattended-upgrades");
    expect(p[3]).toContain("is-enabled unattended-upgrades.service");
    expect(p.findIndex((s) => s.includes("policy drop"))).toBeGreaterThan(3);
    expect(p.filter((s) => s.includes("DCNET \"")).length).toBe(5);
    expect(p.at(-1)).toContain("DCNET-START");
  });
  test("key patterns and drive paths", () => {
    expect(secretHit("x=sk-ant-api03-" + "a".repeat(40))).toBe("key");
    expect(secretHit("task-" + "a".repeat(40))).toBeNull();
    expect(secretHit("--dir /root/.capy/drive/x")).toBe("drive path");
    expect(secretHit("node server.js --port 3000")).toBeNull();
  });
});

describe("sandboxed run and audit", () => {
  test("a clean run passes, deletes its VM and settles its dc-hosts hours", async () => {
    const { r, w, hosts } = await run();
    expect(r.value).toBe("done");
    expect(r.audit.ok).toBe(true);
    expect(w.deleted).toEqual([w.vms[0]!.id]);
    expect(hosts.settled.length).toBe(1);
    expect(w.vms[0]!.calls[0]!.command).toContain("systemctl stop apt-daily.timer");
  });
  for (const [name, faults, want] of [
    ["a failed SSH command", { exit: { processes: 255 } }, "the processes command exited 255"],
    ["an empty file list", { empty: ["files"] }, "the files command returned nothing"],
    ["a cut file list", { cut: ["files"] }, "the written-file list is cut or empty"],
    ["a missing process list", { empty: ["processes"] }, "the processes command returned nothing"],
    ["a cut process list", { cut: ["processes"] }, "the process list is cut"],
    ["a cut egress log", { cut: ["egress"] }, "the egress log is cut"],
    ["a cut scan", { cut: ["scan"] }, "the file scan is cut"],
    ["a failed ruleset read", { exit: { ruleset: 1 } }, "the ruleset command exited 1"],
  ] as Array<[string, FakeFaults, string]>)
    test(name + " stops as uncollected", async () => {
      const { r, w } = await run({ faults });
      expect(r.audit.ok).toBe(false);
      if (!r.audit.ok) {
        expect(r.audit.kind).toBe("uncollected");
        expect(r.audit.reasons.join(" ")).toContain(want);
      }
      expect(w.deleted.length).toBe(1);
    });
  test("a key pattern in a written file, a drive path in process arguments and egress to an unnamed host are breaches", async () => {
    const { r } = await run({
      plant: (vm) => {
        vm.written.push({ path: "/srv/run/.cache/x.json", size: 60, mode: 0o644, mtime: "t", type: "f" });
        vm.files.set("/srv/run/.cache/x.json", bytes('{"k":"sk-ant-api03-' + "b".repeat(40) + '"}'));
        vm.processes.push({ pid: 900, user: "run", args: "cat /root/.capy/drive/notes.md" });
        vm.egress.push({ host: "203.0.113.9", port: 443 });
      },
    });
    expect(r.audit.ok).toBe(false);
    if (!r.audit.ok) {
      expect(r.audit.kind).toBe("breach");
      expect(r.audit.reasons).toContain("a key pattern or drive path in /srv/run/.cache/x.json");
      expect(r.audit.reasons).toContain("a drive path in the arguments of pid 900");
      expect(r.audit.reasons).toContain("egress to 203.0.113.9:443, which is not the proxy or a named mirror");
    }
  });
  test("a blocked connection is recorded and is not egress", async () => {
    const { r } = await run({ plant: (vm) => vm.blocked.push({ host: "198.51.100.7", port: 443 }) });
    expect(r.audit.ok).toBe(true);
    if (r.audit.ok) expect(r.audit.evidence.blocked).toEqual([{ host: "198.51.100.7", port: 443 }]);
  });
  test("an extra scan path that can't be read fails closed; one that holds a key is a breach", async () => {
    const missing = await run({ scanExtra: ["/work/recipe.json"] });
    expect(!missing.r.audit.ok && missing.r.audit.kind).toBe("uncollected");
    const hit = await run({ scanExtra: ["/work/recipe.json"], plant: (vm) => vm.files.set("/work/recipe.json", bytes("AIza" + "c".repeat(35))) });
    expect(!hit.r.audit.ok && hit.r.audit.kind).toBe("breach");
  });
  test("an egress filter with a rule the run did not set is a breach", async () => {
    const { r } = await run({ faults: { ruleset: "table inet dc {\n chain out {\n type filter hook output priority filter; policy accept;\n ip daddr 0.0.0.0/0 accept\n }\n}" } });
    expect(!r.audit.ok && r.audit.kind).toBe("breach");
  });
  test("a failed preamble step ends the run before the job, and the audit still runs", async () => {
    let ran = false;
    const w = fakeWorld({ faults: { preamble: ["mask --now"] } });
    const r = await sandboxed({ backend: fakeBackend(w), hosts: fakeHosts(), now: () => 0 }, fakeSpec(), async () => { ran = true; return 1; });
    expect(ran).toBe(false);
    expect(r.error).toContain("preamble step failed");
    expect(r.audit.ok).toBe(true);
    expect(w.vms[0]!.calls.some((c) => c.command === AUDIT_COMMANDS.processes)).toBe(true);
  });
  test("a cap stop inside the job is rethrown after the audit; a failed read is the run's error", async () => {
    const w = fakeWorld();
    const d = { backend: fakeBackend(w), hosts: fakeHosts(), now: () => 0 };
    await expect(sandboxed(d, fakeSpec(), async () => { throw new CapStopSignal("dc-stage3-reads", "full"); })).rejects.toBeInstanceOf(CapStopSignal);
    expect(w.vms[0]!.calls.some((c) => c.command === AUDIT_COMMANDS.scan)).toBe(true);
    expect(w.deleted.length).toBe(1);
    const r = await sandboxed(d, fakeSpec(), async (vm) => d.backend.read(vm, "/work/none"));
    expect(r.error).toContain("could not read /work/none");
    expect(r.audit.ok).toBe(true);
  });
  test("a refused dc-hosts admission creates no VM", async () => {
    const w = fakeWorld();
    await expect(sandboxed({ backend: fakeBackend(w), hosts: fakeHosts({ refuse: true }), now: () => 0 }, fakeSpec(), async () => 1)).rejects.toBeInstanceOf(CapStopSignal);
    expect(w.vms.length).toBe(0);
  });
  test("parseEgress needs both markers", () => {
    expect(parseEgress("DCNET-START\nDCNET DST=1.2.3.4 DPT=80\n")).toBeNull();
    expect(parseEgress("DCNET-START\nDCNET-END\n")).toEqual({ egress: [], blocked: [] });
  });
});
