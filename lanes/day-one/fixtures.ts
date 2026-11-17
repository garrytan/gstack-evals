// Copyright (c) 2026 Garry Tan. MIT License.
// The keyless checker fixtures (prereg section 6; the Captain's D1 condition): before any paid build, a placeholder app
// scores 0 with "does nothing useful" set, and a reference app scores every task done. Both run through the real
// browser container, the start contract, the node volume, Playwright's MCP server, the verdict parser and the score.
// A scripted checker (fixtures/check.mjs, in a sidecar on the same internal network) stands in for the checker agent;
// the paid smoke runs both fixtures again with the real checker.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodeVolume, startApp, stopApp } from "./app.ts";
import { BROWSER_IMAGE } from "./frozen.ts";
import { copySamples, loadUnit } from "./units.ts";
import { parseVerdicts, scoreBuild, type VerdictParse } from "./verdict.ts";

export const FIXTURES = join(import.meta.dir, "fixtures");
export const FIXTURE_APPS = [{ app: "placeholder", share: 0 }, { app: "reference", share: 1 }] as const;

export async function runFixtures(io: { out: (t: string) => void; err: (t: string) => void }, docker = "docker"): Promise<number> {
  const loaded = loadUnit(join(FIXTURES, "unit"), "fixplants");
  if ("problems" in loaded) {
    io.err("E_DAYONE_FIXTURE the fixture unit does not load: " + loaded.problems.join("; "));
    return 2;
  }
  const u = loaded.unit;
  const ids = u.list!.tasks.map((t) => t.id);
  const { volume } = nodeVolume(docker);
  const network = "day-one-fix-" + randomBytes(4).toString("hex");
  const scratch = mkdtempSync(join(tmpdir(), "day-one-fix-"));
  const made = spawnSync(docker, ["network", "create", "--internal", network], { encoding: "utf8" });
  if (made.status !== 0) {
    io.err("E_DAYONE_FIXTURE docker network create failed: " + made.stderr.trim());
    return 2;
  }
  let failed = 0;
  try {
    for (const f of FIXTURE_APPS) {
      const samples = join(scratch, "samples-" + f.app);
      copySamples(u, samples);
      const a = await startApp({ docker, network, build: join(FIXTURES, f.app), samples, scratch, volume, label: "fix" + f.app.slice(0, 3) });
      let parse: VerdictParse | null = null;
      try {
        if (a.started) {
          const r = spawnSync(docker, ["run", "--rm", "--network", network, "-v", join(FIXTURES, "check.mjs") + ":/check.mjs:ro", "--entrypoint", "node", BROWSER_IMAGE, "/check.mjs", a.mcpUrl], { encoding: "utf8", timeout: 300_000 });
          parse = parseVerdicts([r.stdout], ids);
          if (parse.kind === "bad") io.out("  checker stderr: " + r.stderr.trim().slice(-400));
        }
      } finally {
        stopApp(a, docker, join(scratch, "kept-" + f.app));
      }
      const s = scoreBuild(u.list!, a.started, parse);
      const ok = a.started && s.share === f.share && s.nothing_useful === (f.share === 0);
      if (!ok) failed++;
      const why = parse?.kind === "ok" ? parse.tasks.map((t) => t.id + " " + (t.done ? "done" : "not done") + " (" + t.why + ")").join("; ") : parse ? "unparsable: " + parse.reason : a.detail;
      io.out((ok ? "PASS " : "FAIL ") + f.app + ": started in " + a.start_s + " s, share " + s.share + ", nothing useful " + s.nothing_useful + "; " + why);
    }
  } finally {
    spawnSync(docker, ["network", "rm", network], { encoding: "utf8" });
    rmSync(scratch, { recursive: true, force: true });
  }
  if (failed) io.err("E_DAYONE_FIXTURE " + failed + " fixture(s) scored wrong");
  return failed ? 2 : 0;
}
