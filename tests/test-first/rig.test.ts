// Copyright (c) 2026 Garry Tan. MIT License.
// B2's rig files that no other keyless test reads: the Codex arm image pins Codex 0.170.0's tarball by the sha256 in pins.ts,
// the Claude arm build runs gstack's own setup, the start-capture driver passes the session kind through, the smoke starts
// the fake Responses upstream for a Sol part, and that upstream answers the way Codex reads it (a tool call, then a message).
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CODEX } from "../../lanes/codex-hooks/pins.ts";
import { CODEX_TARBALL } from "../../lanes/codex-hooks/r/pins.ts";
import { REPO } from "../../lanes/test-first/pins.ts";

const read = (p: string) => readFileSync(join(REPO, p), "utf8");
const scratch = mkdtempSync(join(tmpdir(), "b2-rig-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("B2 rig files", () => {
  test("the Codex arm image adds Codex's tarball by the pinned sha256", () => {
    expect(read("lanes/test-first/arms/codex.Dockerfile")).toContain("ADD --checksum=sha256:" + CODEX.tarballSha256 + " " + CODEX_TARBALL + " ");
  });
  test("the Claude arm build parses and runs gstack's own setup with the pinned loadout", () => {
    expect(Bun.spawnSync(["bash", "-n", join(REPO, "lanes/test-first/build-claude.sh")]).exitCode).toBe(0);
    expect(read("lanes/test-first/build-claude.sh")).toContain("./setup --host claude --no-browser --loadout $LOADOUT");
  });
  test("the start-capture driver parses and takes the session kind from its spec", () => {
    const py = Bun.spawnSync(["python3", "-c", "import ast,sys; ast.parse(open(sys.argv[1]).read())", join(REPO, "lanes/test-first/sessions-driver.py")]);
    expect(py.exitCode).toBe(0);
    expect(read("lanes/test-first/sessions-driver.py")).toContain('session_kind=SPEC.get("session_kind", "")');
  });
  test("the smoke parses and starts the fake Responses upstream for a Sol part", () => {
    expect(Bun.spawnSync(["bash", "-n", join(REPO, "lanes/test-first/smoke.sh")]).exitCode).toBe(0);
    expect(read("lanes/test-first/smoke.sh")).toContain('bun "$repo/lanes/test-first/fake-responses.ts"');
  });
  test("the fake Responses upstream calls exec_command first, then answers, and logs each request's model and effort", async () => {
    const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
    const port = probe.port;
    probe.stop(true);
    const log = join(scratch, "fake-upstream.jsonl");
    const proc = Bun.spawn(["bun", join(REPO, "lanes/test-first/fake-responses.ts")], { env: { ...process.env, FAKE_RESPONSES_PORT: String(port), FAKE_UPSTREAM_LOG: log }, stdout: "pipe", stderr: "pipe" });
    try {
      const url = "http://127.0.0.1:" + port;
      for (let i = 0; i < 50; i++) { if (await fetch(url + "/healthz").then((r) => r.ok, () => false)) break; await Bun.sleep(100); }
      const post = (input: unknown[]) => fetch(url + "/v1/responses", { method: "POST", body: JSON.stringify({ model: "gpt-6.2-sol", reasoning: { effort: "low" }, input }) }).then((r) => r.text());
      const first = await post([{ type: "message", role: "user", content: [] }]);
      expect(first).toContain("event: response.completed");
      expect(first).toContain('"name":"exec_command"');
      const second = await post([{ type: "message", role: "user", content: [] }, { type: "function_call_output", call_id: "call_smoke_0", output: "ok" }]);
      expect(second).toContain('"type":"output_text"');
      expect(second).not.toContain("exec_command");
      expect(readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l))).toEqual([
        { path: "/v1/responses", model: "gpt-6.2-sol", effort: "low", items: 1 },
        { path: "/v1/responses", model: "gpt-6.2-sol", effort: "low", items: 2 },
      ]);
    } finally {
      proc.kill();
      await proc.exited;
    }
  });
});
