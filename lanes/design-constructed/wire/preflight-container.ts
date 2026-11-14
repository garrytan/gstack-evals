// Copyright (c) 2026 Garry Tan. MIT License.
// The preflight's review-container check (PD-43, the Captain's extension of the preflight to every execution kind the run
// uses through stage 2): one stage 1 review container started on the controller host as the sessions row starts one,
// in a gstack arm's setup on a fixture session folder: the run user and C3's frozen mounts before the install, the gstack
// install with its install-network and digest checks (ruling 1F), C3 again, claude --version as the no-model start, and
// the container's removal checked as PD-43 condition 1 requires (stop() throws E_DCW_CONTAINER_LEFT when it is left).
// C3, the install checks and the removal check are run/docker.ts's own, unchanged. C2 is not run: it reads a unit's
// export (its manifest and sealed digests), which the preflight has none of. No model is called and nothing is admitted.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DcError } from "../errors.ts";
import { GSTACK_ARMS, sessionSetup, type SessionSetup } from "../run/arms.ts";
import { c3Problems, type GstackInstall, type ReviewContainer } from "../run/docker.ts";
import { causeText } from "../stage3/sandbox.ts";

export interface ContainerSeams {
  /** Starts the container on the session folder (run/docker.ts startReviewContainer on the trial network). */
  start: (setup: SessionSetup, folder: string) => ReviewContainer;
  /** The gstack install with its checks (run/docker.ts installGstack). */
  install: (c: ReviewContainer) => GstackInstall;
  /** C3; run/docker.ts c3Problems when unset. */
  c3?: (c: ReviewContainer, setup: SessionSetup, clean: boolean) => string[];
}

const failure = (e: unknown) => (e instanceof DcError ? e.code + ": " : "") + causeText((e as Error).message ?? String(e));

/** One review container through the sessions row's steps; its lines in order and every problem, none when it passed. */
export async function containerPreflight(dir: string, s: ContainerSeams): Promise<{ lines: string[]; problems: string[] }> {
  const lines: string[] = [];
  const problems: string[] = [];
  const bad = (line: string) => {
    lines.push(line);
    problems.push(line);
  };
  const c3 = s.c3 ?? ((c: ReviewContainer, setup: SessionSetup, clean: boolean) => c3Problems(c, setup, { clean }));
  mkdirSync(join(dir, "repo"), { recursive: true, mode: 0o755 });
  mkdirSync(join(dir, "context"), { recursive: true, mode: 0o755 });
  writeFileSync(join(dir, "repo", "README.md"), "# Preflight fixture\n");
  writeFileSync(join(dir, "plan.md"), "# Plan\n\nThe preflight's fixture plan.\n");
  writeFileSync(join(dir, "context", "notes.md"), "The preflight's fixture context.\n");
  const setup = sessionSetup(GSTACK_ARMS[0]!, "opus");
  let c: ReviewContainer;
  try {
    c = s.start(setup, dir);
  } catch (e) {
    bad("start: failed: " + failure(e));
    return { lines, problems };
  }
  try {
    const seen = c.inspect();
    lines.push("start: " + c.name + " as user " + seen.user + " on " + (seen.networks.join(", ") || "no network"));
    const before = c3(c, setup, true);
    if (before.length) bad("C3 before the install: " + causeText(before.join("; ")));
    else {
      lines.push("C3 before the install: ok (a non-root user, the three frozen mounts, the pinned image, one network, no key variable)");
      const install = s.install(c);
      if (install.code !== 0) bad("gstack install: exited " + install.code);
      else lines.push("gstack install: ok, the install digest " + install.install_digest + " is the pinned tree's, networks after it " + install.networks_after.join(", "));
      const after = c3(c, setup, false);
      if (after.length) bad("C3 after the install: " + causeText(after.join("; ")));
      else lines.push("C3 after the install: ok");
      const v = c.run("claude --version", 60_000);
      if (v.code !== 0) bad("claude --version, the no-model start: failed (exit " + v.code + ")" + (v.stderr.trim() ? ": " + causeText(v.stderr) : ""));
      else lines.push("claude --version, the no-model start: ok, " + v.stdout.trim().replace(/\s+/g, " ").slice(0, 80));
    }
  } catch (e) {
    bad("the check stopped: " + failure(e));
  }
  try {
    c.stop();
    lines.push("removal: " + c.name + " removed, and docker container inspect reports no such container (PD-43 condition 1)");
  } catch (e) {
    bad("removal: " + failure(e));
  }
  return { lines, problems };
}

/** A simulated container for the keyless launch and tests: it passes every step unless told to fail one. */
export function fakeContainerSeams(o: { fail?: "start" | "install-digest" | "claude" | "removal" } = {}): ContainerSeams & { stopped: number } {
  const seams = {
    stopped: 0,
    start: (_setup: SessionSetup, folder: string): ReviewContainer => {
      if (o.fail === "start") throw new DcError("E_DC_INFRA_MISSING", "could not start the review container: no such image");
      return {
        name: "dc-review-fake",
        folder,
        network: "dc-trial-fake",
        inspect: () => ({ image: "sha256:fake", user: "1000:1000", mounts: [], networks: ["dc-trial-fake"], env: [] }),
        run: () => (o.fail === "claude" ? { code: 126, stdout: "", stderr: "sh: 1: claude: Permission denied" } : { code: 0, stdout: "2.1.314 (Claude Code)\n", stderr: "" }),
        stop: () => {
          seams.stopped++;
          if (o.fail === "removal") throw new DcError("E_DCW_CONTAINER_LEFT", "the review container dc-review-fake was not removed after its session (docker rm -f exited 1): device busy; the row stops (PD-43 condition 1)");
        },
      } as unknown as ReviewContainer;
    },
    install: (): GstackInstall => {
      if (o.fail === "install-digest") throw new DcError("E_DCW_INSTALL_DIGEST", "the installed tree's digest differs from the pinned tree's");
      return { code: 0, log: "", git_tree: "t", tree_sha256: "s", pinned_digest: "d".repeat(64), install_digest: "d".repeat(64), networks_after: ["dc-trial-fake"] };
    },
    c3: () => [],
  };
  return seams;
}
